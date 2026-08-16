import type { KnowledgeSource } from "./types";

/**
 * The route registry — single source of truth for the API.
 *
 * Both the Express router and /openapi.json are generated from this table, so
 * a documented spec can't drift from the code. The consumers are machines with
 * no human present to notice a mismatch, and the ARD catalog points at that
 * spec — if it lies, an agent calls an endpoint that doesn't behave as
 * advertised.
 *
 * Adding a route means adding one entry here. Forgetting to document it is
 * not possible.
 */

export interface RouteDefinition {
  path: string;
  summary: string;
  description: string;
  /** JSON Schema for one item in `data`. */
  itemSchema: Record<string, unknown>;
  collection: boolean;
  handler: (source: KnowledgeSource) => Promise<unknown>;
}


const ADDRESS_SCHEMA = {
  type: "object",
  properties: {
    street: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    region: { type: ["string", "null"], description: "State or province" },
    postalCode: { type: ["string", "null"] },
    country: { type: "string" },
  },
};

const HOURS_SCHEMA = {
  type: "object",
  required: ["day", "isClosed"],
  properties: {
    day: { type: "integer", minimum: 0, maximum: 6, description: "0 = Sunday" },
    opens: { type: ["string", "null"], description: "24-hour local time" },
    closes: { type: ["string", "null"] },
    isClosed: { type: "boolean" },
  },
};

const BUSINESS_SCHEMA = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    legalName: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    phone: {
      type: ["string", "null"],
      description: "Canonical number, consistent with every directory listing",
    },
    email: { type: ["string", "null"] },
    domain: { type: ["string", "null"] },
    address: ADDRESS_SCHEMA,
    gbpUrl: { type: ["string", "null"], description: "Google Business Profile" },
    foundedYear: { type: ["integer", "null"] },
    hours: { type: "array", items: HOURS_SCHEMA },
    primaryCategory: {
      type: ["string", "null"],
      description: "Google's primary category, verbatim",
    },
    businessType: {
      type: "string",
      enum: ["storefront", "service_area", "hybrid"],
      description: "Service-area businesses publish no street address",
    },
    sameAs: {
      type: "array",
      items: { type: "string" },
      description: "Other profiles for the same business, for corroboration",
    },
    alternateName: { type: ["string", "null"], description: "Trading name or DBA" },
    slogan: { type: ["string", "null"] },
    logoUrl: { type: ["string", "null"] },
    imageUrls: { type: "array", items: { type: "string" } },
    priceRange: { type: ["string", "null"], description: "$ to $$$$" },
    paymentAccepted: { type: "array", items: { type: "string" } },
    currenciesAccepted: { type: ["string", "null"], description: "ISO 4217" },
    languages: { type: "array", items: { type: "string" } },
    geo: {
      type: ["object", "null"],
      properties: { latitude: { type: "number" }, longitude: { type: "number" } },
    },
    hasMap: { type: ["string", "null"] },
    numberOfEmployees: { type: ["integer", "null"] },
    awards: { type: "array", items: { type: "string" } },
    memberOf: { type: "array", items: { type: "string" }, description: "Trade associations" },
    founder: { type: ["string", "null"] },
    contactPoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          contactType: { type: "string" },
          phone: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
        },
      },
    },
    bookingUrl: { type: ["string", "null"] },
    specialHours: {
      type: "array",
      description: "Dated exceptions to the weekly hours",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          isClosed: { type: "boolean" },
          opens: { type: ["string", "null"] },
          closes: { type: ["string", "null"] },
        },
      },
    },
    attributes: {
      type: "array",
      description: "Attributes with no schema.org property of their own",
      items: {
        type: "object",
        properties: { name: { type: "string" }, value: { type: "string" } },
      },
    },
    serviceCount: { type: "integer" },
    serviceAreaCount: { type: "integer" },
  },
};

const SERVICE_SCHEMA = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    category: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
  },
};

const SERVICE_AREA_SCHEMA = {
  type: "object",
  required: ["name", "zips", "cities"],
  properties: {
    name: { type: "string" },
    zips: {
      type: "array",
      items: { type: "string" },
      description: "Real postal codes served, so a location can be matched exactly",
    },
    cities: { type: "array", items: { type: "string" } },
  },
};

const BRAND_SCHEMA = {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string" } },
};

const FAQ_SCHEMA = {
  type: "object",
  required: ["question", "answer"],
  properties: {
    question: { type: "string" },
    answer: { type: "string" },
    service: { type: ["string", "null"] },
  },
};

const CREDENTIAL_SCHEMA = {
  type: "object",
  required: ["kind", "title"],
  properties: {
    kind: {
      type: "string",
      enum: ["license", "insurance", "certification", "bond", "membership", "award"],
    },
    title: { type: "string" },
    identifier: { type: ["string", "null"] },
    issuer: { type: ["string", "null"] },
  },
};

export const ROUTES: RouteDefinition[] = [
  {
    path: "/v1/business",
    summary: "Business identity",
    description:
      "Who this business is: name, contact details, address, hours, and service posture. " +
      "The record an answer engine needs to resolve the business as a distinct entity.",
    itemSchema: BUSINESS_SCHEMA,
    collection: false,
    handler: (source) => source.business(),
  },
  {
    path: "/v1/services",
    summary: "Services offered",
    description: "Every active service the business provides.",
    itemSchema: SERVICE_SCHEMA,
    collection: true,
    handler: (source) => source.services(),
  },
  {
    path: "/v1/service-areas",
    summary: "Areas served",
    description:
      "Geography served, as postal codes and named municipalities rather than vague phrasing.",
    itemSchema: SERVICE_AREA_SCHEMA,
    collection: true,
    handler: (source) => source.serviceAreas(),
  },
  {
    path: "/v1/brands",
    summary: "Brands serviced",
    description: "Equipment manufacturers this business installs and services.",
    itemSchema: BRAND_SCHEMA,
    collection: true,
    handler: (source) => source.brands(),
  },
  {
    path: "/v1/faqs",
    summary: "Questions and answers",
    description:
      "Approved answers to questions customers actually ask, drawn from real calls.",
    itemSchema: FAQ_SCHEMA,
    collection: true,
    handler: (source) => source.faqs(),
  },
  {
    path: "/v1/credentials",
    summary: "Licenses and certifications",
    description: "Current credentials. Expired entries are never served.",
    itemSchema: CREDENTIAL_SCHEMA,
    collection: true,
    handler: (source) => source.credentials(),
  },
];
