-- Everything the portal writes, so it can run somewhere other than a laptop.
--
-- Until now client data lived in files under content/tenants/. That works for
-- one operator on one machine and cannot be deployed: a container's filesystem
-- is ephemeral, so every release would wipe every client.
--
-- The content tables already existed, but only ever held *published* output
-- from the loader. The portal needs somewhere for the working state too — the
-- settings, the audit results, the raw intake, and the provenance that makes a
-- candidate judgeable rather than merely present.

-- --- settings ---------------------------------------------------------------
-- Operational configuration. Deliberately not the business profile: that lives
-- in business_profile because it publishes, and the split is load-bearing —
-- name, domain and schemaType were once in both places and drifted.

create table if not exists tenant_settings (
  tenant_id             uuid primary key references tenants(id) on delete cascade,

  api_base_url          text not null default '',

  -- Pages the extractor is pointed at, and the Google place ID. Kept flat
  -- rather than jsonb: they are queried and edited individually, and a blob
  -- would hide a typo in a key until something silently read nothing.
  services_page_url     text not null default '',
  service_areas_page_url text not null default '',
  google_place_id       text not null default '',

  -- Where the client's infrastructure lives and who owns it.
  cloudflare_url        text not null default '',
  cloudflare_owner      text not null default '',
  search_console_url    text not null default '',
  gbp_manage_url        text not null default '',
  hosting_provider      text not null default '',
  hosting_url           text not null default '',
  registrar             text not null default '',
  cms_url               text not null default '',

  notes                 text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- --- audit state -------------------------------------------------------------
-- One row per tenant, overwritten on each run. History is not kept: the report
-- answers "what is true now", and a stale check presented as current is worse
-- than no check. The run timestamp is inside the report.

create table if not exists tier1_audits (
  tenant_id   uuid primary key references tenants(id) on delete cascade,
  report      jsonb,
  -- Which of the manual checks a person has confirmed.
  manual      jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- --- intake ------------------------------------------------------------------
-- Raw candidate output, one row per source per tenant, replaced on each run.
--
-- Stored as jsonb rather than shredded into columns because nothing queries
-- inside it — promote reads the whole document, merges it, and writes content
-- rows. Shredding would buy nothing and cost a migration every time an
-- extractor learns a new field, which happened three times this week.

create table if not exists intake_runs (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  source      text not null check (source in ('website', 'places')),
  result      jsonb not null,
  ran_at      timestamptz not null default now(),
  primary key (tenant_id, source)
);

-- --- provenance on content ---------------------------------------------------
-- The content tables carried a `source` enum only. The portal shows where a
-- value came from, how it was recognised and how confident that is, and sorts
-- a review queue by it. Without these columns that judgement is lost the moment
-- content moves into the database.

alter table services       add column if not exists provenance jsonb;
alter table service_areas  add column if not exists provenance jsonb;
alter table brands         add column if not exists provenance jsonb;
alter table faqs           add column if not exists provenance jsonb;
alter table credentials    add column if not exists provenance jsonb;

-- Service areas carry ZIPs in the file store; the column may predate that.
alter table service_areas  add column if not exists zips text[] not null default '{}';

-- --- access ------------------------------------------------------------------
-- These are working tables, not published output. The portal reaches them with
-- the service role after authenticating the user and checking their agency.
-- The anon key has no business here at all: none of it is crawler-facing, and
-- some of it (account links, audit findings) is commercially sensitive.

alter table tenant_settings enable row level security;
alter table tier1_audits    enable row level security;
alter table intake_runs     enable row level security;

grant all on tenant_settings, tier1_audits, intake_runs to service_role;

-- Deliberately no grant to anon. Deliberately no policy for authenticated
-- either: nothing should reach these with a user token, and an absent policy
-- fails closed if something tries.
