-- Stripe, as a payment rail rather than a source of truth.
--
-- The subscription schedule stays here: this app decides who is on what, when
-- the next period starts, and what it costs. Stripe is asked to collect a
-- specific invoice for a specific amount, and asked back later whether it was
-- paid.
--
-- The alternative — Stripe Subscriptions — means the same facts living in two
-- systems that can disagree. A price changed in the Stripe dashboard and not
-- here, a subscription cancelled there and still active here, and no way to
-- tell which is right. One owner, one answer.
--
-- What Stripe is genuinely better at is the part this app should not do:
-- holding card details, retrying a failed charge, and giving a customer a
-- hosted page to pay on.

-- The hosted invoice page. Stored rather than re-fetched because it is what
-- gets pasted into an email, and an invoice that has been sent needs its link
-- to keep working without a round trip to find out what it was.
alter table billing_invoices add column if not exists provider_url text;

-- When Stripe was last asked about this invoice. Reconciliation is polled, not
-- pushed: at this size a handful of requests when the billing page loads is
-- cheaper than owning a public webhook endpoint, and it needs no deployment.
alter table billing_invoices add column if not exists provider_synced_at timestamptz;

-- Which mode the row was created in. Test and live are separate worlds with
-- separate ids, and a test invoice sitting in a live ledger — or the reverse —
-- is the kind of thing discovered while chasing a payment that never existed.
alter table billing_invoices  add column if not exists provider_mode text;
alter table billing_accounts  add column if not exists provider_mode text;

create index if not exists billing_invoices_provider on billing_invoices(provider_ref)
  where provider_ref is not null;
