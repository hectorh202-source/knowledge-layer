import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import express, { type Request, type Response, type Router } from "express";
import {
  isCurrent,
  itemLabels,
  loadByKind,
  loadCredentials,
  saveByKind,
  type CredentialEntry,
} from "../data/content";
import { loadProfile, loadProfileRaw, saveProfileRaw, validateProfile } from "../data/profile";
import { buildJsonLd } from "../jsonld/build";
import { FileSource } from "../api/source/files";
import { MANUAL_CHECKS, runTier1Audit } from "../audit/tier1";
import {
  CONTENT_KINDS,
  createTenant,
  deleteTenant,
  intakeDir,
  listTenantSlugs,
  readSettings,
  readTier1,
  tenantExists,
  writeSettings,
  writeTier1,
  type ContentKind,
  type TenantSettings,
  type TenantSummary,
} from "../tenancy/store";

/**
 * Admin API.
 *
 * Separate from the public API on purpose. That surface is read-only,
 * crawler-facing and unauthenticated; these routes write. Keeping them in
 * different servers means a misconfigured route can't turn the public endpoint
 * into something that accepts writes.
 */

function isContentKind(value: string): value is ContentKind {
  return (CONTENT_KINDS as string[]).includes(value);
}

function summarize(slug: string): TenantSummary | null {
  const settings = readSettings(slug);
  if (!settings) return null;

  let itemCount = 0;
  let approvedCount = 0;
  let publishedCount = 0;

  for (const kind of CONTENT_KINDS) {
    for (const item of loadByKind(slug, kind)) {
      itemCount++;
      if (item.approved === true) approvedCount++;
      if (item.approved === true && item.published === true) publishedCount++;
    }
  }

  const profile = loadProfile(slug);

  // Tier 1 status, rolled up so the client list can show who is blocked
  // without opening each one — the thing that matters at twenty clients
  // rather than one.
  const tier1 = readTier1(slug);
  const report = tier1.report as { passed?: number; failed?: number } | null;
  const manualDone = MANUAL_CHECKS.filter((check) => tier1.manual[check.id]?.checked).length;

  return {
    ...settings,
    itemCount,
    approvedCount,
    publishedCount,
    hasProfile: profile !== null,
    blockingCount: profile ? validateProfile(profile).blocking.length : 1,
    tier1: {
      ran: report !== null,
      passed: report?.passed ?? 0,
      failed: report?.failed ?? 0,
      manualDone,
      manualTotal: MANUAL_CHECKS.length,
      complete: report !== null && (report.failed ?? 1) === 0 && manualDone === MANUAL_CHECKS.length,
    },
  };
}

/** Runs one of the CLI tools and streams back its output. */
function runScript(
  script: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", script, ...args],
      { cwd: process.cwd(), timeout: 300_000, maxBuffer: 8 * 1024 * 1024, shell: process.platform === "win32" },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          output: `${stdout}${stderr}`.trim() || (error ? String(error) : "no output"),
        });
      }
    );
  });
}

export function createAdminRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // --- clients -------------------------------------------------------------

  router.get("/clients", (_req: Request, res: Response) => {
    const clients = listTenantSlugs()
      .map(summarize)
      .filter((entry): entry is TenantSummary => entry !== null);
    res.json({ clients });
  });

  router.post("/clients", (req: Request, res: Response) => {
    try {
      const { name, domain, slug, schemaType } = req.body ?? {};
      if (!name || typeof name !== "string") throw new Error("A business name is required.");
      if (!domain || typeof domain !== "string") throw new Error("A domain is required.");

      const settings = createTenant({ name, domain, slug, schemaType });
      res.status(201).json({ client: summarize(settings.slug) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/clients/:slug", (req: Request, res: Response) => {
    try {
      deleteTenant(req.params.slug);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- one client ----------------------------------------------------------

  router.use("/clients/:slug", (req: Request, res: Response, next) => {
    if (!tenantExists(req.params.slug)) {
      res.status(404).json({ error: `No client "${req.params.slug}".` });
      return;
    }
    next();
  });

  router.get("/clients/:slug", (req: Request, res: Response) => {
    const slug = req.params.slug;
    const profile = loadProfile(slug);
    const validation = profile
      ? validateProfile(profile)
      : { blocking: ["no business profile"], missing: [] };

    const sections = CONTENT_KINDS.map((kind) => {
      const items = loadByKind(slug, kind).map((item, index) => ({
        index,
        ...itemLabels(kind, item),
        approved: item.approved === true,
        published: item.published === true,
        source: (item.provenance as { source?: string } | undefined)?.source ?? "manual",
        confidence: (item.provenance as { confidence?: string } | undefined)?.confidence ?? "—",
        raw: item,
      }));

      return {
        kind,
        items,
        approved: items.filter((item) => item.approved).length,
        published: items.filter((item) => item.approved && item.published).length,
      };
    });

    // An expired credential is a compliance claim that stopped being true.
    const expired = loadCredentials(slug).filter(
      (credential: CredentialEntry) => credential.approved && !isCurrent(credential)
    ).length;

    res.json({
      settings: readSettings(slug),
      summary: summarize(slug),
      profile: loadProfileRaw(slug),
      validation,
      openDays: profile ? profile.hours.filter((entry) => !entry.isClosed).length : 0,
      sections,
      expiredCredentials: expired,
    });
  });

  router.patch("/clients/:slug/settings", (req: Request, res: Response) => {
    try {
      const current = readSettings(req.params.slug);
      if (!current) throw new Error("Client not found.");

      const next: TenantSettings = {
        ...current,
        name: typeof req.body.name === "string" ? req.body.name : current.name,
        domain:
          typeof req.body.domain === "string"
            ? req.body.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")
            : current.domain,
        schemaType:
          typeof req.body.schemaType === "string" ? req.body.schemaType : current.schemaType,
        apiBaseUrl:
          typeof req.body.apiBaseUrl === "string" ? req.body.apiBaseUrl : current.apiBaseUrl,
        notes: typeof req.body.notes === "string" ? req.body.notes : current.notes,
        // Merged rather than replaced, so a partial save can't blank fields the
        // form didn't send.
        links: { ...current.links, ...(req.body.links ?? {}) },
      };

      writeSettings(next);
      res.json({ settings: next });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/clients/:slug/profile", (req: Request, res: Response) => {
    try {
      const raw = loadProfileRaw(req.params.slug);
      // Merge rather than replace, so the file's header comments survive edits.
      saveProfileRaw(req.params.slug, { ...raw, ...req.body });
      res.json({ profile: loadProfileRaw(req.params.slug) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- content -------------------------------------------------------------

  router.patch("/clients/:slug/content/:kind/:index", (req: Request, res: Response) => {
    try {
      const { slug, kind, index } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const items = loadByKind(slug, kind);
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0 || position >= items.length) {
        throw new Error("No such item.");
      }

      items[position] = { ...items[position], ...req.body };
      saveByKind(slug, kind, items);
      res.json({ item: items[position] });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/clients/:slug/content/:kind", (req: Request, res: Response) => {
    try {
      const { slug, kind } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const items = loadByKind(slug, kind);
      // Typed by hand, so it is approved on arrival but still not published —
      // publication stays a separate, deliberate act.
      items.push({
        ...req.body,
        approved: true,
        published: false,
        provenance: { source: "manual", url: null, method: "entered by hand", confidence: "high" },
      });

      saveByKind(slug, kind, items);
      res.status(201).json({ count: items.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/clients/:slug/content/:kind/:index", (req: Request, res: Response) => {
    try {
      const { slug, kind, index } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const items = loadByKind(slug, kind);
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0 || position >= items.length) {
        throw new Error("No such item.");
      }

      items.splice(position, 1);
      saveByKind(slug, kind, items);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** Bulk approve or publish, for working through a large intake queue. */
  router.post("/clients/:slug/content/:kind/bulk", (req: Request, res: Response) => {
    try {
      const { slug, kind } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const { action } = req.body ?? {};
      const items = loadByKind(slug, kind);

      for (const item of items) {
        if (action === "approve") item.approved = true;
        else if (action === "unapprove") {
          item.approved = false;
          item.published = false;
        } else if (action === "publish") {
          // Publishing something unapproved would serve content nobody checked.
          if (item.approved === true) item.published = true;
        } else if (action === "unpublish") item.published = false;
        else throw new Error(`Unknown action "${action}".`);
      }

      saveByKind(slug, kind, items);
      res.json({ count: items.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- sources -------------------------------------------------------------

  router.post("/clients/:slug/intake/website", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const settings = readSettings(slug);
    if (!settings?.domain) {
      res.status(400).json({ error: "Set a domain in Settings first." });
      return;
    }

    const maxPages = String(Number(req.body?.maxPages ?? 14));
    const result = await runScript("src/intake/run.ts", [
      "--site",
      `https://${settings.domain}`,
      "--max-pages",
      maxPages,
      "--tenant",
      slug,
    ]);
    res.json(result);
  });

  router.post("/clients/:slug/intake/places", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const args = ["--tenant", slug];
    if (typeof req.body?.query === "string" && req.body.query.trim()) {
      args.push("--query", req.body.query.trim());
    }
    const result = await runScript("src/intake/run-places.ts", args);
    res.json(result);
  });

  router.post("/clients/:slug/promote", async (req: Request, res: Response) => {
    const result = await runScript("src/intake/promote.ts", ["--tenant", req.params.slug]);
    res.json(result);
  });

  router.post("/clients/:slug/publish/database", async (req: Request, res: Response) => {
    const args = ["--tenant", req.params.slug];
    if (req.body?.publish === true) args.push("--publish");
    if (req.body?.dryRun === true) args.push("--dry-run");
    const result = await runScript("src/db/load-content.ts", args);
    res.json(result);
  });

  // --- outputs -------------------------------------------------------------

  router.get("/clients/:slug/jsonld", async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      const settings = readSettings(slug)!;
      const source = new FileSource({ tenant: slug, includeUnreviewed: false });

      const result = await buildJsonLd(source, {
        domain: settings.domain || "example.com",
        schemaType: settings.schemaType,
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** Which sources have run, and when. */
  router.get("/clients/:slug/sources", (req: Request, res: Response) => {
    const dir = intakeDir(req.params.slug);
    if (!fs.existsSync(dir)) {
      res.json({ runs: [] });
      return;
    }

    const runs = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const stat = fs.statSync(path.join(dir, file));
        return { file, ranAt: stat.mtime.toISOString(), bytes: stat.size };
      });

    res.json({ runs });
  });

  // --- Tier 1 discoverability ---------------------------------------------

  router.get("/clients/:slug/tier1", (req: Request, res: Response) => {
    const state = readTier1(req.params.slug);
    res.json({ ...state, manualChecks: MANUAL_CHECKS });
  });

  router.post("/clients/:slug/tier1/run", async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      const settings = readSettings(slug);
      if (!settings?.domain) throw new Error("Set a domain in Settings first.");

      const report = await runTier1Audit(settings.domain);
      const state = readTier1(slug);
      writeTier1(slug, { ...state, report });

      res.json({ report });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch("/clients/:slug/tier1/manual/:id", (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      const state = readTier1(slug);

      state.manual[req.params.id] = {
        checked: req.body?.checked === true,
        note: typeof req.body?.note === "string" ? req.body.note : (state.manual[req.params.id]?.note ?? ""),
        updatedAt: new Date().toISOString(),
      };

      writeTier1(slug, state);
      res.json({ manual: state.manual });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- system status -------------------------------------------------------

  router.get("/status", async (_req: Request, res: Response) => {
    const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

    let database: { state: string; detail: string } = {
      state: "not-configured",
      detail: "SUPABASE_URL and SUPABASE_ANON_KEY are not set. Everything runs from local files.",
    };

    if (supabaseConfigured) {
      try {
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tenants?select=slug`, {
          headers: {
            apikey: process.env.SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          },
        });
        database = response.ok
          ? { state: "connected", detail: `Reachable, HTTP ${response.status}.` }
          : {
              state: "error",
              detail: `HTTP ${response.status}. The schema may not have been applied yet.`,
            };
      } catch (error) {
        database = {
          state: "error",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const apiPort = Number(process.env.PORT ?? 3001);
    let api: { state: string; detail: string };
    try {
      const response = await fetch(`http://localhost:${apiPort}/health`);
      api = response.ok
        ? { state: "running", detail: `Responding on port ${apiPort}.` }
        : { state: "error", detail: `HTTP ${response.status} on port ${apiPort}.` };
    } catch {
      api = {
        state: "stopped",
        detail: `Nothing responding on port ${apiPort}. Start it with: npm run api`,
      };
    }

    res.json({
      api,
      database,
      config: {
        supabase: supabaseConfigured,
        serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        googleMaps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      },
      clients: listTenantSlugs().length,
    });
  });

  return router;
}
