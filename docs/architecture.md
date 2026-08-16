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
| Admin portal | `npm run portal` | 3100 | The operator UI. Writes. Localhost only. |
| Public API | `npm run api` | 3001 | Read-only, crawler-facing, unauthenticated. |

They are separate processes on purpose. A misconfigured route on the public
surface cannot turn it into something that accepts writes.

## The portal UI

`src/admin/ui.ts` is a single-page app served as one string containing **one
inline script**. That has one sharp consequence: writing the closing script
sequence anywhere in that file — including inside a comment — truncates the page
and freezes the portal. `assertSingleScript` throws at boot if it happens. See
[gotchas.md](gotchas.md#a-comment-froze-the-entire-portal).

## Validation happens twice

**Profile validation** (`validateProfile`) splits gaps into `blocking` — without
which no entity can resolve, so nothing is served at all — and `missing`, which
are facts that could be cited and currently cannot.

**Markup validation** (`validateJsonLd`) checks generated JSON-LD against a
vocabulary distilled from schema.org itself. It catches the class of error that
looks right and silently fails: a real property on the wrong type, which
crawlers drop without complaint. See [markup.md](markup.md#validation).
