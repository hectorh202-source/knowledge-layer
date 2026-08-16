-- Agencies: who may see which clients.
--
-- Until now every signed-in user saw every client, which is fine with one
-- operator and wrong the moment there are two. The product is sold to agencies
-- as well as contractors, so an agency needs its own set of clients that nobody
-- else can reach.
--
-- WHY THE JOIN IS ON A SLUG rather than a tenant id:
-- client content lives in files under content/tenants/<slug>/, and a row in
-- `tenants` only appears once someone runs the loader. Keying membership on the
-- tenant id would mean a client is unreachable until it has been published,
-- which is backwards — the whole point of the portal is working on clients
-- before they are ready. The slug is the identifier that exists from the moment
-- a client is created.

create table if not exists agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists agency_members (
  agency_id   uuid not null references agencies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- owner may add and remove members; member may work on clients. Enforced in
  -- the application, recorded here so it survives a rewrite of that code.
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  primary key (agency_id, user_id)
);

create index if not exists agency_members_user on agency_members(user_id);

create table if not exists agency_clients (
  agency_id   uuid not null references agencies(id) on delete cascade,
  -- Matches the directory name under content/tenants/.
  tenant_slug text not null,
  created_at  timestamptz not null default now(),
  primary key (agency_id, tenant_slug)
);

-- A client belongs to exactly one agency. Without this, two agencies could
-- claim the same slug and both would edit the same files with neither able to
-- see the other doing it.
create unique index if not exists agency_clients_slug_unique on agency_clients(tenant_slug);

alter table agencies       enable row level security;
alter table agency_members enable row level security;
alter table agency_clients enable row level security;

-- These tables are read by the portal server using the service role, which
-- bypasses RLS. The policies below are defence in depth: if anything ever
-- queries them with a user's own token, it still sees only its own agency.
create policy members_read_own on agency_members
  for select using (user_id = auth.uid());

create policy agencies_read_own on agencies
  for select using (
    exists (
      select 1 from agency_members m
      where m.agency_id = agencies.id and m.user_id = auth.uid()
    )
  );

create policy agency_clients_read_own on agency_clients
  for select using (
    exists (
      select 1 from agency_members m
      where m.agency_id = agency_clients.agency_id and m.user_id = auth.uid()
    )
  );

grant select on agencies, agency_members, agency_clients to authenticated;
grant all on agencies, agency_members, agency_clients to service_role;
