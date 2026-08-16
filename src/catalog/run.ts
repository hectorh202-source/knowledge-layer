import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { buildCatalog } from "./build";
import { DEFAULT_SPEC_VERSION, MEDIA_TYPES } from "./schema";

/**
 * Generates ai-catalog.json.
 *
 *   npm run catalog                                  # verifies against a running API
 *   npm run catalog -- --api-base-url https://api.acme.com
 *   npm run catalog -- --allow-unverified            # emit anyway, for inspection
 *   npm run catalog -- --print
 *
 * The output goes to data/catalog/ai-catalog.json. Publishing it is a separate,
 * deliberate step — the file has to be served from the customer's root domain at
 * /.well-known/ai-catalog.json, which is its own problem (OPEN-QUESTIONS 2.1).
 */

function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  // No defaults. A catalog is a public claim made in a business's name, and a
  // forgotten flag emitting one under whichever customer happened to be the
  // default is the one failure this file must not have.
  const domain = get("--domain") ?? process.env.CATALOG_DOMAIN;
  if (!domain) throw new Error("No domain. Pass --domain <domain>, or set CATALOG_DOMAIN.");

  const displayName = get("--name") ?? process.env.CATALOG_DISPLAY_NAME;
  if (!displayName) throw new Error("No business name. Pass --name, or set CATALOG_DISPLAY_NAME.");
  const apiBaseUrl =
    get("--api-base-url") ?? process.env.API_BASE_URL ?? "http://localhost:3001";

  const options = {
    domain,
    displayName,
    apiBaseUrl,
    specVersion: get("--spec-version") ?? DEFAULT_SPEC_VERSION,
    openapiMediaType: get("--openapi-type") ?? MEDIA_TYPES.openapi,
    allowUnverified: argv.includes("--allow-unverified"),
  };

  console.log(`\nai-catalog.json`);
  console.log(`  host     : ${displayName} (${domain})`);
  console.log(`  api      : ${apiBaseUrl}`);
  console.log(`  verifying endpoints...\n`);

  return buildCatalog(options).then((result) => {
    for (const probe of result.probes) {
      const label = probe.url.replace(apiBaseUrl, "");
      if (probe.ok) {
        console.log(`    ok    ${label}${probe.count !== null ? `  (${probe.count})` : ""}`);
      } else {
        console.log(`    FAIL  ${label}  ${probe.error}`);
      }
    }

    console.log("");

    if (result.excluded.length > 0) {
      console.log(`  Excluded from the catalog:`);
      for (const item of result.excluded) {
        console.log(`    - ${item.what}`);
        console.log(`        ${item.reason}`);
      }
      console.log("");
    }

    for (const warning of result.warnings) {
      console.log(`  ! ${warning}\n`);
    }

    const json = JSON.stringify(result.manifest, null, 2);

    if (argv.includes("--print")) {
      console.log(json + "\n");
    }

    const outDir = path.resolve(process.cwd(), "data", "catalog");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "ai-catalog.json");
    fs.writeFileSync(outFile, json + "\n", "utf8");

    const count = result.manifest.entries.length;
    console.log(`  ${count} ${count === 1 ? "entry" : "entries"} written to ${outFile}`);

    if (count === 0) {
      console.log(`\n  An empty catalog is the correct output here, not a failure. Nothing`);
      console.log(`  is being advertised because nothing verified. Publishing entries that`);
      console.log(`  point at nothing is worse than publishing no catalog.`);
    } else {
      console.log(`\n  NOT ready to publish. This must be served from`);
      console.log(`  https://${domain}/.well-known/ai-catalog.json, and the URLs inside it`);
      console.log(`  must be the deployed API, not localhost.`);
    }
    console.log("");
  });
}

main().catch((error) => {
  console.error(`\nCatalog generation failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
