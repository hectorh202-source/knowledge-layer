-- Billing moves onto Stripe properly.
--
-- The previous shape kept plans, subscriptions and invoices here and used
-- Stripe only to collect. That produced a flow needing four clicks and two
-- forms to bill one client, and then a manual raise-and-send every month
-- forever. The data model was defensible; the job it created was not.
--
-- Stripe now owns money and schedule: the price, the subscription, the monthly
-- charge, the retries, the receipts. A customer pays once through a payment
-- link and is charged automatically thereafter. Nothing here raises an invoice
-- again.
--
-- What is left is the one fact Stripe cannot know: which Stripe customer is
-- which client of ours. That is a join table, and it is all this needs to be.

drop table if exists billing_invoices;
drop table if exists billing_subscriptions;
drop table if exists billing_plans;

-- Rebuilt rather than altered. The old columns described a ledger that no
-- longer exists, and carrying them forward would leave provider_ref meaning
-- one thing on some rows and another on others.
drop table if exists billing_accounts;

create table billing_accounts (
  tenant_slug         text primary key,
  agency_id           uuid references agencies(id) on delete set null,

  -- Prefills the payment link and, once paid, the Stripe customer. Optional:
  -- the customer types their own email at checkout if this is blank, which is
  -- one less field standing between a client and being billed.
  contact_email       text not null default '',

  -- Filled in by reconciliation once the first payment lands. Before that
  -- there is no customer, because Stripe creates one at checkout.
  stripe_customer_id  text,

  -- The link that was generated for this client. Kept so it can be re-sent
  -- without making a second one — two live links for one client means two
  -- subscriptions if both get used.
  payment_link_id     text,
  payment_link_url    text,

  -- test or live. Separate worlds with separate ids, and a test link sent to a
  -- real customer takes no money while looking exactly like one that did.
  stripe_mode         text,

  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists billing_accounts_agency on billing_accounts(agency_id);

-- Commercially sensitive and not crawler-facing. Service role only, reached
-- after the portal has authenticated the user and checked their agency.
alter table billing_accounts enable row level security;
grant all on billing_accounts to service_role;
