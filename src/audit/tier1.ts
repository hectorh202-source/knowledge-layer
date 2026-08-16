/**
 * Tier 1 audit — is this business reachable by AI at all?
 *
 * Runs the checks that can actually be tested from here. Everything that needs
 * an account login (Search Console, the Google Business Profile dashboard,
 * directory listings) is a manual item instead, because reporting an unchecked
 * thing as passing is worse than reporting it as unknown.
 */

export type CheckState = "pass" | "fail" | "warn" | "unknown";

export interface CheckResult {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  /** What to do about it, when it isn't passing. */
  fix: string | null;
}

export interface Tier1Report {
  domain: string;
  ranAt: string;
  checks: CheckResult[];
  passed: number;
  failed: number;
}

/**
 * Real user agent strings for the crawlers that matter.
 *
 * Testing with a generic client proves nothing: blocks are almost always
 * applied by user agent at a CDN or WAF, which is exactly how the one on
 * calltitanz.com was found.
 */
const CRAWLERS: { name: string; ua: string; why: string }[] = [
  {
    name: "GPTBot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
    why: "OpenAI's crawler",
  },
  {
    name: "OAI-SearchBot",
    ua: "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    why: "feeds ChatGPT Search results",
  },
  {
    name: "PerplexityBot",
    ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    why: "feeds Perplexity",
  },
  {
    name: "ClaudeBot",
    ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    why: "Anthropic's crawler",
  },
  {
    name: "Googlebot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    why: "Google indexing, which AI Overviews build on",
  },
  {
    name: "Google-Extended",
    ua: "Mozilla/5.0 (compatible; Google-Extended/1.0)",
    why: "Gemini grounding",
  },
];

const TIMEOUT_MS = 12_000;

async function get(
  url: string,
  ua?: string
): Promise<{ status: number; body: string; ok: boolean } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: ua ? { "User-Agent": ua } : {},
    });
    const body = await response.text().catch(() => "");
    return { status: response.status, body, ok: response.ok };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Disallow rules that apply to a named bot, or to everyone. */
function robotsBlocks(robots: string, bot: string): boolean {
  let applies = false;
  for (const rawLine of robots.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === bot.toLowerCase();
    } else if (key === "disallow" && applies && value === "/") {
      return true;
    }
  }
  return false;
}

export async function runTier1Audit(domain: string): Promise<Tier1Report> {
  const checks: CheckResult[] = [];
  const base = `https://${domain}`;

  // --- the site responds at all -------------------------------------------
  const home = await get(base);
  if ("error" in home) {
    checks.push({
      id: "site-up",
      label: "Website responds",
      state: "fail",
      detail: home.error,
      fix: "Check the domain is correct and the site is online.",
    });
    return { domain, ranAt: new Date().toISOString(), checks, passed: 0, failed: 1 };
  }

  checks.push({
    id: "site-up",
    label: "Website responds",
    state: home.ok ? "pass" : "fail",
    detail: `HTTP ${home.status}`,
    fix: home.ok ? null : "The site must return 200 to be crawled.",
  });

  // A login wall on the pages that matter makes everything else moot.
  const looksGated = /name=["']password["']|type=["']password["']/i.test(home.body) &&
    home.body.length < 8000;
  checks.push({
    id: "no-login-wall",
    label: "No login wall",
    state: looksGated ? "warn" : "pass",
    detail: looksGated
      ? "The homepage looks like a login page."
      : "Homepage content is publicly readable.",
    fix: looksGated ? "Content behind a login cannot be read by any crawler." : null,
  });

  // --- robots.txt ----------------------------------------------------------
  const robots = await get(`${base}/robots.txt`);
  let robotsBody = "";
  let sitemapUrl: string | null = null;

  if ("error" in robots || robots.status === 404) {
    checks.push({
      id: "robots",
      label: "robots.txt",
      state: "warn",
      detail: "No robots.txt found. Nothing is blocked, but nothing is declared either.",
      fix: "Add one declaring your sitemap. Absence permits crawling, so this is not urgent.",
    });
  } else {
    robotsBody = robots.body;
    const blocked = CRAWLERS.filter((crawler) => robotsBlocks(robotsBody, crawler.name));
    const match = robotsBody.match(/sitemap:\s*(\S+)/i);
    sitemapUrl = match ? match[1].trim() : null;

    checks.push({
      id: "robots",
      label: "robots.txt allows AI crawlers",
      state: blocked.length > 0 ? "fail" : "pass",
      detail:
        blocked.length > 0
          ? `Blocks ${blocked.map((c) => c.name).join(", ")}.`
          : "No AI crawler is disallowed.",
      fix: blocked.length > 0 ? `Remove the Disallow: / rules for those user agents.` : null,
    });
  }

  // --- can each crawler actually reach it ---------------------------------
  // robots.txt is only half the story. A CDN or WAF can reject a bot by user
  // agent before the request ever reaches the site, and robots.txt will look
  // perfectly clean while it happens.
  const blockedAgents: string[] = [];
  const reachable: string[] = [];

  for (const crawler of CRAWLERS) {
    const response = await get(base, crawler.ua);
    if ("error" in response || response.status === 403 || response.status === 429) {
      const why = "error" in response ? response.error : `HTTP ${response.status}`;
      blockedAgents.push(`${crawler.name} (${why})`);
    } else {
      reachable.push(crawler.name);
    }
    // Spaced, because this is someone's production site.
    await sleep(700);
  }

  checks.push({
    id: "crawler-reach",
    label: "AI crawlers can fetch the site",
    state: blockedAgents.length > 0 ? "fail" : "pass",
    detail:
      blockedAgents.length > 0
        ? `Turned away: ${blockedAgents.join(", ")}. Reaching it fine: ${reachable.join(", ")}.`
        : `All ${reachable.length} crawlers got through.`,
    fix:
      blockedAgents.length > 0
        ? "This is at the host, CDN or firewall, not in robots.txt — a support ticket with the hosting provider."
        : null,
  });

  // --- sitemap -------------------------------------------------------------
  const candidates = sitemapUrl
    ? [sitemapUrl]
    : [`${base}/sitemap_index.xml`, `${base}/sitemap.xml`];

  let sitemapFound: { url: string; urls: number } | null = null;
  for (const candidate of candidates) {
    const response = await get(candidate);
    if (!("error" in response) && response.ok && response.body.includes("<loc>")) {
      sitemapFound = {
        url: candidate,
        urls: (response.body.match(/<loc>/g) ?? []).length,
      };
      break;
    }
  }

  checks.push({
    id: "sitemap",
    label: "XML sitemap",
    state: sitemapFound ? "pass" : "fail",
    detail: sitemapFound
      ? `${sitemapFound.url} — ${sitemapFound.urls} entries${sitemapUrl ? ", declared in robots.txt" : ", not declared in robots.txt"}`
      : "No sitemap found at the usual locations.",
    fix: sitemapFound
      ? sitemapUrl
        ? null
        : "Add a Sitemap: line to robots.txt so crawlers find it without guessing."
      : "Generate one. Most CMS platforms do this with a plugin or a setting.",
  });

  // --- contact details as text --------------------------------------------
  const hasTel = /href=["']tel:/i.test(home.body);
  checks.push({
    id: "contact-text",
    label: "Phone number as text",
    state: hasTel ? "pass" : "warn",
    detail: hasTel
      ? "Found a tel: link on the homepage."
      : "No tel: link on the homepage.",
    fix: hasTel
      ? null
      : "A number inside an image or only in a form cannot be read or cited.",
  });

  // --- does the site say what they do and where ---------------------------
  // Read from the homepage's own links rather than by fetching more pages.
  // Navigation is on the homepage on essentially every site, so this costs
  // nothing extra and is more reliable than guessing at URL conventions.
  const links = internalLinks(home.body, domain);

  const servicePages = links.filter((href) =>
    /\/(services?|plumbing|hvac|heating|cooling|air-conditioning|drain|sewer|water-heater|repair|installation|replacement)(\/|$)/i.test(
      href
    )
  );

  checks.push({
    id: "services-page",
    label: "A page stating services offered",
    state: servicePages.length > 0 ? "pass" : "fail",
    detail:
      servicePages.length > 0
        ? `${servicePages.length} service page${servicePages.length === 1 ? "" : "s"} linked from the homepage.`
        : "No service pages linked from the homepage.",
    fix:
      servicePages.length > 0
        ? null
        : "An AI cannot say what this business does if the site never states it.",
  });

  const areaPages = links.filter((href) =>
    /\/(coverage|service-areas?|areas?-we-serve|locations?|cities|neighborhoods?)(\/|$)/i.test(href)
  );

  checks.push({
    id: "areas-page",
    label: "A page stating service areas",
    state: areaPages.length > 0 ? "pass" : "fail",
    detail:
      areaPages.length > 0
        ? `${areaPages.length} area page${areaPages.length === 1 ? "" : "s"} linked from the homepage.`
        : "No service area pages linked from the homepage.",
    fix:
      areaPages.length > 0
        ? null
        : "Name the cities or ZIPs served. 'And surrounding areas' cannot be matched to a searcher's location.",
  });

  // --- credentials ---------------------------------------------------------
  // Check the homepage first, then the about page, since licence numbers
  // usually live in a footer or on an about page rather than both.
  const aboutPage = links.find((href) => /\/about/i.test(href));
  let credentialText = home.body;

  if (aboutPage && !hasCredentialClaim(credentialText)) {
    await sleep(700);
    const about = await get(aboutPage);
    if (!("error" in about) && about.ok) credentialText += about.body;
  }

  const licenceNumber = credentialText.match(
    /\b((?:CFC|CAC|EC|CGC|CBC|CCC)\s?\d{6,9})\b/i
  );
  const claimsLicensed = hasCredentialClaim(credentialText);

  checks.push({
    id: "credentials",
    label: "Licensing and credentials stated",
    state: licenceNumber ? "pass" : claimsLicensed ? "warn" : "fail",
    detail: licenceNumber
      ? `Found ${licenceNumber[1].trim()}${aboutPage ? " on the homepage or about page" : ""}.`
      : claimsLicensed
        ? "Says licensed or insured, but publishes no licence number."
        : "No licensing claim or number found.",
    fix: licenceNumber
      ? null
      : "A licence number is a specific, verifiable fact. 'Licensed and insured' is a claim every competitor also makes.",
  });

  const passed = checks.filter((check) => check.state === "pass").length;
  const failed = checks.filter((check) => check.state === "fail").length;

  return { domain, ranAt: new Date().toISOString(), checks, passed, failed };
}

function hasCredentialClaim(html: string): boolean {
  return /\b(licen[cs]ed|bonded|insured|certified)\b/i.test(html);
}

/** Same-site links from a page, absolute, deduped. */
function internalLinks(html: string, domain: string): string[] {
  const found = new Set<string>();
  const bare = domain.replace(/^www\./, "").toLowerCase();

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) continue;

    try {
      const url = new URL(raw, `https://${domain}`);
      if (url.hostname.replace(/^www\./, "").toLowerCase() !== bare) continue;
      url.hash = "";
      url.search = "";
      found.add(url.toString());
    } catch {
      // Malformed href — skip rather than abort the audit.
    }
  }

  return [...found];
}

/**
 * Tier 1 items that cannot be tested from here.
 *
 * These need an account login or human judgment. They are tracked as explicit
 * checkboxes so an unverified item reads as unverified rather than quietly
 * counting as done.
 */
export const MANUAL_CHECKS: { id: string; label: string; hint: string }[] = [
  {
    id: "search-console",
    label: "Domain verified in Google Search Console",
    hint: "Needed to confirm what is actually indexed, not just submitted.",
  },
  {
    id: "indexed",
    label: "Key pages confirmed indexed",
    hint: "Search Console → Pages. Submitted is not the same as indexed.",
  },
  {
    id: "gbp-claimed",
    label: "Google Business Profile claimed and complete",
    hint: "An unclaimed listing cannot be corrected and ranks worse.",
  },
  {
    id: "gbp-categories",
    label: "GBP primary and secondary categories correct",
    hint: "Category drives which questions the listing is eligible to answer.",
  },
  {
    id: "gbp-areas",
    label: "GBP service areas set",
    hint: "Should match the areas published on the site.",
  },
  {
    id: "gbp-hours",
    label: "GBP hours, phone and address accurate",
    hint: "These are the most-quoted facts about any local business.",
  },
  {
    id: "nap-consistent",
    label: "Name, address and phone identical everywhere",
    hint: "Inconsistent NAP across directories actively degrades entity resolution.",
  },
  {
    id: "reviews",
    label: "Google reviews present",
    hint: "Corroboration from outside the site is what makes a business credible to an AI.",
  },
  {
    id: "directories",
    label: "Listed on real directories",
    hint: "Yelp, BBB, Angi, Apple Maps, Bing Places, chamber of commerce.",
  },
  {
    id: "ai-test",
    label: "THE TEST — asked ChatGPT, Gemini and Perplexity and the business appeared",
    hint: "This is the whole measure of Tier 1. Nothing else counts if this fails.",
  },
];
