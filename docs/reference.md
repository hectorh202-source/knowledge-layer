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
| `npx tsx scripts/migrate-profile-fields.ts` | One-off migration. `--dry-run` supported |

## Environment variables

See [setup.md](setup.md#environment) for the full table. The one that matters
most: **`SUPABASE_ANON_KEY` must be the anon key**, never the service role key.

## Ports

| Service | Port | Override |
|---|---|---|
| Admin portal | 3100 | `ADMIN_PORT`, or `--port` |
| Public API | 3001 | `PORT`, or `--port` |

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

## Admin API

Mounted at `/admin/api`. Localhost only, no authentication.

| Method | Path |
|---|---|
| `GET` | `/status` |
| `GET` `POST` | `/clients` |
| `GET` `DELETE` | `/clients/:slug` |
| `PATCH` | `/clients/:slug/settings` |
| `GET` | `/clients/:slug/sources` |
| `POST` | `/clients/:slug/intake/website` |
| `POST` | `/clients/:slug/intake/places` |
| `POST` | `/clients/:slug/promote` |
| `POST` `PATCH` `DELETE` | `/clients/:slug/content/:kind[/:index]` |
| `POST` | `/clients/:slug/content/:kind/bulk` |
| `POST` | `/clients/:slug/generate/faqs` |
| `GET` | `/clients/:slug/jsonld` |
| `GET` | `/clients/:slug/nap` |
| `GET` | `/clients/:slug/directories` |
| `GET` | `/clients/:slug/verify-markup` |
| `GET` `POST` | `/clients/:slug/tier1[/run]` |
| `PATCH` | `/clients/:slug/tier1/manual/:id` |
| `POST` | `/clients/:slug/publish/database` |

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
  db/           Supabase client and content loader
  intake/       crawl, fetch, html, jsonld, places, promote
  jsonld/       build, validate, vocabulary.json
  tenancy/      per-tenant file store
scripts/
  build-vocabulary.ts        regenerate the schema.org subset
  check-docs.ts              docs freshness check
  migrate-profile-fields.ts  one-off migration
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
