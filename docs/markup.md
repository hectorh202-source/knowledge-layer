# Structured data

## What gets emitted

One `@graph` containing a business node and, when there are approved FAQs, an
`FAQPage`. The business node's `@type` comes from the profile's `schemaType` —
`Plumber` and `HVACBusiness` tell a crawler more than `LocalBusiness`.

| Source | Property |
|---|---|
| Profile name, phone, email, domain | `name`, `telephone`, `email`, `url` |
| Address | `PostalAddress` — street withheld for service-area businesses |
| Hours | `openingHoursSpecification` |
| Special hours | `specialOpeningHoursSpecification` |
| Primary Google category | `additionalType` |
| GBP URL + other profiles | `sameAs`, Google first |
| Geo | `GeoCoordinates` |
| Branding | `logo`, `image`, `slogan`, `alternateName` |
| Commerce | `priceRange`, `paymentAccepted`, `currenciesAccepted` |
| Trust | `numberOfEmployees`, `award`, `memberOf`, `founder` |
| Attributes | `additionalProperty` |
| Booking URL | `potentialAction` as a `ReserveAction` |
| Service areas | `areaServed` |
| Services | `hasOfferCatalog` |
| Brands | `knowsAbout` |
| Credentials | `hasCredential`, with `credentialCategory` and `expires` |
| FAQs | `FAQPage` → `Question` → `Answer` |

### Decisions worth knowing

**`knowsLanguage`, not `availableLanguage`.** The latter belongs on
`ContactPoint` and `Service`. On a business it is invalid and silently dropped.

**Service-area businesses publish no `streetAddress`** but do publish `geo`.
Coordinates set to the middle of a service area expose no doorstep and are what
let a crawler answer "near me" at all.

**Special hours carry `validFrom` and `validThrough` set to the same date.**
Without both, the entry reads as a permanent rule — it would say the business is
closed for good.

**Booking is a `ReserveAction`, not a bare URL**, so an agent can tell that
following it books work rather than opening a page.

**`aggregateRating` is never emitted.** Republishing Google's ratings as your own
markup is a licensing problem.

## Validation

Every build checks the generated graph against a vocabulary distilled from
schema.org itself. Errors are surfaced in the portal and included in
`JsonLdResult.issues`.

```bash
npm run vocabulary:build     # regenerate from schema.org
```

`scripts/build-vocabulary.ts` fetches the real 1.5MB vocabulary, walks the class
hierarchy for the ~30 types this app emits, and writes a 67KB subset to
`src/jsonld/vocabulary.json`. Re-run it when schema.org changes or when the
builder starts emitting a new type.

The validator answers three questions: does the property exist, is it legal on
this type, and is the value roughly the right shape. It catches the failure mode
that looks correct in review — a real property on the wrong type, which crawlers
drop without complaint and nothing else reports.

Proven against deliberately broken markup:

```
ERROR  @graph[0].availableLanguage  real schema.org property but not valid on Plumber
ERROR  @graph[0].telephon           not a schema.org property — check the spelling
ERROR  @graph[0].geo.longitud       not a schema.org property — check the spelling
```

It correctly passes valid-but-unusual properties like `ethicsPolicy`.

> **Do not prune `vocabulary.json` to what you emit.** It is a dictionary, not an
> inventory. The entries you never emit are how the validator knows `taxID` is
> real and `telephon` is not — they are the control group. Pruned to eleven
> properties, the check can only confirm you emitted what you emitted. See
> [gotchas.md](gotchas.md#the-dictionary-is-not-an-inventory).

### Two validator subtleties

**`{"@id": "..."}` is a node reference**, not an untyped node. It is the correct
way to point one node at another and carries nothing to check.

**Enumeration members are URL strings.** `dayOfWeek: "https://schema.org/Monday"`
is right. The generator records all 95 enumeration types so the checker knows.

Both were false positives producing ~90 warnings per build before being fixed —
which would have trained anyone to ignore the panel.

## Getting it onto a site

### Snippet — the current route

**Publishing → Copy snippet** wraps the graph in a `<script type="application/ld+json">`
tag with the closing sequence escaped, so a string inside the JSON cannot end
the element early.

Works on every platform. The failure mode is staleness: correct the day it is
pasted, drifting from then on, with the portal looking healthy throughout. That
is what the verification check is for — see [audits.md](audits.md#live-markup-verification).

### Cloudflare Worker — the upgrade

Injects at the edge, so nothing goes stale and no CMS access is needed. It also
fixes host-level crawler blocking. **Not built**: it requires a nameserver
change that also moves email, which is not authorised yet, and code that cannot
be deployed or tested does not belong in the repository.

### Client-side fetch — ruled out

Google renders JavaScript. **GPTBot, ClaudeBot and PerplexityBot largely do
not.** Markup injected client-side is invisible to precisely the crawlers this
product exists to reach. It is the easiest route to build and it defeats the
purpose.

## Rich results versus AI crawlers

Google's *rich results* use a narrow subset — roughly name, address, telephone,
geo, url, image, priceRange, openingHoursSpecification. Most of what this app
emits will never produce a rich snippet.

That is fine, and it is not who you are optimising for. LLM crawlers ingest the
whole graph. Valid schema.org is the target, not Google's snippet subset.

Neither `memberOf` nor `hasCredential` produces a rich result, and there is no
public measurement of how answer engines weight them. They are kept because they
are true structured facts answering questions people actually ask — "is this
plumber licensed?" — at a cost of a few lines. "Proven to change an AI answer" is
not an available standard: no property in schema.org has that, `openingHoursSpecification`
included.
