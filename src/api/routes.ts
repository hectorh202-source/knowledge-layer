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
  /**
   * True when this endpoint's data comes from the CRM rather than from
   * authored content or intake.
   *
   * These disappear entirely when the CRM data is generated, rather than
   * serving fabricated services under a real business's name. Not a flag
   * someone has to remember to set — an endpoint the system cannot honestly
   * back does not exist.
   */
  requiresCrm?: boolean;
}

/** Routes that can be served given whether the CRM data is real. */
export function availableRoutes(crmDataIsMock: boolean): RouteDefinition[] {
  return ROUTES.filter((route) => !(route.requiresCrm && crmDataIsMock));
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
    responseTime: { type: ["string", "null"] },
    emergencyService: { type: "boolean" },
    hours: { type: "array", items: HOURS_SCHEMA },
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
    requiresCrm: true,
  },
  {
    path: "/v1/service-areas",
    summary: "Areas served",
    description:
      "Geography served, as postal codes and named municipalities rather than vague phrasing.",
    itemSchema: SERVICE_AREA_SCHEMA,
    collection: true,
    handler: (source) => source.serviceAreas(),
    requiresCrm: true,
  },
  {
    path: "/v1/brands",
    summary: "Brands serviced",
    description: "Equipment manufacturers this business installs and services.",
    itemSchema: BRAND_SCHEMA,
    collection: true,
    handler: (source) => source.brands(),
    requiresCrm: true,
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
