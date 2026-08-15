-- Knowledge Layer — initial schema
--
-- Two kinds of table live here, and the distinction is the whole design:
--
--   DERIVED  — owned by the loader. Re-synced from ServiceTitan on every run.
--              Safe to overwrite. Never hand-edit; your edits will be lost.
--
--   AUTHORED — owned by a human. Pricing factors, FAQs, policies, credentials.
--              The loader must never write to these tables. This is months of
--              editorial work and it is the actual product.
--
-- Human annotations on a derived thing (say, the editorial content for a
-- service) live in a companion AUTHORED table joined by foreign key, rather
-- than as extra columns on the derived row. That way "re-sync services" can
-- never mean "delete the pricing guide someone spent a week writing."
--
-- Derived rows are soft-deleted (is_active = false) rather than removed, so
-- authored content never orphans when ServiceTitan stops returning a record.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Meta
-- ---------------------------------------------------------------------------

-- tenant_id is here from day one even though TitanZ is the only tenant.
-- Adding it later means rewriting every foreign key, every index, and every
-- RLS policy. Adding it now costs one column. See OPEN-QUESTIONS.md 5.1.
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  domain      text,
  crm         text not null default 'servicetitan',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table tenants is 'One row per business. TitanZ is tenant #1.';

-- Provenance. Every derived row can be traced to the export run that produced
-- it, which is what makes "why does the site say $1,400?" answerable.
create table sync_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  export_run     text not null,
  environment    text not null,
  is_mock        boolean not null default false,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  records_loaded integer not null default 0,
  notes          text
);

create index sync_runs_tenant_idx on sync_runs (tenant_id, started_at desc);

comment on column sync_runs.is_mock is
  'True when loaded from generated data. Nothing published should ever trace to a mock run.';

-- ---------------------------------------------------------------------------
-- DERIVED — loader owns these
-- ---------------------------------------------------------------------------

create table business_units (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  source         text not null default 'servicetitan',
  source_id      text not null,
  name           text not null,
  official_name  text,
  is_active      boolean not null default true,
  last_synced_at timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);

create table job_types (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  source         text not null default 'servicetitan',
  source_id      text not null,
  name           text not null,
  class          text,
  is_active      boolean not null default true,
  last_synced_at timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);

comment on table job_types is
  'What gets booked. Distinct from services, which is what gets sold on an invoice.';

create table services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  source           text not null default 'servicetitan',
  source_id        text not null,
  code             text,
  display_name     text not null,
  description      text,
  category         text,
  list_price       numeric(12,2),
  business_unit_id uuid references business_units(id) on delete set null,
  is_active        boolean not null default true,
  last_synced_at   timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);

create table service_areas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  source         text not null default 'servicetitan',
  source_id      text not null,
  name           text not null,
  zips           text[] not null default '{}',
  cities         text[] not null default '{}',
  is_active      boolean not null default true,
  last_synced_at timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);

comment on column service_areas.zips is
  'Real geography. "Port Charlotte and surrounding areas" is not machine-readable.';

create table brands (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  source         text not null default 'servicetitan',
  source_id      text not null,
  name           text not null,
  is_active      boolean not null default true,
  last_synced_at timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);

-- Price statistics are append-only rather than upserted. Keeping every run
-- means you can see pricing drift over time, which is what turns a stale
-- catalog from an invisible problem into a visible one. See 4.2.
create table price_stats (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_type_id   uuid not null references job_types(id) on delete cascade,
  sync_run_id   uuid references sync_runs(id) on delete set null,

  window_months integer not null,
  invoice_count integer not null,
  job_count     integer not null,
  revenue_total numeric(14,2) not null,
  revenue_share numeric(6,5) not null,

  amount_min    numeric(12,2) not null,
  p10           numeric(12,2) not null,
  p25           numeric(12,2) not null,
  median        numeric(12,2) not null,
  p75           numeric(12,2) not null,
  p90           numeric(12,2) not null,
  amount_max    numeric(12,2) not null,
  mean          numeric(12,2) not null,

  -- The range that would actually go on a pricing page: p10-p90, rounded out.
  publish_low   numeric(12,2) not null,
  publish_high  numeric(12,2) not null,
  -- True when the sample is too small for the range to mean anything.
  thin_sample   boolean not null default false,

  computed_at   timestamptz not null default now()
);

create index price_stats_lookup_idx on price_stats (tenant_id, job_type_id, computed_at desc);

-- Most recent stats per job type, which is what everything downstream wants.
create view latest_price_stats as
select distinct on (tenant_id, job_type_id) *
from price_stats
order by tenant_id, job_type_id, computed_at desc;

-- ---------------------------------------------------------------------------
-- AUTHORED — the loader must never write to anything below this line
-- ---------------------------------------------------------------------------

-- The editorial layer for one service. This is the asset: a published range
-- alone is a price tag, while the factors behind it are expertise.
create table service_content (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  job_type_id      uuid references job_types(id) on delete set null,

  slug             text not null,
  headline         text not null,
  summary          text,

  -- [{ "factor": "Tank size 40 vs 75 gal", "effect": "up", "detail": "..." }]
  -- What moves the price. Without this a range is indefensible on the phone
  -- and uncitable by an AI.
  price_factors    jsonb not null default '[]'::jsonb,

  included         text[] not null default '{}',
  excluded         text[] not null default '{}',

  -- Overrides the computed range when a human decides the stats are wrong or
  -- the sample is thin. Null means "use latest_price_stats".
  override_low     numeric(12,2),
  override_high    numeric(12,2),
  override_reason  text,

  is_published     boolean not null default false,
  reviewed_at      timestamptz,
  reviewed_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table faqs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  job_type_id  uuid references job_types(id) on delete set null,

  question     text not null,
  answer       text not null,

  -- Where the question came from. Call transcripts are the best source:
  -- real questions in customers' own words. See 4.4.
  origin       text not null default 'manual'
               check (origin in ('manual', 'call_transcript', 'gbp', 'website', 'crm')),
  -- Generated candidates stay unapproved until a human signs off. Nothing
  -- unapproved is ever published.
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index faqs_tenant_idx on faqs (tenant_id, job_type_id);

create table policies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null
               check (kind in ('warranty', 'permits', 'payment', 'scheduling',
                               'cancellation', 'emergency', 'guarantee', 'other')),
  title        text not null,
  body         text not null,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table credentials (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null
               check (kind in ('license', 'insurance', 'certification',
                               'bond', 'membership', 'award')),
  title        text not null,
  identifier   text,
  issuer       text,
  issued_on    date,
  -- A lapsed license published as current is the worst possible stale record.
  valid_until  date,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_updated_at before update on tenants
  for each row execute function set_updated_at();
create trigger service_content_updated_at before update on service_content
  for each row execute function set_updated_at();
create trigger faqs_updated_at before update on faqs
  for each row execute function set_updated_at();
create trigger policies_updated_at before update on policies
  for each row execute function set_updated_at();
create trigger credentials_updated_at before update on credentials
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled everywhere now so that adding tenant #2 is a policy change rather
-- than a security incident. The loader uses the service role key and bypasses
-- RLS entirely; these policies govern the public API layer built later.
-- ---------------------------------------------------------------------------

alter table tenants          enable row level security;
alter table sync_runs        enable row level security;
alter table business_units   enable row level security;
alter table job_types        enable row level security;
alter table services         enable row level security;
alter table service_areas    enable row level security;
alter table brands           enable row level security;
alter table price_stats      enable row level security;
alter table service_content  enable row level security;
alter table faqs             enable row level security;
alter table policies         enable row level security;
alter table credentials      enable row level security;

-- Anonymous read access to published content only. This is what the public
-- API and the AI catalog will serve. Unpublished drafts stay invisible.
create policy public_read_services on services
  for select using (is_active = true);
create policy public_read_service_areas on service_areas
  for select using (is_active = true);
create policy public_read_job_types on job_types
  for select using (is_active = true);
create policy public_read_brands on brands
  for select using (is_active = true);
create policy public_read_price_stats on price_stats
  for select using (true);
create policy public_read_service_content on service_content
  for select using (is_published = true);
create policy public_read_faqs on faqs
  for select using (is_published = true and is_approved = true);
create policy public_read_policies on policies
  for select using (is_published = true);
create policy public_read_credentials on credentials
  for select using (is_published = true);
