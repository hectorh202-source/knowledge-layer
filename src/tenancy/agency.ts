import { listTenantSlugs } from "./store";

/**
 * Which clients a signed-in user may see.
 *
 * Client content lives in files; who may touch it lives in Supabase, because
 * that is where the users are. This module is the join.
 *
 * Queried with the service role rather than the user's token. The portal has
 * already authenticated the request, and using the user's token here would mean
 * the server could only see what RLS lets that user see — which is the same
 * answer by a longer route, and one that breaks the moment the server needs to
 * do something on a user's behalf, like claiming a client during signup.
 *
 * When Supabase is not configured there are no agencies and every client is
 * visible. That keeps the local single-operator workflow working exactly as it
 * did, which is what the whole app was until today.
 */

export interface Agency {
  id: string;
  name: string;
  role: "owner" | "member";
}

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export function agenciesEnabled(): boolean {
  return config() !== null;
}

async function query(path: string, init?: RequestInit): Promise<unknown> {
  const cfg = config();
  if (!cfg) return null;

  const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/** The user's agency, creating one on first sign-in. */
export async function agencyFor(user: { id: string; email: string }): Promise<Agency | null> {
  if (!agenciesEnabled()) return null;

  const rows = (await query(
    `agency_members?user_id=eq.${user.id}&select=role,agencies(id,name)&limit=1`
  )) as { role: string; agencies: { id: string; name: string } }[];

  if (rows.length > 0 && rows[0].agencies) {
    return {
      id: rows[0].agencies.id,
      name: rows[0].agencies.name,
      role: rows[0].role === "owner" ? "owner" : "member",
    };
  }

  // An invite beats provisioning. Without this an invited colleague signs in
  // and lands in a brand new empty agency, which looks identical to the invite
  // having silently failed.
  const joined = await acceptInvite(user);
  if (joined) return joined;

  return provision(user);
}

/** Redeems a pending invite for this address, if there is one. */
async function acceptInvite(user: { id: string; email: string }): Promise<Agency | null> {
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) return null;

  const invites = (await query(
    `agency_invites?email=eq.${encodeURIComponent(email)}&accepted_at=is.null` +
      `&select=id,role,agencies(id,name)&limit=1`
  )) as { id: string; role: string; agencies: { id: string; name: string } | null }[];

  const invite = invites[0];
  if (!invite?.agencies) return null;

  await query(`agency_members`, {
    method: "POST",
    body: JSON.stringify({ agency_id: invite.agencies.id, user_id: user.id, role: invite.role }),
  });

  // Marked rather than deleted, so the owner can see the invite was taken up
  // rather than wondering whether it ever arrived.
  await query(`agency_invites?id=eq.${invite.id}`, {
    method: "PATCH",
    body: JSON.stringify({ accepted_at: new Date().toISOString() }),
  });

  return {
    id: invite.agencies.id,
    name: invite.agencies.name,
    role: invite.role === "owner" ? "owner" : "member",
  };
}

/**
 * First sign-in: give the user an agency rather than an empty screen.
 *
 * The very first agency also claims any client folders already on disk. That is
 * the migration from single-operator to multi-tenant, and it only happens once
 * — a second user gets a fresh, empty agency and cannot inherit somebody else's
 * clients by being late.
 */
async function provision(user: { id: string; email: string }): Promise<Agency> {
  const existing = (await query(`agencies?select=id&limit=1`)) as { id: string }[];
  const isFirst = existing.length === 0;

  const created = (await query(`agencies`, {
    method: "POST",
    body: JSON.stringify({ name: user.email ? `${user.email.split("@")[0]}'s agency` : "My agency" }),
  })) as { id: string; name: string }[];

  const agency = created[0];

  await query(`agency_members`, {
    method: "POST",
    body: JSON.stringify({ agency_id: agency.id, user_id: user.id, role: "owner" }),
  });

  if (isFirst) {
    const unclaimed = await listTenantSlugs();
    if (unclaimed.length > 0) {
      await query(`agency_clients`, {
        method: "POST",
        body: JSON.stringify(unclaimed.map((slug) => ({ agency_id: agency.id, tenant_slug: slug }))),
      });
    }
  }

  return { id: agency.id, name: agency.name, role: "owner" };
}

/** Slugs this agency owns. Null means agencies are off — everything is visible. */
export async function slugsFor(agencyId: string | null): Promise<string[] | null> {
  if (!agenciesEnabled() || !agencyId) return null;

  const rows = (await query(
    `agency_clients?agency_id=eq.${agencyId}&select=tenant_slug`
  )) as { tenant_slug: string }[];

  return rows.map((row) => row.tenant_slug);
}

// --- platform ---------------------------------------------------------------

/**
 * Platform administration, granted by environment variable rather than a table.
 *
 * Deliberate. This is the one role that can create agencies, and a role that
 * powerful should not be grantable through a web form by whoever currently
 * holds it — a single compromised session would otherwise be permanent. Editing
 * .env and restarting is a slower, more visible act, and that is the point.
 *
 *   PLATFORM_ADMIN_EMAILS=you@example.com,partner@example.com
 */
export function isPlatformAdmin(email: string | undefined): boolean {
  const allowed = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0 || !email) return false;
  return allowed.includes(email.trim().toLowerCase());
}

export interface AgencySummary {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  pending: number;
  clients: number;
}

/** Every agency on the platform, with enough to see who is actually using it. */
export async function listAgencies(): Promise<AgencySummary[]> {
  if (!agenciesEnabled()) return [];

  const agencies = (await query(`agencies?select=id,name,created_at&order=created_at`)) as {
    id: string;
    name: string;
    created_at: string;
  }[];

  const members = (await query(`agency_members?select=agency_id`)) as { agency_id: string }[];
  const invites = (await query(`agency_invites?accepted_at=is.null&select=agency_id`)) as {
    agency_id: string;
  }[];
  const clients = (await query(`agency_clients?select=agency_id`)) as { agency_id: string }[];

  const count = (rows: { agency_id: string }[], id: string): number =>
    rows.filter((row) => row.agency_id === id).length;

  return agencies.map((agency) => ({
    id: agency.id,
    name: agency.name,
    createdAt: agency.created_at,
    members: count(members, agency.id),
    pending: count(invites, agency.id),
    clients: count(clients, agency.id),
  }));
}

/**
 * Creates an agency and invites its first owner.
 *
 * The owner arrives through the same invite path as any other member, so there
 * is one way into an agency rather than two. Without the invite the agency
 * would exist with nobody able to reach it, and the person it was made for
 * would sign in and be handed a second, empty agency of their own.
 */
export async function createAgency(name: string, ownerEmail: string): Promise<{ id: string; name: string }> {
  if (!agenciesEnabled()) throw new Error("Supabase is not configured.");

  const trimmed = name.trim();
  const email = ownerEmail.trim().toLowerCase();

  if (!trimmed) throw new Error("An agency name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That is not an email address.");

  const clash = (await query(
    `agency_invites?email=eq.${encodeURIComponent(email)}&accepted_at=is.null&select=id`
  )) as { id: string }[];
  if (clash.length > 0) {
    throw new Error("That address already has an invite outstanding somewhere on the platform.");
  }

  const created = (await query(`agencies`, {
    method: "POST",
    body: JSON.stringify({ name: trimmed }),
  })) as { id: string; name: string }[];

  const agency = created[0];

  try {
    await query(`agency_invites`, {
      method: "POST",
      body: JSON.stringify({ agency_id: agency.id, email, role: "owner" }),
    });
  } catch (error) {
    // An agency nobody can reach is litter. Remove it rather than leave it.
    await query(`agencies?id=eq.${agency.id}`, { method: "DELETE" });
    throw error;
  }

  return agency;
}

// --- team ------------------------------------------------------------------

export interface Member {
  userId: string;
  email: string;
  role: "owner" | "member";
  /** Absent for a pending invite — they have not signed in yet. */
  joined: boolean;
}

/** Everyone in the agency, joined and invited, in one list. */
export async function listMembers(agencyId: string): Promise<Member[]> {
  if (!agenciesEnabled()) return [];

  const members = (await query(
    `agency_members?agency_id=eq.${agencyId}&select=user_id,role`
  )) as { user_id: string; role: string }[];

  // Emails live in auth.users, which PostgREST does not expose. The admin API
  // does, and one call for the whole list beats one per member.
  const emails = new Map<string, string>();
  const cfg = config();
  if (cfg && members.length > 0) {
    const response = await fetch(`${cfg.url}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    });
    if (response.ok) {
      const body = (await response.json()) as { users?: { id: string; email?: string }[] };
      for (const user of body.users ?? []) emails.set(user.id, user.email ?? "");
    }
  }

  const pending = (await query(
    `agency_invites?agency_id=eq.${agencyId}&accepted_at=is.null&select=email,role`
  )) as { email: string; role: string }[];

  return [
    ...members.map((m) => ({
      userId: m.user_id,
      email: emails.get(m.user_id) || "(unknown)",
      role: m.role === "owner" ? ("owner" as const) : ("member" as const),
      joined: true,
    })),
    ...pending.map((p) => ({
      userId: "",
      email: p.email,
      role: p.role === "owner" ? ("owner" as const) : ("member" as const),
      joined: false,
    })),
  ];
}

/**
 * Asks Supabase to send an invite email, which also creates the account.
 *
 * Best effort, and separate from writing the invite row on purpose: the row is
 * what decides which agency someone joins, the email is only a convenience. A
 * caller that has already written the row calls this alone.
 */
export async function sendInviteEmail(email: string): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;

  try {
    const response = await fetch(`${cfg.url}/auth/v1/invite`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface InviteResult {
  email: string;
  /** Whether Supabase managed to send an invite email. */
  emailed: boolean;
  note: string;
}

/**
 * Invites someone to the agency.
 *
 * Two things happen, and the second is the one that matters. Supabase is asked
 * to send an invite email, which also creates the account — but that depends on
 * email being configured, and the built-in sender is rate limited. So the
 * invite row is written regardless, and it is the row that decides which agency
 * they land in.
 *
 * The result says plainly whether the email went, so an owner whose SMTP is not
 * set up is told to create the account by hand rather than waiting for a
 * message that is never coming.
 */
export async function invite(
  agencyId: string,
  invitedBy: string,
  rawEmail: string
): Promise<InviteResult> {
  const cfg = config();
  const email = rawEmail.trim().toLowerCase();

  if (!cfg) throw new Error("Supabase is not configured.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That is not an email address.");

  const existing = (await query(
    `agency_invites?email=eq.${encodeURIComponent(email)}&accepted_at=is.null&select=id`
  )) as { id: string }[];

  if (existing.length === 0) {
    await query(`agency_invites`, {
      method: "POST",
      body: JSON.stringify({ agency_id: agencyId, email, invited_by: invitedBy }),
    });
  }

  const emailed = await sendInviteEmail(email);

  return {
    email,
    emailed,
    note: emailed
      ? "Invite email sent. They join this agency the first time they sign in."
      : "Could not send an invite email — Supabase email may not be configured. Create their " +
        "account in Authentication → Users and they will join this agency on first sign-in.",
  };
}

/** Removes a member, or withdraws an invite that has not been taken up. */
export async function removeMember(agencyId: string, target: string): Promise<void> {
  if (!agenciesEnabled()) return;

  if (target.includes("@")) {
    await query(
      `agency_invites?agency_id=eq.${agencyId}&email=eq.${encodeURIComponent(
        target.toLowerCase()
      )}&accepted_at=is.null`,
      { method: "DELETE" }
    );
    return;
  }

  await query(`agency_members?agency_id=eq.${agencyId}&user_id=eq.${target}`, { method: "DELETE" });
}

/**
 * Owners in the agency, so the last one cannot remove themselves.
 *
 * An agency with no owner has clients nobody can invite anyone to, and no way
 * back without database access.
 */
export async function ownerCount(agencyId: string): Promise<number> {
  if (!agenciesEnabled()) return 0;
  const rows = (await query(
    `agency_members?agency_id=eq.${agencyId}&role=eq.owner&select=user_id`
  )) as { user_id: string }[];
  return rows.length;
}

export async function claim(agencyId: string, slug: string): Promise<void> {
  if (!agenciesEnabled()) return;
  await query(`agency_clients`, {
    method: "POST",
    body: JSON.stringify({ agency_id: agencyId, tenant_slug: slug }),
  });
}

export async function release(slug: string): Promise<void> {
  if (!agenciesEnabled()) return;
  await query(`agency_clients?tenant_slug=eq.${encodeURIComponent(slug)}`, { method: "DELETE" });
}

/**
 * Whether this agency may touch this client.
 *
 * The check that matters. Filtering the client list is cosmetic — every route
 * that takes a :slug has to ask this, or another agency's client is one guessed
 * URL away.
 */
export async function mayAccess(agencyId: string | null, slug: string): Promise<boolean> {
  if (!agenciesEnabled()) return true;
  if (!agencyId) return false;

  const rows = (await query(
    `agency_clients?agency_id=eq.${agencyId}&tenant_slug=eq.${encodeURIComponent(slug)}&select=tenant_slug`
  )) as { tenant_slug: string }[];

  return rows.length > 0;
}
