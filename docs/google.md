# Google Places

## The constraint that shapes everything

**A service-area business that hides its street address cannot be found by name
through any Google API.**

Not "is hard to find". Cannot be found. This was established by testing seven
distinct surfaces against one live, verified, 5.0-rated listing with 60 reviews:

| Surface | Result |
|---|---|
| Places API (New) Text Search — exact name | 0 results |
| Places API (New) Text Search — distinctive word, globally | 0 results |
| Places API (New) Text Search — name + city | 0 results |
| Places API (New) Autocomplete — unbiased | a similarly named business in Ontario, Canada |
| Places API (New) Autocomplete — `locationRestriction` over the client's own city | `{}` |
| Legacy Find Place — by name | `ZERO_RESULTS` |
| Legacy Find Place — **by phone number** | `ZERO_RESULTS` |
| Legacy Text Search / Autocomplete | wrong business |
| Scraping the rendered Google Maps page | contains no `ChIJ` string at all |

The same searches returned twenty competitors in the same city. Fetching
`places/{place_id}` for that business works perfectly and returns full details.

**Why:** service-area businesses are largely home-based. A queryable API that
returned them would publish home addresses in bulk, so Google withholds them
from search surfaces while showing them on Maps, where a human sees one at a
time. This is policy, not a bug, and not something to engineer around.

**Why it matters commercially:** SAB-with-hidden-address is the *norm* for
plumbers, haulers, HVAC, electricians and locksmiths. That is the entire target
market. Search-by-name is the exception path; place ID is the main road.

## How the app gets a place ID

Three routes, in the order the code tries them.

**1. Settings → Content sources → Google place ID.** Set once per client. Accepts
a bare `ChIJ…` or any Google URL containing one.

**2. The website crawl.** `extractPlaceIds` scans raw HTML for `ChIJ[A-Za-z0-9_-]{16,}`.
Embedded maps, "get directions" links and review widgets must carry the ID to
function, so most sites publish it. On the test client it was in a review
widget's "write a review" link:

```html
<a href="https://search.google.com/local/writereview?placeid=ChIJtftYjlar3IgRXiOqfiRAeAc">
```

A place ID is an opaque Google-issued identifier — it cannot be coincidentally
similar — so finding one on a site is near-proof of which listing that site owns.
It gets `high` confidence where nothing else in the heuristic extractor does.

If a site carries **several different** IDs, none is used. That means multiple
locations or a third-party widget carrying someone else's, and guessing would
import the wrong company.

**3. Ask the client.** Their **Google review link** contains the place ID, and
every profile owner has one from the GBP dashboard.

## `cid` is not a place ID

`maps.google.com/?cid=538250680958853982` holds a **different identifier**. It
cannot be passed to `places/{id}` and cannot be converted server-side — resolving
one returns a JavaScript shell with no ID in it. The app records `cid` links as
a `gbpUrl` for a human to click and rejects them as place IDs with an explicit
message.

Google Maps URLs are equally useless as a source: they carry a hex CID pair
(`!1s0x…:0x…`) and a `/g/…` Knowledge Graph ID, neither convertible.

## What the app deliberately does not do

**No search.** `searchPlaces`, `matchPlace`, the name-search ladder, the
corroboration matcher and a legacy phone lookup were all built and all removed.
Each worked only for businesses Google already indexes — the ones least in need
of help — while adding three code paths, three failure messages and three ways
to import the wrong company.

**No autocomplete dropdown.** Tested before building: it returns competitors and
a business in Canada, never the client.

Phone lookup via legacy `findplacefromtext` **does work** for indexed
businesses — it resolved two competitors straight to their place IDs from a phone
number alone — and still returns nothing for a hidden-address SAB. It was removed
for that reason.

## Wrong-business risk

Structurally gone rather than mitigated. A place ID identifies exactly one
listing, so there is no matching step left to be wrong about. That is why the
corroboration machinery was deleted along with the search code.

## Licensing

Google permits indefinite storage of `place_id` **only**. Hours, addresses and
ratings must not be cached long-term. So Places output lands as an unapproved
candidate for the owner to confirm — after which it is *their* asserted fact
rather than Google's cached data.

Review text is deliberately never extracted. Ratings and counts are facts worth
noting; republishing the reviews is someone else's copyright.

## The GBP dashboard is not the API

What an owner sees in their dashboard is what is *in* the profile. What the API
returns is what is *published to the world*. Those differ, and no amount of
looking at the dashboard reveals the gap.

Building a "GBP health report" was considered and dropped: Google already tells
owners about missing descriptions, hours and photos, more accurately and for
free, and it knows things the public API never exposes.
