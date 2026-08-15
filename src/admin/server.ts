import "dotenv/config";
import express, { type Request, type Response } from "express";
import { createAdminRouter } from "./routes";
import { ADMIN_HTML } from "./ui";
import { listTenantSlugs, migrateLegacyContent } from "../tenancy/store";

/**
 * The admin portal.
 *
 *   npm run portal
 *
 * Deliberately a separate server from the public API. That one is read-only,
 * crawler-facing and unauthenticated; this one writes files, edits client data
 * and shells out to the intake tools. Keeping them apart means no
 * misconfiguration can turn the public endpoint into something that accepts
 * writes.
 *
 * Binds to 127.0.0.1 for the same reason: there is no authentication here yet,
 * so it must not be reachable from the network. Adding accounts is what turns
 * this into something that can run anywhere.
 */

const HOST = "127.0.0.1";

function main(): void {
  const argv = process.argv.slice(2);
  const portArg = argv.indexOf("--port");
  const port = Number(portArg !== -1 ? argv[portArg + 1] : (process.env.ADMIN_PORT ?? 3100));

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to start the portal with NODE_ENV=production.\n\n" +
        "  It has no authentication and can edit every client's data."
    );
  }

  const migrated = migrateLegacyContent();

  const app = express();
  app.disable("x-powered-by");

  app.use("/admin/api", createAdminRouter());

  app.get(["/", "/admin"], (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(ADMIN_HTML);
  });

  app.use((_req: Request, res: Response) => res.status(404).json({ error: "not_found" }));

  app.listen(port, HOST, () => {
    console.log(`\nKnowledge Layer — admin portal`);
    console.log(`  http://localhost:${port}`);
    console.log(`  clients : ${listTenantSlugs().length}`);
    if (migrated) {
      console.log(`\n  Migrated the previous single-client content into content/tenants/titanz/.`);
    }
    console.log(`\n  Bound to ${HOST} only — no authentication yet, so it stays off the network.\n`);
  });
}

try {
  main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
