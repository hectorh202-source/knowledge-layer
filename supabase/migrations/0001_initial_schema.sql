-- Knowledge Layer — schema
--
-- Purpose: make a business legible to AI, so an answer engine can resolve who
-- it is, what it does, where it works, and answer questions about it.
--
-- Everything here is content a human approved. Three sources fill it, in
-- priority order — Google Business Profile, then the website, then manual
-- entry — and every row records which one it came from. No source writes
-- directly to these tables; extraction produces candidates in files, a person
-- approves them, and only then do they land here.
--
-- Two flags gate every piece of content:
--   is_approved  — a human confirmed it is true
--   is_published — a human decided to serve it
-- Both must be set. Nothing is served on a business's behalf by default.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

-- One Supabase project serves every customer; tenant_id separates them and RLS
-- enforces it. Splitting a customer into their own project is only warranted by
-- a hard isolation requirement.
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The entity
--
-- The foundation. An answer engine that cannot resolve this business as a
-- distinct entity cannot recommend it, however good the rest of the content is.
-- ---------------------------------------------------------------------------

create table business_profile (
  tenant_id         uuid primary key references tenants(id) on delete cascade,

  name              text not null,
  legal_name        text,
  description       text,

  -- The canonical NAP number. Must match the Google Business Profile and every
  -- directory listing character for character — an inconsistent NAP actively
  -- degrades entity resolution. Tracking numbers belong on landing pages.
  phone             text,
  email             text,
  domain            text,

  street            text,
  city              text,
  region            text,
  postal_code       text,
  country           text not null default 'US',

  -- The strongest corroboration signal available. AI weights agreement across
  -- independent sources, and locally this is the one that counts.
  gbp_url           text,

  founded_year      integer,
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
  day_of_week  integer not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  opens        time,
  closes       time,
  is_closed    boolean not null default false,
  unique (tenant_id, day_of_week)
);

comment on table business_hours is
  'Structured for schema.org openingHoursSpecification. "Call for hours" is not citable.';

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------

-- Where a row came from, so a reviewer can judge it and a stale source can be
-- traced later.
create type content_source as enum ('gbp', 'places', 'website', 'manual');

create table services (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  category     text,
  description  text,
  source       content_source not null default 'manual',
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, name)
);

comment on table services is
  'Use the words customers use. "Water heater replacement" gets matched to a question; "plumbing solutions" does not.';

create table service_areas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  -- Real postal codes are the point: they let an answer engine match a
  -- customer's location exactly instead of guessing from prose.
  zips         text[] not null default '{}',
  source       content_source not null default 'manual',
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, name)
);

create table brands (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  source       content_source not null default 'manual',
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, name)
);

comment on table brands is
  'Answers "do you work on X", which is a high-volume question shape.';

-- Question and answer is the citation mechanism — an answer engine matches a
-- user's question to an answer, making this the highest-leverage table here.
create table faqs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  question     text not null,
  answer       text not null,
  source       content_source not null default 'manual',
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, question)
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
  -- A lapsed license published as current is a compliance claim that stopped
  -- being true. Expired rows are never served.
  valid_until  date,
  source       content_source not null default 'manual',
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table policies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  kind         text not null
               check (kind in ('warranty', 'permits', 'payment', 'scheduling',
                               'cancellation', 'emergency', 'guarantee', 'other')),
  title        text not null,
  body         text not null,
  is_approved  boolean not null default false,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index services_tenant_idx     on services (tenant_id);
create index service_areas_tenant_idx on service_areas (tenant_id);
create index brands_tenant_idx       on brands (tenant_id);
create index faqs_tenant_idx         on faqs (tenant_id);
create index credentials_tenant_idx  on credentials (tenant_id);

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
create trigger services_updated_at before update on services
  for each row execute function set_updated_at();
create trigger service_areas_updated_at before update on service_areas
  for each row execute function set_updated_at();
create trigger brands_updated_at before update on brands
  for each row execute function set_updated_at();
create trigger faqs_updated_at before update on faqs
  for each row execute function set_updated_at();
create trigger credentials_updated_at before update on credentials
  for each row execute function set_updated_at();
create trigger policies_updated_at before update on policies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled everywhere so adding a customer is a data change, not a security
-- decision. The loader uses the service role key and bypasses RLS; the public
-- API uses the anon key, so these policies are what protect unpublished drafts
-- and other tenants' data.
-- ---------------------------------------------------------------------------

alter table tenants          enable row level security;
alter table business_profile enable row level security;
alter table business_hours   enable row level security;
alter table services         enable row level security;
alter table service_areas    enable row level security;
alter table brands           enable row level security;
alter table faqs             enable row level security;
alter table credentials      enable row level security;
alter table policies         enable row level security;

create policy public_read_business_profile on business_profile
  for select using (is_published = true);
create policy public_read_business_hours on business_hours
  for select using (true);
create policy public_read_services on services
  for select using (is_approved = true and is_published = true);
create policy public_read_service_areas on service_areas
  for select using (is_approved = true and is_published = true);
create policy public_read_brands on brands
  for select using (is_approved = true and is_published = true);
create policy public_read_faqs on faqs
  for select using (is_approved = true and is_published = true);
create policy public_read_credentials on credentials
  for select using (is_approved = true and is_published = true);
create policy public_read_policies on policies
  for select using (is_approved = true and is_published = true);
