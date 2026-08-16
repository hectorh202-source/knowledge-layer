import Stripe from "stripe";

/**
 * Stripe, owning billing.
 *
 * The price, the subscription, the monthly charge, the card retries, the
 * receipts — all Stripe's. This app knows which Stripe customer is which
 * client of ours and nothing else about money.
 *
 * That is a deliberate reversal. The first version kept a ledger here and used
 * Stripe only to collect, which meant raising and sending an invoice by hand
 * every month for every client, forever. Stripe already does that perfectly.
 *
 * **Payment links, not Checkout sessions.** A Checkout session needs a
 * success_url the customer's browser can reach, and this portal runs on
 * localhost — the customer would be redirected to a machine that is not
 * theirs. A payment link is hosted end to end by Stripe, needs no public URL
 * of ours, and is a stable thing you can text someone.
 *
 * **Reconciliation is polled.** Loading a billing page asks Stripe what is
 * true. A webhook would be faster and needs a public endpoint; at this size
 * the poll is a request or two and needs nothing.
 */

let client: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/**
 * Test or live, from the key itself.
 *
 * Never a separate setting. A mode flag that can disagree with the key is a way
 * to believe you are testing while charging a real card.
 */
export function stripeMode(): "test" | "live" | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return key.startsWith("sk_live_") ? "live" : "test";
}

function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (!key.startsWith("sk_")) {
    throw new Error("STRIPE_SECRET_KEY should start with sk_test_ or sk_live_.");
  }

  client = new Stripe(key, {
    // Pinned, so a Stripe release cannot change a response shape under us.
    apiVersion: "2025-10-29.clover" as Stripe.LatestApiVersion,
    maxNetworkRetries: 2,
    appInfo: { name: "Knowledge Layer" },
  });
  return client;
}

function readable(error: unknown): Error {
  const e = error as Stripe.errors.StripeError;
  if (e?.type === "StripeAuthenticationError") {
    return new Error("Stripe rejected the key. Check STRIPE_SECRET_KEY in .env.");
  }
  if (e?.type === "StripeConnectionError") {
    return new Error("Could not reach Stripe. Try again.");
  }
  if (e?.message) return new Error(`Stripe: ${e.message}`);
  return error instanceof Error ? error : new Error(String(error));
}

// --- the catalog ------------------------------------------------------------

export interface StripePrice {
  id: string;
  productName: string;
  amountCents: number;
  currency: string;
  /** "month", "year", or null for a one-off charge like a setup fee. */
  interval: string | null;
}

function toPrice(p: Stripe.Price): StripePrice {
  const product = p.product as Stripe.Product;
  return {
    id: p.id,
    productName: typeof product === "object" && "name" in product ? product.name : "—",
    amountCents: p.unit_amount ?? 0,
    currency: p.currency.toUpperCase(),
    interval: p.recurring?.interval ?? null,
  };
}

/**
 * Everything sellable, straight from Stripe.
 *
 * There is no local plan table any more. A price edited in the Stripe dashboard
 * is live here immediately, and there is no second copy to drift.
 */
export async function listPrices(): Promise<{ recurring: StripePrice[]; oneOff: StripePrice[] }> {
  try {
    const all = await stripe().prices.list({
      active: true,
      limit: 100,
      expand: ["data.product"],
    });

    const usable = all.data.filter((p) => {
      const product = p.product as Stripe.Product;
      // A price whose product was archived still comes back active, and
      // offering it produces a checkout that fails at the last step.
      return typeof product === "object" && !("deleted" in product && product.deleted) && product.active;
    });

    return {
      recurring: usable.filter((p) => p.recurring).map(toPrice),
      oneOff: usable.filter((p) => !p.recurring).map(toPrice),
    };
  } catch (error) {
    throw readable(error);
  }
}

/**
 * Create the starting catalogue, so nobody has to learn Stripe's dashboard
 * before they can bill anyone.
 *
 * $800 a month and a $2,500 setup — from the capacity model, not the market:
 * every client costs the same hours whatever they pay, so price is the only
 * lever on what an hour earns, and a solo ceiling is about fifty clients.
 */
export async function seedCatalog(): Promise<{ monthly: StripePrice; setup: StripePrice }> {
  try {
    const monthlyProduct = await stripe().products.create(
      { name: "AI discoverability", description: "Monthly — audits, freshness, published markup." },
      { idempotencyKey: "kl-product-monthly" }
    );
    const monthlyPrice = await stripe().prices.create(
      {
        product: monthlyProduct.id,
        currency: "usd",
        unit_amount: 80000,
        recurring: { interval: "month" },
      },
      { idempotencyKey: "kl-price-monthly-800" }
    );

    const setupProduct = await stripe().products.create(
      { name: "Setup", description: "One-off — extraction, review and first publication." },
      { idempotencyKey: "kl-product-setup" }
    );
    const setupPrice = await stripe().prices.create(
      { product: setupProduct.id, currency: "usd", unit_amount: 250000 },
      { idempotencyKey: "kl-price-setup-2500" }
    );

    return {
      monthly: toPrice({ ...monthlyPrice, product: monthlyProduct } as Stripe.Price),
      setup: toPrice({ ...setupPrice, product: setupProduct } as Stripe.Price),
    };
  } catch (error) {
    throw readable(error);
  }
}

// --- payment links ----------------------------------------------------------

export interface PaymentLink {
  id: string;
  url: string;
  mode: "test" | "live";
}

/**
 * One link that starts the subscription and takes the setup fee with it.
 *
 * The client pays once and Stripe charges the card every month afterwards. No
 * invoice is raised here, ever.
 *
 * The tenant slug goes into the metadata of both the link and the subscription
 * it creates. That is the whole join: Stripe makes the customer at checkout, so
 * there is nothing to match on until the subscription exists and carries the
 * slug itself.
 */
export async function createPaymentLink(input: {
  slug: string;
  priceId: string;
  setupPriceId?: string | null;
}): Promise<PaymentLink> {
  const mode = stripeMode();
  if (!mode) throw new Error("Stripe is not configured.");

  try {
    const lineItems: Stripe.PaymentLinkCreateParams.LineItem[] = [
      { price: input.priceId, quantity: 1 },
    ];
    if (input.setupPriceId) lineItems.push({ price: input.setupPriceId, quantity: 1 });

    const link = await stripe().paymentLinks.create({
      line_items: lineItems,
      metadata: { tenant_slug: input.slug },
      // Carried onto the subscription, which is what reconciliation searches.
      // Without it a paid subscription has no way back to a client.
      subscription_data: { metadata: { tenant_slug: input.slug } },
      // Stripe hosts the thank-you page. Nothing of ours needs to be reachable
      // from the customer's browser, which is what makes this work from a
      // laptop with no deployment.
      after_completion: { type: "hosted_confirmation" },
      allow_promotion_codes: true,
    });

    return { id: link.id, url: link.url, mode };
  } catch (error) {
    throw readable(error);
  }
}

/** Stop a link working, when a plan changes or it was made in error. */
export async function deactivateLink(id: string): Promise<void> {
  try {
    await stripe().paymentLinks.update(id, { active: false });
  } catch (error) {
    const e = error as Stripe.errors.StripeError;
    if (e?.type === "StripeInvalidRequestError") return;
    throw readable(error);
  }
}

// --- what Stripe knows ------------------------------------------------------

export interface LiveSubscription {
  id: string;
  slug: string;
  customerId: string;
  customerEmail: string | null;
  status: string;
  /** True for anything Stripe considers currently billable. */
  live: boolean;
  amountCents: number;
  currency: string;
  interval: string;
  startedOn: string;
  /** Next automatic charge, as an ISO date. */
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
}

function iso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;
}

function toSubscription(s: Stripe.Subscription): LiveSubscription | null {
  const customer = s.customer;

  // The subscription's own metadata first, then the customer's.
  //
  // A subscription made from a payment link carries the slug. One created by
  // hand in the Stripe dashboard does not — Stripe has no idea what a tenant
  // slug is — and reading only the subscription would leave it orphaned, which
  // looks exactly like the client never paid.
  const slug =
    s.metadata?.tenant_slug ||
    (typeof customer === "object" && customer && !("deleted" in customer && customer.deleted)
      ? customer.metadata?.tenant_slug
      : undefined);

  if (!slug) return null;

  const item = s.items.data[0];
  const price = item?.price;

  // The renewal date moved onto the item in recent API versions; the
  // subscription-level field is gone, so read it where it now lives.
  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end;

  return {
    id: s.id,
    slug,
    customerId: typeof customer === "string" ? customer : customer.id,
    customerEmail:
      typeof customer === "object" && "email" in customer ? (customer.email ?? null) : null,
    status: s.status,
    live: ["active", "trialing", "past_due"].includes(s.status),
    amountCents: (price?.unit_amount ?? 0) * (item?.quantity ?? 1),
    currency: (price?.currency ?? "usd").toUpperCase(),
    interval: price?.recurring?.interval ?? "month",
    startedOn: iso(s.start_date) ?? "",
    renewsOn: iso(periodEnd),
    cancelAtPeriodEnd: s.cancel_at_period_end,
  };
}

/**
 * Every subscription this app created, by client.
 *
 * One request rather than one per client. At fifty clients the per-client
 * version is fifty round trips to draw one table.
 */
export async function allSubscriptions(): Promise<Map<string, LiveSubscription>> {
  try {
    const byslug = new Map<string, LiveSubscription>();

    for await (const s of stripe().subscriptions.list({
      status: "all",
      limit: 100,
      expand: ["data.customer"],
    })) {
      const sub = toSubscription(s);
      if (!sub) continue;

      // Newest live one wins. A client who cancelled and resubscribed has two,
      // and the cancelled one must not be what the page reports.
      const existing = byslug.get(sub.slug);
      if (!existing || (sub.live && !existing.live)) byslug.set(sub.slug, sub);
    }

    return byslug;
  } catch (error) {
    throw readable(error);
  }
}

export async function subscriptionFor(
  slug: string,
  knownCustomerId?: string | null
): Promise<LiveSubscription | null> {
  const clean = slug.replace(/'/g, "");

  try {
    const all: LiveSubscription[] = [];

    const bySubscription = await stripe().subscriptions.search({
      query: `metadata['tenant_slug']:'${clean}'`,
      limit: 20,
      expand: ["data.customer"],
    });
    for (const s of bySubscription.data) {
      const sub = toSubscription(s);
      if (sub) all.push(sub);
    }

    // Search does not look through to the customer, so a subscription created
    // in the Stripe dashboard has to be found the other way round: locate the
    // customer by slug, then list what they are subscribed to.
    if (all.length === 0) {
      // The stored id first — search will not see a customer created moments
      // ago, so a client set up by hand in the dashboard would look unpaid
      // until Stripe's index caught up.
      const customer = knownCustomerId || (await customerFor(clean));
      if (customer) {
        const list = await stripe().subscriptions.list({
          customer,
          status: "all",
          limit: 20,
          expand: ["data.customer"],
        });
        for (const s of list.data) {
          const sub = toSubscription(s);
          if (sub) all.push(sub);
        }
      }
    }

    return all.find((s) => s.live) ?? all[0] ?? null;
  } catch (error) {
    throw readable(error);
  }
}

/** The Stripe customer carrying this slug, if one exists. */
export async function customerFor(slug: string): Promise<string | null> {
  try {
    const found = await stripe().customers.search({
      query: `metadata['tenant_slug']:'${slug.replace(/'/g, "")}'`,
      limit: 1,
    });
    return found.data[0]?.id ?? null;
  } catch (error) {
    throw readable(error);
  }
}

/**
 * The customer for a client, created if absent.
 *
 * `known` is the id we already recorded, and it is checked first for a reason
 * that cost a duplicate customer to find: **Stripe's search index is eventually
 * consistent.** A customer created a second ago is not findable by metadata for
 * up to a minute, so a search-only version returns nothing, creates another,
 * and splits one client's payment history across two records.
 *
 * Search is still the fallback, for a customer that exists in Stripe but whose
 * id was never stored here.
 */
export async function ensureCustomer(
  slug: string,
  known?: string | null,
  email?: string,
  name?: string
): Promise<string> {
  try {
    if (known) {
      try {
        const found = await stripe().customers.retrieve(known);
        if (!found.deleted) {
          if (email && "email" in found && found.email !== email) {
            await stripe().customers.update(known, { email });
          }
          return known;
        }
      } catch {
        // Deleted in the dashboard. Fall through and make a new one; the
        // alternative is every future call failing against a dead id.
      }
    }

    const searched = await customerFor(slug);
    if (searched) {
      if (email) await stripe().customers.update(searched, { email });
      return searched;
    }

    const created = await stripe().customers.create({
      email: email || undefined,
      name: name || slug,
      metadata: { tenant_slug: slug },
    });
    return created.id;
  } catch (error) {
    throw readable(error);
  }
}

/**
 * Where to send someone to key a card by hand.
 *
 * Stripe's dashboard, with the customer already chosen. Building a card field
 * in this app instead meant an iframe, a publishable key, a script from
 * js.stripe.com and a few hundred lines — to reproduce a screen Stripe already
 * ships, maintains, and keeps out of our PCI scope entirely.
 *
 * The test dashboard lives under /test, so the link follows the key's mode
 * rather than dropping someone into live by default.
 */
export function dashboardSubscriptionUrl(customerId: string): string {
  const prefix = stripeMode() === "live" ? "" : "/test";
  return `https://dashboard.stripe.com${prefix}/subscriptions/create?customer=${customerId}`;
}

export function dashboardCustomerUrl(customerId: string): string {
  const prefix = stripeMode() === "live" ? "" : "/test";
  return `https://dashboard.stripe.com${prefix}/customers/${customerId}`;
}

export interface LiveInvoice {
  id: string;
  number: string | null;
  amountCents: number;
  amountPaidCents: number;
  currency: string;
  status: string;
  createdOn: string | null;
  paidOn: string | null;
  dueOn: string | null;
  url: string | null;
  pdf: string | null;
}

export async function invoicesFor(customerId: string): Promise<LiveInvoice[]> {
  try {
    const list = await stripe().invoices.list({ customer: customerId, limit: 24 });

    return list.data.map((inv) => ({
      id: inv.id ?? "",
      number: inv.number ?? null,
      amountCents: inv.total,
      amountPaidCents: inv.amount_paid,
      currency: inv.currency.toUpperCase(),
      status: inv.status ?? "unknown",
      createdOn: iso(inv.created),
      paidOn: iso(inv.status_transitions?.paid_at),
      dueOn: iso(inv.due_date),
      url: inv.hosted_invoice_url ?? null,
      pdf: inv.invoice_pdf ?? null,
    }));
  } catch (error) {
    throw readable(error);
  }
}

/** Everything unpaid, across every customer. For the overdue figure. */
export async function openInvoices(): Promise<{ customerId: string; amountCents: number; dueOn: string | null }[]> {
  try {
    const out: { customerId: string; amountCents: number; dueOn: string | null }[] = [];

    for await (const inv of stripe().invoices.list({ status: "open", limit: 100 })) {
      const customer = inv.customer;
      out.push({
        customerId: typeof customer === "string" ? customer : (customer?.id ?? ""),
        amountCents: inv.total - inv.amount_paid,
        dueOn: iso(inv.due_date),
      });
    }

    return out;
  } catch (error) {
    throw readable(error);
  }
}

/**
 * Cancel. At period end by default — the client has paid for the month and
 * should keep it.
 */
export async function cancelSubscription(id: string, immediately = false): Promise<void> {
  try {
    if (immediately) await stripe().subscriptions.cancel(id);
    else await stripe().subscriptions.update(id, { cancel_at_period_end: true });
  } catch (error) {
    throw readable(error);
  }
}

export async function resumeSubscription(id: string): Promise<void> {
  try {
    await stripe().subscriptions.update(id, { cancel_at_period_end: false });
  } catch (error) {
    throw readable(error);
  }
}

/**
 * A link to manage the card and see receipts, for the client.
 *
 * Stripe's own portal. Building any of this — updating a card, downloading an
 * invoice — would mean handling card details, and there is no version of that
 * worth owning.
 */
export async function billingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  } catch (error) {
    throw readable(error);
  }
}

/** Proves the key works. */
export async function ping(): Promise<{ ok: boolean; detail: string }> {
  if (!stripeEnabled()) return { ok: false, detail: "STRIPE_SECRET_KEY is not set." };
  try {
    await stripe().customers.list({ limit: 1 });
    return { ok: true, detail: `${stripeMode()} mode` };
  } catch (error) {
    return { ok: false, detail: readable(error).message };
  }
}
