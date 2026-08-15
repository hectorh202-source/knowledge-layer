-- Knowledge Layer — initial schema
--
-- The purpose of this database is to make a business legible to AI: to let an
-- answer engine resolve who it is, what it does, where it works, and what the
-- answers are to the questions people actually ask.
--
-- Two kinds of table live here, and the distinction is the whole design:
--
--   DERIVED  — owned by the loader. Re-synced from ServiceTitan on every run.
--              Safe to overwrite. Never hand-edit; your edits will be lost.
--
--   AUTHORED — owned by a human. The business profile, hours, FAQs, policies,
--              credentials, service write-ups. This is the actual product and
--              the loader must never write to it.
--
-- Human annotations on a derived thing live in a companion AUTHORED table
-- joined by foreign key, rather than as extra columns on the derived row. That
-- way "re-sync services" can never mean "delete the write-up someone spent a
-- week on."
--
-- Derived rows are soft-deleted (is_active = false) rather than removed, so
-- authored content never orphans when ServiceTitan stops returning a record.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Meta
-- ---------------------------------------------------------------------------

-- tenant_id is here from day one even though TitanZ is the only tenant.
-- Adding it later means rewriting every foreign key, index, and RLS policy.
-- Adding it now costs one column. See OPEN-QUESTIONS.md 5.1.
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  crm         text not null default 'servicetitan',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table tenants is 'One row per business. TitanZ is tenant #1.';

-- Provenance. Every derived row traces to the export run that produced it.
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
-- AUTHORED — the entity foundation
--
-- Everything else depends on these. An answer engine that cannot resolve this
-- business as a distinct entity cannot recommend it, however good the rest of
-- the content is.
-- ---------------------------------------------------------------------------

create table business_profile (
  tenant_id         uuid primary key references tenants(id) on delete cascade,

  name              text not null,
  legal_name        text,
  description       text,

  -- The canonical NAP number. Must match the Google Business Profile and every
  -- directory listing character for character. Tracking numbers belong on
  -- AI-specific landing pages, never here — an inconsistent NAP actively
  -- degrades entity resolution.
  phone             text,
  email             text,
  domain            text,

  street            text,
  city              text,
  region            text,
  postal_code       text,
  country           text not null default 'US',

  -- The strongest corroboration signal available. AI weights agreement across
  -- independent sources, and GBP is the one that matters most locally.
  gbp_url           text,

  founded_year      integer,
  -- A citable specific, e.g. "within 2 hours for emergencies".
  response_time     text,
  emergency_service boolean not null default false,

  is_published      boolean not null default false,
  reviewed_at       timestamptz,
  reviewed_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table business_hours (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  -- 0 = Sunday.
  day_of_week  integer not null check (day_of_week between 0 and 6),
  opens        time,
  closes       time,
  is_closed    boolean not null default false,
  unique (tenant_id, day_of_week)
);

comment on table business_hours is
  'Structured for schema.org openingHoursSpecification. "Call for hours" is not citable.';

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
  is_active      boolean not null default true,
  last_synced_at timestamptz not null default now(),
  unique (tenant_id, source, source_id)
);

comment on table job_types is
  'What gets booked. Distinct from services, which is what gets sold.';

create table services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  source           text not null default 'servicetitan',
  source_id        text not null,
  code             text,
  display_name     text not null,
  description      text,
  category         text,
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
  'Real postal codes. "Port Charlotte and surrounding areas" is not something an AI can match a ZIP against.';

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

comment on table brands is
  'Equipment serviced. Answers "do you work on X" — a high-volume query shape.';

-- ---------------------------------------------------------------------------
-- AUTHORED — content
-- ---------------------------------------------------------------------------

create table service_content (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_type_id   uuid references job_types(id) on delete set null,

  slug          text not null,
  headline      text not null,
  summary       text,

  -- Concrete, citable statements about this service. Specificity is what gets
  -- quoted; generic marketing copy is what gets skipped.
  key_points    text[] not null default '{}',
  included      text[] not null default '{}',
  excluded      text[] not null default '{}',

  is_published  boolean not null default false,
  reviewed_at   timestamptz,
  reviewed_by   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Question and answer is the citation mechanism. An answer engine matches a
-- user's question to an answer, so this table is the highest-leverage content
-- in the schema.
create table faqs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  job_type_id  uuid references job_types(id) on delete set null,

  question     text not null,
  answer       text not null,

  -- Call transcripts are the best source: real questions in customers' own
  -- words rather than what someone imagines customers ask. See 4.4.
  origin       text not null default 'manual'
               check (origin in ('manual', 'call_transcript', 'gbp', 'website', 'crm')),
  -- Generated candidates stay unapproved until a human signs off.
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
  -- A lapsed license published as current is the worst kind of stale record.
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
create trigger business_profile_updated_at before update on business_profile
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
-- Enabled everywhere now so adding tenant #2 is a policy change rather than a
-- security incident. The loader uses the service role key and bypasses RLS;
-- these policies govern the public API.
-- ---------------------------------------------------------------------------

alter table tenants          enable row level security;
alter table sync_runs        enable row level security;
alter table business_profile enable row level security;
alter table business_hours   enable row level security;
alter table business_units   enable row level security;
alter table job_types        enable row level security;
alter table services         enable row level security;
alter table service_areas    enable row level security;
alter table brands           enable row level security;
alter table service_content  enable row level security;
alter table faqs             enable row level security;
alter table policies         enable row level security;
alter table credentials      enable row level security;

-- Anonymous read access to published, active content only.
create policy public_read_business_profile on business_profile
  for select using (is_published = true);
create policy public_read_business_hours on business_hours
  for select using (true);
create policy public_read_services on services
  for select using (is_active = true);
create policy public_read_service_areas on service_areas
  for select using (is_active = true);
create policy public_read_job_types on job_types
  for select using (is_active = true);
create policy public_read_brands on brands
  for select using (is_active = true);
create policy public_read_service_content on service_content
  for select using (is_published = true);
create policy public_read_faqs on faqs
  for select using (is_published = true and is_approved = true);
create policy public_read_policies on policies
  for select using (is_published = true);
create policy public_read_credentials on credentials
  for select using (is_published = true);
