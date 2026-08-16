import type { KnowledgeSource } from "../api/types";
import { validateJsonLd, type SchemaIssue } from "./validate";

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
  /** Vocabulary problems found in the generated graph. */
  issues: SchemaIssue[];
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
    return {
      graph: { "@context": "https://schema.org", "@graph": [] },
      included,
      warnings,
      issues: [],
    };
  }

  // --- the business -------------------------------------------------------
  const businessNode: Record<string, unknown> = {
    // The profile owns this. `options.schemaType` remains only so a caller can
    // preview a different type without editing the client.
    "@type": business.schemaType || options.schemaType,
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

  // A service-area business hides its address on purpose, and it is usually a
  // home. Publishing the street line would leak exactly what the owner chose
  // not to show — so only the region is emitted, which is what makes the
  // business locatable without exposing anyone.
  if (business.businessType === "service_area") {
    delete address.streetAddress;
    businessNode.address = address;
  } else {
    businessNode.address = address;
  }

  if (business.foundedYear) businessNode.foundingDate = String(business.foundedYear);

  // The Google category, stated in the markup. schema.org has no field for it,
  // and additionalType is the accepted place for a classification the vocabulary
  // cannot express — it says "this is a Plumber" in the customer's own words
  // rather than leaving it implied by the @type alone.
  if (business.primaryCategory) businessNode.additionalType = business.primaryCategory;

  // sameAs is how a crawler ties this markup to every other profile of the same
  // business — the corroboration that makes an entity resolvable rather than
  // merely asserted. The GBP link belongs first; it is the strongest of them.
  const sameAs = [
    ...(business.gbpUrl ? [business.gbpUrl] : []),
    ...business.sameAs.filter((url) => url !== business.gbpUrl),
  ];
  if (sameAs.length > 0) businessNode.sameAs = sameAs;

  // --- identity & branding -------------------------------------------------
  if (business.alternateName) businessNode.alternateName = business.alternateName;
  if (business.slogan) businessNode.slogan = business.slogan;
  if (business.logoUrl) businessNode.logo = business.logoUrl;
  if (business.imageUrls.length > 0) businessNode.image = business.imageUrls;

  // --- commerce ------------------------------------------------------------
  if (business.priceRange) businessNode.priceRange = business.priceRange;
  if (business.paymentAccepted.length > 0) {
    // schema.org expects a single string here, comma-separated by convention.
    businessNode.paymentAccepted = business.paymentAccepted.join(", ");
  }
  if (business.currenciesAccepted) businessNode.currenciesAccepted = business.currenciesAccepted;

  // --- reach ---------------------------------------------------------------
  // knowsLanguage, not availableLanguage: the latter belongs on ContactPoint
  // and Service, and putting it on the business is simply wrong markup.
  if (business.languages.length > 0) businessNode.knowsLanguage = business.languages;

  if (business.geo) {
    businessNode.geo = {
      "@type": "GeoCoordinates",
      latitude: business.geo.latitude,
      longitude: business.geo.longitude,
    };
  }
  if (business.hasMap) businessNode.hasMap = business.hasMap;

  // --- scale & trust -------------------------------------------------------
  if (business.numberOfEmployees) {
    businessNode.numberOfEmployees = {
      "@type": "QuantitativeValue",
      value: business.numberOfEmployees,
    };
  }
  if (business.awards.length > 0) businessNode.award = business.awards;
  if (business.memberOf.length > 0) {
    businessNode.memberOf = business.memberOf.map((name) => ({
      "@type": "Organization",
      name,
    }));
  }
  if (business.founder) {
    businessNode.founder = { "@type": "Person", name: business.founder };
  }

  // --- contact -------------------------------------------------------------
  if (business.contactPoints.length > 0) {
    businessNode.contactPoint = business.contactPoints.map((point) => ({
      "@type": "ContactPoint",
      contactType: point.contactType,
      ...(point.phone ? { telephone: point.phone } : {}),
      ...(point.email ? { email: point.email } : {}),
    }));
  }

  // A booking link as a ReserveAction rather than a bare URL, so an agent can
  // tell that following it books work rather than reading a page.
  if (business.bookingUrl) {
    businessNode.potentialAction = {
      "@type": "ReserveAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: business.bookingUrl,
        actionPlatform: [
          "https://schema.org/DesktopWebPlatform",
          "https://schema.org/MobileWebPlatform",
        ],
      },
      result: { "@type": "Reservation", name: "Service appointment" },
    };
  }

  // --- attributes the vocabulary has no field for --------------------------
  if (business.attributes.length > 0) {
    businessNode.additionalProperty = business.attributes.map((attribute) => ({
      "@type": "PropertyValue",
      name: attribute.name,
      value: attribute.value,
    }));
  }

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

  // Dated exceptions. A closure needs both validFrom and validThrough set to
  // the same date — without them the entry reads as a permanent rule, which
  // would say the business is shut for good.
  if (business.specialHours.length > 0) {
    businessNode.specialOpeningHoursSpecification = business.specialHours.map((entry) => ({
      "@type": "OpeningHoursSpecification",
      validFrom: entry.date,
      validThrough: entry.date,
      ...(entry.isClosed
        ? { opens: "00:00", closes: "00:00" }
        : { opens: entry.opens, closes: entry.closes }),
    }));
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
      // The kind — "license", "certification", "insurance" — stated rather than
      // left to be inferred from the title. It is the difference between a
      // state licence and a manufacturer badge, which are not equivalent claims.
      ...(credential.kind ? { credentialCategory: credential.kind } : {}),
      ...(credential.identifier ? { identifier: credential.identifier } : {}),
      ...(credential.issuer ? { recognizedBy: { "@type": "Organization", name: credential.issuer } } : {}),
      // Lapsed credentials never reach this point — the source filters them —
      // so a date here is always in the future. Publishing it is what separates
      // a licence known to be current from one nobody has checked in years,
      // which otherwise read identically.
      ...(credential.validUntil ? { expires: credential.validUntil } : {}),
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

  const graph = { "@context": "https://schema.org", "@graph": nodes };

  // Validate what was actually produced, not what was intended. Every warning
  // above is a judgment about content; these are facts about the vocabulary,
  // and they catch the class of mistake that looks correct in review — a
  // property on the wrong type is silently dropped by crawlers and nothing
  // anywhere reports it.
  const issues = validateJsonLd(graph);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    warnings.push(
      `${errors.length} invalid schema.org propert${errors.length === 1 ? "y" : "ies"} — ` +
        `crawlers will ignore ${errors.length === 1 ? "it" : "them"}:`
    );
    for (const issue of errors) warnings.push(`    ${issue.path} — ${issue.message}`);
  }

  return { graph, included, warnings, issues };
}

/** Wraps the graph in a script tag, ready to paste into a page head. */
export function toScriptTag(graph: Record<string, unknown>): string {
  // </script> inside a JSON string would close the tag early. Escaping the
  // slash keeps the JSON valid while making the sequence inert in HTML.
  const json = JSON.stringify(graph, null, 2).replace(/<\//g, "<\\/");
  return `<script type="application/ld+json">\n${json}\n</script>\n`;
}
