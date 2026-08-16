# Audits

Four checks. Three live under **Discoverability**, one under **Publishing**.

---

## Tier 1 automated checks

```bash
# in the portal: Discoverability → Run checks
```

Nine checks covering whether a site is reachable and readable at all:

- site responds, no login wall
- `robots.txt` allows AI crawlers
- **crawler reachability using real user-agent strings** — GPTBot, OAI-SearchBot,
  PerplexityBot, ClaudeBot, Googlebot, Google-Extended
- XML sitemap present
- phone visible as text rather than an image
- services page, service areas page, licensing

Plus ten manual items needing account access, tracked as checkboxes.

The crawler check is worth understanding: a site can pass `robots.txt` and still
turn crawlers away at the host. One audited site returned a consistent `429` to
GPTBot while a browser agent got `200` with identical timing, with response
headers identifying the host's CDN edge. That is a hosting ticket, not a
`robots.txt` edit. See [gotchas.md](gotchas.md#robotstxt-is-not-the-only-thing-that-blocks-crawlers).

---

## NAP consistency

```bash
npm run audit:nap -- --tenant <slug>
```

Compares name, address and phone across **four sources**: the business profile,
the website crawl, Google Places, and the JSON-LD already live on the site.

Inconsistent NAP is the ordinary reason an entity fails to resolve. An engine
seeing two phone numbers cannot know they are one business, so neither record
accumulates the corroboration that earns a citation — and the fix is usually a
five-minute edit nobody knew was needed.

**Findings group by value, not by source.** Which sources agree *is* the
diagnosis:

```
HIGH  name
      Junk Chucker Junk Removal and Hauling
        — profile, Google
      Junk Chucker Junk Removal
        — website crawl, live site markup
```

Two camps, two apiece. That tells you where to go. Four flat rows of
near-identical text would not.

**Matching is normalised, not literal.** `(941) 500-3351` and `941-500-3351` are
one number; `Main Street` and `Main St` one address; `&`, `and` and `&amp;` one
word; ZIP+4 and ZIP one place. An audit that reports formatting as a conflict
trains people to ignore it.

**Absence is not conflict.** A source silent on a field disagrees with nobody.

### Independent sources versus echoes

Once our markup is published to a client's site, the site starts reading our own
claim back to us. The crawl and the live-markup check then agree with the profile
because they **are** the profile — and the audit would report a clean bill of
health forever after publication, precisely when it most needs to keep watching
Google.

So each value is marked independent or not:

| Source | Independent? |
|---|---|
| Business profile | Never — it is the claim being checked, not evidence for it |
| Google Places | Always |
| Live site markup | Only when the node does **not** carry our `@id` |
| Website crawl | Unless the value came from JSON-LD while our markup is live |

A field can therefore *agree everywhere* and still be **uncorroborated**, which
the report calls `weak` and explains:

```
ok    name
      all 4 source(s) agree: Junk Chucker Junk Removal and Hauling
      1 independent — confirmed
```

Four sources, one of them actually evidence. That is an honest reading of a
published client, and it keeps Google as the source that matters.

Name, phone and city are `high` severity — they are what engines match records
on. Street, region and postal code are `medium`.

---

## Directory presence

```bash
npm run audit:directories -- --tenant <slug>
```

**Two states only: `found` and `unknown`. There is deliberately no "not listed".**

Directory search cannot be done from a server. Measured:

| Platform | Response |
|---|---|
| Yelp search | `403` |
| Yelp profile URL known to exist | `403` |
| Facebook | `400` |
| BBB | `200`, results rendered in JavaScript — the HTML holds only the query echoed back |
| Bing Maps | `200`, business name absent entirely |

A checker built on those would report *not listed on Yelp* for a business
plainly listed on Yelp. That false negative gets acted on — someone creates a
duplicate listing, which is actively harmful — and an audit that has lied twice
stops being read.

**What is automatic:** the crawl extracts profile links from the site's own
markup. A business's footer is better evidence of where it is listed than any
lookup, and a stronger claim, because the business published it. Share widgets
and bare homepage links are excluded — a "share on Facebook" button says nothing
about having a page.

**What is manual:** fifteen directories with prefilled search links, roughly ten
seconds each. Yelp, BBB, Angi, Facebook, Apple Maps, Bing Places, Nextdoor,
Thumbtack, Yellow Pages, HomeAdvisor, Porch, Trustpilot, Chamber of Commerce,
MapQuest, Foursquare.

The list is rendered on the Discoverability page as soon as it loads — the audit
is pure file reads, so there is nothing to defer behind a button, and which
directories get checked should not be something you click to discover.

Add one by adding an entry to `src/audit/directories.ts`: hostnames, a line on
why it matters, and a search-URL builder. It appears in the card automatically.

**Deliberately excluded** — Hotfrog, Brownbook, Cylex, EZlocal, Nicelocal,
Manta, Superpages, Citysearch. That long tail is what citation packages pad
their numbers with. Citation *count* was a local-pack ranking signal in the SEO
era; it is not what an answer engine retrieves, and a card showing twenty
directories with eighteen unknowns is noise.

**Where a platform's own search cannot be verified, the link is a Google
`site:` query instead.** HomeAdvisor is the current case. A guessed search URL
that 404s looks exactly like an absent listing, which is the one thing this
audit must never imply.

### Why directories matter

Through **retrieval**, not markup. Asked for the best plumber in a city, an
assistant retrieves aggregator pages and builds its answer from them. Those pages
*are* the candidate set. A business absent from them was never in the running,
however good the markup on its own site.

- **Directory presence decides whether you are a candidate.**
- **Markup decides whether you are understood once you are one.**

Retrieval comes first. Perfect markup on a page nobody retrieved changes nothing.

---

## Live markup verification

```bash
npm run verify:markup -- --tenant <slug>
```

Fetches the live page and compares what is published against what the portal
holds.

| Status | Meaning |
|---|---|
| `LIVE AND CURRENT` | Ours is there and matches |
| `OUT OF DATE` | Ours is there, with a field-by-field diff |
| `NOT OURS` | Business markup present, none carrying our `@id` |
| `NOT INSTALLED` | No business markup at all |

**It reads raw HTML with no JavaScript executed.** That is the point rather than
a shortcut: if markup does not appear here, it does not exist for GPTBot either.

It also detects **competing business nodes**. Most SEO plugins emit their own,
and two descriptions of one business on one page leave a crawler no way to pick
the authoritative one. On first run against the test client it found exactly
that — an `Organization` node under a different name than Google holds.
