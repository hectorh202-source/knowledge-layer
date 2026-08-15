import type { KnowledgeSource } from "../api/types";

/**
 * Builds schema.org JSON-LD from the knowledge layer.
 *
 * This is the surface that works TODAY. The ARD catalog is a bet on a standard
 * with near-zero adoption; JSON-LD is what Google and every AI crawler already
 * consume, from the site the business already has. Same facts, same source,
 * different serialization.
 *
 * Emitted as a single @graph with @id anchors so the nodes reference one
 * another rather than describing several unrelated entities. A page carrying
 * two independent LocalBusiness definitions is worse than one, because a
 * crawler has to guess which is authoritative.
 */

const DAY_URIS = [
  "https://schema.org/Sunday",
  "https://schema.org/Monday",
  "https://schema.org/Tuesday",
  "https://schema.org/Wednesday",
  "https://schema.org/Thursday",
  "https://schema.org/Friday",
  "https://schema.org/Saturday",
];

export interface BuildJsonLdOptions {
  /** Root domain the markup will be published on. */
  domain: string;
  /**
   * schema.org type for the business. More specific is better — Plumber and
   * HVACBusiness both inherit LocalBusiness and tell a crawler more.
   */
  schemaType: string;
}

export interface JsonLdResult {
  graph: Record<string, unknown>;
  /** Node types included, for reporting. */
  included: string[];
  warnings: string[];
}

export async function buildJsonLd(
  source: KnowledgeSource,
  options: BuildJsonLdOptions
): Promise<JsonLdResult> {
  const [business, services, areas, faqs, credentials, brands] = await Promise.all([
    source.business(),
    source.services(),
    source.serviceAreas(),
    source.faqs(),
    source.credentials(),
    source.brands(),
  ]);

  const warnings: string[] = [];
  const included: string[] = [];
  const nodes: Record<string, unknown>[] = [];

  const base = `https://${options.domain}`;
  const businessId = `${base}/#business`;

  if (!business) {
    warnings.push(
      "No published business profile — nothing can be emitted. Markup describing an " +
        "unidentifiable entity is worse than no markup."
    );
    return { graph: { "@context": "https://schema.org", "@graph": [] }, included, warnings };
  }

  // --- the business -------------------------------------------------------
  const businessNode: Record<string, unknown> = {
    "@type": options.schemaType,
    "@id": businessId,
    name: business.name,
    url: base,
  };

  if (business.legalName && business.legalName !== business.name) {
    businessNode.legalName = business.legalName;
  }
  if (business.description) businessNode.description = business.description;
  if (business.phone) businessNode.telephone = business.phone;
  if (business.email) businessNode.email = business.email;

  const address: Record<string, unknown> = { "@type": "PostalAddress" };
  if (business.address.street) address.streetAddress = business.address.street;
  if (business.address.city) address.addressLocality = business.address.city;
  if (business.address.region) address.addressRegion = business.address.region;
  if (business.address.postalCode) address.postalCode = business.address.postalCode;
  address.addressCountry = business.address.country;
  businessNode.address = address;

  if (business.foundedYear) businessNode.foundingDate = String(business.foundedYear);

  // sameAs is how a crawler ties this markup to the Google Business Profile —
  // the corroboration that makes an entity resolvable rather than asserted.
  if (business.gbpUrl) businessNode.sameAs = [business.gbpUrl];

  const openHours = business.hours.filter((entry) => !entry.isClosed && entry.opens && entry.closes);
  if (openHours.length > 0) {
    businessNode.openingHoursSpecification = openHours.map((entry) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DAY_URIS[entry.day],
      opens: entry.opens,
      closes: entry.closes,
    }));
  } else {
    warnings.push("No opening hours published — one of the most commonly asked facts is missing.");
  }

  // areaServed with real postal codes is what lets a crawler match a
  // searcher's location precisely rather than inferring from prose.
  if (areas.length > 0) {
    businessNode.areaServed = areas.map((area) => {
      const node: Record<string, unknown> = { "@type": "City", name: area.name };
      if (area.zips.length > 0) node.identifier = area.zips;
      return node;
    });
  }

  if (services.length > 0) {
    businessNode.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: `${business.name} services`,
      itemListElement: services.map((service) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: service.name,
          ...(service.description ? { description: service.description } : {}),
          ...(service.category ? { category: service.category } : {}),
          provider: { "@id": businessId },
        },
      })),
    };
  }

  // Modeling judgment: schema.org has no dedicated property for "equipment
  // brands we service". knowsAbout is the closest honest fit — it expresses
  // subject-matter competence rather than ownership of the brand.
  if (brands.length > 0) {
    businessNode.knowsAbout = brands.map((brand) => brand.name);
  }

  // Also a judgment call: hasCredential is defined for
  // EducationalOccupationalCredential, which is an imperfect fit for a trade
  // license but the nearest standard property available.
  if (credentials.length > 0) {
    businessNode.hasCredential = credentials.map((credential) => ({
      "@type": "EducationalOccupationalCredential",
      name: credential.title,
      ...(credential.identifier ? { identifier: credential.identifier } : {}),
      ...(credential.issuer ? { recognizedBy: { "@type": "Organization", name: credential.issuer } } : {}),
    }));
  }

  nodes.push(businessNode);
  included.push(options.schemaType);

  // --- FAQs ----------------------------------------------------------------
  // Question-and-answer is the format an answer engine cites most directly,
  // and it's usually the piece a site has as content but not as markup.
  if (faqs.length > 0) {
    nodes.push({
      "@type": "FAQPage",
      "@id": `${base}/#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
      about: { "@id": businessId },
    });
    included.push(`FAQPage (${faqs.length} questions)`);
  } else {
    warnings.push(
      "No approved FAQs — the highest-value markup is missing. Question-and-answer is " +
        "what an answer engine quotes most directly."
    );
  }

  return {
    graph: { "@context": "https://schema.org", "@graph": nodes },
    included,
    warnings,
  };
}

/** Wraps the graph in a script tag, ready to paste into a page head. */
export function toScriptTag(graph: Record<string, unknown>): string {
  // </script> inside a JSON string would close the tag early. Escaping the
  // slash keeps the JSON valid while making the sequence inert in HTML.
  const json = JSON.stringify(graph, null, 2).replace(/<\//g, "<\\/");
  return `<script type="application/ld+json">\n${json}\n</script>\n`;
}
