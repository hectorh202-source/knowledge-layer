import "dotenv/config";
import express, { type Request, type Response } from "express";
import { createAdminRouter } from "./routes";
import { ADMIN_HTML } from "./ui";
import { loginPage } from "./login";
import {
  authConfigured,
  requireAuth,
  setSessionCookie,
  signIn,
  signOut,
  type AuthedRequest,
} from "./auth";
import { listTenantSlugs, migrateLegacyContent } from "../tenancy/store";
import { agenciesEnabled, agencyFor, isPlatformAdmin } from "../tenancy/agency";

/**
 * The admin portal.
 *
 *   npm run portal
 *   npm run portal -- --host 0.0.0.0     (only with auth configured)
 *
 * Deliberately a separate server from the public API. That one is read-only,
 * crawler-facing and unauthenticated; this one writes files, edits client data
 * and shells out to the intake tools. Keeping them apart means no
 * misconfiguration can turn the public endpoint into something that accepts
 * writes.
 *
 * Every route except the login page and the health check is behind Supabase
 * Auth. Accounts are created in the Supabase dashboard; there is no signup here.
 */

function main(): void {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const port = Number(get("--port") ?? process.env.ADMIN_PORT ?? 3100);
  const authed = authConfigured();

  /**
   * Localhost unless someone asks otherwise, and only then with auth.
   *
   * Binding to 0.0.0.0 without authentication would expose a tool that edits
   * every client's data to the network. The flag exists so deploying is a
   * deliberate act rather than a default.
   */
  const requestedHost = get("--host") ?? process.env.ADMIN_HOST;
  if (requestedHost && requestedHost !== "127.0.0.1" && !authed) {
    throw new Error(
      `Refusing to bind to ${requestedHost} without authentication.\n\n` +
        "  Set SUPABASE_URL and SUPABASE_ANON_KEY in .env first. This server edits\n" +
        "  every client's data and shells out to the intake tools."
    );
  }
  const host = requestedHost ?? "127.0.0.1";

  if (process.env.NODE_ENV === "production" && !authed) {
    throw new Error(
      "Refusing to start the portal with NODE_ENV=production and no authentication.\n\n" +
        "  Set SUPABASE_URL and SUPABASE_ANON_KEY in .env."
    );
  }

  const migrated = migrateLegacyContent();

  const app = express();
  app.disable("x-powered-by");
  // Behind a proxy, req.protocol must reflect the original scheme or the
  // session cookie never gets its Secure flag.
  app.set("trust proxy", true);

  // --- public routes -------------------------------------------------------

  app.get("/health", (_req: Request, res: Response) =>
    res.json({ status: "ok", auth: authed ? "supabase" : "disabled" })
  );

  app.get("/login", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(loginPage({ configured: authed }));
  });

  app.post("/login", express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    void (async () => {
      const email = String(req.body?.email ?? "").trim();
      const password = String(req.body?.password ?? "");

      const tokens = email && password ? await signIn(email, password) : null;

      if (!tokens) {
        res.status(401).setHeader("Content-Type", "text/html; charset=utf-8");
        // Deliberately not saying which half was wrong: that tells an attacker
        // which addresses have accounts.
        res.send(loginPage({ configured: authed, error: "Those details were not accepted." }));
        return;
      }

      setSessionCookie(req, res, tokens);
      res.redirect("/");
    })();
  });

  app.post("/logout", (req: Request, res: Response) => {
    void (async () => {
      await signOut(req);
      res.setHeader("Set-Cookie", "kl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      res.redirect("/login");
    })();
  });

  // --- everything below requires a session ---------------------------------

  if (authed) app.use(requireAuth);

  /**
   * Resolve the caller's agency once per request, before any route sees it.
   *
   * Doing it here rather than inside each handler means a route added later
   * cannot forget to, and the slug guard inside the router can rely on it
   * always being present.
   */
  if (authed && agenciesEnabled()) {
    app.use((req: AuthedRequest & { agency?: unknown }, res: Response, next) => {
      void (async () => {
        try {
          req.agency = req.user ? await agencyFor(req.user) : null;
          next();
        } catch (error) {
          res.status(503).json({
            error: "agency_unavailable",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });
  }

  app.use("/admin/api", createAdminRouter());

  app.get("/whoami", (req: AuthedRequest, res: Response) =>
    res.json({
      user: req.user ?? null,
      // Drives whether the Platform section appears at all. The routes behind
      // it are guarded independently — this only decides what is worth showing.
      platformAdmin: isPlatformAdmin(req.user?.email),
    })
  );

  app.get(["/", "/admin"], (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(ADMIN_HTML);
  });

  app.use((_req: Request, res: Response) => res.status(404).json({ error: "not_found" }));

  app.listen(port, host, () => {
    console.log(`\nKnowledge Layer — admin portal`);
    console.log(`  http://localhost:${port}`);
    console.log(`  clients : ${listTenantSlugs().length}`);
    if (migrated) {
      console.log(`\n  Migrated the previous single-client content into content/tenants/titanz/.`);
    }
    console.log(
      authed
        ? `\n  Supabase Auth is on. Sign in at /login — accounts are created in Supabase.\n`
        : `\n  Bound to ${host} only — no authentication configured, so it stays off the network.\n`
    );
  });
}

try {
  main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
