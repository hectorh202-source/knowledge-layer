import type { KnowledgeSource } from "./types";

/**
 * The route registry — single source of truth for the API.
 *
 * Both the Express router and /openapi.json are generated from this table.
 * The build plan called for generating the OpenAPI doc from the routes rather
 * than hand-writing it, "because it'll drift from the code within a month."
 * A hand-written spec that lies about the API is worse than no spec, since the
 * whole point is machines consuming it without a human to notice.
 *
 * Adding a route means adding one entry here. Forgetting to document it is
 * not possible.
 */

export interface RouteDefinition {
  path: string;
  summary: string;
  description: string;
  /** JSON Schema for a single item in the `data` array. */
  itemSchema: Record<string, unknown>;
  /** Whether `data` is an array or a single object. */
  collection: boolean;
  handler: (source: KnowledgeSource) => Promise<unknown>;
}

const SERVICE_SCHEMA = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", description: "Customer-facing service name" },
    category: { type: ["string", "null"], description: "Grouping, e.g. Water Heaters" },
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
      description: "Real postal codes served. Not a marketing phrase.",
    },
    cities: { type: "array", items: { type: "string" } },
  },
};

const PRICING_SCHEMA = {
  type: "object",
  required: ["service", "currency", "low", "high", "unit", "factors"],
  properties: {
    service: { type: "string" },
    currency: { type: "string", enum: ["USD"] },
    low: { type: "number", description: "Low end of the typical range, not the cheapest job ever" },
    high: { type: "number", description: "High end of the typical range, not the worst case" },
    unit: { type: "string", enum: ["job"] },
    factors: {
      type: "array",
      description: "What moves this price up or down. The reason the range is trustworthy.",
      items: {
        type: "object",
        required: ["factor", "effect"],
        properties: {
          factor: { type: "string" },
          effect: { type: "string", enum: ["up", "down", "varies"] },
          detail: { type: "string" },
        },
      },
    },
    included: { type: "array", items: { type: "string" } },
    excluded: { type: "array", items: { type: "string" } },
    reviewedAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "When a human last verified this. Staleness is a public fact.",
    },
  },
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

const BUSINESS_SCHEMA = {
  type: "object",
  required: ["name", "serviceCount", "serviceAreaCount"],
  properties: {
    name: { type: "string" },
    domain: { type: ["string", "null"] },
    serviceCount: { type: "integer" },
    serviceAreaCount: { type: "integer" },
  },
};

export const ROUTES: RouteDefinition[] = [
  {
    path: "/v1/business",
    summary: "Business summary",
    description: "Identity and headline counts for the business.",
    itemSchema: BUSINESS_SCHEMA,
    collection: false,
    handler: (source) => source.business(),
  },
  {
    path: "/v1/services",
    summary: "Services offered",
    description: "Every active service the business sells.",
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
    path: "/v1/pricing",
    summary: "Published price ranges",
    description:
      "Reviewed price ranges with the factors that move them. Only content a human has " +
      "signed off on appears here — unreviewed statistical ranges are never served.",
    itemSchema: PRICING_SCHEMA,
    collection: true,
    handler: (source) => source.pricing(),
  },
  {
    path: "/v1/faqs",
    summary: "Frequently asked questions",
    description: "Approved and published questions, drawn from what customers actually ask.",
    itemSchema: FAQ_SCHEMA,
    collection: true,
    handler: (source) => source.faqs(),
  },
];
