import { execFile } from "child_process";
import * as path from "path";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
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
import { verifyMarkup } from "../audit/verify-markup";
import { auditNap } from "../audit/nap";
import { auditDirectories } from "../audit/directory-presence";
import { buildReport } from "../report/build";
import { renderReport } from "../report/render";
import {
  agenciesEnabled,
  claim,
  mayAccess,
  release,
  createAgency,
  invite,
  isPlatformAdmin,
  listAgencies,
  listMembers,
  ownerCount,
  removeMember,
  sendInviteEmail,
  slugsFor,
  type Agency,
} from "../tenancy/agency";
import {
  CONTENT_KINDS,
  createTenant,
  deleteTenant,
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
import { storage } from "../tenancy/storage";

/**
 * Admin API.
 *
 * Separate from the public API on purpose. That surface is read-only,
 * crawler-facing and unauthenticated; these routes write. Keeping them in
 * different servers means a misconfigured route can't turn the public endpoint
 * into something that accepts writes.
 */

/** A request that has been through the auth and agency middleware. */
export interface AgencyRequest extends Request {
  agency?: Agency | null;
}

function isContentKind(value: string): value is ContentKind {
  return (CONTENT_KINDS as string[]).includes(value);
}

async function summarize(slug: string): Promise<TenantSummary | null> {
  const settings = await readSettings(slug);
  if (!settings) return null;

  let itemCount = 0;
  let approvedCount = 0;
  let publishedCount = 0;

  for (const kind of CONTENT_KINDS) {
    for (const item of await loadByKind(slug, kind)) {
      itemCount++;
      if (item.approved === true) approvedCount++;
      if (item.approved === true && item.published === true) publishedCount++;
    }
  }

  const profile = await loadProfile(slug);

  // Tier 1 status, rolled up so the client list can show who is blocked
  // without opening each one — the thing that matters at twenty clients
  // rather than one.
  const tier1 = await readTier1(slug);
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

/**
 * Candidates sitting in intake files that aren't in the content files yet.
 *
 * Crawling writes candidates; promoting moves them into the sections. Without
 * this count the two steps look identical from the outside — a crawl that
 * found 33 services leaves every section reading zero, and nothing on screen
 * says why.
 */
async function countPendingIntake(
  slug: string
): Promise<Record<string, number> & { total: number }> {
  const pending: Record<string, number> & { total: number } = { total: 0 };
  const runs = await storage().listIntake(slug);
  if (runs.length === 0) return pending;

  const key = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

  const existing: Record<string, Set<string>> = {
    services: new Set(
      (await loadByKind(slug, "services")).map((item) => key(String(item.name ?? "")))
    ),
    "service-areas": new Set(
      (await loadByKind(slug, "service-areas")).map((item) => key(String(item.name ?? "")))
    ),
    brands: new Set((await loadByKind(slug, "brands")).map((item) => key(String(item.name ?? "")))),
    faqs: new Set(
      (await loadByKind(slug, "faqs")).map((item) => key(String(item.question ?? "")))
    ),
    credentials: new Set(
      (await loadByKind(slug, "credentials")).map((item) =>
        key(String(item.identifier ?? item.title ?? ""))
      )
    ),
  };

  // Deduped across sources, so two intake runs finding the same service count
  // once — the same thing promote would write.
  const fresh: Record<string, Set<string>> = {
    services: new Set(),
    "service-areas": new Set(),
    brands: new Set(),
    faqs: new Set(),
    credentials: new Set(),
  };

  for (const { result } of runs) {
    const collect = (items: unknown, kind: string, field: string) => {
      if (!Array.isArray(items)) return;
      for (const raw of items) {
        const value = key(String((raw as Record<string, unknown>)?.[field] ?? ""));
        if (value && !existing[kind].has(value)) fresh[kind].add(value);
      }
    };

    collect(result.services, "services", "name");
    collect(result.areas, "service-areas", "name");
    collect(result.brands, "brands", "name");
    collect(result.faqs, "faqs", "question");
    collect(result.credentials, "credentials", "title");
  }

  for (const [kind, set] of Object.entries(fresh)) {
    pending[kind] = set.size;
    pending.total += set.size;
  }

  return pending;
}

/**
 * tsx's CLI entry, resolved rather than assumed.
 *
 * `require.resolve("tsx")` would give the library export, not the executable,
 * and the `.bin/tsx` shim is a shell script — the one thing this must avoid.
 */
const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

/** Runs one of the CLI tools and streams back its output. */
function runScript(
  script: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // No shell, ever.
    //
    // This used to run `npx.cmd` with `shell: true` on Windows, which pastes
    // the arguments into one command string with no quoting. A business named
    // "Junk Chucker - Junk Removal & Hauling" therefore searched for "Junk",
    // and cmd.exe tried to run "Hauling" as a separate command — the `&`
    // terminated the first one. Anything a person can type into the portal
    // reaches this function, so `&`, `|`, `>` and friends were live command
    // injection into our own shell, not merely a mangled search.
    //
    // Running node against tsx's CLI entry directly skips the shell and the
    // .cmd shim together, so arguments are passed as an array the whole way
    // down and never re-parsed.
    execFile(
      process.execPath,
      [TSX_CLI, script, ...args],
      { cwd: process.cwd(), timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
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

  /**
   * Every route carrying a :slug is checked against the caller's agency.
   *
   * Filtering the client list is cosmetic. This is the part that matters —
   * without it, another agency's client is one guessed URL away, and the slugs
   * are derived from business names so they are eminently guessable.
   *
   * A slug that exists but belongs to someone else returns 404 rather than 403:
   * telling a stranger that a client exists but is not theirs is telling them
   * something about a business they have no relationship with.
   */
  router.use("/clients/:slug", (req: AgencyRequest, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        if (!agenciesEnabled()) return next();
        const allowed = await mayAccess(req.agency?.id ?? null, req.params.slug);
        if (!allowed) {
          res.status(404).json({ error: "not_found" });
          return;
        }
        next();
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  // --- platform -------------------------------------------------------------

  /**
   * Platform administration sits outside the agency model, so it is guarded
   * separately. Being an agency owner grants nothing here.
   */
  const platformOnly = (req: AgencyRequest & { user?: { email?: string } }, res: Response): boolean => {
    if (isPlatformAdmin(req.user?.email)) return true;
    // 404 rather than 403: a non-admin has no business learning that a platform
    // tier exists.
    res.status(404).json({ error: "not_found" });
    return false;
  };

  router.get("/platform/agencies", (req: AgencyRequest & { user?: { email?: string } }, res: Response) => {
    void (async () => {
      if (!platformOnly(req, res)) return;
      try {
        res.json({ agencies: await listAgencies() });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  router.post("/platform/agencies", (req: AgencyRequest & { user?: { email?: string } }, res: Response) => {
    void (async () => {
      if (!platformOnly(req, res)) return;
      try {
        const ownerEmail = String(req.body?.ownerEmail ?? "");
        // createAgency has already written the owner's invite row — that is
        // what actually places them. This only tries to email them about it.
        const agency = await createAgency(String(req.body?.name ?? ""), ownerEmail);
        const emailed = await sendInviteEmail(ownerEmail);

        res.status(201).json({
          agency,
          emailed,
          note: emailed
            ? "Invite email sent. They become the owner the first time they sign in."
            : "Agency created, but no invite email could be sent. Create their account in " +
              "Authentication → Users and they will become the owner on first sign-in.",
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  // --- team ----------------------------------------------------------------

  router.get("/agency/members", (req: AgencyRequest, res: Response) => {
    void (async () => {
      try {
        if (!req.agency) return res.json({ members: [], role: null });
        res.json({ members: await listMembers(req.agency.id), role: req.agency.role });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  router.post("/agency/invites", (req: AgencyRequest & { user?: { id: string } }, res: Response) => {
    void (async () => {
      try {
        if (!req.agency) throw new Error("No agency.");
        // Owner only. A member who can invite can hand your client list to
        // anyone, which is not a decision a member should be able to make.
        if (req.agency.role !== "owner") {
          res.status(403).json({ error: "Only an owner can invite people." });
          return;
        }
        const result = await invite(req.agency.id, req.user?.id ?? "", String(req.body?.email ?? ""));
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  router.delete("/agency/members/:target", (req: AgencyRequest & { user?: { id: string } }, res: Response) => {
    void (async () => {
      try {
        if (!req.agency) throw new Error("No agency.");
        if (req.agency.role !== "owner") {
          res.status(403).json({ error: "Only an owner can remove people." });
          return;
        }

        const target = req.params.target;

        // Removing the last owner leaves an agency nobody can administer, with
        // clients still in it and no route back without database access.
        if (target === req.user?.id && (await ownerCount(req.agency.id)) <= 1) {
          res.status(400).json({ error: "You are the only owner. Make someone else an owner first." });
          return;
        }

        await removeMember(req.agency.id, target);
        res.json({ ok: true });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  // --- clients -------------------------------------------------------------

  router.get("/clients", (req: AgencyRequest, res: Response) => {
    void (async () => {
      try {
        const visible = await slugsFor(req.agency?.id ?? null);
        const summaries = await Promise.all(
          (await listTenantSlugs())
            // Null means agencies are off, so everything is visible — the local
            // single-operator setup this app was until today.
            .filter((slug) => visible === null || visible.includes(slug))
            .map(summarize)
        );
        const clients = summaries.filter((entry): entry is TenantSummary => entry !== null);
        res.json({ clients, agency: req.agency ?? null });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  router.post("/clients", (req: AgencyRequest, res: Response) => {
    void (async () => {
      try {
        const { name, domain, slug, schemaType } = req.body ?? {};
        if (!name || typeof name !== "string") throw new Error("A business name is required.");
        if (!domain || typeof domain !== "string") throw new Error("A domain is required.");

        const settings = await createTenant({ name, domain, slug, schemaType });

        // Claim it before returning. A client created but unclaimed would be
        // invisible to the person who just made it, and claimable by the next
        // agency to guess its slug.
        if (req.agency) {
          try {
            await claim(req.agency.id, settings.slug);
          } catch (error) {
            await deleteTenant(settings.slug);
            throw new Error(
              `Created the client but could not assign it to your agency, so it was removed. ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        res.status(201).json({ client: await summarize(settings.slug) });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  router.delete("/clients/:slug", (req: Request, res: Response) => {
    void (async () => {
      try {
        await deleteTenant(req.params.slug);
        // Release after the files are gone. Releasing first would leave an
        // orphan folder that no agency owns and nobody can see.
        await release(req.params.slug);
        res.json({ ok: true });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  // --- one client ----------------------------------------------------------

  router.use("/clients/:slug", (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      if (!(await tenantExists(req.params.slug))) {
        res.status(404).json({ error: `No client "${req.params.slug}".` });
        return;
      }
      next();
    })();
  });

  router.get("/clients/:slug", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const profile = await loadProfile(slug);
    const validation = profile
      ? validateProfile(profile)
      : { blocking: ["no business profile"], missing: [] };

    const sections = await Promise.all(CONTENT_KINDS.map(async (kind) => {
      const items = (await loadByKind(slug, kind)).map((item, index) => ({
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
    }));

    // An expired credential is a compliance claim that stopped being true.
    const expired = (await loadCredentials(slug)).filter(
      (credential: CredentialEntry) => credential.approved && !isCurrent(credential)
    ).length;

    res.json({
      settings: await readSettings(slug),
      summary: await summarize(slug),
      profile: await loadProfileRaw(slug),
      validation,
      openDays: profile ? profile.hours.filter((entry) => !entry.isClosed).length : 0,
      sections,
      expiredCredentials: expired,
      pendingIntake: await countPendingIntake(slug),
      // Included up front rather than behind a button. The audit is pure file
      // reads with no network call, so there is no cost to it, and which
      // directories get checked should not be something you have to click to
      // discover.
      directories: await auditDirectories(slug),
    });
  });

  router.patch("/clients/:slug/settings", async (req: Request, res: Response) => {
    try {
      const current = await readSettings(req.params.slug);
      if (!current) throw new Error("Client not found.");

      // name, domain and schemaType are deliberately not settable here. They
      // belong to the business profile, and accepting them would let a stale
      // Settings page write an old name back over a fresh profile edit —
      // reintroducing the drift this endpoint used to cause. The values on
      // `current` are read straight from the profile, so they round-trip
      // unchanged.
      const next: TenantSettings = {
        ...current,
        apiBaseUrl:
          typeof req.body.apiBaseUrl === "string" ? req.body.apiBaseUrl : current.apiBaseUrl,
        notes: typeof req.body.notes === "string" ? req.body.notes : current.notes,
        // Merged rather than replaced, so a partial save can't blank fields the
        // form didn't send.
        links: { ...current.links, ...(req.body.links ?? {}) },
        sources: { ...current.sources, ...(req.body.sources ?? {}) },
      };

      await writeSettings(next);
      res.json({ settings: next });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/clients/:slug/profile", async (req: Request, res: Response) => {
    try {
      const raw = await loadProfileRaw(req.params.slug);
      // Merge rather than replace, so anything the form didn't send survives.
      await saveProfileRaw(req.params.slug, { ...raw, ...req.body });
      res.json({ profile: await loadProfileRaw(req.params.slug) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- content -------------------------------------------------------------

  router.patch("/clients/:slug/content/:kind/:index", async (req: Request, res: Response) => {
    try {
      const { slug, kind, index } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const items = await loadByKind(slug, kind);
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0 || position >= items.length) {
        throw new Error("No such item.");
      }

      items[position] = { ...items[position], ...req.body };
      await saveByKind(slug, kind, items);
      res.json({ item: items[position] });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/clients/:slug/content/:kind", async (req: Request, res: Response) => {
    try {
      const { slug, kind } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const items = await loadByKind(slug, kind);
      // Typed by hand, so it is approved on arrival but still not published —
      // publication stays a separate, deliberate act.
      items.push({
        ...req.body,
        approved: true,
        published: false,
        provenance: { source: "manual", url: null, method: "entered by hand", confidence: "high" },
      });

      await saveByKind(slug, kind, items);
      res.status(201).json({ count: items.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/clients/:slug/content/:kind/:index", async (req: Request, res: Response) => {
    try {
      const { slug, kind, index } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const items = await loadByKind(slug, kind);
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0 || position >= items.length) {
        throw new Error("No such item.");
      }

      items.splice(position, 1);
      await saveByKind(slug, kind, items);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** Bulk approve or publish, for working through a large intake queue. */
  router.post("/clients/:slug/content/:kind/bulk", async (req: Request, res: Response) => {
    try {
      const { slug, kind } = req.params;
      if (!isContentKind(kind)) throw new Error(`Unknown content kind "${kind}".`);

      const { action } = req.body ?? {};
      const items = await loadByKind(slug, kind);

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

      await saveByKind(slug, kind, items);
      res.json({ count: items.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // --- sources -------------------------------------------------------------

  router.post("/clients/:slug/intake/website", async (req: Request, res: Response) => {
    const slug = req.params.slug;
    const settings = await readSettings(slug);
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
    if (typeof req.body?.placeId === "string" && req.body.placeId.trim()) {
      args.push("--place-id", req.body.placeId.trim());
    }
    const result = await runScript("src/intake/run-places.ts", args);
    res.json(result);
  });

  // Rendered HTML rather than JSON: this one is read by a person, printed to
  // PDF and emailed. Served from the admin surface so it stays behind auth —
  // it names gaps in a client's setup and is not for the open web.
  router.get("/clients/:slug/report", async (req: Request, res: Response) => {
    try {
      const report = await buildReport(req.params.slug);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(renderReport(report));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/clients/:slug/directories", async (req: Request, res: Response) => {
    try {
      res.json(await auditDirectories(req.params.slug));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/clients/:slug/nap", async (req: Request, res: Response) => {
    try {
      res.json(await auditNap(req.params.slug));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/clients/:slug/verify-markup", async (req: Request, res: Response) => {
    try {
      res.json(await verifyMarkup(req.params.slug));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/clients/:slug/generate/faqs", async (req: Request, res: Response) => {
    const result = await runScript("src/content/generate-faqs.ts", [
      "--tenant",
      req.params.slug,
      ...(req.body?.dryRun === true ? ["--dry-run"] : []),
    ]);
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
      const settings = (await readSettings(slug))!;
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
  router.get("/clients/:slug/sources", async (req: Request, res: Response) => {
    const runs = (await storage().listIntake(req.params.slug)).map((run) => ({
      file: run.source,
      ranAt: run.ranAt,
      // The candidate count, not the byte size. Bytes were an artefact of
      // reading the file off disk and told nobody anything; "33 services found"
      // is the thing someone is actually looking at this view to learn.
      items:
        (Array.isArray(run.result.services) ? run.result.services.length : 0) +
        (Array.isArray(run.result.areas) ? run.result.areas.length : 0) +
        (Array.isArray(run.result.brands) ? run.result.brands.length : 0) +
        (Array.isArray(run.result.faqs) ? run.result.faqs.length : 0) +
        (Array.isArray(run.result.credentials) ? run.result.credentials.length : 0),
    }));

    res.json({ runs });
  });

  // --- Tier 1 discoverability ---------------------------------------------

  router.get("/clients/:slug/tier1", async (req: Request, res: Response) => {
    const state = await readTier1(req.params.slug);
    res.json({ ...state, manualChecks: MANUAL_CHECKS });
  });

  router.post("/clients/:slug/tier1/run", async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      const settings = await readSettings(slug);
      if (!settings?.domain) throw new Error("Set a domain in Settings first.");

      const report = await runTier1Audit(settings.domain);
      const state = await readTier1(slug);
      await writeTier1(slug, { ...state, report });

      res.json({ report });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch("/clients/:slug/tier1/manual/:id", async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      const state = await readTier1(slug);

      state.manual[req.params.id] = {
        checked: req.body?.checked === true,
        note: typeof req.body?.note === "string" ? req.body.note : (state.manual[req.params.id]?.note ?? ""),
        updatedAt: new Date().toISOString(),
      };

      await writeTier1(slug, state);
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
      clients: (await listTenantSlugs()).length,
    });
  });

  return router;
}
