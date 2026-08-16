-- Grants for the PostgREST roles.
--
-- The initial schema enabled row level security on every table and wrote
-- policies for them, then granted nothing. Both halves are required: a GRANT
-- lets a role reach the table at all, and the policy then decides which rows it
-- sees. With policies alone every request fails before RLS is ever consulted:
--
--   42501  permission denied for table tenants
--
-- That is not a security posture, it is an outage. Found the first time the
-- schema was applied to a real project.
--
-- Applied as a separate migration rather than by editing the initial one,
-- because that one has already run. Editing an applied migration desyncs
-- Supabase's history from the database and the next push fails on objects that
-- already exist.

grant usage on schema public to anon, authenticated, service_role;

-- Read-only for the public API. The anon (publishable) key is the security
-- boundary of the crawler-facing surface: RLS decides what it sees, and the
-- anon key is what makes RLS apply at all. It must never be able to write.
grant select on all tables in schema public to anon, authenticated;

-- The loader writes with the service role, which bypasses RLS by design and is
-- never exposed to a browser.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Future tables inherit the same shape, so the next migration that adds one
-- does not reintroduce this exact outage.
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;


-- --- two policy gaps found in the same pass -------------------------------

-- `tenants` had RLS enabled and no policy at all, which is deny-all. The public
-- API resolves a slug to a tenant id against this table on every request, so
-- the whole surface would have failed with "Tenant not found. Has content been
-- loaded?" — an error pointing at the loader when the cause is authorisation.
--
-- Visible only when the tenant has a published profile. A tenant row is not
-- secret in itself, but the full client list is commercially sensitive and
-- should not be enumerable by anyone holding the publishable key.
create policy public_read_tenants on tenants
  for select using (
    exists (
      select 1 from business_profile bp
      where bp.tenant_id = tenants.id and bp.is_published = true
    )
  );

-- `business_hours` was `using (true)` — every tenant's hours readable whether
-- or not that client is published, which is inconsistent with every other
-- table and leaks draft clients. Tied to the profile's published state
-- instead.
--
-- The subquery runs as the calling role, so business_profile's own policy also
-- applies to it; that is fine here because it only ever needs published rows,
-- which is exactly what that policy permits.
drop policy if exists public_read_business_hours on business_hours;

create policy public_read_business_hours on business_hours
  for select using (
    exists (
      select 1 from business_profile bp
      where bp.tenant_id = business_hours.tenant_id and bp.is_published = true
    )
  );
