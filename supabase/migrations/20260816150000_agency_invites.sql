-- Invites: how a second person joins an agency.
--
-- The constraint that shapes this: public signups are turned off, and should
-- stay off. So an invite cannot be "here is a link, make yourself an account" —
-- that is the thing we deliberately disabled.
--
-- Instead an invite is a claim on an email address. When someone with that
-- address signs in for the first time, they join this agency rather than being
-- provisioned a new empty one, which is what would otherwise happen and would
-- look to them exactly like the product being broken.
--
-- The account itself is created either by Supabase's invite email or by hand in
-- the dashboard. Both routes end in the same place, and the invite row is what
-- makes either one land in the right agency.

create table if not exists agency_invites (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies(id) on delete cascade,
  -- Stored lowercase; addresses are compared case-insensitively at sign-in
  -- because nobody types their own address the same way twice.
  email       text not null,
  role        text not null default 'member' check (role in ('owner', 'member')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

-- One outstanding invite per address. Without this, inviting the same person
-- twice leaves two rows and the second sign-in silently does nothing.
create unique index if not exists agency_invites_email_pending
  on agency_invites(email) where accepted_at is null;

create index if not exists agency_invites_agency on agency_invites(agency_id);

alter table agency_invites enable row level security;

-- Read by the portal server with the service role. This policy is defence in
-- depth: a member querying with their own token sees only their agency's
-- invites, never another agency's list of who they are hiring.
create policy invites_read_own_agency on agency_invites
  for select using (
    exists (
      select 1 from agency_members m
      where m.agency_id = agency_invites.agency_id and m.user_id = auth.uid()
    )
  );

grant select on agency_invites to authenticated;
grant all on agency_invites to service_role;
