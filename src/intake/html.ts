import * as cheerio from "cheerio";
import {
  provenance,
  type CredentialCandidate,
  type EntityCandidates,
  type FaqCandidate,
  type ServiceCandidate,
} from "./types";

/**
 * Heuristic extraction from page markup, for sites with no structured data.
 *
 * Everything here is lower confidence than JSON-LD by construction — we're
 * inferring meaning from how a page happens to be built, and every site is
 * built differently. These candidates exist to save a human typing, not to be
 * trusted. Nothing from this file should ever be auto-approved.
 */

/** Phone numbers in tel: links are unambiguous; ones in body text are not. */
export function extractContact(html: string, url: string, into: EntityCandidates): void {
  const $ = cheerio.load(html);

  $('a[href^="tel:"]').each((_, element) => {
    const raw = ($(element).attr("href") ?? "").replace(/^tel:/, "").trim();
    const digits = raw.replace(/\D/g, "");
    // 10 digits, or 11 starting with a US country code.
    if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) {
      into.phone.push({
        value: $(element).text().trim() || raw,
        provenance: provenance("website", url, "tel: link", "high"),
      });
    }
  });

  $('a[href^="mailto:"]').each((_, element) => {
    const raw = ($(element).attr("href") ?? "").replace(/^mailto:/, "").split("?")[0].trim();
    if (raw.includes("@")) {
      into.email.push({
        value: raw,
        provenance: provenance("website", url, "mailto: link", "high"),
      });
    }
  });

  // Google Business Profile links are usually in a footer or a "reviews" block.
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    if (/g\.page|maps\.app\.goo\.gl|google\.[a-z.]+\/maps/i.test(href)) {
      into.gbpUrl.push({
        value: href,
        provenance: provenance("website", url, "link to Google Maps", "medium"),
      });
    }
  });

  const bodyText = $("body").text().replace(/\s+/g, " ");

  // US address line: "1234 Main St, Port Charlotte, FL 33948".
  const addressMatch = bodyText.match(
    /(\d{1,6}\s+[A-Za-z0-9.\-' ]{3,40}),\s*([A-Za-z .'-]{2,30}),\s*([A-Z]{2})\s+(\d{5})/
  );
  if (addressMatch) {
    const p = provenance("website", url, "address pattern in page text", "low");
    into.street.push({ value: addressMatch[1].trim(), provenance: p });
    into.city.push({ value: addressMatch[2].trim(), provenance: p });
    into.region.push({ value: addressMatch[3].trim(), provenance: p });
    into.postalCode.push({ value: addressMatch[4].trim(), provenance: p });
  }

  // "Serving Southwest Florida since 1998", "Family owned since 2004".
  const foundedMatch = bodyText.match(/\b(?:since|est(?:ablished)?\.?)\s+(19\d{2}|20\d{2})\b/i);
  if (foundedMatch) {
    into.foundedYear.push({
      value: Number(foundedMatch[1]),
      provenance: provenance("website", url, `"${foundedMatch[0]}" in page text`, "low"),
    });
  }
}

/**
 * FAQ pairs from page structure.
 *
 * Two shapes cover most of the web: <details><summary>, and a heading whose
 * text ends in a question mark followed by prose. Accordion widgets built from
 * divs are common too but have no reliable signature, so they're missed rather
 * than guessed at.
 */
export function extractFaqs(html: string, url: string): FaqCandidate[] {
  const $ = cheerio.load(html);
  const faqs: FaqCandidate[] = [];

  $("details").each((_, element) => {
    const question = $(element).find("summary").first().text().replace(/\s+/g, " ").trim();
    const clone = $(element).clone();
    clone.find("summary").remove();
    const answer = clone.text().replace(/\s+/g, " ").trim();

    if (question && answer && answer.length > 20) {
      faqs.push({
        question,
        answer,
        provenance: provenance("website", url, "<details>/<summary>", "medium"),
      });
    }
  });

  $("h2, h3, h4").each((_, element) => {
    const question = $(element).text().replace(/\s+/g, " ").trim();
    if (!question.endsWith("?") || question.length < 10) return;

    // Walk forward until the next heading, collecting prose.
    const parts: string[] = [];
    let node = $(element).next();
    while (node.length > 0 && !/^h[1-4]$/i.test(node.prop("tagName") ?? "")) {
      const chunk = node.text().replace(/\s+/g, " ").trim();
      if (chunk) parts.push(chunk);
      if (parts.join(" ").length > 600) break;
      node = node.next();
    }

    const answer = parts.join(" ").trim();
    if (answer.length > 20) {
      faqs.push({
        question,
        answer,
        provenance: provenance("website", url, "question heading + following text", "medium"),
      });
    }
  });

  return dedupeByQuestion(faqs);
}

const CREDENTIAL_PATTERNS: { pattern: RegExp; kind: string; label: string }[] = [
  { pattern: /\b(?:license|lic\.?|licence)\s*#?\s*([A-Z]{0,4}[-\s]?\d{4,10})\b/i, kind: "license", label: "License" },
  { pattern: /\b(CFC\s?\d{6,9})\b/i, kind: "license", label: "Florida plumbing license" },
  { pattern: /\b(CAC\s?\d{6,9})\b/i, kind: "license", label: "Florida HVAC license" },
  { pattern: /\b(EC\s?\d{6,9})\b/i, kind: "license", label: "Florida electrical license" },
];

/**
 * License numbers, usually in a footer.
 *
 * Low confidence deliberately — a license number is a compliance claim, and a
 * wrong one published as current is worse than none at all.
 */
export function extractCredentials(html: string, url: string): CredentialCandidate[] {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");
  const found: CredentialCandidate[] = [];
  const seen = new Set<string>();

  for (const { pattern, kind, label } of CREDENTIAL_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const identifier = match[1].trim();
    if (seen.has(identifier)) continue;
    seen.add(identifier);

    found.push({
      kind,
      title: label,
      identifier,
      provenance: provenance("website", url, `"${match[0].trim()}" in page text`, "low"),
    });
  }

  if (/\b(?:licensed|bonded|insured)\b/i.test(text)) {
    found.push({
      kind: "insurance",
      title: "Licensed, bonded and insured (claimed on site)",
      identifier: null,
      provenance: provenance("website", url, "claim in page text", "low"),
    });
  }

  return found;
}

/** Meta description is a reasonable fallback for a business description. */
export function extractMeta(html: string, url: string, into: EntityCandidates): void {
  const $ = cheerio.load(html);

  const description =
    $('meta[name="description"]').attr("content") ??
    $('meta[property="og:description"]').attr("content");
  if (description && description.trim().length > 40) {
    into.description.push({
      value: description.trim(),
      provenance: provenance("website", url, "meta description", "medium"),
    });
  }

  const siteName = $('meta[property="og:site_name"]').attr("content");
  if (siteName && siteName.trim()) {
    into.name.push({
      value: siteName.trim(),
      provenance: provenance("website", url, "og:site_name", "medium"),
    });
  }
}

/**
 * Services from navigation and internal links.
 *
 * Most sites publish no `Service` markup, so their service list only exists as
 * link text pointing at service pages. That's noisy — the same nav also holds
 * "About", "Careers", "Financing" — so this filters to links whose path looks
 * like a service page and whose text reads like a service rather than a page
 * name. Low confidence throughout; the point is to save typing, not to be right.
 */
export function extractServices(html: string, url: string): ServiceCandidate[] {
  const $ = cheerio.load(html);
  const found = new Map<string, ServiceCandidate>();

  // Paths that indicate a service page rather than a company page.
  const servicePath = /\/(services?|plumbing|hvac|heating|cooling|air-conditioning|drain|sewer|water-heater|repair|installation|maintenance)(\/|$)/i;

  // Link text that is a site section, not something you can buy.
  const notAService =
    /^(home|about|about us|contact|contact us|careers|blog|reviews|financing|coupons|specials|our team|service area|areas we serve|privacy|terms|book now|schedule|call now|menu|more|learn more|read more|view all|shop)$/i;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().replace(/\s+/g, " ").trim();

    if (!text || text.length < 4 || text.length > 60) return;
    if (notAService.test(text)) return;
    if (!servicePath.test(href)) return;
    // Anything with a digit or currency is a price or a phone number.
    if (/[\d$]/.test(text)) return;

    const key = text.toLowerCase();
    if (found.has(key)) return;

    found.set(key, {
      name: text,
      description: null,
      provenance: provenance("website", url, "service page link text", "low"),
    });
  });

  return [...found.values()];
}

/**
 * Reads a page someone has pointed us at — a services or service-areas hub.
 *
 * Far more reliable than guessing at URL conventions, because the page is known
 * rather than inferred. The one wrinkle is that a hub page also carries the
 * site's own menu and footer, so its links include About, Careers, Contact.
 * Those also appear on the homepage; the ones unique to this page are the
 * actual list. That comparison does the filtering no word list can.
 */
export function extractHubLinks(
  html: string,
  url: string,
  homepageHrefs: Set<string>,
  label: string
): { name: string; href: string }[] {
  const $ = cheerio.load(html);
  const found = new Map<string, { name: string; href: string }>();

  $("a[href]").each((_, element) => {
    const rawHref = $(element).attr("href") ?? "";
    const text = $(element).text().replace(/\s+/g, " ").trim();

    if (!text || text.length < 3 || text.length > 60) return;
    // A digit or currency symbol means a phone number, price, or address.
    if (/[\d$]/.test(text)) return;

    // A link inside a paragraph is part of a sentence, not a list entry. This
    // is what separates a genuine index page from a prose page that happens to
    // link out — without it, "pipes", "grease", and "customer care" all read as
    // services.
    if ($(element).closest("p").length > 0) return;

    // All-caps text is a call to action ("CONTACT US", "BOOK NOW"), not an item.
    if (text === text.toUpperCase() && /[A-Z]{3}/.test(text)) return;

    let absolute: string;
    try {
      const parsed = new URL(rawHref, url);
      parsed.hash = "";
      parsed.search = "";
      absolute = parsed.toString();
    } catch {
      return;
    }

    // Site furniture: anything the homepage also links to.
    if (homepageHrefs.has(absolute)) return;
    // Self-links and anchors back to this page.
    if (absolute.replace(/\/$/, "") === url.replace(/\/$/, "")) return;

    const key = text.toLowerCase();
    if (!found.has(key)) found.set(key, { name: text, href: absolute });
  });

  return [...found.values()];
}

/**
 * Plain-text lists on a page someone pointed us at.
 *
 * Service lists are very often not links at all — just a run of short sibling
 * elements, one item each. On a real site this looked like:
 *
 *   <p>Storage Clean Outs</p>
 *   <p>Appliance Removal</p>
 *   <p>Furniture Removal</p>
 *
 * Link extraction finds nothing there, and no amount of URL pattern matching
 * helps. What identifies these is structural repetition rather than markup
 * type: several siblings of the same tag, each holding a short phrase with no
 * link and no sentence punctuation. That works for <p>, <li>, <div>, or <span>
 * runs equally.
 */
export function extractHubTextItems(
  html: string,
  /**
   * Text runs that also appear on the homepage.
   *
   * Sitewide blocks — "Prompt Pickup / Friendly Service / Locally Owned" and
   * the like — are structurally identical to a real list and get picked up as
   * one. They appear on every page, so the homepage is the baseline that tells
   * page content from site furniture, exactly as it does for links.
   */
  furniture: Set<string> = new Set(),
  minRun = 4
): string[] {
  const $ = cheerio.load(html);
  const items: string[] = [];
  const seen = new Set<string>();

  $("body")
    .find("*")
    .each((_, parent) => {
      const children = $(parent).children();
      if (children.length < minRun) return;

      const run: string[] = [];
      let tag: string | null = null;

      children.each((_, child) => {
        const $child = $(child);
        const childTag = ($child.prop("tagName") ?? "").toLowerCase();
        const text = $child.text().replace(/\s+/g, " ").trim();

        const looksLikeItem =
          text.length >= 3 &&
          text.length <= 50 &&
          // An item is a label, not a sentence.
          !/[.!?;:]$/.test(text) &&
          // Links are handled separately; a linked run is a nav block.
          $child.find("a").length === 0 &&
          $child.children().length === 0 &&
          // Digits mean a phone number, price, or address.
          !/\d/.test(text);

        if (looksLikeItem && (tag === null || tag === childTag)) {
          tag = childTag;
          run.push(text);
        }
      });

      if (run.length >= minRun) {
        for (const text of run) {
          const key = text.toLowerCase();
          if (seen.has(key) || furniture.has(key)) continue;
          seen.add(key);
          items.push(text);
        }
      }
    });

  return items;
}

/**
 * Items on a hub page identified by a shared URL pattern.
 *
 * The strongest signal on a hub page, and the one that needs neither link text
 * nor the homepage comparison. Real items cluster — twelve links matching
 * `/junk-removal-<city>` — while About, Careers and Contact share nothing.
 *
 * This is what handles two cases the other strategies miss. Image-only links
 * (`<a href="/junk-removal-venice"><img …></a>`) carry no text to read, so the
 * label comes from the slug instead. And items linked sitewide from a footer
 * look like furniture to the homepage comparison, even though on an areas page
 * they are exactly the content wanted.
 */
export function extractHubUrlCluster(
  html: string,
  url: string,
  minCluster = 3
): { name: string; href: string }[] {
  const $ = cheerio.load(html);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();

  // slug tokens -> href, for every internal link with a single-segment path.
  const entries: { tokens: string[]; href: string; text: string }[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, element) => {
    let parsed: URL;
    try {
      parsed = new URL($(element).attr("href") ?? "", url);
    } catch {
      return;
    }
    if (parsed.hostname.replace(/^www\./, "").toLowerCase() !== host) return;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return;

    const slug = segments[0].toLowerCase();
    if (seen.has(slug)) return;
    seen.add(slug);

    entries.push({
      tokens: slug.split("-").filter(Boolean),
      href: parsed.origin + parsed.pathname,
      text: $(element).text().replace(/\s+/g, " ").trim(),
    });
  });

  // Group by leading token — the cheapest proxy for "same kind of page".
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (entry.tokens.length < 2) continue;
    const key = entry.tokens[0];
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const cluster = [...groups.values()]
    .filter((group) => group.length >= minCluster)
    .sort((a, b) => b.length - a.length)[0];

  if (!cluster) return [];

  // Strip the tokens every member shares, so `/junk-removal-venice` reads as
  // "Venice" rather than "Junk Removal Venice".
  let shared = 0;
  const first = cluster[0].tokens;
  while (
    shared < first.length - 1 &&
    cluster.every((entry) => entry.tokens[shared] === first[shared])
  ) {
    shared++;
  }

  return cluster.flatMap((entry) => {
    const rest = entry.tokens.slice(shared);
    if (rest.length === 0) return [];

    // The slug remainder is what distinguishes members of the cluster, so it
    // names them consistently. Link text is a fallback: on a page mixing image
    // links with text ones it produced "Venice" alongside
    // "Sarasota Junk Removal" for the same kind of item.
    const fromSlug = rest
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ");
    const name = fromSlug || entry.text;
    if (!name || name.length > 60) return [];

    return [{ name, href: entry.href }];
  });
}

/** Absolute, normalized hrefs on a page — used as the furniture baseline. */
export function pageHrefs(html: string, url: string): Set<string> {
  const $ = cheerio.load(html);
  const hrefs = new Set<string>();

  $("a[href]").each((_, element) => {
    try {
      const parsed = new URL($(element).attr("href") ?? "", url);
      parsed.hash = "";
      parsed.search = "";
      hrefs.add(parsed.toString());
    } catch {
      // Malformed href — skip.
    }
  });

  return hrefs;
}

function dedupeByQuestion(faqs: FaqCandidate[]): FaqCandidate[] {
  const seen = new Set<string>();
  return faqs.filter((faq) => {
    const key = faq.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
