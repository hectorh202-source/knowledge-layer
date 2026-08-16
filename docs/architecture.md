# Architecture

## The pipeline

```
  SOURCES              INTAKE            REVIEW           PUBLISH
  ───────              ──────            ──────           ───────
  website  ─┐
  Google   ─┼─→  intake/*.json  ─→  content/*.json  ─→  JSON-LD  ─→ customer site
  a person ─┘     (candidates)       (approved)         API / DB
```

Four stages, and the boundaries between them are the design.

**Sources** disagree with each other. That is normal and is the point — see
[audits.md](audits.md#nap-consistency).

**Intake** writes *candidates* to `content/tenants/<slug>/intake/`. Nothing is
decided here. Each candidate carries `{ source, url, method, confidence }`.

**Promote** merges every intake file into the content files. It fills blanks,
never overwrites a human value, and reports conflicts instead of resolving them.

**Review** is the approval gate. Two independent flags per item: `approved` (a
person confirmed it is true) and `published` (a person confirmed it should go
out). Both are required before anything is served.

**Publish** turns approved-and-published content into schema.org JSON-LD, and
optionally into a Supabase database and a public API.

## Where data lives

Two stores behind one interface, `Storage` in `src/tenancy/storage.ts`.
Nothing above it knows which is in use.

| | `FileStorage` | `SupabaseStorage` |
|---|---|---|
| Backing | `content/tenants/<slug>/` | Postgres, via PostgREST |
| Reached with | the filesystem | the service role key |
| Good for | local work, offline, a single operator | anything deployed |

**Supabase when configured, files otherwise**, decided once per process so a
single run cannot read from one and write to the other. `CONTENT_STORE=files`
forces files even with Supabase configured; `CONTENT_STORE=supabase` refuses to
start without keys rather than silently falling back.

That escape hatch matters more than it looks. Production keys in `.env` are
otherwise enough to move every read and write onto the live database, with
nothing on screen to say so.

```
content/
  business-profile.example.json     template, committed
  tenants/                          GITIGNORED — real client data
    <slug>/
      settings.json                 operational config
      business-profile.json         the entity record
      services.json
      service-areas.json
      brands.json
      faqs.json
      credentials.json
      tier1.json                    audit state
      intake/
        website.json                crawl output
        places.json                 Google output
```

`content/tenants/` is gitignored deliberately. It holds real customer data and
unreviewed third-party content scraped from their sites.

The Supabase side is the same shape: `tenant_settings`, `business_profile`, the
five content tables, `tier1_audits`, `intake_runs`. All service-role only —
none of it is crawler-facing and some of it (account links, audit findings) is
commercially sensitive.

### Moving a client from files into the database

```bash
npm run content:migrate -- --dry-run
```

A copy, not a move: the files are left in place, so a bad run costs a re-run
and nothing else. It skips any client that already has settings in Supabase —
the likely mistake is running it after a week of portal edits and silently
reverting them to whatever the files last held. `--force` overrides that.

Every loader is async because of this split. A function that reads a client
returns a promise even when the file store answers instantly, since the same
call has to work against a database.

## Settings versus profile — an important split

**`business-profile.json` owns everything that publishes.** Name, domain,
schema type, address, hours, categories, all of it.

**`settings.json` owns operational config only.** Page URLs for the extractor,
the Google place ID, account links, the deployed API URL, notes.

`name`, `domain` and `schemaType` *appear* on the settings object but are read
from and written to the profile. They were once stored in both files and
drifted — renaming a client in Settings relabelled the nav while the published
markup kept the old name, with nothing on screen to say the edit had no effect.
See [gotchas.md](gotchas.md#the-same-field-stored-twice).

## Agencies

An agency owns a set of clients. Users belong to an agency; clients belong to an
agency; nobody sees anyone else's.

Three tables in Supabase — `agencies`, `agency_members` (owner or member),
`agency_clients` — with membership keyed on the **tenant slug**, not a tenant id.
Client content lives in files and a row in `tenants` only appears once the loader
runs, so keying on the id would make a client unreachable until it was published.
The slug exists from the moment a client is created.

**The guard is what matters, not the filter.** Filtering the client list is
cosmetic; every route carrying a `:slug` is checked against the caller's agency,
because slugs derive from business names and are guessable. A slug that exists
but belongs to someone else returns **404, not 403** — telling a stranger that a
client exists but is not theirs still tells them something about a business they
have no relationship with.

A unique index on `tenant_slug` means one client belongs to exactly one agency,
enforced by the database rather than by remembering to check.

**First sign-in provisions an agency** rather than showing an empty screen, and
the *first* agency also claims any client folders already on disk — the migration
from single-operator. Later users get a fresh empty agency and cannot inherit
existing clients by signing up late.

**Without Supabase there are no agencies** and every client is visible, which is
the local single-operator setup this app was until agencies existed.

### Invites

Public signups are off and should stay off, so an invite is **a claim on an
email address**, not a link that lets someone enrol. `agencyFor` checks for a
pending invite *before* provisioning — without that ordering an invited
colleague signs in, gets a new empty agency, and it looks identical to the
invite having failed.

The account itself is created either by Supabase's invite email or by hand in
the dashboard. Both end in the same place; the invite row is what decides which
agency they land in, which is why it is written whether or not the email sends.

Owner-only, because a member who can invite can hand the client list to anyone.
The last owner cannot remove themselves — that leaves an agency with clients, no
administrator and no route back without database access.

### Platform administration

Three tiers: **platform admin → agencies → clients.** Clients never log in; they
receive the report.

A platform admin creates agencies and invites their first owner. Granted by
`PLATFORM_ADMIN_EMAILS` in the environment, never by a database flag or the UI —
this is the one role that can create agencies, and it should not be grantable
through a web form by whoever currently holds it, or a single compromised
session becomes permanent.

**Platform admins administer agencies, not their data.** They see agency names
and counts, not clients' content. Support access means joining the agency, which
appears in that agency's Team list — there is no invisible access.

Platform routes return **404** to non-admins rather than 403, so the tier's
existence is not advertised. Hiding the nav item is tidiness; the routes are
guarded independently.

Being a platform admin and owning an agency are independent. The env var grants
one, an `agency_members` row the other.

## Source abstraction

`KnowledgeSource` has two implementations:

- **`FileSource`** — reads the content files. The default, and enough for real use.
- **`SupabaseSource`** — reads the database. Uses the anon key so RLS applies.

Both produce the same DTOs, so the JSON-LD builder, the API and the catalog do
not know or care which is behind them.

`BusinessDto extends BusinessProfile`. That is deliberate: the two were once
hand-maintained copies of the same field list and drifted every time a field was
added or removed. Deriving one from the other makes that impossible.

## The two servers

| Server | Command | Port | Purpose |
|---|---|---|---|
| Admin portal | `npm run portal` | 3100 | The operator UI. Writes. Behind Supabase Auth. |
| Public API | `npm run api` | 3001 | Read-only, crawler-facing, unauthenticated. |

They are separate processes on purpose. A misconfigured route on the public
surface cannot turn it into something that accepts writes.

The public API stays unauthenticated deliberately — crawlers cannot log in, and
everything it serves is already approved and published. RLS on the anon key is
its boundary, not a password. See [setup.md](setup.md#authentication).

### One deployment, every client

The public API resolves the client **per request, from the Host header**. A
client's domain points here:

```
api.acme.com  CNAME  <the deployment>
```

Two ways a hostname is registered, both from configuration the operator already
fills in: whatever the client's **API base URL** setting points at, and
`api.<their domain>` as the convention. Their bare domain is deliberately not
registered — that is their website and it does not point here.

Serving from the client's own domain is the point, not a convenience. Data at
`api.acme.com` is the business corroborating itself; the same data at our
domain is a third party vouching for them, which is a weaker entity signal.

**An unrecognised host is a 404, never a fallback client.** Serving some
arbitrary business's data to a caller who cannot tell they got the wrong
company is worse than an error. For the same reason every response carries
`Vary: Host` — two clients differ only by hostname, so a shared cache keyed on
the URL alone would hand one business's markup to another's visitors.

The mapping is cached for a minute, so a client added in the portal starts
resolving without a redeploy.

`TENANT_SLUG` or `--tenant` **pins** the process to one client and ignores the
hostname. That is for local work, where `localhost` maps to nobody, and for a
deliberately dedicated deployment.

Nothing has a default client any more. The API, the JSON-LD CLI, the catalog
generator and the content loader all refuse to run without being told who they
are acting for — a forgotten flag used to act on one particular customer
instead of failing.

## The portal UI

`src/admin/ui.ts` is a single-page app served as one string containing **one
inline script**. That has one sharp consequence: writing the closing script
sequence anywhere in that file — including inside a comment — truncates the page
and freezes the portal. `assertSingleScript` throws at boot if it happens. See
[gotchas.md](gotchas.md#a-comment-froze-the-entire-portal).

### Every action says it is happening

Feedback is proportional to the work, in three tiers. The signal should match
what the action costs: a modal that flashes for 150ms is noise, and a review
queue where every click blocks the screen cannot be worked through at all.

| Tier | Actions | Signal |
|---|---|---|
| Instant | approve, unapprove, publish, unpublish, manual check | Applied **optimistically** — the row changes now, dimmed until confirmed, reverted with an error if the server refuses |
| Page | open a client, save, add, delete, bulk | The clicked button becomes a spinner and disables |
| Long | crawl, Google pull, promote, Tier 1, database load, NAP, verify | **Dismissable overlay** naming the job. Hiding leaves it running — a crawl takes minutes, and holding someone hostage to it is not a feature |

Underneath all three, a thin bar at the top moves whenever any request is in
flight. It lives inside the `api()` wrapper rather than at the call sites, so it
covers endpoints nobody remembered to handle, including ones added later.

**Approve and publish do not re-read the client.** They change one row and know
which, so they patch local state and re-render. Every toggle used to fire two
requests and a full re-render, which is most of why the portal felt slow once
client data moved into Postgres. Delete is the exception: it shifts every later
item's index, and the index is what the API addresses, so that one re-reads
rather than guessing.

## Validation happens twice

**Profile validation** (`validateProfile`) splits gaps into `blocking` — without
which no entity can resolve, so nothing is served at all — and `missing`, which
are facts that could be cited and currently cannot.

**Markup validation** (`validateJsonLd`) checks generated JSON-LD against a
vocabulary distilled from schema.org itself. It catches the class of error that
looks right and silently fails: a real property on the wrong type, which
crawlers drop without complaint. See [markup.md](markup.md#validation).
