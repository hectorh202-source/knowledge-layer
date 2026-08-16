# Reference

## Commands

Everything the portal does is also a CLI tool. `--tenant <slug>` is required
unless `TENANT_SLUG` is set in `.env`.

### Running

| Command | What it does |
|---|---|
| `npm run portal` | Admin portal on :3100, localhost only |
| `npm run api` | Public read-only API on :3001 |
| `npm run typecheck` | Type check without emitting |
| `npm run build` | Compile to `dist/` |

### Intake

| Command | What it does |
|---|---|
| `npm run intake -- --site https://example.com --tenant <slug>` | Crawl a website |
| `npm run intake:places -- --tenant <slug>` | Fetch Google Places by place ID |
| `npm run promote -- --tenant <slug>` | Merge intake into content. `--dry-run` supported |

### Content

| Command | What it does |
|---|---|
| `npm run generate:faqs -- --tenant <slug>` | Build FAQs from approved facts. `--dry-run` supported |

### Audits

| Command | What it does |
|---|---|
| `npm run audit:nap -- --tenant <slug>` | NAP consistency across sources. `--no-live` skips fetching the site |
| `npm run audit:directories -- --tenant <slug>` | Where the business is listed |
| `npm run verify:markup -- --tenant <slug>` | Is our markup live and current |

### Publishing

| Command | What it does |
|---|---|
| `npm run jsonld -- --tenant <slug>` | Generate schema.org JSON-LD |
| `npm run catalog -- --tenant <slug>` | Generate the ARD catalog (Tier 3) |
| `npm run content:load -- --tenant <slug>` | Push approved content to Supabase. `--dry-run`, `--publish` |

### Maintenance

| Command | What it does |
|---|---|
| `npm run vocabulary:build` | Regenerate the schema.org subset from schema.org |
| `npm run docs:check` | Verify these docs still match the code |
| `npm run content:migrate` | Copy clients from disk into Supabase. `--dry-run`, `--tenant <slug>`, `--force` |
| `npx tsx scripts/verify-migration.ts` | Compare every client on disk against Supabase. Read-only |
| `npx tsx scripts/migrate-profile-fields.ts` | One-off migration. `--dry-run` supported |

## Environment variables

See [setup.md](setup.md#environment) for the full table. The one that matters
most: **`SUPABASE_ANON_KEY` must be the anon key**, never the service role key.

## Ports

| Service | Port | Override |
|---|---|---|
| Admin portal | 3100 | `ADMIN_PORT`, or `--port` |
| Public API | 3001 | `PORT`, or `--port` |

The portal binds to `127.0.0.1` unless given `--host` or `ADMIN_HOST`, and it
**refuses any other host without Supabase configured** — it edits every
client's data and shells out to the intake tools, so exposing it has to be a
deliberate act rather than a default.

## Public API

Read-only, unauthenticated, crawler-facing. Serves only content that is both
approved and published.

```
GET /v1/business
GET /v1/services
GET /v1/service-areas
GET /v1/faqs
GET /v1/credentials
GET /v1/brands
```

## Portal routes

Public — the only two that work without a session:

| Method | Path | |
|---|---|---|
| `GET` | `/login` | Sign-in form |
| `POST` | `/login` | Email and password, sets an httpOnly session cookie |
| `GET` | `/health` | Reports whether auth is configured |

Everything else requires a session. Pages redirect to `/login`; anything under
`/admin/api` returns `401` JSON instead, because a browser following a redirect
into a fetch handler produces a login page rendered inside a JSON parser.

| Method | Path | |
|---|---|---|
| `POST` | `/logout` | Revokes the session and clears the cookie |
| `GET` | `/whoami` | The signed-in user, or null |

## Admin API

Mounted at `/admin/api`. Requires a session.

| Method | Path |
|---|---|
| `GET` | `/status` |
| `GET` `POST` | `/clients` |
| `GET` `DELETE` | `/clients/:slug` |
| `PATCH` | `/clients/:slug/settings` |
| `POST` | `/clients/:slug/intake/website` |
| `POST` | `/clients/:slug/intake/places` |
| `POST` | `/clients/:slug/promote` |
| `POST` `PATCH` `DELETE` | `/clients/:slug/content/:kind[/:index]` |
| `POST` | `/clients/:slug/content/:kind/bulk` |
| `POST` | `/clients/:slug/generate/faqs` |
| `GET` | `/clients/:slug/report` | rendered HTML, for the client |
| `GET` | `/clients/:slug/jsonld` |
| `GET` | `/clients/:slug/nap` |
| `GET` | `/clients/:slug/directories` |
| `GET` | `/clients/:slug/verify-markup` |
| `GET` `POST` | `/clients/:slug/tier1[/run]` |
| `PATCH` | `/clients/:slug/tier1/manual/:id` |
| `POST` | `/clients/:slug/publish/database` |

## Billing

**Stripe owns billing.** The price, the subscription, the monthly charge, the
card retries, the receipts. This app knows which Stripe customer is which
client of ours and reads everything else live.

| | |
|---|---|
| Starting prices | $800/month plus a $2,500 one-off setup, both Stripe products |
| Local state | One table: `billing_accounts`, mapping a tenant slug to a Stripe customer and payment link |
| Enforcement | None. Stripe retries a failing card on its own schedule; nothing here cuts a client off |

### Two clicks

Pick the plan, press **Create payment link**. The link is copied to the
clipboard. Send it. The client pays once and Stripe charges the card every
month from then on.

There is nothing to do monthly. No invoice to raise, no month-end run, no
send. That is the whole point of the rebuild — the first version kept a ledger
here and used Stripe only to collect, which meant four clicks and two forms to
start a client and then a manual raise-and-send every month, forever.

### Why no local ledger

There was one: plans, subscriptions and invoices, three tables. It is gone.
Keeping the schedule here meant reimplementing what Stripe already does
better, including card retries, and it produced a flow that needed a manual.

The cost of reading live is a request or two per page. The benefit is that a
price changed in the Stripe dashboard is correct here immediately, and there
is no second copy of anything to drift.

**Prices live in Stripe, not here.** A price that exists in two places is a
price that will eventually disagree with itself.

### Payment links, not Checkout sessions

A Checkout session needs a `success_url` the customer's browser can reach, and
the portal runs on localhost — the customer would be redirected to a machine
that is not theirs. A payment link is hosted end to end by Stripe, needs no
public URL of ours, and is a stable thing you can text someone.

The tenant slug goes in the metadata of the link and of the subscription it
creates. That is the entire join: Stripe makes the customer at checkout, so
there is nothing to match on until the subscription exists and carries the slug
itself.

Replacing a link deactivates the old one. Two live links for one client means
two subscriptions if both get used, which is a refund conversation rather than
a tidiness problem.

### Mode

Read from the key — `sk_test_` or `sk_live_` — never a separate setting,
because a flag that can disagree with the key is a way to believe you are
testing while charging a real card. Every billing screen says which mode it is
in, and a link made in the other mode is flagged as dead rather than quietly
failing when a client tries to pay it.

### Taking a card over the phone

**Key a card in Stripe** creates the Stripe customer, carrying the tenant slug,
and opens Stripe's own subscription screen with that customer already selected.
Key the card there; it appears here on the next refresh.

A card field was built in this app first, with Stripe Elements. It worked and it
was deleted: an iframe, a publishable key, a script from js.stripe.com and a few
hundred lines, to reproduce a screen Stripe already ships and maintains. The
link does the same job with none of it, and moves card handling further away
rather than closer.

The customer must exist before the link can point anywhere, and creating it is
what carries the slug across — a subscription made by hand in the dashboard
would otherwise have no way back to a client.

**Beware Stripe search.** Its index is eventually consistent: a customer created
a second ago is not findable by metadata for up to a minute. The stored id is
always checked first. A search-only version made a second customer every time
the button was pressed twice, splitting one client across two records.

### What is deliberately not built

Changing a card, downloading a receipt, issuing a refund. All of it goes to
Stripe's own customer portal through **Manage card in Stripe**. Every version
of those features means handling card details, and there is no version of that
worth owning.
## Source layout

```
src/
  admin/        portal — server, routes, single-page UI
  api/          public API — routes, OpenAPI, rate limit
    source/     FileSource and SupabaseSource behind one interface
  audit/        tier1, nap, directory-presence, directories, verify-markup
  catalog/      ARD catalog (Tier 3)
  content/      generate-faqs
  data/         profile and content types, load and save, validation
  billing/      plans, accounts, subscriptions, invoices
  db/           Supabase client and content loader
  intake/       crawl, fetch, html, jsonld, places, promote
  jsonld/       build, validate, vocabulary.json
  tenancy/      storage layer (files and Supabase), tenants, agencies
scripts/
  build-vocabulary.ts        regenerate the schema.org subset
  check-docs.ts              docs freshness check
  migrate-profile-fields.ts  one-off migration
  migrate-to-supabase.ts     copy clients from disk into the database
  verify-migration.ts        compare the two stores, read-only
supabase/migrations/         SQL schema
docs/                        you are here
```

## Content kinds

`services`, `service-areas`, `brands`, `faqs`, `credentials`.

Every item carries `approved`, `published`, and `provenance`. Both flags are
required before anything is served.

## Provenance

```ts
{ source: "website" | "places" | "gbp" | "crm" | "calls" | "generated",
  url: string | null,
  method: string,
  confidence: "high" | "medium" | "low" }
```

`confidence` sorts a review queue. It never auto-approves anything.
