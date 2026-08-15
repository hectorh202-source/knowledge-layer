# AI Discoverability — What's Required vs. What's Extra

Three tiers. Finish one before starting the next. Each tier has a "done" line so
you know when to stop and move on.

---

## TIER 1 — REQUIRED

**Without these, AI cannot find you. With them, it can.**

This is the actual answer to "get discovered by AI." Nothing else on this page is
required for that. Most of it is settings and audit work, not building.

> **Audited against calltitanz.com on 2026-08-15.** Findings inline. One real
> failure found, and it is not in robots.txt.

### The website has to be readable

- [x] Check robots.txt is not blocking AI crawlers — **clean.** Only `Disallow: /wp-admin/`, and the sitemap is declared.
- [x] Site loads without login walls on the pages that matter — 14 pages crawled freely.
- [ ] **FAILING — Site isn't blocking crawlers at the firewall or CDN level.**
      **GPTBot gets a consistent `429 Too Many Requests`** across spaced retries,
      while a browser user agent gets `200` with identical timing. Response
      headers identify **Hostinger's CDN edge (`Server: hcdn`)** — `Content-Length: 0`,
      so the request never reaches WordPress. This is a Hostinger support ticket,
      not a code change or a robots.txt edit.
      **Tested and passing:** OAI-SearchBot `200`, PerplexityBot `200`,
      ClaudeBot `200`, Googlebot `200`.
      **Impact, stated precisely:** OAI-SearchBot is the crawler behind ChatGPT
      Search results, and it passes — so the site is not invisible to ChatGPT.
      GPTBot is OpenAI's other crawler and it is being turned away at the host.

### The website has to say what you do

- [x] A page stating services offered — **55 service pages** (34 plumbing, 17 HVAC, 4 air conditioning).
- [x] A page stating service areas — **`/coverage` plus 7 city pages**: Port Charlotte, Punta Gorda, North Fort Myers, Cape Coral, Englewood, Venice, Sarasota.
- [x] Contact info visible as text — `tel:` and `mailto:` links present, not images.
- [x] Basic about/credentials — `/about-us` exists; licenses `CFC1434184` (plumbing) and `CAC1824330` (HVAC) appear in page text, along with "since 2007".

### Google has to have you indexed

- [ ] Domain verified in Google Search Console — **cannot check, needs the account login.**
- [x] XML sitemap submitted — `sitemap_index.xml` exists, is declared in robots.txt, and covers ~191 URLs across 9 child sitemaps.
- [ ] Confirm key pages are actually indexed — **cannot check reliably without Search Console.**

### The business listing has to be right

- [ ] Google Business Profile claimed and complete — a GBP link exists on the site (`cid=15554419587955723858`), but completeness is unverified. Needs the Places API key or two minutes in the dashboard.
- [ ] Correct categories — unverified.
- [ ] Service areas set — unverified.
- [ ] Hours, phone, address accurate — **hours are not published anywhere we can see.** This is also the one blocking gap left in the business profile.
- [ ] Business name, address, phone IDENTICAL everywhere — needs a directory audit. Note the domain split: `titanzplumbing.com` is a landing shell in front of `calltitanz.com`, which is a NAP consistency risk worth checking.

### Something outside your site has to confirm you exist

- [ ] Google reviews present — a `/reviews` section exists on the site (13 pages), but the actual Google review count is unverified.
- [ ] Listed on real directories — **not checked.** Yelp, BBB, Angi, Apple Maps, Bing Places, chamber of commerce.

### The test itself

- [ ] **Not run.** Ask ChatGPT, Gemini and Perplexity for a plumber in Port Charlotte and see whether TitanZ appears. Five minutes, and it is the whole measure.

**TIER 1 IS DONE WHEN:** you can ask ChatGPT, Gemini, and Perplexity for a
plumber in your city and your business appears. Test it. That's the whole
measure. If you show up, discovery is solved — stop and move to Tier 2.

---

## TIER 2 — NOT REQUIRED, BUT THIS IS WHERE THE MONEY IS

**Tier 1 gets you found. Tier 2 gets you chosen.**

Being found and not picked is the same result as not being found. Everything here
works today through normal search. No developer needed. No new technology.

### Pricing content — highest return on this entire page

- [ ] One pricing page per major service, starting with highest revenue
- [ ] Real ranges, never "call for pricing"
- [ ] What makes the price go up or down
- [ ] What's included and excluded

*Why it matters: when someone asks AI what a job costs, it answers using whoever
published numbers. If that isn't you, you're not in the conversation. Very few
competitors do this.*

### Real customer questions

- [ ] Pull actual questions from recorded calls
- [ ] Answer them publicly on the site, plainly
- [ ] Keep going — every call is future content
- [ ] Skip generic filler content. It hurts more than it helps.

### Depth on the pages

- [ ] A dedicated page per service, not one combined services page
- [ ] Location pages for the markets that matter
- [ ] Structured data markup (LocalBusiness, Service, FAQ) — helps machines read the page correctly

### Reviews as an ongoing system

- [ ] Steady flow, not bursts
- [ ] More than one platform
- [ ] Responses to reviews

### Booking that actually works

- [ ] Test every scheduling button on the site
- [ ] Confirm online booking is live and functional

*A broken button costs you jobs today, AI or no AI. Worth checking regardless.*

**TIER 2 IS DONE WHEN:** your top services each have a pricing page live and
indexed, and AI quotes your numbers when asked about cost in your market.

---

## TIER 3 — OPTIONAL AND SPECULATIVE

**Real technology. No meaningful traffic yet.**

None of this is needed to be discovered. It's a bet on AI shifting from crawling
websites to querying businesses directly. That shift may happen. It hasn't yet.

- [ ] Database holding all business information in structured form
- [ ] API serving that information at api.yourdomain.com
- [ ] OpenAPI description file
- [ ] ai-catalog.json at /.well-known/
- [ ] CRM connection exposing real appointment availability
- [ ] AI-specific call tracking number and source attribution
- [ ] MCP server
- [ ] Agent-to-agent server

**Honest status:** the catalog standard is real, announced June 2026, backed by
Google, Microsoft, Hugging Face and others. But it's a draft, and weeks after
launch essentially no major sites had published one. Publishing a catalog does
not mean any AI platform will read it.

**Cost/benefit:** the catalog file itself is an afternoon. The database and API
behind it are the real work — and they hold the same information you already
wrote in Tier 2. So Tier 2 is not wasted effort if you later build Tier 3. It's
the input.

**TIER 3 IS DONE WHEN:** there's no clear finish line, which is exactly why it
goes last.

---

## SCOPE CREEP GUARDS

Rules to hold yourself to:

1. Do not start Tier 2 until Tier 1 passes the test. The test is asking three AI tools for a business like yours and seeing if you appear.
2. Do not start Tier 3 until Tier 2 pricing pages are live. Tier 3 serves the same information Tier 2 contains. Building the pipe before the water exists is the most common way this goes wrong.
3. The catalog file goes up last, not first. It points at an API. If the API doesn't exist, the file points at nothing and that's worse than having no file.
4. Anything involving agents, MCP, or AI booking directly into the CRM is not on the list until something is actually asking. Build when there's demand, not in anticipation of it.
5. If a new idea appears mid-build, write it down and finish the tier.

---

## THE SHORT VERSION

**Required to be discovered:** crawlable site, pages saying what you do and
where, indexed in Google, accurate business listing, reviews, a few directory
listings.

**Everything else** — pricing, booking, database, API, catalog, agents — is about
being chosen or about a future that hasn't arrived.

**Pricing content is the single highest-return item and it isn't technical.**

---

## WHERE THIS BUILD CURRENTLY SITS

Adopted 2026-08-15 as the guide for how this build progresses.

**Already built, and all of it is Tier 3:** the content database schema, the API,
the OpenAPI file, the ai-catalog.json generator, and the JSON-LD generator.

**Tier 1 and Tier 2 have not been started.** Nothing in Tier 1 has been checked
against calltitanz.com — not robots.txt, not Search Console, not the Google
Business Profile, not directory listings.

Per guard #2, that ordering is backwards. The tiers above take precedence over
anything queued in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) from here on.

The one Tier 3 piece that carries over regardless is the JSON-LD generator, which
is Tier 2's "structured data markup" line — but it can only emit what the content
files hold, and nothing in them is approved yet.
