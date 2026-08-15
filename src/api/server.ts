import "dotenv/config";
import express, { type Request, type Response } from "express";
import { buildOpenApiDocument } from "./openapi";
import { rateLimit } from "./ratelimit";
import { ROUTES } from "./routes";
import { createSource, type SourceKind } from "./source/factory";
import { buildJsonLd } from "../jsonld/build";
import type { KnowledgeSource } from "./types";

/**
 * Layer 1 — the read-only public API.
 *
 *   npm run api                        # auto: supabase if configured, else files
 *   npm run api -- --source files
 *   npm run api -- --include-unreviewed
 *
 * Read-only by design. Booking is Layer 4 and has a completely different risk
 * profile; nothing here writes anywhere.
 */

interface Options {
  port: number;
  source: SourceKind;
  tenant: string;
  includeUnreviewed: boolean;
  baseUrl: string;
  /** Domain the JSON-LD describes, used for @id anchors. */
  domain: string;
  schemaType: string;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const source = (get("--source") ?? "auto") as Options["source"];
  const port = Number(get("--port") ?? process.env.PORT ?? 3001);

  return {
    port,
    source,
    tenant: get("--tenant") ?? process.env.TENANT_SLUG ?? "titanz",
    includeUnreviewed: argv.includes("--include-unreviewed"),
    baseUrl: get("--base-url") ?? process.env.API_BASE_URL ?? `http://localhost:${port}`,
    domain: get("--domain") ?? process.env.CATALOG_DOMAIN ?? "example.com",
    schemaType: get("--type") ?? "LocalBusiness",
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const source: KnowledgeSource = createSource(options.source, {
    tenant: options.tenant,
    includeUnreviewed: options.includeUnreviewed,
  });
  const app = express();

  app.set("trust proxy", true);
  app.disable("x-powered-by");

  // Wide-open CORS is correct here: the entire purpose of this API is to be read
  // by crawlers and agents we've never met. Everything it serves is already
  // published content, and it accepts no writes and no credentials.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  });

  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", source: source.kind, tenant: source.tenant });
  });

  /**
   * Live schema.org markup.
   *
   * Served as raw JSON-LD rather than the {data, meta} envelope, because the
   * consumer is a crawler reading schema.org — the envelope would break it.
   *
   * Serving it live matters for delivery: a snippet on the customer's site can
   * fetch this, so the markup follows the knowledge layer instead of being
   * pasted once and going stale the first time hours or services change.
   */
  app.get("/jsonld", async (_req: Request, res: Response) => {
    try {
      const result = await buildJsonLd(source, {
        domain: options.domain,
        schemaType: options.schemaType,
      });
      res.setHeader("Content-Type", "application/ld+json");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(JSON.stringify(result.graph, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(503).json({ error: "source_unavailable", message });
    }
  });

  app.get("/openapi.json", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(buildOpenApiDocument(options.baseUrl, source.tenant));
  });

  for (const route of ROUTES) {
    app.get(route.path, async (_req: Request, res: Response) => {
      try {
        const data = await route.handler(source);

        // An hour of caching. Crawlers re-fetch aggressively and this data
        // changes on a sync cadence, not per request.
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json({
          data,
          meta: {
            tenant: source.tenant,
            // A null single-object response is empty, not a count of one.
            // Reporting 1 here would let the catalog advertise an endpoint
            // that returns nothing.
            count: Array.isArray(data) ? data.length : data ? 1 : 0,
            generatedAt: new Date().toISOString(),
            source: source.kind,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ${route.path} failed: ${message}`);
        res.status(503).json({ error: "source_unavailable", message });
      }
    });
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: "not_found",
      message: "Unknown endpoint. See /openapi.json for what exists.",
    });
  });

  app.listen(options.port, () => {
    console.log(`\nKnowledge API`);
    console.log(`  listening : http://localhost:${options.port}`);
    console.log(`  source    : ${source.kind}`);
    console.log(`  tenant    : ${source.tenant}`);
    console.log(`  spec      : http://localhost:${options.port}/openapi.json`);

    if (options.includeUnreviewed) {
      console.log(`\n  ! --include-unreviewed is on. Unreviewed price ranges are being`);
      console.log(`    served. Local inspection only — never run this way in production.`);
    }
    if (source.kind === "files") {
      console.log(`\n  Serving from the latest export on disk. Authored content (pricing`);
      console.log(`  factors, FAQs) lives only in the database, so those will be empty.`);
    }
    console.log("");
  });
}

main();
