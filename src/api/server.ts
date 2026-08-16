import "dotenv/config";
import express, { type Request, type Response } from "express";
import { buildOpenApiDocument } from "./openapi";
import { rateLimit } from "./ratelimit";
import { ROUTES } from "./routes";
import { createSource, type SourceKind } from "./source/factory";
import { buildJsonLd } from "../jsonld/build";
import { buildDashboardData } from "../dashboard/data";
import { renderDashboard } from "../dashboard/page";
import { knownHosts, resolveTenant } from "./tenant";
import { readSettings } from "../tenancy/store";
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
  /**
   * Pin every request to one client, ignoring the hostname.
   *
   * Empty is the normal case: one deployment serving every client, each
   * reached through their own domain. This exists for local work, where
   * "localhost" maps to nobody, and for a deliberately dedicated deployment.
   */
  pinnedTenant: string;
  includeUnreviewed: boolean;
  baseUrl: string;
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
    pinnedTenant: get("--tenant") ?? process.env.TENANT_SLUG ?? "",
    includeUnreviewed: argv.includes("--include-unreviewed"),
    baseUrl: get("--base-url") ?? process.env.API_BASE_URL ?? `http://localhost:${port}`,
  };
}

/** What a request resolved to: the client, and how to describe them. */
interface Resolved {
  slug: string;
  source: KnowledgeSource;
  /** Domain the JSON-LD describes, for @id anchors. */
  domain: string;
  schemaType: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  /**
   * The client for this request.
   *
   * Everything a response needs comes from that client's own settings — the
   * domain the markup anchors to, the schema.org type. Those used to be
   * process-wide flags, which is only coherent when a process serves one
   * client: CATALOG_DOMAIN would have stamped one business's domain onto every
   * other business's markup.
   */
  const resolve = async (req: Request): Promise<Resolved | null> => {
    const slug = options.pinnedTenant || (await resolveTenant(req.headers.host));
    if (!slug) return null;

    const settings = await readSettings(slug);
    if (!settings) return null;

    return {
      slug,
      source: createSource(options.source, {
        tenant: slug,
        includeUnreviewed: options.includeUnreviewed,
      }),
      domain: settings.domain || "example.com",
      schemaType: settings.schemaType || "LocalBusiness",
    };
  };

  const unknownHost = (req: Request, res: Response): void => {
    res.status(404).json({
      error: "unknown_host",
      message:
        `No client is configured for "${req.headers.host ?? ""}". A client's API domain is ` +
        `set on their settings, or follows api.<their domain>.`,
    });
  };

  if (options.includeUnreviewed && process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to start: --include-unreviewed with NODE_ENV=production.\n\n" +
        "  That serves content nobody has approved as though the business said it."
    );
  }

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

  // Deliberately answers without resolving a client. A health check that 404s
  // on an unrecognised host reports the whole service down when one CNAME is
  // wrong, and load balancers hit it by IP.
  app.get("/health", async (req: Request, res: Response) => {
    const resolved = await resolve(req).catch(() => null);
    res.json({
      status: "ok",
      mode: options.pinnedTenant ? "single-tenant" : "multi-tenant",
      tenant: resolved?.slug ?? null,
      source: resolved?.source.kind ?? options.source,
    });
  });

  /**
   * Review dashboard.
   *
   * Reads the content files directly rather than going through the source, so
   * it can show what is NOT approved — which is the entire point. The public
   * API cannot show that, and must not.
   *
   * Disabled in production for the same reason: it would expose unapproved
   * content, and there is no authentication on this service.
   */
  app.get("/dashboard", async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const resolved = await resolve(req);
    if (!resolved) return unknownHost(req, res);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(renderDashboard(await buildDashboardData(resolved.slug)));
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
  app.get("/jsonld", async (req: Request, res: Response) => {
    try {
      const resolved = await resolve(req);
      if (!resolved) return unknownHost(req, res);

      const result = await buildJsonLd(resolved.source, {
        domain: resolved.domain,
        schemaType: resolved.schemaType,
      });
      res.setHeader("Content-Type", "application/ld+json");
      res.setHeader("Cache-Control", "public, max-age=3600");
      // Two clients share this deployment and differ only by Host, so a shared
      // cache keyed on the URL alone would hand one business's markup to
      // another's visitors.
      res.setHeader("Vary", "Host");
      res.send(JSON.stringify(result.graph, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(503).json({ error: "source_unavailable", message });
    }
  });

  app.get("/openapi.json", async (req: Request, res: Response) => {
    const resolved = await resolve(req);
    if (!resolved) return unknownHost(req, res);

    // The advertised server is this request's own origin, not a configured
    // one. A spec reached at api.acme.com that tells a crawler to call
    // somewhere else sends it to the wrong business.
    const baseUrl = options.pinnedTenant
      ? options.baseUrl
      : `${req.protocol}://${req.headers.host}`;

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Vary", "Host");
    res.json(buildOpenApiDocument(baseUrl, resolved.slug, ROUTES));
  });

  for (const route of ROUTES) {
    app.get(route.path, async (req: Request, res: Response) => {
      try {
        const resolved = await resolve(req);
        if (!resolved) return unknownHost(req, res);

        const data = await route.handler(resolved.source);

        // An hour of caching. Crawlers re-fetch aggressively and this data
        // changes on a sync cadence, not per request.
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.setHeader("Vary", "Host");
        res.json({
          data,
          meta: {
            tenant: resolved.slug,
            // A null single-object response is empty, not a count of one.
            // Reporting 1 here would let the catalog advertise an endpoint
            // that returns nothing.
            count: Array.isArray(data) ? data.length : data ? 1 : 0,
            generatedAt: new Date().toISOString(),
            source: resolved.source.kind,
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

  const hosts = options.pinnedTenant ? [] : await knownHosts();

  app.listen(options.port, () => {
    console.log(`\nKnowledge API`);
    console.log(`  listening : http://localhost:${options.port}`);
    console.log(`  source    : ${options.source}`);

    if (options.pinnedTenant) {
      console.log(`  tenant    : ${options.pinnedTenant}  (pinned — hostname ignored)`);
    } else if (hosts.length === 0) {
      console.log(`  tenant    : resolved per request from the Host header`);
      console.log(`\n  ! No client has an API hostname yet, so every request will 404.`);
      console.log(`    Set "API base URL" on a client, or point api.<their domain> here.`);
      console.log(`    For local work, run with --tenant <slug> to pin one client.`);
    } else {
      console.log(`  tenant    : resolved per request from the Host header`);
      for (const { host, slug } of hosts) console.log(`              ${host} → ${slug}`);
    }

    console.log(`  dashboard : http://localhost:${options.port}/dashboard`);
    console.log(`  spec      : http://localhost:${options.port}/openapi.json`);

    if (options.includeUnreviewed) {
      console.log(`\n  ! --include-unreviewed is on, so unapproved content is being served.`);
      console.log(`    Local inspection only — never run this way in production.`);
    }
    console.log("");
  });
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
