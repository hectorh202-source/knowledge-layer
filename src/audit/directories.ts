/**
 * The directories worth being listed on, and how to check each one.
 *
 * The mechanism this serves is retrieval, not markup. When someone asks an
 * assistant for the best plumber in a city, the pages that come back are
 * overwhelmingly aggregators — Yelp, Angi, BBB, the local "best of" lists. Those
 * pages are the candidate set the answer is built from, so a business absent
 * from them was never in the running, however good the markup on its own site.
 *
 * WHY NONE OF THIS IS AUTOMATED, which is the important part:
 *
 * Directory search cannot be done reliably from a server. Measured, not assumed:
 * Yelp returns 403 to a browser-agent request for both its search page and a
 * profile URL we know exists; Facebook returns 400; BBB and Bing return 200 with
 * results rendered in JavaScript, so the HTML contains the query echoed back and
 * no results at all.
 *
 * A checker built on those responses would report "not listed on Yelp" for a
 * business plainly listed on Yelp. A false finding is worse than no finding —
 * it trains someone to distrust the whole audit — so absence of evidence is
 * never reported as absence.
 *
 * What is left is honest and still useful: detect the profiles a business links
 * from its own site, and hand a person a prefilled search for the rest.
 */

export interface Directory {
  id: string;
  name: string;
  /** Hostnames that identify a profile link on this platform. */
  hosts: string[];
  /** Why this one is worth the trouble. */
  why: string;
  /** Builds the search URL a person opens to check by hand. */
  search: (business: string, where: string) => string;
}

const q = (value: string): string => encodeURIComponent(value.trim());

export const DIRECTORIES: Directory[] = [
  {
    id: "yelp",
    name: "Yelp",
    hosts: ["yelp.com"],
    why: "Ranks for 'best X in Y' queries, which is what assistants retrieve for recommendations.",
    search: (business, where) =>
      `https://www.yelp.com/search?find_desc=${q(business)}&find_loc=${q(where)}`,
  },
  {
    id: "bbb",
    name: "Better Business Bureau",
    hosts: ["bbb.org"],
    why: "The trust signal cited most often when an answer qualifies a recommendation.",
    search: (business, where) =>
      `https://www.bbb.org/search?find_text=${q(business)}&find_loc=${q(where)}`,
  },
  {
    id: "angi",
    name: "Angi",
    hosts: ["angi.com", "angieslist.com"],
    why: "Home-services specific, and its category pages rank for exactly these queries.",
    search: (business, where) => `https://www.angi.com/search?query=${q(`${business} ${where}`)}`,
  },
  {
    id: "facebook",
    name: "Facebook",
    hosts: ["facebook.com", "fb.com"],
    why: "Often the only other place a small operator posts, and it corroborates NAP.",
    search: (business, where) => `https://www.facebook.com/search/top?q=${q(`${business} ${where}`)}`,
  },
  {
    id: "apple",
    name: "Apple Maps",
    hosts: ["maps.apple.com"],
    why: "Feeds Siri and every iPhone map query. Registered separately from Google.",
    search: (business, where) => `https://maps.apple.com/?q=${q(`${business} ${where}`)}`,
  },
  {
    id: "bing",
    name: "Bing Places",
    hosts: ["bing.com"],
    why: "Bing's index is what Copilot draws on, and it is not populated from Google.",
    search: (business, where) => `https://www.bing.com/maps?q=${q(`${business} ${where}`)}`,
  },
  {
    id: "nextdoor",
    name: "Nextdoor",
    hosts: ["nextdoor.com"],
    why: "Neighbourhood recommendations for home services, and heavily indexed.",
    search: (business, where) => `https://nextdoor.com/search/?query=${q(business)}`,
  },
  {
    id: "thumbtack",
    name: "Thumbtack",
    hosts: ["thumbtack.com"],
    why: "Another home-services aggregator that ranks on the same queries.",
    search: (business, where) => `https://www.thumbtack.com/search?q=${q(business)}`,
  },
  {
    id: "yellowpages",
    name: "Yellow Pages",
    hosts: ["yellowpages.com", "yp.com"],
    why: "Still ranks for \"X in Y\" queries and is still scraped by other aggregators.",
    search: (business, where) =>
      `https://www.yellowpages.com/search?search_terms=${q(business)}&geo_location_terms=${q(where)}`,
  },
  {
    id: "homeadvisor",
    name: "HomeAdvisor",
    hosts: ["homeadvisor.com"],
    why: "Merged with Angi, but its profiles still exist and still rank separately.",
    // Google site: search rather than HomeAdvisor's own. Its profile URLs are
    // category paths with no documented search endpoint, and a guessed URL that
    // 404s looks exactly like an absent listing — the failure this audit exists
    // to avoid. A site: query cannot be wrong.
    search: (business, where) =>
      `https://www.google.com/search?q=${q(`site:homeadvisor.com "${business}" ${where}`)}`,
  },
  {
    id: "porch",
    name: "Porch",
    hosts: ["porch.com"],
    why: "Home-services marketplace, well indexed for local trade queries.",
    search: (business, where) => `https://porch.com/search?q=${q(`${business} ${where}`)}`,
  },
  {
    id: "trustpilot",
    name: "Trustpilot",
    hosts: ["trustpilot.com"],
    why: "Review platform increasingly cited in AI answers, and independent of Google.",
    search: (business, where) => `https://www.trustpilot.com/search?query=${q(business)}`,
  },
  {
    id: "chamber",
    name: "Chamber of Commerce",
    hosts: ["chamberofcommerce.com"],
    why: "A genuine local authority signal, and usually cheap to obtain.",
    search: (business, where) =>
      `https://www.chamberofcommerce.com/search?what=${q(business)}&where=${q(where)}`,
  },
  {
    id: "mapquest",
    name: "MapQuest",
    hosts: ["mapquest.com"],
    why: "Little direct traffic, but its data is redistributed to other services.",
    search: (business, where) => `https://www.mapquest.com/search/results?query=${q(`${business} ${where}`)}`,
  },
  {
    id: "foursquare",
    name: "Foursquare",
    hosts: ["foursquare.com"],
    why: "Diminished as a destination, still an aggregator other platforms pull from.",
    search: (business, where) =>
      `https://foursquare.com/explore?q=${q(business)}&near=${q(where)}`,
  },
];

/**
 * Deliberately excluded, so nobody adds them back thinking it was an oversight:
 * Hotfrog, Brownbook, Cylex, EZlocal, Nicelocal, Manta, Superpages, Citysearch.
 *
 * These are the long tail that citation packages pad their numbers with. They
 * inflate a citation count, which was a local-pack ranking signal in the SEO
 * era and is not what an answer engine retrieves. A card listing twenty
 * directories with eighteen unknowns is noise, and noise gets ignored — the
 * same reason this audit reports "unknown" rather than guessing.
 *
 * Evidence from the first Tier 1 test (OPEN-QUESTIONS 7.9): of the five sources
 * Perplexity cited for competing businesses, four were the businesses' own
 * websites and the fifth was BBB. Not a long tail.
 */

/** Which directory a URL belongs to, if any. */
export function directoryFor(url: string): Directory | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }

  return (
    DIRECTORIES.find((directory) =>
      directory.hosts.some((known) => host === known || host.endsWith(`.${known}`))
    ) ?? null
  );
}
