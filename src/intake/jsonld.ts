import * as cheerio from "cheerio";
import {
  provenance,
  type AreaCandidate,
  type EntityCandidates,
  type FaqCandidate,
  type ServiceCandidate,
} from "./types";

/**
 * Extracts structured data the site already publishes.
 *
 * This is the highest-signal source available and it's routinely ignored. A site
 * with LocalBusiness JSON-LD is handing over name, phone, address, and hours in
 * exactly the form we want, already curated by whoever built the site. FAQPage
 * markup gives question and answer pairs verbatim.
 *
 * Everything here is marked high confidence for that reason — it's the site
 * owner's own declaration, not our inference from prose.
 */

const BUSINESS_TYPES = new Set([
  "LocalBusiness",
  "Organization",
  "Plumber",
  "HVACBusiness",
  "HomeAndConstructionBusiness",
  "ProfessionalService",
  "Electrician",
  "RoofingContractor",
  "GeneralContractor",
  "Corporation",
]);

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Pulls every JSON-LD block, flattening @graph containers. */
export function parseJsonLdBlocks(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const blocks: Record<string, unknown>[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON-LD is common on real sites. Skip it rather than abort.
      return;
    }

    const queue = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of queue) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;

      const graph = record["@graph"];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          if (node && typeof node === "object") blocks.push(node as Record<string, unknown>);
        }
      } else {
        blocks.push(record);
      }
    }
  });

  return blocks;
}

function typesOf(node: Record<string, unknown>): string[] {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
  return [];
}

/**
 * JSON-LD is embedded in HTML, so its string values routinely arrive still
 * carrying HTML entities — "Titanz Plumbing &amp; Air" rather than "&".
 * Publishing that verbatim puts the raw entity in front of a crawler.
 */
function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return cheerio.load(`<div>${value}</div>`)("div").text();
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    return decodeEntities(value).trim();
  }
  return null;
}

/** JSON-LD values are frequently objects or arrays where a string is expected. */
function firstText(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstText(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.name) ?? text(record["@value"]) ?? text(record.url);
  }
  return text(value);
}

export function extractEntityFromJsonLd(
  blocks: Record<string, unknown>[],
  url: string,
  into: EntityCandidates
): void {
  for (const node of blocks) {
    const types = typesOf(node);
    if (!types.some((t) => BUSINESS_TYPES.has(t))) continue;

    const p = (method: string) => provenance("website", url, method, "high");
    const push = <T>(list: { value: T; provenance: ReturnType<typeof p> }[], value: T | null, method: string) => {
      if (value !== null && value !== undefined) list.push({ value, provenance: p(method) });
    };

    push(into.name, firstText(node.name), `JSON-LD ${types[0]} name`);
    push(into.legalName, firstText(node.legalName), `JSON-LD ${types[0]} legalName`);
    push(into.description, firstText(node.description), `JSON-LD ${types[0]} description`);
    push(into.phone, firstText(node.telephone), `JSON-LD ${types[0]} telephone`);
    push(into.email, firstText(node.email), `JSON-LD ${types[0]} email`);

    const address = node.address;
    if (address && typeof address === "object") {
      const a = (Array.isArray(address) ? address[0] : address) as Record<string, unknown>;
      const street = firstText(a.streetAddress);
      const locality = firstText(a.addressLocality);

      push(into.street, street, "JSON-LD address.streetAddress");
      push(into.city, locality, "JSON-LD address.addressLocality");
      push(into.region, firstText(a.addressRegion), "JSON-LD address.addressRegion");
      push(into.postalCode, firstText(a.postalCode), "JSON-LD address.postalCode");

      // Plenty of real sites cram the whole address into streetAddress, or put
      // "City, ST" in addressLocality. Offer split values as lower-confidence
      // alternatives rather than rewriting what the site actually declared —
      // a reviewer can then pick, and the original stays visible.
      for (const [raw, label] of [
        [locality, "addressLocality"],
        [street, "streetAddress"],
      ] as const) {
        const match = raw?.match(/^(.*?),\s*([A-Z]{2})(?:\s+\d{5})?$/);
        if (!match) continue;

        const cityPart = match[1].replace(/^\d{1,6}\s+[^,]*,\s*/, "").trim();
        if (cityPart) {
          into.city.push({
            value: cityPart,
            provenance: provenance("website", url, `split from ${label}`, "medium"),
          });
        }
        into.region.push({
          value: match[2],
          provenance: provenance("website", url, `split from ${label}`, "medium"),
        });
      }
    }

    const founded = firstText(node.foundingDate);
    if (founded) {
      const year = Number(founded.slice(0, 4));
      if (Number.isFinite(year) && year > 1800) {
        push(into.foundedYear, year, "JSON-LD foundingDate");
      }
    }

    // sameAs frequently carries the Google Maps / GBP link, which is the
    // strongest corroboration signal available.
    const sameAs = node.sameAs;
    const links = Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : [];
    for (const link of links) {
      const href = text(link);
      if (href && /google\.[a-z.]+\/maps|g\.page|maps\.app\.goo\.gl/i.test(href)) {
        push(into.gbpUrl, href, "JSON-LD sameAs (Google)");
      }
    }

    for (const spec of asArray(node.openingHoursSpecification)) {
      if (!spec || typeof spec !== "object") continue;
      const s = spec as Record<string, unknown>;
      const opens = text(s.opens);
      const closes = text(s.closes);

      for (const dayValue of asArray(s.dayOfWeek)) {
        const dayName = firstText(dayValue);
        if (!dayName) continue;
        const key = dayName.split("/").pop()!.toLowerCase();
        const day = DAY_INDEX[key];
        if (day === undefined) continue;

        into.hours.push({
          value: { day, opens, closes, isClosed: !opens && !closes },
          provenance: p("JSON-LD openingHoursSpecification"),
        });
      }
    }
  }
}

/** FAQPage markup — question and answer pairs, verbatim from the site. */
export function extractFaqsFromJsonLd(
  blocks: Record<string, unknown>[],
  url: string
): FaqCandidate[] {
  const faqs: FaqCandidate[] = [];

  for (const node of blocks) {
    const isFaqPage = typesOf(node).includes("FAQPage");
    const entities = asArray(node.mainEntity);

    for (const entity of entities) {
      if (!entity || typeof entity !== "object") continue;
      const e = entity as Record<string, unknown>;
      if (!isFaqPage && !typesOf(e).includes("Question")) continue;

      const question = firstText(e.name) ?? firstText(e.text);
      const accepted = e.acceptedAnswer;
      const answer =
        accepted && typeof accepted === "object"
          ? firstText((accepted as Record<string, unknown>).text)
          : null;

      if (question && answer) {
        faqs.push({
          question: stripHtml(question),
          answer: stripHtml(answer),
          provenance: provenance("website", url, "JSON-LD FAQPage", "high"),
        });
      }
    }
  }

  return faqs;
}

export function extractServicesFromJsonLd(
  blocks: Record<string, unknown>[],
  url: string
): { services: ServiceCandidate[]; areas: AreaCandidate[] } {
  const services: ServiceCandidate[] = [];
  const areas: AreaCandidate[] = [];

  for (const node of blocks) {
    const types = typesOf(node);

    if (types.includes("Service")) {
      const name = firstText(node.name);
      if (name) {
        services.push({
          name,
          description: firstText(node.description),
          provenance: provenance("website", url, "JSON-LD Service", "high"),
        });
      }
    }

    for (const area of asArray(node.areaServed)) {
      const name = firstText(area);
      if (name) {
        areas.push({
          name,
          provenance: provenance("website", url, "JSON-LD areaServed", "high"),
        });
      }
    }
  }

  return { services, areas };
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Answer text in FAQPage markup is usually HTML. */
function stripHtml(value: string): string {
  return cheerio
    .load(`<div>${value}</div>`)("div")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}
