import * as cheerio from "cheerio";
import {
  provenance,
  type CredentialCandidate,
  type EntityCandidates,
  type FaqCandidate,
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

function dedupeByQuestion(faqs: FaqCandidate[]): FaqCandidate[] {
  const seen = new Set<string>();
  return faqs.filter((faq) => {
    const key = faq.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
