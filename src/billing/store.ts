/**
 * Billing — what each client is on, and what they owe.
 *
 * A ledger, not a payment processor. It answers "who owes me what, and since
 * when", and produces an invoice you can send. Money moves by whatever means
 * you already use; no card details reach this application.
 *
 * **Supabase only, on purpose.** Everything else in this app falls back to
 * files when Supabase is absent, because client content is per-tenant and a
 * directory models it honestly. Billing is cross-tenant and it is money — a
 * JSON file that silently diverges from the database is worse than an honest
 * "billing needs Supabase". `billingEnabled()` is the check; the portal says so
 * rather than showing an empty page.
 *
 * Amounts are integer cents throughout. A price stored as a float is a
 * rounding error that compounds twelve times a year and surfaces as an invoice
 * disagreeing with itself by a penny.
 */

export interface Plan {
  id: string;
  name: string;
  setupCents: number;
  monthlyCents: number;
  currency: string;
}

export interface Account {
  id: string;
  tenantSlug: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  notes: string;
}

export interface Subscription {
  id: string;
  accountId: string;
  planId: string;
  planName: string;
  /** The rate actually charged — the override if set, otherwise the plan's. */
  monthlyCents: number;
  /** True when this client is not on the plan's list price. */
  isCustomRate: boolean;
  interval: "monthly" | "annual";
  status: "trialing" | "active" | "paused" | "cancelled";
  startedOn: string;
  nextInvoiceOn: string;
  setupCents: number;
  setupInvoiced: boolean;
}

export interface InvoiceLine {
  description: string;
  amountCents: number;
  kind: "setup" | "subscription" | "adjustment";
}

export interface Invoice {
  id: string;
  accountId: string;
  tenantSlug: string;
  number: string;
  periodStart: string | null;
  periodEnd: string | null;
  lines: InvoiceLine[];
  totalCents: number;
  currency: string;
  status: "draft" | "issued" | "paid" | "void";
  issuedOn: string | null;
  dueOn: string | null;
  paidOn: string | null;
  paidMethod: string;
}

// ---------------------------------------------------------------------------

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export function billingEnabled(): boolean {
  return config() !== null;
}

async function rest(path: string, init?: RequestInit): Promise<unknown> {
  const cfg = config();
  if (!cfg) {
    throw new Error(
      "Billing needs Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env."
    );
  }

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
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Cents to "$800.00". The only place money becomes a string. */
export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Today, as an ISO date. Isolated so the whole module has one idea of "now". */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Day 0 of the following month is the last day of the target month, which is
  // how a 31st survives February without silently becoming March 3rd.
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  return date.toISOString().slice(0, 10);
}

// --- plans -----------------------------------------------------------------

export async function listPlans(): Promise<Plan[]> {
  const rows = (await rest("billing_plans?is_active=eq.true&select=*&order=monthly_cents")) as
    | Record<string, unknown>[]
    | null;

  return (rows ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    setupCents: Number(r.setup_cents),
    monthlyCents: Number(r.monthly_cents),
    currency: String(r.currency ?? "USD"),
  }));
}

// --- accounts and subscriptions --------------------------------------------

const SUB_SELECT =
  "*,billing_plans(name,monthly_cents,setup_cents),billing_accounts(tenant_slug)";

function toSubscription(r: Record<string, unknown>): Subscription {
  const plan = (r.billing_plans ?? {}) as Record<string, unknown>;
  const override = r.monthly_cents === null ? null : Number(r.monthly_cents);
  const planRate = Number(plan.monthly_cents ?? 0);

  return {
    id: String(r.id),
    accountId: String(r.account_id),
    planId: String(r.plan_id),
    planName: String(plan.name ?? "—"),
    monthlyCents: override ?? planRate,
    isCustomRate: override !== null && override !== planRate,
    interval: r.interval === "annual" ? "annual" : "monthly",
    status: String(r.status) as Subscription["status"],
    startedOn: String(r.started_on),
    nextInvoiceOn: String(r.next_invoice_on),
    setupCents: Number(r.setup_cents ?? 0),
    setupInvoiced: r.setup_invoiced === true,
  };
}

/** The billing account for one client, with its live subscription if any. */
export async function accountFor(
  slug: string
): Promise<{ account: Account; subscription: Subscription | null } | null> {
  const rows = (await rest(
    `billing_accounts?tenant_slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`
  )) as Record<string, unknown>[];

  if (!rows || rows.length === 0) return null;
  const r = rows[0];

  const account: Account = {
    id: String(r.id),
    tenantSlug: String(r.tenant_slug),
    companyName: String(r.company_name ?? ""),
    contactName: String(r.contact_name ?? ""),
    contactEmail: String(r.contact_email ?? ""),
    notes: String(r.notes ?? ""),
  };

  const subs = (await rest(
    `billing_subscriptions?account_id=eq.${account.id}&status=in.(trialing,active,paused)` +
      `&select=${SUB_SELECT}&limit=1`
  )) as Record<string, unknown>[];

  return { account, subscription: subs?.length ? toSubscription(subs[0]) : null };
}

/** Create or update the billing account for a client. */
export async function saveAccount(
  slug: string,
  fields: Partial<Omit<Account, "id" | "tenantSlug">> & { agencyId?: string | null }
): Promise<Account> {
  const rows = (await rest(`billing_accounts?on_conflict=tenant_slug`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      tenant_slug: slug,
      ...(fields.agencyId !== undefined ? { agency_id: fields.agencyId } : {}),
      ...(fields.companyName !== undefined ? { company_name: fields.companyName } : {}),
      ...(fields.contactName !== undefined ? { contact_name: fields.contactName } : {}),
      ...(fields.contactEmail !== undefined ? { contact_email: fields.contactEmail } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      updated_at: new Date().toISOString(),
    }),
  })) as Record<string, unknown>[];

  const r = rows[0];
  return {
    id: String(r.id),
    tenantSlug: String(r.tenant_slug),
    companyName: String(r.company_name ?? ""),
    contactName: String(r.contact_name ?? ""),
    contactEmail: String(r.contact_email ?? ""),
    notes: String(r.notes ?? ""),
  };
}

/**
 * Put a client on a plan.
 *
 * Replaces any live subscription rather than adding one — the unique index
 * would refuse a second, and two live subscriptions is two monthly charges for
 * one client wearing the disguise of a half-applied plan change.
 */
export async function subscribe(
  slug: string,
  input: {
    planId: string;
    monthlyCents?: number | null;
    setupCents?: number;
    interval?: "monthly" | "annual";
    startedOn?: string;
  }
): Promise<Subscription> {
  const existing = await accountFor(slug);
  if (!existing) throw new Error(`No billing account for "${slug}".`);

  if (existing.subscription) {
    await rest(`billing_subscriptions?id=eq.${existing.subscription.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled", cancelled_on: today() }),
    });
  }

  const plans = await listPlans();
  const plan = plans.find((p) => p.id === input.planId);
  if (!plan) throw new Error("Unknown plan.");

  const started = input.startedOn || today();

  const rows = (await rest(`billing_subscriptions?select=${SUB_SELECT}`, {
    method: "POST",
    body: JSON.stringify({
      account_id: existing.account.id,
      plan_id: plan.id,
      monthly_cents: input.monthlyCents ?? null,
      setup_cents: input.setupCents ?? plan.setupCents,
      interval: input.interval ?? "monthly",
      started_on: started,
      next_invoice_on: started,
      // Carried over, so changing plan does not re-charge the data lift. The
      // setup fee is for onboarding the business, and that happened once.
      setup_invoiced: existing.subscription?.setupInvoiced ?? false,
    }),
  })) as Record<string, unknown>[];

  return toSubscription(rows[0]);
}

export async function updateSubscription(
  id: string,
  fields: { status?: Subscription["status"]; monthlyCents?: number | null; interval?: string }
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.status) {
    patch.status = fields.status;
    if (fields.status === "cancelled") patch.cancelled_on = today();
  }
  if (fields.monthlyCents !== undefined) patch.monthly_cents = fields.monthlyCents;
  if (fields.interval) patch.interval = fields.interval;

  await rest(`billing_subscriptions?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// --- invoices ---------------------------------------------------------------

function toInvoice(r: Record<string, unknown>, slug: string): Invoice {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    tenantSlug: slug,
    number: String(r.number),
    periodStart: (r.period_start as string) ?? null,
    periodEnd: (r.period_end as string) ?? null,
    lines: Array.isArray(r.lines) ? (r.lines as InvoiceLine[]) : [],
    totalCents: Number(r.total_cents ?? 0),
    currency: String(r.currency ?? "USD"),
    status: String(r.status) as Invoice["status"],
    issuedOn: (r.issued_on as string) ?? null,
    dueOn: (r.due_on as string) ?? null,
    paidOn: (r.paid_on as string) ?? null,
    paidMethod: String(r.paid_method ?? ""),
  };
}

/**
 * The next invoice number.
 *
 * Sequential and gap-free is not attempted — a gap in a number series is
 * cosmetic, whereas two invoices sharing a number is a real problem, and the
 * unique constraint on `number` is what actually prevents it. Year-prefixed so
 * the series restarts annually and stays short enough to quote on a transfer.
 */
async function nextNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = (await rest(
    `billing_invoices?number=like.${year}-*&select=number&order=number.desc&limit=1`
  )) as { number: string }[];

  const last = rows?.[0]?.number;
  const seq = last ? Number(last.split("-")[1]) + 1 : 1;
  return `${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Bill one client for their next period.
 *
 * Includes the setup fee the first time and never again. Returns null when the
 * client has nothing due — no live subscription, or already invoiced past this
 * date — so running it across everyone is safe to repeat.
 */
export async function invoiceClient(
  slug: string,
  options?: { upTo?: string; dueDays?: number }
): Promise<Invoice | null> {
  const found = await accountFor(slug);
  if (!found?.subscription) return null;

  const sub = found.subscription;
  if (sub.status === "cancelled" || sub.status === "paused") return null;

  const upTo = options?.upTo || today();
  if (sub.nextInvoiceOn > upTo) return null;

  const months = sub.interval === "annual" ? 12 : 1;
  const periodStart = sub.nextInvoiceOn;
  const periodEnd = addMonths(periodStart, months);

  const lines: InvoiceLine[] = [];

  if (!sub.setupInvoiced && sub.setupCents > 0) {
    lines.push({
      description: "Setup — extraction, review and first publication",
      amountCents: sub.setupCents,
      kind: "setup",
    });
  }

  lines.push({
    description:
      sub.interval === "annual"
        ? `${sub.planName} — 12 months, ${periodStart} to ${periodEnd}`
        : `${sub.planName} — ${periodStart} to ${periodEnd}`,
    amountCents: sub.monthlyCents * months,
    kind: "subscription",
  });

  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const issued = today();
  const due = addMonths(issued, 0);
  const dueOn = new Date(Date.parse(due) + (options?.dueDays ?? 14) * 86400000)
    .toISOString()
    .slice(0, 10);

  const rows = (await rest(`billing_invoices`, {
    method: "POST",
    body: JSON.stringify({
      account_id: found.account.id,
      number: await nextNumber(),
      period_start: periodStart,
      period_end: periodEnd,
      lines,
      total_cents: total,
      status: "issued",
      issued_on: issued,
      due_on: dueOn,
    }),
  })) as Record<string, unknown>[];

  await rest(`billing_subscriptions?id=eq.${sub.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      next_invoice_on: periodEnd,
      setup_invoiced: true,
      updated_at: new Date().toISOString(),
    }),
  });

  return toInvoice(rows[0], slug);
}

/**
 * Which client an invoice or subscription belongs to.
 *
 * So the routes that address one by id can be checked against the caller's
 * agency. An unguessable id is not an access control — it is a bet that nobody
 * ever pastes one into the wrong window, and these rows are money.
 */
export async function slugForInvoice(id: string): Promise<string | null> {
  const rows = (await rest(
    `billing_invoices?id=eq.${encodeURIComponent(id)}&select=billing_accounts(tenant_slug)&limit=1`
  )) as { billing_accounts?: { tenant_slug: string } }[];
  return rows?.[0]?.billing_accounts?.tenant_slug ?? null;
}

export async function slugForSubscription(id: string): Promise<string | null> {
  const rows = (await rest(
    `billing_subscriptions?id=eq.${encodeURIComponent(id)}&select=billing_accounts(tenant_slug)&limit=1`
  )) as { billing_accounts?: { tenant_slug: string } }[];
  return rows?.[0]?.billing_accounts?.tenant_slug ?? null;
}

export async function markPaid(id: string, method: string): Promise<void> {
  await rest(`billing_invoices?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "paid",
      paid_on: today(),
      paid_method: method || "",
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function voidInvoice(id: string): Promise<void> {
  await rest(`billing_invoices?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "void", updated_at: new Date().toISOString() }),
  });
}

export async function invoicesFor(slug: string): Promise<Invoice[]> {
  const found = await accountFor(slug);
  if (!found) return [];

  const rows = (await rest(
    `billing_invoices?account_id=eq.${found.account.id}&select=*&order=created_at.desc&limit=50`
  )) as Record<string, unknown>[];

  return (rows ?? []).map((r) => toInvoice(r, slug));
}

// --- the overview -----------------------------------------------------------

export interface BillingRow {
  tenantSlug: string;
  companyName: string;
  contactEmail: string;
  planName: string | null;
  monthlyCents: number;
  isCustomRate: boolean;
  interval: "monthly" | "annual";
  status: Subscription["status"] | "none";
  nextInvoiceOn: string | null;
  setupOwed: boolean;
  /** Issued, unpaid, past its due date. */
  overdueCents: number;
  overdueCount: number;
  openCents: number;
}

export interface BillingSummary {
  rows: BillingRow[];
  /** Monthly recurring revenue, with annual subscriptions spread over twelve. */
  mrrCents: number;
  overdueCents: number;
  openCents: number;
  unbilledSetupCents: number;
  activeCount: number;
  /** Clients with no billing account at all. */
  unbilledSlugs: string[];
}

/**
 * Everything the billing page shows, in three queries rather than three per
 * client. At fifty clients the per-client version is a hundred and fifty round
 * trips to render one table.
 */
export async function summary(slugs: string[]): Promise<BillingSummary> {
  const accounts = ((await rest(`billing_accounts?select=*`)) ?? []) as Record<string, unknown>[];
  const subs = ((await rest(
    `billing_subscriptions?status=in.(trialing,active,paused)&select=${SUB_SELECT}`
  )) ?? []) as Record<string, unknown>[];
  const invoices = ((await rest(
    `billing_invoices?status=eq.issued&select=account_id,total_cents,due_on`
  )) ?? []) as { account_id: string; total_cents: number; due_on: string | null }[];

  const now = today();
  const byAccount = new Map<string, Record<string, unknown>>();
  for (const a of accounts) byAccount.set(String(a.tenant_slug), a);

  const subByAccount = new Map<string, Subscription>();
  for (const s of subs) subByAccount.set(String(s.account_id), toSubscription(s));

  const owed = new Map<string, { open: number; overdue: number; overdueCount: number }>();
  for (const inv of invoices) {
    const entry = owed.get(inv.account_id) ?? { open: 0, overdue: 0, overdueCount: 0 };
    entry.open += inv.total_cents;
    if (inv.due_on && inv.due_on < now) {
      entry.overdue += inv.total_cents;
      entry.overdueCount++;
    }
    owed.set(inv.account_id, entry);
  }

  const rows: BillingRow[] = [];
  const unbilledSlugs: string[] = [];
  let mrr = 0, overdue = 0, open = 0, unbilledSetup = 0, active = 0;

  for (const slug of slugs) {
    const account = byAccount.get(slug);
    if (!account) {
      unbilledSlugs.push(slug);
      continue;
    }

    const id = String(account.id);
    const sub = subByAccount.get(id) ?? null;
    const due = owed.get(id) ?? { open: 0, overdue: 0, overdueCount: 0 };

    if (sub && sub.status === "active") {
      // Annual is spread over twelve so one client's contract shape does not
      // make the MRR line jump by a factor of twelve in the month they renew.
      mrr += sub.monthlyCents;
      active++;
    }
    if (sub && !sub.setupInvoiced) unbilledSetup += sub.setupCents;

    overdue += due.overdue;
    open += due.open;

    rows.push({
      tenantSlug: slug,
      companyName: String(account.company_name ?? ""),
      contactEmail: String(account.contact_email ?? ""),
      planName: sub?.planName ?? null,
      monthlyCents: sub?.monthlyCents ?? 0,
      isCustomRate: sub?.isCustomRate ?? false,
      interval: sub?.interval ?? "monthly",
      status: sub?.status ?? "none",
      nextInvoiceOn: sub?.nextInvoiceOn ?? null,
      setupOwed: sub ? !sub.setupInvoiced && sub.setupCents > 0 : false,
      overdueCents: due.overdue,
      overdueCount: due.overdueCount,
      openCents: due.open,
    });
  }

  return {
    rows,
    mrrCents: mrr,
    overdueCents: overdue,
    openCents: open,
    unbilledSetupCents: unbilledSetup,
    activeCount: active,
    unbilledSlugs,
  };
}

/** Every client whose next invoice date has arrived. */
export async function dueNow(slugs: string[]): Promise<string[]> {
  const { rows } = await summary(slugs);
  const now = today();
  return rows
    .filter((r) => r.status === "active" && r.nextInvoiceOn && r.nextInvoiceOn <= now)
    .map((r) => r.tenantSlug);
}
