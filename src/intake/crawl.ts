import * as cheerio from "cheerio";
import { PoliteFetcher } from "./fetch";
import {
  extractEntityFromJsonLd,
  extractFaqsFromJsonLd,
  extractServicesFromJsonLd,
  parseJsonLdBlocks,
} from "./jsonld";
import {
  extractContact,
  extractCredentials,
  extractFaqs,
  extractHubLinks,
  extractHubTextItems,
  extractMeta,
  extractServices,
  pageHrefs,
} from "./html";
import {
  emptyEntityCandidates,
  provenance,
  type IntakeResult,
} from "./types";

/**
 * Crawls a customer's website and extracts everything it can.
 *
 * Deliberately shallow. A handful of the right pages — home, about, contact,
 * services, FAQ — carries almost all the extractable facts, and crawling a
 * whole site to find them is slow, rude, and mostly returns blog posts.
 */

/** Path fragments worth prioritizing, most valuable first. */
const PRIORITY_PATTERNS = [
  /\/(faqs?|frequently-asked)/i,
  /\/(contact)/i,
  /\/(about)/i,
  /\/(services?|what-we-do)/i,
  /\/(service-areas?|areas-we-serve|locations?)/i,
];

/** Never worth fetching. */
const SKIP_PATTERNS = [
  /\/(wp-admin|wp-json|wp-content|wp-includes)/i,
  /\/(cart|checkout|account|login|register)/i,
  /\.(pdf|jpe?g|png|gif|svg|webp|css|js|zip|mp4|xml)$/i,
  /\/(privacy|terms|sitemap)/i,
  /\/(tag|category|author)\//i,
  /#/,
];

export interface CrawlOptions {
  site: string;
  maxPages: number;
  delayMs: number;
  /** A page someone has pointed us at, read directly rather than guessed. */
  servicesPageUrl?: string;
  serviceAreasPageUrl?: string;
}

function normalizeUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    url.hash = "";
    url.search = "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "") || url.origin;
  } catch {
    return null;
  }
}

/**
 * Host key that ignores a leading www.
 *
 * Sites routinely serve on the bare domain while linking to the www host (or
 * the reverse). Comparing origins literally makes every internal link look
 * external, and the crawl silently stops after the first page — which is
 * exactly what happened the first time this ran.
 */
function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Dedupe key that treats www and bare hosts as the same page.
 *
 * The host comparison already ignores www, so without matching the seen-key to
 * it, every page reachable under both hosts gets fetched twice — doubling the
 * load we put on a customer's site for nothing.
 */
function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${hostKey(url)}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function priorityOf(url: string): number {
  for (let i = 0; i < PRIORITY_PATTERNS.length; i++) {
    if (PRIORITY_PATTERNS[i].test(url)) return i;
  }
  return PRIORITY_PATTERNS.length;
}

export async function crawlSite(options: CrawlOptions): Promise<IntakeResult> {
  const startedAt = new Date().toISOString();
  const origin = new URL(options.site).origin;
  const domain = new URL(options.site).hostname.replace(/^www\./, "");
  const siteHost = hostKey(options.site);

  const fetcher = new PoliteFetcher(origin, options.delayMs);
  await fetcher.loadRobots();

  const result: IntakeResult = {
    domain,
    startedAt,
    finishedAt: startedAt,
    pagesFetched: [],
    pagesSkipped: [],
    entity: emptyEntityCandidates(),
    faqs: [],
    services: [],
    credentials: [],
    areas: [],
    brands: [],
    notes: [],
  };

  const queue: string[] = [origin];
  const seen = new Set<string>([dedupeKey(origin)]);
  const externalHosts = new Map<string, number>();
  let homepageHtml: string | null = null;
  let structuredDataFound = false;

  while (queue.length > 0 && result.pagesFetched.length < options.maxPages) {
    // Highest-value pages first, so a low --max-pages still gets the good ones.
    queue.sort((a, b) => priorityOf(a) - priorityOf(b));
    const url = queue.shift()!;

    let page;
    try {
      page = await fetcher.get(url);
    } catch (error) {
      result.pagesSkipped.push({
        url,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (page.status !== 200 || !page.html.includes("<")) {
      result.pagesSkipped.push({ url, reason: `HTTP ${page.status}` });
      continue;
    }

    result.pagesFetched.push(url);
    if (homepageHtml === null) homepageHtml = page.html;

    // --- structured data first; it outranks everything heuristic ------------
    const blocks = parseJsonLdBlocks(page.html);
    if (blocks.length > 0) {
      structuredDataFound = true;
      extractEntityFromJsonLd(blocks, url, result.entity);
      result.faqs.push(...extractFaqsFromJsonLd(blocks, url));

      const { services, areas } = extractServicesFromJsonLd(blocks, url);
      result.services.push(...services);
      result.areas.push(...areas);
    }

    // --- heuristics ---------------------------------------------------------
    extractMeta(page.html, url, result.entity);
    extractContact(page.html, url, result.entity);
    result.faqs.push(...extractFaqs(page.html, url));
    result.credentials.push(...extractCredentials(page.html, url));
    result.services.push(...extractServices(page.html, url));

    // --- discover more ------------------------------------------------------
    const $ = cheerio.load(page.html);
    $("a[href]").each((_, element) => {
      const next = normalizeUrl($(element).attr("href") ?? "", url);
      if (!next) return;

      const host = hostKey(next);
      if (host !== siteHost) {
        // Track where off-domain links go, so a landing page that fronts the
        // real site can be recognized rather than silently returning nothing.
        if (host) externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
        return;
      }

      const key = dedupeKey(next);
      if (seen.has(key)) return;
      if (SKIP_PATTERNS.some((pattern) => pattern.test(next))) return;

      seen.add(key);
      queue.push(next);
    });
  }

  // --- pages we were pointed at --------------------------------------------
  // Read last, so the homepage is available as the site-furniture baseline.
  const furniture = homepageHtml ? pageHrefs(homepageHtml, origin) : new Set<string>();
  const textFurniture = new Set(
    homepageHtml
      ? extractHubTextItems(homepageHtml).map((text) => text.toLowerCase())
      : []
  );

  for (const hub of [
    { url: options.servicesPageUrl, kind: "services" as const },
    { url: options.serviceAreasPageUrl, kind: "areas" as const },
  ]) {
    if (!hub.url) continue;

    let page;
    try {
      page = await fetcher.get(hub.url);
    } catch (error) {
      result.pagesSkipped.push({
        url: hub.url,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (page.status !== 200) {
      result.pagesSkipped.push({ url: hub.url, reason: `HTTP ${page.status}` });
      result.notes.push(
        `The configured ${hub.kind} page returned HTTP ${page.status}. Check the URL in Settings.`
      );
      continue;
    }

    result.pagesFetched.push(hub.url);

    // Links first, then plain-text runs — a list is often one or the other,
    // occasionally both.
    const names = [
      ...extractHubLinks(page.html, hub.url, furniture, hub.kind).map((link) => link.name),
      ...extractHubTextItems(page.html, textFurniture),
    ];

    const links = [...new Set(names.map((name) => name.trim()))]
      .filter(Boolean)
      .map((name) => ({ name, href: hub.url! }));

    if (links.length === 0) {
      result.notes.push(
        `Nothing extractable on the configured ${hub.kind} page — no links unique to it and no ` +
          `repeated short text items. Check the URL points at the list itself.`
      );
      continue;
    }

    const provenanceFor = provenance("website", hub.url, "configured " + hub.kind + " page", "high");
    if (hub.kind === "services") {
      result.services.push(
        ...links.map((link) => ({ name: link.name, description: null, provenance: provenanceFor }))
      );
    } else {
      result.areas.push(...links.map((link) => ({ name: link.name, provenance: provenanceFor })));
    }
  }

  // A single page with no internal links is almost always a placeholder or a
  // redirect shell in front of the real site. Customers give the wrong domain
  // constantly, so say so instead of reporting a thin crawl as a thin business.
  if (result.pagesFetched.length <= 1 && externalHosts.size > 0) {
    const [topHost] = [...externalHosts.entries()].sort((a, b) => b[1] - a[1])[0];
    const socialHosts = /facebook|instagram|twitter|x\.com|linkedin|yelp|google|youtube|tiktok/i;

    if (!socialHosts.test(topHost)) {
      result.notes.push(
        `Only one page found, and its links point to ${topHost}. This domain looks like a ` +
          `landing page in front of the real site. Re-run with --site https://${topHost}.`
      );
    }
  }

  if (!structuredDataFound) {
    result.notes.push(
      "No JSON-LD found anywhere on the site. Everything extracted is heuristic and " +
        "low confidence — expect to correct most of it. Adding structured data to this " +
        "site is itself high-value work."
    );
  }

  if (result.faqs.length === 0) {
    result.notes.push(
      "No FAQ content found. Question-and-answer is the format answer engines cite " +
        "most directly, so this is the biggest content gap."
    );
  }

  if (result.entity.phone.length === 0) {
    result.notes.push("No phone number found — check that the site uses tel: links.");
  }

  result.faqs = dedupe(result.faqs, (faq) => faq.question.toLowerCase().trim());
  result.services = dedupe(result.services, (service) => service.name.toLowerCase().trim());
  result.areas = dedupe(result.areas, (area) => area.name.toLowerCase().trim());
  result.credentials = dedupe(
    result.credentials,
    (credential) => `${credential.kind}:${credential.identifier ?? credential.title}`
  );

  result.finishedAt = new Date().toISOString();
  return result;
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
