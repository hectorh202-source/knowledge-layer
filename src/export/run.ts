import "dotenv/config";

/**
 * Read-only ServiceTitan export.
 *
 * Dumps raw JSON to data/raw/<timestamp>/ so we can design the schema against
 * what ServiceTitan actually holds, rather than against what we imagine it holds.
 *
 *   npm run export -- --env production --history 12
 *   npm run export -- --only pricebook-services,job-types
 *   npm run export -- --list
 *
 * Nothing here writes to ServiceTitan. Every request is a GET.
 */

interface Cli {
  env?: string;
  only?: string[];
  historyMonths: number;
  delayMs: number;
  pageSize: number;
  includeLarge: boolean;
  list: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Cli {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);

  const only = get("--only");

  return {
    env: get("--env"),
    only: only ? only.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    historyMonths: Number(get("--history") ?? 12),
    delayMs: Number(get("--delay") ?? 500),
    pageSize: Number(get("--page-size") ?? 200),
    includeLarge: !has("--skip-large"),
    list: has("--list"),
    dryRun: has("--dry-run"),
  };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  // The --env flag overrides ST_ENV for this run only. This must happen before
  // the ServiceTitan client is imported, because it resolves its base URLs at
  // module load. That is why the imports below are dynamic.
  if (cli.env) {
    if (cli.env !== "integration" && cli.env !== "production") {
      throw new Error(`--env must be "integration" or "production", got "${cli.env}"`);
    }
    process.env.ST_ENV = cli.env;
  }

  const { buildTargets } = await import("./targets");
  const targets = buildTargets(cli.historyMonths);

  if (cli.list) {
    console.log("\nAvailable export targets:\n");
    for (const t of targets) {
      const flags = [t.large ? "large" : null, t.uncertain ? "unverified" : null]
        .filter(Boolean)
        .join(", ");
      console.log(`  ${t.name}${flags ? `  [${flags}]` : ""}`);
      console.log(`      ${t.why}`);
      if (t.uncertain) console.log(`      ! ${t.uncertain}`);
    }
    console.log("");
    return;
  }

  const selected = targets.filter((t) => {
    if (cli.only) return cli.only.includes(t.name);
    if (t.large && !cli.includeLarge) return false;
    return true;
  });

  if (selected.length === 0) {
    throw new Error("No targets selected. Run with --list to see available names.");
  }

  const { getTenantId, ServiceTitanApiError } = await import("../servicetitan/auth");
  const { fetchAllPages } = await import("../servicetitan/paginate");
  const { createRun, writeRecords, writeManifest } = await import("./output");

  const tenantId = getTenantId();
  const stEnv = process.env.ST_ENV as string;
  const run = createRun();

  console.log(`\nServiceTitan export`);
  console.log(`  environment : ${stEnv}`);
  console.log(`  tenant      : ${tenantId}`);
  console.log(`  targets     : ${selected.length}`);
  console.log(`  throttle    : ${cli.delayMs}ms between pages, ${cli.pageSize} per page`);
  console.log(`  output      : ${run.dir}`);
  if (cli.dryRun) console.log(`  DRY RUN — no requests will be made`);
  console.log("");

  if (stEnv === "production") {
    // 10.1: this shares a tenant with the live phone agent.
    console.log(`  Production. Throttled and read-only, but the live voice agent shares`);
    console.log(`  this tenant's rate limits. Off-hours is the safe window.\n`);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const target of selected) {
    const basePath = `/${target.module}/v2/tenant/${tenantId}`;
    const label = `${target.name}`;

    if (cli.dryRun) {
      console.log(`  ${label}\n      GET ${basePath}${target.path}`);
      results.push({ target: target.name, status: "skipped-dry-run" });
      continue;
    }

    process.stdout.write(`  ${label} ... `);

    try {
      const records = await fetchAllPages(basePath, target.path, target.query ?? {}, {
        pageSize: cli.pageSize,
        delayMs: cli.delayMs,
      });

      const file = writeRecords(run, target.name, records);
      console.log(`${records.length} records`);

      results.push({
        target: target.name,
        status: "ok",
        count: records.length,
        file,
        endpoint: `${basePath}${target.path}`,
        query: target.query ?? null,
      });
    } catch (error) {
      // One bad endpoint should not cost the whole run. Record and continue —
      // the failures are how we learn which paths and params are wrong.
      const status = error instanceof ServiceTitanApiError ? error.status : null;
      const message = error instanceof Error ? error.message : String(error);

      console.log(`FAILED${status ? ` (${status})` : ""} — ${message}`);

      results.push({
        target: target.name,
        status: "failed",
        httpStatus: status,
        error: message,
        endpoint: `${basePath}${target.path}`,
        query: target.query ?? null,
        uncertain: target.uncertain ?? null,
        body: error instanceof ServiceTitanApiError ? error.body : null,
      });
    }
  }

  const manifestPath = writeManifest(run, {
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    environment: stEnv,
    tenantId,
    historyMonths: cli.historyMonths,
    pageSize: cli.pageSize,
    delayMs: cli.delayMs,
    results,
  });

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "failed");

  console.log(`\n  ${ok}/${selected.length} succeeded`);
  if (failed.length > 0) {
    console.log(`\n  Failed targets (endpoint or params likely wrong):`);
    for (const f of failed) {
      console.log(`    - ${f.target}${f.httpStatus ? ` (${f.httpStatus})` : ""}`);
    }
    console.log(`\n  These belong in OPEN-QUESTIONS.md. Details in the manifest.`);
  }
  console.log(`\n  Manifest: ${manifestPath}\n`);
}

main().catch((error) => {
  console.error(`\nExport aborted: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
