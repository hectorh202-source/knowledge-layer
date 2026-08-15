import type { RouteDefinition } from "./routes";

/**
 * Generates the OpenAPI document from the route registry.
 *
 * Never hand-write this. A spec that drifts from the code is worse than no spec
 * here, because the consumers are machines with no human present to notice the
 * mismatch. The ARD catalog points at this document, so if it lies, an agent
 * calls an endpoint that doesn't behave as advertised.
 */
export function buildOpenApiDocument(
  baseUrl: string,
  tenantName: string,
  routes: RouteDefinition[]
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const route of routes) {
    const dataSchema = route.collection
      ? { type: "array", items: route.itemSchema }
      : route.itemSchema;

    paths[route.path] = {
      get: {
        summary: route.summary,
        description: route.description,
        operationId: route.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "meta"],
                  properties: {
                    data: dataSchema,
                    meta: { $ref: "#/components/schemas/Meta" },
                  },
                },
              },
            },
          },
          "429": { description: "Rate limited" },
          "503": { description: "Data source unavailable" },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${tenantName} Knowledge API`,
      version: "1.0.0",
      description:
        "Structured, machine-readable facts about this business — services, areas served, " +
        "reviewed price ranges, and answers to common questions. Read-only.",
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      schemas: {
        Meta: {
          type: "object",
          required: ["tenant", "count", "generatedAt"],
          properties: {
            tenant: { type: "string" },
            count: { type: "integer" },
            generatedAt: { type: "string", format: "date-time" },
            source: {
              type: "string",
              enum: ["supabase", "files"],
              description: "Which backing store served this response.",
            },
          },
        },
      },
    },
  };
}
