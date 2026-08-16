# Onboarding a client

Everything below happens in the portal at <http://localhost:3100>. CLI
equivalents are in [reference.md](reference.md) if you prefer them.

## The short version

1. Add the client — name and domain
2. Crawl the website
3. Save the place ID the crawl found
4. Pull from Google
5. Promote
6. Review and approve
7. Generate FAQs from what you approved
8. Publish
9. Copy the snippet onto the site
10. Verify it is live

Steps 2 to 4 are in that order for a reason: the crawl finds the place ID, and
Google Places cannot reach a service-area business without one.

---

## 1. Add the client

**All clients → Add client.** Name and domain. The name should be **exactly what
Google shows** — it is what publishes, and it is what the NAP audit compares
against.

One client per domain is enforced. Two clients on one domain would generate
conflicting markup for the same site with no way for a crawler to tell which is
authoritative.

## 2. Crawl the website

**Sources → 1 Crawl website.**

Respects `robots.txt`, one request per second, roughly 25 pages. It extracts
contact details, services, service areas, FAQs, credentials, the Google place
ID, and links to profiles on other platforms.

If services or service areas come back empty, the site probably words its
navigation unusually — "What We Do" rather than "Services". Paste the exact URLs
into **Settings → Content sources** and crawl again. That is more accurate than
any amount of pattern matching.

## 3. Save the place ID

The crawl reports it if the site embeds a map, a directions link or a review
widget. Put it in **Settings → Content sources → Google place ID**.

You can paste a full Google URL rather than the bare ID; it will be extracted.
A `cid=` link will not work — different identifier, not convertible.

If the site has nothing from Google on it, ask the client for their **Google
review link**, which every profile owner has and which contains the place ID.

**Do not skip this expecting name search to work.** It will not. See
[google.md](google.md).

## 4. Pull from Google

**Sources → 2 Google Places.** Both boxes blank.

Brings back the verified name, phone, hours, and rating. For a service-area
business there will be no address, and that is correct rather than a failure.

## 5. Promote

**Sources → 3 Promote candidates.**

Merges every intake file into the content files. Read the output: the
`CONFLICTS` block is where a source disagrees with something already set, and
your value was kept.

Nothing appears in the Services or Q&A sections until you promote. A crawl that
found 33 services leaves every section reading zero until this step runs.

## 6. Review and approve

Go through each section. Approving means *this is true*; publishing means *this
should go out*. They are separate on purpose.

Check the business profile too — **Business profile** — and set:

- **Business type.** Service-area suppresses the street address in published
  markup and stops address being a blocking error. Most home-services clients
  are service-area.
- **Primary Google category**, copied verbatim from the listing.
- **Other profiles** — Facebook, Yelp, BBB. These become `sameAs`, which is how
  an engine confirms the listings describe one business.
- **Hours.** Google's are often stale. Verify them.

## 7. Generate FAQs

**Q&A → Generate from approved facts.** Preview first.

Builds questions from approved service areas, hours, credentials and brands.
One question per area, because "do you serve Venice" is a real search. One
roll-up for services, because thirty-four "do you offer X" entries is filler.

Everything lands unapproved. Read them before approving — an answer published in
a business's name is a promise made on their behalf.

## 8. Publish

Approve, then publish. **Both are required** — the serving gate checks both, so
45 approved items with nothing published produce a business node and no content.

## 9. Get the markup onto the site

**Publishing → Generate.** Check it says *Valid schema.org*, then **Copy
snippet** and paste into the site's `<head>`.

| Platform | Where |
|---|---|
| WordPress | Theme header, or an SEO plugin's header-code box |
| Squarespace | Settings → Advanced → Code Injection |
| Wix | Settings → Custom Code |
| Webflow | Project Settings → Custom Code |

**Turn off any existing business schema first.** Most SEO plugins emit their own
`LocalBusiness` or `Organization` node. Two competing descriptions of one
business on one page is worse than one, because a crawler cannot tell which is
authoritative. Replace, do not append.

## 10. Verify

**Publishing → Check the live site.** Four possible answers:

| Status | Meaning |
|---|---|
| `LIVE AND CURRENT` | Done. |
| `OUT OF DATE` | Installed but stale. Field-by-field diff shown. Re-copy. |
| `NOT OURS` | Business markup present, none carrying our `@id`. Usually the plugin. |
| `NOT INSTALLED` | No business markup at all. |

Re-run this whenever the profile changes. A pasted snippet is correct the day it
is pasted and drifts silently from then on.

## Send the client their report

**Publishing → Client report → Open report.** A printable page written for the
business owner rather than for you: what AI can currently find, whether their
details agree across the web, what has been published, and what happens next —
split by who does each thing.

Run **Discoverability → Run checks** first. The report uses the stored audit and
states its date, so an old result will honestly report a problem you have
already fixed.

It carries **no score or grade**. Every figure traces to something measured, and
anything that could not be checked is marked unconfirmed rather than guessed.
A fabricated visibility percentage is the easiest thing to put on a page like
this and the fastest way to make the real numbers beside it untrustworthy.

It lives behind the login. It names gaps in a client's setup, which is not
material for the open web.

## Then run the audits

**Discoverability** holds three, all worth running once the above is done:

- **Run checks** — the Tier 1 automated set
- **Compare sources** — NAP consistency across the profile, site, Google and live markup
- **Directory listings** — where the business is listed, and where to check by hand

See [audits.md](audits.md).
