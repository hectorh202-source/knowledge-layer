import {
  allSubscriptions,
  createPaymentLink,
  ensureCustomer,
  deactivateLink,
  invoicesFor as stripeInvoicesFor,
  listPrices,
  openInvoices,
  stripeEnabled,
  stripeMode,
  subscriptionFor,
  type LiveInvoice,
  type LiveSubscription,
  type StripePrice,
} from "./stripe";

/**
 * Billing.
 *
 * Stripe owns money and schedule. This module owns exactly one fact Stripe
 * cannot know — which Stripe customer is which client of ours — and reads
 * everything else live.
 *
 * There is no plan table, no subscription table and no invoice table. There
 * used to be all three, and keeping them meant raising and sending an invoice
 * by hand every month for every client, forever. Stripe already does that,
 * better, including the card retries nobody wants to write.
 *
 * The cost of reading live is a request or two per page. The benefit is that a
 * price changed in the Stripe dashboard is correct here immediately, and there
 * is no second copy of anything to drift.
 */

export interface Account {
  tenantSlug: string;
  contactEmail: string;
  stripeCustomerId: string | null;
  paymentLinkId: string | null;
  paymentLinkUrl: string | null;
  stripeMode: string | null;
  notes: string;
}

export interface ClientBilling {
  account: Account | null;
  subscription: LiveSubscription | null;
  invoices: LiveInvoice[];
  prices: { recurring: StripePrice[]; oneOff: StripePrice[] };
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
    throw new Error("Billing needs Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
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

function toAccount(r: Record<string, unknown>): Account {
  return {
    tenantSlug: String(r.tenant_slug),
    contactEmail: String(r.contact_email ?? ""),
    stripeCustomerId: (r.stripe_customer_id as string) ?? null,
    paymentLinkId: (r.payment_link_id as string) ?? null,
    paymentLinkUrl: (r.payment_link_url as string) ?? null,
    stripeMode: (r.stripe_mode as string) ?? null,
    notes: String(r.notes ?? ""),
  };
}

async function upsert(slug: string, fields: Record<string, unknown>): Promise<Account> {
  const rows = (await rest("billing_accounts?on_conflict=tenant_slug", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ tenant_slug: slug, ...fields, updated_at: new Date().toISOString() }),
  })) as Record<string, unknown>[];
  return toAccount(rows[0]);
}

export async function accountFor(slug: string): Promise<Account | null> {
  const rows = (await rest(
    `billing_accounts?tenant_slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`
  )) as Record<string, unknown>[];
  return rows?.length ? toAccount(rows[0]) : null;
}

export async function saveAccount(
  slug: string,
  fields: { contactEmail?: string; notes?: string }
): Promise<Account> {
  return upsert(slug, {
    ...(fields.contactEmail !== undefined ? { contact_email: fields.contactEmail } : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
  });
}

// --- the one action ---------------------------------------------------------

/**
 * Put a client on a plan and produce the link that starts it.
 *
 * The whole flow. One call creates the payment link, stores it, and hands back
 * something to send. The client pays once; Stripe charges them every month
 * afterwards and nothing here is touched again.
 *
 * An existing link is replaced and the old one deactivated. Two live links for
 * one client means two subscriptions if both get used, and that is a refund
 * conversation rather than a tidiness problem.
 */
export async function startBilling(input: {
  slug: string;
  priceId: string;
  setupPriceId?: string | null;
  contactEmail?: string;
}): Promise<Account> {
  if (!stripeEnabled()) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to .env.");
  }

  const existing = await accountFor(input.slug);
  if (existing?.paymentLinkId) await deactivateLink(existing.paymentLinkId);

  const link = await createPaymentLink({
    slug: input.slug,
    priceId: input.priceId,
    setupPriceId: input.setupPriceId,
  });

  return upsert(input.slug, {
    payment_link_id: link.id,
    payment_link_url: link.url,
    stripe_mode: link.mode,
    ...(input.contactEmail ? { contact_email: input.contactEmail } : {}),
  });
}

/**
 * One client's billing, as Stripe currently sees it.
 *
 * The customer id is written back when the first payment lands — Stripe creates
 * the customer at checkout, so there is nothing to record until then.
 */
export async function clientBilling(slug: string): Promise<ClientBilling> {
  const account = await accountFor(slug);

  if (!stripeEnabled()) {
    return { account, subscription: null, invoices: [], prices: { recurring: [], oneOff: [] } };
  }

  const [subscription, prices] = await Promise.all([
    subscriptionFor(slug, account?.stripeCustomerId),
    listPrices(),
  ]);

  let invoices: LiveInvoice[] = [];
  if (subscription) {
    invoices = await stripeInvoicesFor(subscription.customerId);

    if (account?.stripeCustomerId !== subscription.customerId) {
      await upsert(slug, {
        stripe_customer_id: subscription.customerId,
        ...(subscription.customerEmail && !account?.contactEmail
          ? { contact_email: subscription.customerEmail }
          : {}),
      });
    }
  } else if (account?.stripeCustomerId) {
    invoices = await stripeInvoicesFor(account.stripeCustomerId);
  }

  return {
    account: subscription ? await accountFor(slug) : account,
    subscription,
    invoices,
    prices,
  };
}

/**
 * The Stripe customer for a client, created and recorded if absent.
 *
 * Persisting the id is what makes this safe to press twice: Stripe's search
 * index lags behind creation by up to a minute, so a version that only searched
 * would make a second customer and split the payment history.
 */
export async function ensureCustomerFor(
  slug: string,
  email?: string,
  name?: string
): Promise<string> {
  const account = await accountFor(slug);
  const id = await ensureCustomer(slug, account?.stripeCustomerId, email, name);

  if (account?.stripeCustomerId !== id || (email && account?.contactEmail !== email)) {
    await upsert(slug, {
      stripe_customer_id: id,
      ...(email ? { contact_email: email } : {}),
    });
  }

  return id;
}

// --- the overview -----------------------------------------------------------

export interface BillingRow {
  tenantSlug: string;
  contactEmail: string;
  status: string;
  live: boolean;
  amountCents: number;
  interval: string;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  /** A link exists but nobody has paid it yet. */
  awaitingPayment: boolean;
  paymentLinkUrl: string | null;
  overdueCents: number;
}

export interface BillingSummary {
  rows: BillingRow[];
  mrrCents: number;
  overdueCents: number;
  activeCount: number;
  awaitingCount: number;
  /** Clients with no plan and no link — nobody has started billing them. */
  unbilledSlugs: string[];
  prices: { recurring: StripePrice[]; oneOff: StripePrice[] };
  stripe: { enabled: boolean; mode: string | null };
}

/**
 * Every client, and what Stripe says about them.
 *
 * Three Stripe calls total, not three per client. At fifty clients the
 * per-client version is a hundred and fifty round trips to draw one table.
 */
export async function summary(slugs: string[]): Promise<BillingSummary> {
  const accounts = ((await rest("billing_accounts?select=*")) ?? []) as Record<string, unknown>[];
  const byslug = new Map(accounts.map((a) => [String(a.tenant_slug), toAccount(a)]));

  if (!stripeEnabled()) {
    return {
      rows: [],
      mrrCents: 0,
      overdueCents: 0,
      activeCount: 0,
      awaitingCount: 0,
      unbilledSlugs: slugs,
      prices: { recurring: [], oneOff: [] },
      stripe: { enabled: false, mode: null },
    };
  }

  const [subs, open, prices] = await Promise.all([allSubscriptions(), openInvoices(), listPrices()]);

  const overdueByCustomer = new Map<string, number>();
  const now = new Date().toISOString().slice(0, 10);
  for (const inv of open) {
    // Open but not yet due is not overdue — it is the current month waiting
    // for a card to be charged, which is the normal state of things.
    if (inv.dueOn && inv.dueOn >= now) continue;
    const running = overdueByCustomer.get(inv.customerId) ?? 0;
    overdueByCustomer.set(inv.customerId, running + inv.amountCents);
  }

  const rows: BillingRow[] = [];
  const unbilledSlugs: string[] = [];
  let mrr = 0;
  let overdue = 0;
  let active = 0;
  let awaiting = 0;

  for (const slug of slugs) {
    const account = byslug.get(slug) ?? null;
    const sub = subs.get(slug) ?? null;

    if (!sub && !account?.paymentLinkUrl) {
      unbilledSlugs.push(slug);
      continue;
    }

    const overdueCents = sub ? (overdueByCustomer.get(sub.customerId) ?? 0) : 0;

    if (sub?.live) {
      // Yearly spread over twelve, so one client's contract shape does not make
      // the MRR line jump by a factor of twelve in the month they renew.
      mrr += sub.interval === "year" ? Math.round(sub.amountCents / 12) : sub.amountCents;
      active++;
    }
    if (!sub && account?.paymentLinkUrl) awaiting++;
    overdue += overdueCents;

    rows.push({
      tenantSlug: slug,
      contactEmail: account?.contactEmail || sub?.customerEmail || "",
      status: sub?.status ?? "awaiting payment",
      live: sub?.live ?? false,
      amountCents: sub?.amountCents ?? 0,
      interval: sub?.interval ?? "month",
      renewsOn: sub?.renewsOn ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      awaitingPayment: !sub && Boolean(account?.paymentLinkUrl),
      paymentLinkUrl: account?.paymentLinkUrl ?? null,
      overdueCents,
    });
  }

  return {
    rows,
    mrrCents: mrr,
    overdueCents: overdue,
    activeCount: active,
    awaitingCount: awaiting,
    unbilledSlugs,
    prices,
    stripe: { enabled: true, mode: stripeMode() },
  };
}
