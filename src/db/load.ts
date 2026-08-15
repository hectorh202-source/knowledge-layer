import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getSupabase, tenantSlug } from "./client";
import { latestRunDir, loadDataset } from "../analysis/normalize";
import { buildRevenueReport } from "../analysis/revenue";

/**
 * Loads an export run into Supabase.
 *
 *   npm run load -- --dry-run          # no credentials needed
 *   npm run load
 *   npm run load -- --run data/raw/2026-08-15T17-15-46-810
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 *
 * The loader writes to DERIVED tables only — business_units, job_types,
 * services, service_areas, brands, price_stats. It must never touch
 * service_content, faqs, policies, or credentials. Those hold human editorial
 * work, and a sync that can erase them would destroy the actual product.
 *
 * Derived rows that disappear from ServiceTitan are marked is_active = false
 * rather than deleted, so authored content joined to them never orphans.
 */

/** Tables the loader is permitted to write. Anything else is a bug. */
const WRITABLE = [
  "business_units",
  "job_types",
  "services",
  "service_areas",
  "brands",
  "price_stats",
  "sync_runs",
  "tenants",
] as const;

/** Tables the loader must never write. Listed so the intent is executable. */
const FORBIDDEN = ["service_content", "faqs", "policies", "credentials"] as const;

function assertWritable(table: string): void {
  if ((FORBIDDEN as readonly string[]).includes(table)) {
    throw new Error(
      `Loader attempted to write to authored table "${table}". This is a bug — ` +
        `authored content is human-owned and must never be overwritten by a sync.`
    );
  }
  if (!(WRITABLE as readonly string[]).includes(table)) {
    throw new Error(`Loader attempted to write to unknown table "${table}".`);
  }
}

function readJson(dir: string, name: string): Record<string, unknown>[] {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface LoadContext {
  dryRun: boolean;
  tenantId: string;
  syncRunId: string | null;
  syncedAt: string;
  counts: Record<string, number>;
}

/**
 * Upserts a batch on its natural key and returns source_id -> row id.
 *
 * In dry-run mode nothing is sent; ids are faked so downstream mapping still
 * exercises the same code path.
 */
async function upsertDerived(
  ctx: LoadContext,
  table: string,
  rows: Record<string, unknown>[]
): Promise<Map<string, string>> {
  assertWritable(table);

  const bySourceId = new Map<string, string>();
  ctx.counts[table] = rows.length;

  if (rows.length === 0) return bySourceId;

  if (ctx.dryRun) {
    rows.forEach((row, i) => bySourceId.set(String(row.source_id), `dry-${table}-${i}`));
    return bySourceId;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: "tenant_id,source,source_id" })
    .select("id, source_id");

  if (error) {
    throw new Error(`Upsert into ${table} failed: ${error.message}`);
  }

  for (const row of data ?? []) {
    bySourceId.set(String((row as Record<string, unknown>).source_id), String((row as Record<string, unknown>).id));
  }

  return bySourceId;
}

/**
 * Soft-deletes derived rows this run didn't see.
 *
 * Deliberately not a hard delete. A service that vanishes from the price book
 * may still have a published pricing guide attached to it, and dropping the row
 * would orphan that work.
 */
async function deactivateMissing(
  ctx: LoadContext,
  table: string,
  seenSourceIds: string[]
): Promise<void> {
  assertWritable(table);
  if (ctx.dryRun) return;

  const supabase = getSupabase();
  let query = supabase
    .from(table)
    .update({ is_active: false })
    .eq("tenant_id", ctx.tenantId)
    .eq("source", "servicetitan");

  if (seenSourceIds.length > 0) {
    query = query.not("source_id", "in", `(${seenSourceIds.map((id) => `"${id}"`).join(",")})`);
  }

  const { error } = await query;
  if (error) throw new Error(`Deactivating stale rows in ${table} failed: ${error.message}`);
}

async function resolveTenant(ctx: Omit<LoadContext, "tenantId">, slug: string): Promise<string> {
  if (ctx.dryRun) return "dry-tenant";

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tenants")
    .upsert({ slug, name: slug }, { onConflict: "slug" })
    .select("id")
    .single();

  if (error) throw new Error(`Resolving tenant "${slug}" failed: ${error.message}`);
  return String((data as Record<string, unknown>).id);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const dryRun = argv.includes("--dry-run");
  const runArg = get("--run");
  const dir = runArg ? path.resolve(process.cwd(), runArg) : latestRunDir();
  const slug = get("--tenant") ?? tenantSlug();

  const dataset = loadDataset(dir);
  const report = buildRevenueReport(dataset);
  const syncedAt = new Date().toISOString();

  console.log(`\nLoad export into Supabase`);
  console.log(`  source      : ${path.basename(dir)}`);
  console.log(`  environment : ${dataset.source.environment}${dataset.source.mock ? "  (MOCK DATA)" : ""}`);
  console.log(`  tenant      : ${slug}`);
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  console.log("");

  if (dataset.source.mock && !dryRun) {
    console.log(`  ! Loading mock data into a real database. It will be flagged`);
    console.log(`    is_mock on the sync run. Nothing published should trace to it.\n`);
  }

  const base: Omit<LoadContext, "tenantId"> = {
    dryRun,
    syncRunId: null,
    syncedAt,
    counts: {},
  };
  const tenantId = await resolveTenant(base, slug);
  const ctx: LoadContext = { ...base, tenantId };

  // --- sync run ------------------------------------------------------------
  if (!dryRun) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("sync_runs")
      .insert({
        tenant_id: tenantId,
        export_run: path.basename(dir),
        environment: dataset.source.environment,
        is_mock: dataset.source.mock,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Creating sync run failed: ${error.message}`);
    ctx.syncRunId = String((data as Record<string, unknown>).id);
  }

  // --- business units ------------------------------------------------------
  const rawUnits = readJson(dir, "business-units");
  const unitIds = await upsertDerived(
    ctx,
    "business_units",
    rawUnits.map((row) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: String(row.id),
      name: str(row.name) ?? "Unnamed",
      official_name: str(row.officialName),
      is_active: row.active !== false,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "business_units", [...unitIds.keys()]);

  // --- job types -----------------------------------------------------------
  const jobTypeIds = await upsertDerived(
    ctx,
    "job_types",
    dataset.jobTypes.map((type) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: String(type.id),
      name: type.name,
      is_active: true,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "job_types", [...jobTypeIds.keys()]);

  // --- services ------------------------------------------------------------
  const rawServices = readJson(dir, "pricebook-services");
  const serviceIds = await upsertDerived(
    ctx,
    "services",
    rawServices.map((row) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: String(row.id),
      code: str(row.code),
      display_name: str(row.displayName) ?? "Unnamed service",
      description: str(row.description),
      list_price: num(row.price),
      business_unit_id: unitIds.get(String(row.businessUnitId)) ?? null,
      is_active: row.active !== false,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "services", [...serviceIds.keys()]);

  // --- service areas -------------------------------------------------------
  const rawZones = readJson(dir, "zones");
  const zoneIds = await upsertDerived(
    ctx,
    "service_areas",
    rawZones.map((row) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: String(row.id),
      name: str(row.name) ?? "Unnamed zone",
      zips: Array.isArray(row.zips) ? row.zips : [],
      cities: Array.isArray(row.cities) ? row.cities : [],
      is_active: row.active !== false,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "service_areas", [...zoneIds.keys()]);

  // --- brands --------------------------------------------------------------
  // Distinct manufacturers off the equipment catalog.
  const rawEquipment = readJson(dir, "pricebook-equipment");
  const brandNames = new Map<string, string>();
  for (const row of rawEquipment) {
    const name = str(row.manufacturer);
    if (name && !brandNames.has(name)) brandNames.set(name, String(row.id));
  }
  const brandIds = await upsertDerived(
    ctx,
    "brands",
    [...brandNames.entries()].map(([name, sourceId]) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: sourceId,
      name,
      is_active: true,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "brands", [...brandIds.keys()]);

  // --- price stats ---------------------------------------------------------
  // Append-only. Every run keeps its own row so pricing drift stays visible.
  const statRows = report.byRevenue.flatMap((row) => {
    const jobTypeUuid = jobTypeIds.get(String(row.jobTypeId));
    if (!jobTypeUuid) return [];

    const d = row.distribution;
    return [
      {
        tenant_id: tenantId,
        job_type_id: jobTypeUuid,
        sync_run_id: ctx.syncRunId,
        window_months: 12,
        invoice_count: row.invoiceCount,
        job_count: row.jobCount,
        revenue_total: Number(row.revenue.toFixed(2)),
        revenue_share: Number(row.revenueShare.toFixed(5)),
        amount_min: Number(d.min.toFixed(2)),
        p10: Number(d.p10.toFixed(2)),
        p25: Number(d.p25.toFixed(2)),
        median: Number(d.median.toFixed(2)),
        p75: Number(d.p75.toFixed(2)),
        p90: Number(d.p90.toFixed(2)),
        amount_max: Number(d.max.toFixed(2)),
        mean: Number(d.mean.toFixed(2)),
        publish_low: row.publishRange.low,
        publish_high: row.publishRange.high,
        thin_sample: row.thinSample,
      },
    ];
  });

  assertWritable("price_stats");
  ctx.counts["price_stats"] = statRows.length;
  if (!dryRun && statRows.length > 0) {
    const supabase = getSupabase();
    const { error } = await supabase.from("price_stats").insert(statRows);
    if (error) throw new Error(`Inserting price stats failed: ${error.message}`);
  }

  // --- finish --------------------------------------------------------------
  const total = Object.values(ctx.counts).reduce((sum, n) => sum + n, 0);

  if (!dryRun && ctx.syncRunId) {
    const supabase = getSupabase();
    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), records_loaded: total })
      .eq("id", ctx.syncRunId);
  }

  for (const [table, count] of Object.entries(ctx.counts)) {
    console.log(`  ${table.padEnd(18)} ${String(count).padStart(5)}`);
  }
  console.log(`  ${"".padEnd(18)} ${"-".repeat(5)}`);
  console.log(`  ${"total".padEnd(18)} ${String(total).padStart(5)}\n`);

  console.log(`  Untouched (human-owned): ${FORBIDDEN.join(", ")}\n`);

  if (dryRun) {
    console.log(`  Dry run complete. Nothing was written.\n`);
  }
}

main().catch((error) => {
  console.error(`\nLoad failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
