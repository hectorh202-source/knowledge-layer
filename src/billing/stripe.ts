import Stripe from "stripe";
import type { Account, Invoice } from "./store";

/**
 * Stripe, as a payment rail rather than a source of truth.
 *
 * This app owns the schedule: who is on what, when the next period starts, what
 * it costs. Stripe is asked to collect one specific invoice and asked back
 * later whether it was paid.
 *
 * **Not Stripe Subscriptions**, deliberately. Those would put the same facts in
 * two systems that can disagree — a price changed in the dashboard and not
 * here, a subscription cancelled there and still active here, and no way to say
 * which is right. What Stripe is genuinely better at is the part this app
 * should not attempt: holding card details, retrying a failed charge, and
 * giving the customer a page to pay on.
 *
 * **Reconciliation is polled, not pushed.** A webhook needs a public URL, which
 * needs a deployment. Asking Stripe about the open invoices when the billing
 * page loads is a handful of requests at this size, works from a laptop, and
 * has no endpoint to secure. Webhooks are worth adding at a few hundred
 * clients, or when instant notification starts to matter.
 */

let client: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/**
 * Test or live, read from the key itself.
 *
 * Never configured separately. A mode flag that can disagree with the key is a
 * way to believe you are in test mode while charging a real card.
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
    throw new Error(
      "STRIPE_SECRET_KEY does not look like a secret key. It should start with sk_test_ or sk_live_.\n" +
        "  A publishable key (pk_) cannot create invoices, and a restricted key may not have the scopes."
    );
  }

  client = new Stripe(key, {
    // Pinned. Stripe changes response shapes between versions, and inheriting
    // whatever the account default happens to be means a field can vanish
    // without anything in this repository changing.
    apiVersion: "2025-10-29.clover" as Stripe.LatestApiVersion,
    maxNetworkRetries: 2,
    appInfo: { name: "Knowledge Layer" },
  });
  return client;
}

/** A Stripe error, in words a person can act on. */
function readable(error: unknown): Error {
  if (error && typeof error === "object" && "type" in error) {
    const e = error as Stripe.errors.StripeError;
    if (e.type === "StripeAuthenticationError") {
      return new Error("Stripe rejected the key. Check STRIPE_SECRET_KEY in .env.");
    }
    if (e.type === "StripeInvalidRequestError") {
      return new Error(`Stripe: ${e.message}`);
    }
    if (e.type === "StripeConnectionError") {
      return new Error("Could not reach Stripe. Check the connection and try again.");
    }
    return new Error(`Stripe: ${e.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

// ---------------------------------------------------------------------------

export interface StripeCustomerResult {
  id: string;
  mode: "test" | "live";
}

/**
 * The Stripe customer for a billing account, created if absent.
 *
 * Reuses `provider_ref` when it is already set and still resolves. A customer
 * deleted in the dashboard leaves a stale id here, and creating a fresh one is
 * the only useful response — the alternative is every invoice failing forever
 * with a reference to something that no longer exists.
 */
export async function ensureCustomer(
  account: Account,
  existingRef: string | null,
  existingMode: string | null
): Promise<StripeCustomerResult> {
  const mode = stripeMode();
  if (!mode) throw new Error("Stripe is not configured.");

  try {
    // Only trust a reference created in the mode we are now in. Test and live
    // are separate worlds with separate ids, and a test customer id sent to
    // the live API is simply "no such customer".
    if (existingRef && existingMode === mode) {
      try {
        const found = await stripe().customers.retrieve(existingRef);
        if (!found.deleted) return { id: found.id, mode };
      } catch {
        // Fall through and make a new one.
      }
    }

    const created = await stripe().customers.create({
      name: account.companyName || account.tenantSlug,
      email: account.contactEmail || undefined,
      description: `Knowledge Layer — ${account.tenantSlug}`,
      metadata: { tenant_slug: account.tenantSlug },
    });

    return { id: created.id, mode };
  } catch (error) {
    throw readable(error);
  }
}

export interface StripeInvoiceResult {
  id: string;
  url: string | null;
  mode: "test" | "live";
}

/**
 * Mirror one of our invoices into Stripe and finalise it.
 *
 * Finalised rather than left as a draft: a draft has no payment page, so there
 * is nothing to send, and the button that made it would appear to have done
 * nothing. `auto_advance` is off — Stripe should not decide on its own when to
 * email a customer or when to give up retrying. Sending stays an explicit act
 * here.
 */
export async function pushInvoice(
  customerId: string,
  invoice: Invoice,
  options?: { dueDays?: number; memo?: string }
): Promise<StripeInvoiceResult> {
  const mode = stripeMode();
  if (!mode) throw new Error("Stripe is not configured.");

  try {
    const draft = await stripe().invoices.create(
      {
        customer: customerId,
        collection_method: "send_invoice",
        days_until_due: options?.dueDays ?? 14,
        auto_advance: false,
        currency: invoice.currency.toLowerCase(),
        description: options?.memo,
        metadata: { knowledge_layer_invoice: invoice.number, tenant_slug: invoice.tenantSlug },
      },
      // Our own invoice number as the key, so a double-click or a retry after a
      // timeout cannot produce two Stripe invoices for one period. This is the
      // single most important line in the file.
      { idempotencyKey: `kl-invoice-${invoice.number}` }
    );

    if (!draft.id) throw new Error("Stripe returned an invoice with no id.");

    for (const [index, line] of invoice.lines.entries()) {
      await stripe().invoiceItems.create(
        {
          customer: customerId,
          invoice: draft.id,
          currency: invoice.currency.toLowerCase(),
          amount: line.amountCents,
          description: line.description,
        },
        { idempotencyKey: `kl-line-${invoice.number}-${index}` }
      );
    }

    const finalised = await stripe().invoices.finalizeInvoice(draft.id);

    return {
      id: finalised.id ?? draft.id,
      url: finalised.hosted_invoice_url ?? null,
      mode,
    };
  } catch (error) {
    throw readable(error);
  }
}

/** Email the invoice through Stripe. Explicit — nothing here sends by itself. */
export async function sendInvoice(stripeInvoiceId: string): Promise<string | null> {
  try {
    const sent = await stripe().invoices.sendInvoice(stripeInvoiceId);
    return sent.hosted_invoice_url ?? null;
  } catch (error) {
    throw readable(error);
  }
}

export interface StripeStatus {
  id: string;
  paid: boolean;
  status: string;
  url: string | null;
  /** When Stripe recorded payment, as an ISO date. */
  paidOn: string | null;
  amountPaidCents: number;
}

/**
 * Ask Stripe about one invoice.
 *
 * Returns null when the id is unknown to this account — usually a test id
 * being asked about in live mode, which should read as "no information" rather
 * than as an error that stops a reconciliation run.
 */
export async function invoiceStatus(stripeInvoiceId: string): Promise<StripeStatus | null> {
  try {
    const inv = await stripe().invoices.retrieve(stripeInvoiceId);
    const paidAt = inv.status_transitions?.paid_at ?? null;

    return {
      id: inv.id ?? stripeInvoiceId,
      paid: inv.status === "paid",
      status: inv.status ?? "unknown",
      url: inv.hosted_invoice_url ?? null,
      paidOn: paidAt ? new Date(paidAt * 1000).toISOString().slice(0, 10) : null,
      amountPaidCents: inv.amount_paid ?? 0,
    };
  } catch (error) {
    const e = error as Stripe.errors.StripeError;
    if (e?.type === "StripeInvalidRequestError") return null;
    throw readable(error);
  }
}

export async function voidStripeInvoice(stripeInvoiceId: string): Promise<void> {
  try {
    await stripe().invoices.voidInvoice(stripeInvoiceId);
  } catch (error) {
    const e = error as Stripe.errors.StripeError;
    // Already void, or paid and therefore un-voidable. Neither should stop the
    // local invoice being marked void — the record here is ours.
    if (e?.type === "StripeInvalidRequestError") return;
    throw readable(error);
  }
}

/** A cheap call that proves the key works, for the status page. */
export async function ping(): Promise<{ ok: boolean; detail: string }> {
  if (!stripeEnabled()) return { ok: false, detail: "STRIPE_SECRET_KEY is not set." };
  try {
    // Listing one customer is the cheapest call that proves the key is valid
    // and has read access, and unlike accounts.retrieve it needs no argument
    // and works on a restricted key.
    await stripe().customers.list({ limit: 1 });
    return { ok: true, detail: `${stripeMode()} mode` };
  } catch (error) {
    return { ok: false, detail: readable(error).message };
  }
}
