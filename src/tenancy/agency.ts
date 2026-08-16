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

  return provision(user);
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
    const unclaimed = listTenantSlugs();
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
