-- Billing: what each client is on, and what they owe.
--
-- A ledger, not a payment processor. It answers "who owes me what, and since
-- when" and produces an invoice you can send. Money moves by whatever means
-- you already use. No card details reach this application, which is the whole
-- reason it can exist before there is anywhere to host a webhook.
--
-- Shaped so Stripe drops in behind it later: plans, subscriptions and invoices
-- are real records with their own lifecycle rather than a spreadsheet in a
-- jsonb column, and every row has room for the provider's own identifier.
--
-- --- money -------------------------------------------------------------------
-- Integer cents throughout. A monthly price stored as a float is a rounding
-- error that compounds twelve times a year and shows up as an invoice that
-- disagrees with itself by a penny.

-- --- plans -------------------------------------------------------------------
-- Named prices. A plan is the default; a subscription may override the monthly
-- rate for one client, because the first few clients are always priced
-- differently and pretending otherwise means a plan per customer.

create table if not exists billing_plans (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  -- Charged once, when the client is onboarded. This is the data lift: the
  -- extraction, the review, the corrections. It is labour, not margin.
  setup_cents     integer not null default 0 check (setup_cents >= 0),
  -- Charged every period. This is freshness: audits, re-crawls, keeping the
  -- markup true as the business changes.
  monthly_cents   integer not null default 0 check (monthly_cents >= 0),
  currency        text not null default 'USD',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- --- who pays ----------------------------------------------------------------
-- One account per paying client. Keyed on the tenant slug for the same reason
-- agency_clients is: a client exists in the portal from the moment it is
-- created, and its row in `tenants` may not appear until content is loaded.
--
-- The billing contact is deliberately its own field rather than reused from the
-- business profile. The profile's email publishes — it is the address a
-- customer of theirs would write to. An invoice goes to whoever does their
-- books, and those are rarely the same person.

create table if not exists billing_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_slug     text not null unique,
  agency_id       uuid references agencies(id) on delete set null,

  company_name    text not null default '',
  contact_name    text not null default '',
  contact_email   text not null default '',
  notes           text not null default '',

  -- Where this account lives at the payment provider, once there is one.
  provider        text,
  provider_ref    text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists billing_accounts_agency on billing_accounts(agency_id);

-- --- subscriptions -----------------------------------------------------------
-- What this client is on, and since when.
--
-- One active subscription per account, enforced below. Two would mean two
-- monthly charges for one client, and it would look exactly like a plan change
-- that half-applied.

create table if not exists billing_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references billing_accounts(id) on delete cascade,
  plan_id           uuid not null references billing_plans(id),

  -- Overrides the plan when set. Founding-client pricing, a negotiated rate, a
  -- discount that should not become a new plan everyone can see.
  monthly_cents     integer check (monthly_cents >= 0),

  -- 'monthly' or 'annual'. Annual is billed once for the year; the discount is
  -- expressed by setting monthly_cents lower, not by a separate percentage
  -- nobody can find later.
  interval          text not null default 'monthly' check (interval in ('monthly','annual')),

  status            text not null default 'active'
                    check (status in ('trialing','active','paused','cancelled')),

  started_on        date not null default current_date,
  -- The next period this account should be invoiced for.
  next_invoice_on   date not null default current_date,
  cancelled_on      date,

  -- The data lift is charged once per client, so it is tracked here rather than
  -- generated every period.
  setup_cents       integer not null default 0 check (setup_cents >= 0),
  setup_invoiced    boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One live subscription per account. A partial index, so a cancelled one can
-- sit alongside its replacement in the history.
create unique index if not exists billing_one_live_subscription
  on billing_subscriptions(account_id)
  where status in ('trialing','active','paused');

-- --- invoices ----------------------------------------------------------------
-- What was billed, for which period, and whether it came in.
--
-- Immutable once issued, by convention rather than by trigger: an invoice is a
-- statement of what was asked for on a date. Getting it wrong is corrected by
-- voiding it and issuing another, which is what the 'void' status is for.

create table if not exists billing_invoices (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references billing_accounts(id) on delete cascade,

  -- Human-facing, sequential, stable. Generated by the app so it can be quoted
  -- on a bank transfer.
  number          text not null unique,

  period_start    date,
  period_end      date,

  -- One entry per line: {description, amount_cents, kind}. jsonb because a
  -- line has no life of its own — nothing queries or updates one — and a table
  -- for it would be three joins to print a page.
  lines           jsonb not null default '[]',
  total_cents     integer not null default 0,
  currency        text not null default 'USD',

  status          text not null default 'draft'
                  check (status in ('draft','issued','paid','void')),

  issued_on       date,
  due_on          date,
  paid_on         date,
  -- Free text: "bank transfer", "cheque", "Stripe pi_...". This is a record of
  -- what happened, not an integration.
  paid_method     text not null default '',

  provider        text,
  provider_ref    text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists billing_invoices_account on billing_invoices(account_id, period_start desc);
create index if not exists billing_invoices_open on billing_invoices(status, due_on) where status = 'issued';

-- --- access ------------------------------------------------------------------
-- Nothing here is crawler-facing and all of it is commercially sensitive —
-- what every client pays, and who is behind. Service role only, reached after
-- the portal has authenticated the user and checked their agency.
--
-- No policy for `authenticated` either: nothing should arrive here holding a
-- user token, and an absent policy fails closed if something tries.

alter table billing_plans         enable row level security;
alter table billing_accounts      enable row level security;
alter table billing_subscriptions enable row level security;
alter table billing_invoices      enable row level security;

grant all on billing_plans, billing_accounts, billing_subscriptions, billing_invoices
  to service_role;

-- --- the starting plan -------------------------------------------------------
-- $800/month, $2,500 setup. Chosen from the capacity model rather than from
-- the market: every client costs the same hours whatever they pay, so price is
-- the only lever on what an hour earns, and the ceiling on a solo operation is
-- about fifty clients. Discount the setup for early clients; never the monthly.

insert into billing_plans (name, setup_cents, monthly_cents)
values ('Standard', 250000, 80000)
on conflict (name) do nothing;
