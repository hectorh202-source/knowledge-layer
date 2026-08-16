# Open Questions — AI Discoverability Platform

Living doc. Started 2026-08-15.

The point of this file is that **you don't need answers to these right now.** Most of them only
become urgent at a specific moment in the build. Each entry says what it blocks, so you can tell
whether it's a today problem or a six-months-from-now problem.

**Status key:** `OPEN` · `ANSWERED` · `BLOCKED` (waiting on someone else) · `DEFERRED` (deliberately
not deciding yet)

**Standing rule:** anything we don't have, don't know, or decide to postpone gets logged here as it
comes up — no need to ask. Deferring is a valid answer; losing track of what was deferred is not.

---

## 1. ARD spec & catalog mechanics

### 1.1 Does a redirect satisfy domain binding, or must the file return 200 from the customer's origin?
**Status:** OPEN
**Why it matters:** If a 302 to a central host counts, each customer's install is a two-line rewrite.
If the file must be served from their domain, every adapter needs a server-side proxy fetch —
different failure modes, caching, and timeout handling.
**Blocks:** The delivery adapter design. Same product, meaningfully different plumbing.
**How to answer:** Read `/spec/` and `/how_to_publish/` at agenticresourcediscovery.org.

### 1.2 Is per-tenant cryptographic signing required?
**Status:** ANSWERED — No. Optional.
Trust data lives in an optional `trustManifest` object inside each entry, decoupled from the
lightweight metadata. Signatures are detached JWS over the trust metadata. The baseline manifest
carries no signature at all.
**Consequence:** No key management system needed for v1. No per-tenant key store, no rotation, no
binding ceremony. Signing becomes an upsell tier later if registries start weighting it.

### 1.3 What is the correct media type for an OpenAPI entry?
**Status:** OPEN — narrowed, not closed (rechecked 2026-08-15)
Re-read `agenticresourcediscovery.org/ai_catalog_spec/`. It documents **only**
`application/mcp-server+json` and defers the full media type list to an external `ai-catalog`
repository on GitHub. So the OpenAPI type is still a guess.
**Current guess:** `application/openapi+json`, isolated in `MEDIA_TYPES` in
`src/catalog/schema.ts` and overridable with `--openapi-type`. The generator warns on every run
while the default is in use.
**Why it matters:** A wrong media type may make the manifest invalid.
**Where to look next:** the `ai-catalog` GitHub repository the spec page points to.

### 1.8 Is `specVersion` "1.0" or "0.9"?
**Status:** OPEN — new discrepancy found 2026-08-15
Our June notes recorded ARD as a v0.9 draft. The spec page's example now shows `"specVersion":
"1.0"`. Either 1.0 shipped in the two months since, or the page is ahead of the published schema.
**Handling:** defaults to `"1.0"` with a warning on every generation; override with
`--spec-version`.
**Blocks:** Publishing. Not the build.

### 1.9 What is confirmed about the manifest shape
**Status:** ANSWERED (read from the spec page, 2026-08-15)
- Four root elements: `specVersion`, `host`, `entries`, `collections`
- `host` carries `displayName` and `identifier` (a domain or DID)
- Entries carry `identifier`, `displayName`, `type`, `url`, `description`
- `trustManifest` is an optional per-entry object — baseline manifests are unsigned (see 1.2)
- Identifiers use a domain-scoped URN convention

### 1.4 What does `collections` actually allow?
**Status:** OPEN
Root element for sub-catalogs / departmental feeds.
**Why it matters:** If a customer's root catalog can legitimately reference centrally-hosted
resources through a collection, the whole adapter problem gets much simpler.
**Blocks:** Nothing today — but could simplify the platform story considerably.

### 1.5 Which of the four catalog discovery methods matter?
**Status:** OPEN
The spec defines four ways an agent or crawler can locate a catalog. Only the well-known path has
been considered so far.
**Blocks:** Nothing yet. Relevant when optimizing for actually getting found.

### 1.6 Will registries be stricter in practice than the spec? Will v1.0 change any of this?
**Status:** OPEN — unanswerable for now
v0.9 draft with near-zero adoption means no body of implementation experience to check against.
**How to handle:** Build to the spec, expect drift, keep the generator's output easy to regenerate.

### 1.7 Has adoption moved since June?
**Status:** OPEN — worth rechecking
As of the June 18 census, zero of 39 major sites — including all eleven working-group members —
served a discoverable `ai-catalog.json`. Google's native support in Agent Platform was "coming in
following months." That data is now ~2 months stale.
**Why it matters:** This is the single number that tells you whether the catalog is a lottery ticket
or a real channel. Recheck quarterly.

---

## 2. Delivery onto customer domains

### 2.1 Which delivery adapters do you actually build?
**Status:** DEFERRED — TitanZ is WordPress, that's the only one needed now
Candidates in rough order of leverage: Cloudflare Worker (platform-agnostic, probably the best
single lever), WordPress mu-plugin, nginx/Apache snippet, Netlify/Vercel rewrites.
**Blocks:** Customer #2, if they're not on WordPress.

### 2.4 Who owns the Cloudflare account?
**Status:** OPEN — decide before customer #2
One Cloudflare account holds unlimited zones, so a master account works technically. The real
question is nameserver control: on the free plan, adding a domain means pointing its nameservers at
Cloudflare, so whoever holds the account controls all their DNS — site and email both.

**Options:** client owns the account with you added as a member (cleanest at churn, small onboarding
friction); your master account holding every zone (fastest, but you hold DNS for businesses you
don't own); or Cloudflare for SaaS, where clients keep DNS and CNAME to you (the proper
multi-tenant answer, paid, overkill until there's volume).

**Recommendation on file:** client-owned, you as a member. It matches the rest of the product —
improving assets they own rather than taking custody — and it answers 2.3 cleanly, since churn just
means losing access.

**Caveat on the fix:** Cloudflare stops the 429 by absorbing crawler traffic at its cache, so
requests never reach Hostinger's rate limiter. Uncached paths still pass through to origin. Verify
with the Discoverability audit after it's live rather than assuming.

### 2.2 Should site access be a hard qualification gate at signup?
**Status:** OPEN
E.g. "we need Cloudflare on your domain, or edit access to the host."
**Why it matters:** The customers who most need this are the ones whose site is a mystery box the
last agency left behind. Better to disqualify at signup than discover it in week three.
**Blocks:** Sales process design.

### 2.3 What happens to the catalog and schema markup if a customer churns?
**Status:** OPEN
Both sit on *their* domain but flow through your system.
**Why it matters:** Buyers who've been burned by agencies will ask this in the sales call. A clean
stated answer makes you easier to buy from.
**Blocks:** First contract.

---

## 3. Sources

### 3.0 CRM is out of scope for v1
**Status:** ANSWERED — decided 2026-08-15
All ServiceTitan and CRM code removed. The goal is making a business findable by AI, and a CRM
integration is a gate in front of that — it blocks onboarding, only helps customers on one specific
CRM, and none of it was needed. Recoverable from git history at `baf2923` if it ever earns its way
back as an optional enrichment.

**The three sources, in priority order:**
1. **Google Business Profile** — most authoritative, already curated by the owner
2. **Their website** — whatever Google doesn't carry
3. **Manual entry** — anything neither has

Everything is content a human approved, with the source recorded on every row. There is no longer a
derived-versus-authored split, because nothing writes to the database automatically.

### 3.1 Two different Google APIs
**Status:** OPEN — sequencing matters
- **Places API (New)** — your key, no approval, no customer involvement. Hours, NAP, categories,
  rating. Built (untested, see 4.11).
- **Business Profile API** — services, owner-written description, Q&A, attributes. Needs Google to
  approve your project *and* each customer to OAuth in. Not built.
**Action:** submit the Business Profile API access request early; it's slow and blocks nothing else.

## 4. Data, content & intake

### 4.0 Direction correction — pricing is not the organizing principle
**Status:** ANSWERED — corrected 2026-08-15
The build drifted into pricing because revenue was the easiest thing to compute from ServiceTitan,
and easy to measure got mistaken for important. This is an AEO app: the goal is **being mentioned**,
not being price-shopped.

**What getting mentioned actually requires:**
1. The AI can resolve the business as a distinct entity — NAP, hours, service area. Foundational;
   nothing else works without it.
2. Content matches the question shape. Question→answer is the citation mechanism, which makes FAQs
   the highest-leverage content in the system.
3. Coverage of the query surface — services × areas, "who does X in Y".
4. Corroboration — reviews, directories, third-party mentions. AI weights agreement across sources.

**Removed:** revenue analysis, price statistics, pricing endpoints, the pricing page template.
Recoverable from git history at `b05b3b6` if it's ever wanted back as one field on a service page.
**Kept from that work:** nothing pricing-specific. The mapping boundary (`src/data/normalize.ts`)
survived because it was never about pricing.

### 4.6 schema.org / JSON-LD
**Status:** ANSWERED — built 2026-08-15
Generated from the same knowledge source the API reads, so published markup can't drift from what
the API serves. Emitted as one `@graph` with `@id` anchors, and served live at `/jsonld` so a
snippet on the customer's site can fetch it rather than pasting once and going stale.

### 4.15 The site already has business markup — replace, don't append
**Status:** OPEN — needs a human decision, per customer
calltitanz.com already publishes `Plumber` JSON-LD; that's where intake read the NAP. Adding ours
alongside leaves two independent business definitions on one page and a crawler guessing which is
authoritative.
**Options:** replace their block with ours, or keep theirs and publish only the FAQPage node.
**Why FAQPage alone is tempting:** their 25 FAQs exist as accordion HTML with no markup at all, so
that node is pure gain with no conflict. The generator detects and warns; it does not decide.

### 4.16 Two schema.org modeling judgment calls
**Status:** OPEN — low stakes, worth revisiting
- **Brands serviced → `knowsAbout`.** schema.org has no property for "equipment brands we service".
  `knowsAbout` expresses subject-matter competence, which is the nearest honest fit; `brand` would
  wrongly claim ownership.
- **Licenses → `hasCredential`.** Defined for `EducationalOccupationalCredential`, an imperfect fit
  for a trade license but the nearest standard property.
**How to settle:** run the output through Google's Rich Results Test and see what it actually reads.

### 4.1 Which TitanZ service brings in the most revenue?
**Status:** OPEN
**Why it matters:** That's the first pricing page. Highest-ticket, highest-volume job first; once one
is right, the rest follow the same shape.
**Blocks:** Starting the highest-return work in the whole plan.

### 4.2 Who owns freshness, and how often?
**Status:** OPEN
A stale catalog is worse than no catalog — it produces confident wrong answers about pricing and
availability.
**Blocks:** Nothing technically. Everything reputationally.

### 4.3 How do you get pricing ranges without the owner guessing?
**Status:** OPEN
Job/invoice history can produce real distributions per job type. But "what moves this price up or
down" is expertise, not data.
**Blocks:** Whether onboarding is a two-week manual lift or a review-and-approve session.

### 4.5 The mock data's field shapes are guesses
**Status:** OPEN — accepted risk, deliberately taken
ServiceTitan registration is postponed, so the build runs on generated mock data
(`npm run export -- --mock`). The field names in `src/mock/generate.ts` are modeled from memory of
the ServiceTitan v2 API, not from documentation or a real response.

**What this is good for:** proving the pipeline — pagination, output layout, manifests, the
invoice→job join, and every analysis and transform step downstream.

**What it is not good for:** finalizing a schema. This reintroduces exactly the "designing against
imagined data" problem the export was written to avoid. Anything shaped directly by these field
names is provisional until a real export confirms it.

**How to limit the damage:** keep the boundary between raw ServiceTitan shapes and our own schema
explicit, so correcting the mapping later is a change in one place rather than a refactor.
**Resolves when:** the first real integration export lands. Diff it against the mock output.

### 4.7 Intake must not depend on the voice agent
**Status:** ANSWERED — corrected 2026-08-15
Call transcripts were being treated as *the* FAQ source. Most customers won't have a voice agent, so
depending on it would mean the AEO product can't be sold standalone. Transcripts are now one
optional high-quality source among several, not the foundation.

**Source order, by how universally available each is:**
1. **Website** — everyone has one, no credentials. Built.
2. **Places API** — public Google data, needs only *our* API key, not the customer's authorization,
   so a profile can be pre-filled during a sales call before anything is signed. Not built.
3. **GBP API** — full profile including Q&A, posts, attributes. Needs the owner to OAuth. Not built.
4. **CRM** — richest structured data, needs integration. Partly built (the export).
5. **Call transcripts** — best FAQ source when it exists. Optional.
6. **Generated** — build candidates from the service list when a site has nothing. Not built.

### 4.8 The domain a customer gives you may not be their site
**Status:** ANSWERED — handled in the crawler
Found immediately on the first real run: `titanzplumbing.com` is a one-page landing shell whose only
link points at `calltitanz.com`, the actual site. The crawler now detects a single page whose links
all go to one non-social external host and says so, rather than reporting a thin crawl as a thin
business.

### 4.9 Services and service areas aren't extractable from most sites
**Status:** OPEN
The real run pulled 25 FAQs, full NAP, and both Florida license numbers — but zero services and zero
areas, because the site publishes no `Service` or `areaServed` JSON-LD. Nav labels and page titles
are the obvious fallback but they're noisy.
**Mitigating factor:** for CRM-connected customers, services come from ServiceTitan and are better
than anything scraped. This gap mostly matters for customers onboarded before their CRM is wired up.

### 4.10 Extracted credentials are compliance claims
**Status:** OPEN — deliberately low confidence
Regex found `CFC1434184` and `CAC1824330` on the real site. Those look right, but a license number
is a claim about compliance, and a wrong or lapsed one published as current is the worst kind of
stale record.
**Rule already enforced:** the API never serves expired credentials, and nothing extracted is
approved automatically. Someone has to verify these against the state license lookup.

### 4.11 The Places API integration is untested against a live call
**Status:** RESOLVED — 2026-08-15, verified against live responses
`POST places:searchText` with `X-Goog-Api-Key` + `X-Goog-FieldMask` returns HTTP 200 and the expected
`places[].displayName.text` / `formattedAddress` / `nationalPhoneNumber` / `websiteUri` shape. The
endpoint paths and search field mask are correct as written.
**Still unverified:** the *details* call — `addressComponents` type strings and the
`regularOpeningHours.periods` shape have not been exercised, because no test business has matched
confidently yet. Those remain the most likely things to be wrong.
**First failure was not code:** `Requests to this API ... are blocked` is the Google Cloud key
restriction error, not a bad request. It means the request reached Google and was refused before
execution — so it also proved the endpoint path was valid.

### 4.11a Service-area businesses are invisible to Places Text Search
**Status:** ANSWERED — 2026-08-15. **This is a product-shaping constraint, not an edge case.**
Searching Places for the test business returned nothing under any query: the exact listing name, the
distinctive word "Chucker" globally, the name plus city, the phone number, and a tight
`locationRestriction` rectangle over its city. The same rectangle happily returned twenty
competitors. The obvious conclusion — that the listing was unverified or unpublished — was **wrong**.
It is live, `OPERATIONAL`, rated 5.0 from 60 reviews, and fetching `places/{id}` directly works
perfectly.
**Cause:** the Places details response carries no `formattedAddress` and no `addressComponents`. It
is a service-area business with a hidden street address, and Google's Text Search does not return
address-less businesses. They are reachable by place ID and effectively only by place ID.
**Why this shapes the product:** SAB-with-hidden-address is the *norm* in home services — plumbers,
haulers, HVAC, electricians, locksmiths. That is the entire target market. Search-by-name is
therefore the exception path and place ID is the main road.
**Consequences taken:** `sources.googlePlaceId` added to tenant settings with a field in Settings →
Content sources; Places intake uses it before attempting any search; the zero-results message now
explains SABs instead of blaming verification.
**Finding the ID without asking the owner:** the client's own site usually carries it. `ChIJ…` and
`cid=` appear in embedded maps and review widgets — grepping three pages of the test site found it
immediately. Worth automating into the crawl.

### 4.11c Autocomplete does not rescue name lookup — the site does
**Status:** ANSWERED — 2026-08-15, autocomplete tested and rejected
The obvious fix for "name search doesn't work" is the SaaS-standard autocomplete dropdown, backed by
`places:autocomplete`. Tested: it does not return the SAB either. Unbiased it returned a similarly
named business in Ottawa, Canada; with a `locationRestriction` circle over the client's own city it
returned `{}`. Both Places search surfaces exclude address-less businesses, so a dropdown would show
the client's competitors and never the client.
**What works instead:** the client's own website. `ChIJ…` and `cid=` appear in embedded maps and
review widgets, and a place ID is an opaque Google-issued identifier, so finding one on a site is
near-proof of which listing that site belongs to — the one high-confidence signal in the whole
heuristic extractor.
**Built:** `extractPlaceIds` in the crawl, `entity.placeId` candidates, and Places intake resolving
the ID from Settings → crawl → search in that order. Verified against the live site.
**Ordering consequence:** the Sources page now runs Website before Google Places, because Places
depends on the crawl having found the ID.
**Still open:** an autocomplete dropdown remains worth building for clients that *do* publish an
address, but it cannot be the primary path.

### 4.11f All search paths removed — place ID or manual entry, nothing else
**Status:** DECIDED — 2026-08-15
Everything built to work around the SAB problem was deleted: the name-search ladder, the
corroboration matcher, and the legacy phone lookup. `searchPlaces`, `matchPlace`, `findPlaceByPhone`
and their supporting helpers are gone.
**Why, given phone lookup demonstrably worked:** it worked for businesses Google already indexes,
which are exactly the ones least likely to need help. It did nothing for the clients this product
targets. Keeping it meant three code paths, three failure messages and three ways to import the
wrong company, in exchange for a case the crawl already covers.
**What remains:** `fetchPlaceDetails` by place ID and `parsePlaceId`. The ID comes from Settings or
from the crawl. No ID means the business is entered by hand, which is a smaller cost than a fallback
that fails differently each time.
**Wrong-business risk is now structurally gone** rather than mitigated — a place ID identifies
exactly one listing, so there is no matching step left to get wrong. The `expectName`/`expectPhone`
corroboration machinery went with it.
**Size:** `places.ts` and `run-places.ts` together are 437 lines, down from roughly 700.

### 4.11e Phone lookup works, and still cannot reach a hidden-address SAB
**Status:** SUPERSEDED by 4.11f — the finding stands, the code was removed.
Places API (New) has no phone lookup; the legacy `findplacefromtext` endpoint does, via
`inputtype=phonenumber`. Built as `findPlaceByPhone`, wired ahead of name search, and it **works** —
control tests resolved two indexed businesses straight to their place IDs from nothing but a phone
number. Since the crawl already extracts the phone from the client's site, that is a real automatic
route for any client Google indexes normally.
**It does not solve SABs.** The test business returns `ZERO_RESULTS` by phone exactly as it does by
name.
**Seven surfaces now tested against one live, verified, 5.0-rated listing, all failing:**
Places (New) Text Search; Places (New) Autocomplete unbiased, location-biased and
location-restricted; legacy Find Place by name; legacy Text Search by name; legacy Autocomplete;
legacy Find Place by phone; and scraping the rendered Maps page, which contains no `ChIJ` string at
all — only a hex CID pair and a `/g/` Knowledge Graph ID, neither convertible.
**Settled conclusion:** there is no name-based or phone-based route to a service-area business that
hides its address. This is deliberate on Google's part — SABs are largely home-based, and a
queryable API would publish home addresses in bulk. Treat it as a fixed constraint, not a gap to
engineer around.
**The three routes that do work:** the place ID off the client's own site (automatic, built), a
review link the client sends (`writereview?placeid=…`, parsed, built), or the GBP API after they
authorize (4.11d).
**Lookup order now implemented:** place ID → phone → name.

### 4.11d Business Profile API — the answer for onboarded clients, not for lookup
**Status:** OPEN — decision pending, access not requested
The GBP API is not a search API. There is no "find any business by name"; it lists only locations the
authenticated account manages, so it cannot replace Places for pre-sale research on a business that
has not hired us.
**What it does solve:** once a client grants access — normally by adding the agency as a manager,
which agencies do anyway — `accounts.locations.list` returns their locations directly. No searching,
no place ID hunting, and the SAB problem disappears entirely because we are not searching.
**What it adds beyond Places:** service areas, categories, attributes, Q&A, posts, reviews, and
crucially **write access** — hours, description and services can be corrected at the source rather
than only mirrored. For an AEO product that is a different class of capability.
**It also dissolves 4.12:** the caching restriction on Places data does not apply the same way to a
client's own data accessed with their authorization.
**Cost:** Google gates the Business Profile APIs behind an access request that takes days to weeks.
If it is wanted, the application should go in early rather than when it is needed.
**Shape it points to:** Places for the pre-sale pitch with zero customer involvement, GBP API once
they sign.

### 4.11b Google's 24/7 hours shape silently produced a six-day closure
**Status:** FIXED — 2026-08-15, verified against the live payload
A business open around the clock returns a *single* period — `{open: {day: 0, hour: 0, minute: 0}}`
with no `close` and no other days listed. `mapOpeningHours` read that literally as "open Sunday,
closed Monday through Saturday" and filled the remaining six days with `isClosed: true`.
**Impact had it shipped:** a 24/7 emergency-service business would have published JSON-LD stating it
was closed six days a week — worse than publishing no hours at all, and precisely the kind of fact an
answer engine repeats verbatim.
**Fix:** a lone period opening at midnight with no close maps to all seven days open. Verified by
running the live payload through `detailsToIntake`.
**Caught only because** the details call finally ran against a real listing — 4.11 flagged this shape
as the most likely thing to be wrong, and it was.

### 4.12 Google restricts caching Places data
**Status:** ANSWERED — constraint, design around it
Google's terms permit indefinite storage of `place_id` only. Hours, addresses, and ratings must not
be cached long-term. That's a real constraint for a product whose whole job is storing and
republishing business facts.
**How it's handled:** Places output is an unapproved candidate for the owner to confirm. Once
confirmed it becomes *their* asserted fact rather than Google's cached data. Places is never a
source of record, and the note is printed on every run.
**Also:** review text is deliberately not extracted. Ratings and counts are facts worth noting;
republishing the reviews themselves is someone else's copyrighted content.

### 4.13 Wrong-business matching is the real risk in Places intake
**Status:** ANSWERED — mitigated, worth knowing
Promoting another company's hours and phone number into a customer's profile would be worse than
having neither. "First search result" is not sufficient evidence.
**Rule:** a match is only `confident` when the phone number or website domain corroborates it.
**Revised 2026-08-15 — an uncorroborated match now writes nothing at all.** Flagging it as low
confidence was not enough: the candidate still landed in the intake file, still appeared in the
review queue, and could still be approved by someone skimming. A live search proved the risk is
routine rather than theoretical — a loose query for the test business returned three unrelated junk
removal companies, and the old code would have imported the first one's phone, address and hours.
**Escape hatch:** the run prints the shortlist with place IDs and stops. Pasting a place ID into the
Place ID field skips the search and imports that place — a human reading the list and choosing *is*
the corroboration.
**Corroboration signals:** phone, website domain, or an exact match against the Settings business
name (punctuation-normalised, so `X - Y & Z` equals `X Y and Z`). Exact only — a partial name match
is the one signal most likely to be wrong in precisely the cases that matter.

### 4.13a The Settings business name is the sole source of truth for finding the listing
**Status:** ANSWERED — 2026-08-15, fallbacks removed
Places intake originally searched on the name extracted by the website crawl and never read the
Settings name at all — the field a person fills in first when setting up a business. Fixing that as a
priority order (Settings name, then crawled name, then domain) was still wrong.
**Rule:** the Settings name is searched and nothing else. If it finds nothing, the run stops. If it
is empty, the run refuses before making any API call.
**Why no fallback:**
- A fallback can answer with a *different business*. Searching this client's domain returned a
  competitor, "Chuck That Junk LLC" — which would then have been matched and imported.
- A fallback that succeeds hides the real defect. If a wrong Settings name still "works" because
  something else rescued it, nobody ever learns the field is wrong.
- It contradicts the product. This app exists so one entity resolves to one business across GBP,
  website and markup. An intake quietly searching under three different names tolerates exactly the
  inconsistency it sells a fix for.
**Not a fallback:** appending city/state to the *same* name when the name alone returns nothing.
Same source of truth, narrower search.

### 4.13b The portal ran CLI tools through a Windows shell, unquoted
**Status:** FIXED — 2026-08-15
`runScript` in `src/admin/routes.ts` called `npx.cmd` with `shell: true` on Windows. `execFile` with
`shell: true` pastes the argument array into a single command string with no quoting, so cmd.exe
re-parsed it.
**How it surfaced:** searching Places for `Junk Chucker - Junk Removal & Hauling` actually searched
for `Junk`, and cmd.exe tried to run `Hauling` as a separate command. Every space split an argument
and the `&` terminated the command.
**Why it mattered more than a mangled search:** every value a person types into the portal reaches
this function. `&`, `|`, `>` and `^` were live command injection into our own shell. The portal binds
to 127.0.0.1 and has no authentication yet, so the blast radius was local — but this becomes remote
the moment it is exposed, which is on the roadmap.
**Fix:** run `process.execPath` against `node_modules/tsx/dist/cli.mjs` directly. No shell and no
`.cmd` shim, so arguments pass as an array the whole way down and are never re-parsed. Verified: a
name containing `&` and spaces arrives at `process.argv` intact as one element.
**Worth auditing:** any other `shell: true` or string-concatenated command in this codebase.

### 4.14 The full GBP API is still unbuilt
**Status:** OPEN — deliberate
Places gives public data with no customer involvement. The Google Business Profile API adds Q&A,
posts, attributes, and service lists, but requires the owner to OAuth in.
**Why it's worth doing later:** GBP Q&A is real customer questions with the owner's own answers —
the same value as call transcripts, available to every customer rather than only voice-agent ones.
**Cost:** an OAuth flow, token storage, and a step in onboarding the customer has to complete.

### 4.4 What does the intake pipeline pull from?
**Status:** OPEN — design question, not yet urgent
Candidate sources: CRM (services, price book, areas, skills), existing website crawl, Google Business
Profile, call transcripts (best FAQ source), invoice history, owner input last.
**Blocks:** Customer #2 through #20. This is the step that decides product vs. consulting.
**Note:** The live voice agent is already producing call transcripts today — the single best source of
real FAQs, in customers' own words. That content is accumulating whether or not anyone is mining it
yet. Worth deciding early how it gets captured and retained.

---

## 5. Product scope

### 5.1 Single-tenant now, platform later — when does the switch happen?
**Status:** ANSWERED for now — TitanZ only, add others as needed
**Watch for:** The temptation to call ServiceTitan directly and abstract later. See 3.4.

### 5.2 When do MCP and A2A get built?
**Status:** DEFERRED
MCP is mostly a wrapper over the API — days, not weeks, once the API exists, and it has a real path
to users today. A2A is real protocol with the least evidence behind it; stub the catalog entry and
build when a registry is actually sending queries.

### 5.4 How do migrations actually get applied?
**Status:** OPEN — no Supabase project exists yet
`supabase/migrations/0001_initial_schema.sql` can be pasted into the Supabase SQL editor to start,
but that doesn't version-track what's been applied. The Supabase CLI does, and matters more once
there's a second environment or a second tenant.
**Blocks:** Running the loader for real. Not the build — `--dry-run` works without a database.

### 5.5 `price_stats` is append-only and grows forever
**Status:** OPEN — intentional for now
Every analysis run inserts a row per job type, which is what makes pricing drift visible over time
(4.2). At ~18 rows per run it's harmless for years; at 200 tenants syncing nightly it isn't.
**Decide later:** retention window, or roll up to monthly after N months.

### 5.6 Who decides when a computed price range gets overridden?
**Status:** OPEN
`service_content` has `override_low` / `override_high` / `override_reason` for when the statistics
are wrong or the sample is thin. That's a judgment call with no owner assigned.
**Why it matters:** an override with no reason recorded is indistinguishable from a typo six months
later. The column exists; the process doesn't.

### 5.3 How are per-tenant CRM credentials stored?
**Status:** DEFERRED until multi-tenant
You'd be holding OAuth tokens that can write jobs into other companies' dispatch boards — the largest
liability surface for a solo builder. Supabase Vault or a dedicated secrets store, never plaintext,
tokens scoped to the minimum the adapter needs.

---

## 6. Business model & pricing

### 6.1 Structure
**Status:** ANSWERED — setup fee plus monthly.
Setup covers your labor. Monthly covers freshness. Different costs, they scale differently, keep
them unblurred.

### 6.2 What are the actual numbers?
**Status:** OPEN
Anchors to test, not conclusions: $2,000–3,500 setup, $400–800/month direct. Contractors already
budget $1,500–5,000/month for SEO agencies, so this sits inside an existing line item.
**Principles already decided:** Never discount the monthly — discount the setup. Keep setup high
early on purpose; it filters buyers, funds the build, and honestly prices the manual curation.

### 6.3 Agency wholesale rate and volume tiers?
**Status:** OPEN
Typical wholesale lands around 40–50% of direct price.
**Blocks:** First agency conversation.

### 6.4 Monthly vs. annual contracts?
**Status:** OPEN
**Why it matters:** The initial data lift is where your real cost sits — annual protects you from
eating that cost and churning in month three.

### 6.5 What makes month seven feel justified?
**Status:** OPEN
The attribution layer is the answer: tracking number, source field into the CRM, a simple monthly
"here's what AI sent you." Not a feature — the retention mechanism.
**Blocks:** Renewal conversations. Build early despite being unglamorous.

### 6.6 How are modules priced against each other?
**Status:** OPEN
The platform sells as modules (see 9.2) — voice channel, AI-discoverability channel, bundle. The
setup fee covers the data lift once; each module is a monthly line item on top.
**Why it matters:** The setup fee gets easier to justify when it's buying infrastructure that serves
more than one module. That's also the argument for the bundle being priced well below the sum.
**Blocks:** First customer who wants only one module.

---

## 7. Go-to-market & channel

### 7.1 Direct and agency — both. But in what order?
**Status:** ANSWERED (both) / OPEN (sequencing)
**The risk:** A contractor sale is one onboarding. An agency sale is fifteen arriving the same week.
Until intake is real, an agency win is a denial-of-service attack on yourself.
**Recommendation on file:** Direct first for the first handful, agencies once onboarding is fast and
you have a case study with numbers.

### 7.2 What's the channel conflict policy?
**Status:** OPEN
Options: published direct price with agency wholesale; never sell direct to an agency partner's
existing client; or different SKUs per channel (direct includes hand-holding, agency is
platform-only).
**Blocks:** First agency agreement. Decide before, not during.

### 7.3 Which contractors after TitanZ — revenue or reference value?
**Status:** OPEN
Two customers in different trades teach you more. Five plumbers is a repeatable sales motion. Solo,
repeatable probably wins: one trade, one geography, three or four live, then pitch agencies.

### 7.4 How deep does white-label go?
**Status:** DEFERRED until agency channel opens
Agency-specific needs: multi-client dashboard, their branding on reports, bulk onboarding, they do
the data lift, billing at the agency level, tier-1 support absorbed by them. That last one is the
biggest hidden benefit of the channel for a solo builder — worth giving up margin for.

---

## 7.9 BASELINE — the Tier 1 test, run for the first time

**Date:** 2026-08-16. Query: *junk removal in Port Charlotte*, asked of three
engines on the same day. Record this verbatim; the only honest measure of
whether any of this work moves anything is the same three queries repeated later.

**Important caveat on attribution.** Our markup went live roughly an hour before
this test. No crawler will have re-read the site yet, so this is the state
*before* our work landed — a control, not a result.

| Engine | Junk Chucker | Answer built from |
|---|---|---|
| Gemini | **not shown** | Google's local index — every business shown had a street address |
| ChatGPT | listed 5th of 5, no phone, no source badge, **excluded from the closing recommendation** | web pages |
| Perplexity | **absent** from a table of six | local listings and directories |

**The finding that matters.** Perplexity listed *Daniel's Junk Removal, 5★ from
**one** review*. Junk Chucker has 5.0 from **60** reviews and did not appear.
This is not a quality, reputation or markup problem. Perplexity's own wording —
"listed as open 24 hours", "rated 5.0 from 96 reviews", "listed in local
listings" — shows it is retrieving directory listings. Junk Chucker has one
confirmed directory presence (Facebook) and seven unknown.

**A business with one review beats a business with sixty by being present in the
sources that get retrieved.** Two of three engines never got as far as our
markup, which is exactly the retrieval-before-understanding argument the
directory audit was built on.

**Second pattern, present in all three.** The businesses that earn a
*recommendation* rather than a mention publish numbers: "$125 minimum", "$79 for
one bulky item", "estimates by text from photos". Junk Chucker's ChatGPT entry —
"handles everything from single-item pickups to full cleanouts" — is the vaguest
line on the page, and it is the reason it is named and then left out of the
shortlist.

**Actions this ranks, in order:**
1. Directory listings — Yelp, BBB, Angi, Bing Places, Apple Maps, Thumbtack.
   Account creation, roughly an afternoon, and on this evidence the highest
   return available. The prefilled searches are in the directory audit.
2. Pricing content — a minimum charge and two or three anchors. Tier 2's top
   item, now with direct evidence behind it.
3. Nothing in the app. No build would have changed any of these three answers.

**Re-run:** 2026-09-06 or later, same query, same three engines.

---

## 8. Claims from the video still unverified

### 8.1 Google's "knowledge catalog" product for businesses
**Status:** OPEN — can't confirm a product by that name. May be a loose paraphrase.

### 8.2 Verified-domain Search Console connection / discoverability API
**Status:** OPEN — named in the video as "already rolled out," never specified.

### 8.3 Jobber's native Gemini/ChatGPT booking integration
**Status:** PARTLY ANSWERED — the real Jobber–Google instant booking integration is Local Services
Ads and dates from 2021. Not the same thing. The Vegas conversation may be about something
unannounced; treat as roadmap claim, not shipped product.

### 8.4 Google's AEO white paper
**Status:** OPEN — referenced, never read.

### 8.5 Gemini Spark
**Status:** ANSWERED — Real. Announced at Google I/O, May 2026. Gemini base models with an agentic
harness from Google Antigravity, running on dedicated cloud VMs.

---

## 9. Architecture & repo

### 9.1 Same repo as the voice agent, or separate?
**Status:** ANSWERED — Separate. New folder, new repo.
The voice agent (`st-voice-booking-backend`) is **live and answering real calls for a business that
depends on it.** That single fact decided this.

Reasoning, so it doesn't get relitigated:
- Retrofitting a knowledge layer under a live phone system means touching the path that answers real
  calls, solo, with no staging environment that mirrors real call traffic. Bad trade for an
  architectural nicety.
- The shared-code argument is smaller than it looks. `auth.ts` is ~150 lines. Copying costs an
  afternoon of eventual reconciliation; destabilizing the phone agent costs a customer.
- The knowledge layer's shape isn't known yet. A shared abstraction designed against one real
  consumer and one imagined one fits neither.

**What would have changed it:** If the voice agent were still pre-production, one monorepo with
shared packages and separate deployables would have been the better call.

### 9.2 Does the product still sell as modules?
**Status:** ANSWERED — Yes. Two repos, one product story.
Packaging and code structure are independent decisions. The strongest argument for modules was
economic, not technical: **one onboarding data lift monetizes twice.** Intake is the cost center, so
serving two revenue lines off the same setup engagement roughly doubles unit economics against the
same cost. That survives the repo split completely.

Also unchanged: the voice agent sells today on an obvious ROI story ("stop losing jobs to
voicemail"), while discoverability is a bet on a standard with near-zero adoption. Bundling lets the
proven product carry the speculative one.

**Constraint to hold:** two or three SKUs, not a matrix. Voice, AI Discoverability, bundle. Six
toggleable modules is a combinatorial support surface for one person.

### 9.3 What is the platform actually called / framed as?
**Status:** OPEN
Don't name it after either channel. It's a business knowledge layer with channels on top — voice
channel, AI-search channel, plausibly web chat and lead-form channels later. That framing keeps the
door open.

### 9.4 When does the ServiceTitan client get extracted into a shared package?
**Status:** DEFERRED — copy it for now
Copy the file rather than rewriting it, with a comment noting it's duplicated from the voice agent
repo. Extract once both are stable and the knowledge layer's shape is proven — at that point it's a
version bump against a known-good library rather than a redesign.
**Watch for:** the two copies drifting silently. If a ServiceTitan API change breaks one, check both.

### 9.5 When and how does the voice agent migrate onto the knowledge layer?
**Status:** DEFERRED — but it's the eventual convergence point
Today the voice agent's business facts likely live in prompt text, which means changing TitanZ's
pricing means editing a prompt. That is exactly the freshness problem this platform sells against —
so eating your own dog food here is a genuine improvement, not just tidiness.
**How, when it happens:** incrementally, one data type at a time, behind a flag. FAQs first as the
lowest-risk surface. Never as a big-bang refactor.

---

## 10. Known risks (not questions — things to actively manage)

### 10.1 Shared ServiceTitan rate limits across two apps
**Severity:** High, and live from day one
Separate repos do not give separate ServiceTitan throttling. Both apps hit the same tenant, and if
they share an app registration they share rate limits. A bulk export pulling twelve months of job
history could rate-limit the live voice agent mid-call.

**Mitigations, both decided:**
- Register a **separate ServiceTitan app** for this build so credentials and limits are independent.
- Rate-limit the export scripts deliberately. Run the first full pull slowly and off-hours.

This matters immediately because the bulk export is the literal first thing being built.

### 10.2 Scope creep across two products, solo
**Severity:** Medium, ongoing
Two half-finished products is strictly worse than one finished one. The voice agent is live; this
build is new. Don't develop both at once.

### 10.3 Silent drift between the two ServiceTitan clients
**Severity:** Low now, grows over time
See 9.4.

### 10.4 Can't honor `Retry-After` on 429
**Severity:** Low, but relevant given 10.1
The copied auth client throws on any status >= 400 without exposing response headers, so the
paginator can't read `Retry-After` and falls back to exponential backoff (2s doubling, 5 attempts).
Backoff is more conservative than the server would ask for, which is the safe direction — but it
means we're guessing at how long to wait.
**Fix, when it's worth it:** surface headers on `ServiceTitanApiError`. That's a change to the copied
client, so it should happen at the same time as the shared-package extraction in 9.4, not before.

### 10.6 Rate limiting is in-memory and single-instance
**Severity:** Low now, blocking at deploy time
`src/api/ratelimit.ts` keeps counters in a Map. It resets on restart and doesn't coordinate across
replicas, so two instances behind a load balancer means double the intended limit.
**Fix when deploying:** a shared store (Redis / Upstash), or the platform's own rate limiting
(Cloudflare, Vercel). Not worth building before there's a host.

### 10.7 No API authentication, by design
**Severity:** Accepted, worth restating
Everything the API serves is published content intended for crawlers and agents. There are no
writes, no credentials, and no private data — so rate limiting is the only control, and CORS is
deliberately wide open.
**What would change this:** availability data (Layer 4). Live scheduling surfaces are a different
risk profile than a price list, and that's the point to revisit auth.

### 10.5 Raw exports contain real customer and revenue data
**Severity:** Medium, permanent
`data/raw/` is gitignored, and each run writes to its own timestamped directory. That covers
accidental commits. It does not cover the files sitting unencrypted on a laptop indefinitely.
**Decide later:** retention policy, and whether anything sensitive gets stripped at export time
rather than after.

---

## Assets already in hand (worth remembering when this feels early)

- **A live AI phone agent booking real jobs.** Walking into an agency conversation with that running
  is a fundamentally different pitch than a spec document.
- **Call transcripts accumulating right now** — the best available source of real customer FAQs.
- **A production-proven ServiceTitan integration**, which de-risks the whole API layer.
- **Working OAuth client-credentials auth** with token caching, in-flight request dedup, 401 retry,
  and integration/production switching. Copy it, don't rebuild it.

---

## Things already settled (don't relitigate)

- ARD is real. Announced June 17, 2026. Co-authored by Google, Microsoft, and Hugging Face, with
  Amazon, Cisco, GitHub, Salesforce, Snowflake, and Nvidia in the coalition.
- Manifest path is `https://yourdomain.com/.well-known/ai-catalog.json`.
- Manifest envelope is four root elements: `specVersion`, `host`, `entries`, `collections`.
- Entries are typed by media type, not a short type string. ChatGPT's `capabilities` array with short
  type strings was plausible-looking but wrong.
- Identifiers use a domain-scoped URN convention (`urn:ai:titanzplumbing.com:...`). Tenant domain is a
  first-class input to the generator, not a config afterthought.
- No signing required for v1 (see 1.2).
- Build order is bottom-up: data, then API, then catalog file, then booking, with tracking woven
  through. The catalog is a signpost — the things it points at have to exist first.
- The pricing content is the highest-return work and pays off through ordinary search regardless of
  whether the agent thesis lands.
- The 58% zero-click stat doesn't mean what the video says it means. Real trend, oversold as evidence.
- **New repo, new folder.** Completely separate from the voice agent app. (See 9.1.)
- **Copy the ServiceTitan client** rather than rewriting or sharing it for now. (See 9.4.)
- **Separate ServiceTitan app registration**, so rate limits don't collide with the live voice
  agent. (See 10.1.)
- **Sold as modules on one platform** despite the two codebases. (See 9.2.)
- **First step is read-only export scripts** — see what ServiceTitan actually holds before designing
  a schema. Targets: pricebook services and materials, business units and job types, zones/service
  areas, and completed jobs with revenue for the last 12 months. Raw JSON to disk, then design the
  schema against reality.
- **The export answers two open questions empirically.** 4.1 (highest-revenue service) becomes a
  computed number rather than someone's estimate. 4.3 (pricing ranges) becomes a real distribution
  per job type.
- **The schema splits DERIVED from AUTHORED tables**, and the loader is only permitted to write the
  derived ones. Services, job types, service areas, brands, and price stats re-sync from
  ServiceTitan. Pricing factors, FAQs, policies, and credentials are human-owned and the loader
  raises if it ever tries to touch them. Human annotations on a derived thing live in a companion
  authored table joined by FK, never as extra columns on a derived row — so "re-sync services" can
  never mean "delete the pricing guide someone spent a week writing."
- **Derived rows are soft-deleted** (`is_active = false`), never removed, so authored content
  joined to them can't orphan when ServiceTitan stops returning a record.
- **`tenant_id` is in the schema from day one** despite TitanZ being the only tenant. Adding it later
  means rewriting every foreign key, index, and RLS policy. Adding it now cost one column.
- **RLS is enabled on every table now**, so tenant #2 is a policy change rather than a security
  incident. The loader uses the service role key and bypasses it; the public API layer must use the
  anon key so the policies actually apply.
- **`price_stats` is append-only**, one row per job type per run, so pricing drift over time is
  visible rather than silently overwritten.
- **The catalog generator verifies before it advertises.** Every capability is probed before it
  appears in the manifest. Unreachable endpoints are excluded, and so are endpoints that return 200
  with an empty array — that's the dangerous case, because nothing errors while the description
  promises data that isn't there. The entry description is assembled from what actually has content,
  so it can't drift from reality.
- **Surfaces that don't exist are excluded explicitly and reported**, so MCP and A2A being absent is
  a recorded decision rather than an oversight rediscovered in three months.
- **An empty catalog is a valid output**, not a failure. Publishing entries that point at nothing is
  worse than publishing no catalog.
- **The API serves only reviewed content.** `service_content` drives the pricing endpoint, not
  `price_stats` — a service with statistics but no human-approved write-up simply does not appear.
  Publishing an unreviewed statistical range would put thin samples in front of an AI as if they
  were quotes. `--include-unreviewed` exists for local inspection only.
- **The public API uses the Supabase ANON key**, never the service role key, so RLS actually
  applies. The source constructor raises if the two keys match.
- **`/openapi.json` is generated from the route registry**, never hand-written. The consumers are
  machines with no human present to notice a spec that drifted from the code.
- **What the export won't give you:** the factors that move a price up or down, FAQs, warranty and
  permit policies, credentials, brands serviced. ServiceTitan has the *what*, not the *why*. Those
  still need a human — but they're far easier to write while annotating a real service list than
  from a blank page.
