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
**Status:** OPEN
The draft catalog file uses `application/openapi+json`. The spec example only showed the MCP server
label (`application/mcp-server+json`); the OpenAPI one was inferred.
**Why it matters:** A wrong media type may make the manifest invalid.
**Blocks:** Publishing TitanZ's real catalog. One-line fix once verified.

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

## 3. ServiceTitan & the CRM layer

### 3.1 Is ServiceTitan API access approved?
**Status:** ANSWERED — Yes.

### 3.2 Does TitanZ already have ServiceTitan's AI Virtual Agent enabled?
**Status:** OPEN
It's shipped: greets customers, gathers info, books jobs using real-time ServiceTitan data and
Adaptive Capacity (job type, location, required skill set).
**Why it matters:** Building a parallel booking path that ignores capacity rules would be a step
backward.
**Blocks:** Any custom booking work.

### 3.3 Does an agent book, or does an agent hand off?
**Status:** DEFERRED — start read-only
Availability-read plus a booking link gets most of the value at a fraction of the liability.
**Revisit when:** You've seen what agent traffic actually looks like. Especially important
multi-tenant — a mis-booked-job incident across someone else's customer base is not absorbable solo.

### 3.4 Does the new ServiceTitan app registration have the right scopes?
**Status:** DEFERRED — deliberately, by decision. Building first.
The export needs at minimum Pricebook (services, categories, equipment), Settings (business units,
technicians), JPM (jobs, job types), Dispatch (zones), and Accounting (invoices).
**Why deferring is safe:** Building the exporter doesn't require scopes to be right. The first real
run tells you exactly which are missing — a 403 per target, recorded in the run manifest.
**Blocks:** Only the first successful production run, not the build.

### 3.5 Which ServiceTitan environment do we export from?
**Status:** OPEN
A `--env` flag now switches per-run without editing `.env`, so this no longer blocks the build.
**The tension:** Integration usually holds synthetic data, which cannot answer 4.1 or 4.3 — those
need real revenue. Production can, but shares rate limits with the live phone agent (10.1).
**Recommendation on file:** integration first to shake out endpoint paths and params, then one
throttled production run off-hours for the real numbers.

### 3.6 Are the export endpoint paths and filter params correct?
**Status:** OPEN — the first run answers this
Targets marked `uncertain` in `src/export/targets.ts`. The guessed parts:
- `jobs` date filter may be `completedOnOrAfter` or `completedOnAfter`; `jobStatus` casing unverified
- `invoices` date filter param unverified
- Zone shape unknown — ZIP-based, polygon-based, or barely configured at all
**How it resolves:** The runner records each failure with HTTP status and response body in the run
manifest instead of aborting. One bad path costs one target, not the export.

### 3.7 Where does job revenue actually live?
**Status:** OPEN
Revenue sits on **invoices**, not jobs — so revenue-per-service means joining invoices to jobs on
`jobId`, then jobs to job types. Both the join key and whether invoices reliably carry `jobId` need
confirming against real data.
**Blocks:** 4.1 and 4.3 — the two questions the entire export exists to answer.

### 3.8 Do we ever export customer locations?
**Status:** OPEN — deliberately excluded for now
`crm/locations` would give real service-area geography, but it's customer PII at volume. Dispatch
zones are the lower-risk source for the same answer.
**Revisit if:** zones turn out to be unconfigured, leaving locations as the only real geography
source. Decide handling and retention before pulling it.

### 3.9 What's the second CRM, and when?
**Status:** DEFERRED
Jobber and Housecall Pro are the likely candidates. Both expose less than ServiceTitan.
**Why it matters now anyway:** The abstract adapter interface should be designed from day one even
with one implementation. That refactor is always worse than estimated, and here it's the product.

---

## 4. Data, content & intake

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
- **What the export won't give you:** the factors that move a price up or down, FAQs, warranty and
  permit policies, credentials, brands serviced. ServiceTitan has the *what*, not the *why*. Those
  still need a human — but they're far easier to write while annotating a real service list than
  from a blank page.
