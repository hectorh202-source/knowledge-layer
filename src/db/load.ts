import "dotenv/config";
import * as path from "path";
import { getSupabase, tenantSlug } from "./client";
import { latestRunDir, loadDataset } from "../data/normalize";

/**
 * Loads an export run into Supabase.
 *
 *   npm run load -- --dry-run          # no credentials needed
 *   npm run load
 *   npm run load -- --run data/raw/2026-08-15T17-15-46-810
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 *
 * The loader writes DERIVED tables only — business_units, job_types, services,
 * service_areas, brands. It must never touch business_profile, business_hours,
 * service_content, faqs, policies, or credentials. Those hold human editorial
 * work, and a sync that can erase them would destroy the actual product.
 *
 * Authored content has its own ingestion path: `npm run content:load`.
 *
 * Derived rows that disappear from ServiceTitan are marked is_active = false
 * rather than deleted, so authored content joined to them never orphans.
 */

/** Tables the loader may write. */
const WRITABLE = [
  "tenants",
  "sync_runs",
  "business_units",
  "job_types",
  "services",
  "service_areas",
  "brands",
] as const;

/** Tables the loader must never write. Listed so the intent is executable. */
const FORBIDDEN = [
  "business_profile",
  "business_hours",
  "service_content",
  "faqs",
  "policies",
  "credentials",
] as const;

function assertWritable(table: string): void {
  if ((FORBIDDEN as readonly string[]).includes(table)) {
    throw new Error(
      `Loader attempted to write authored table "${table}". This is a bug — ` +
        `authored content is human-owned and must never be overwritten by a sync.`
    );
  }
  if (!(WRITABLE as readonly string[]).includes(table)) {
    throw new Error(`Loader attempted to write unknown table "${table}".`);
  }
}

interface LoadContext {
  dryRun: boolean;
  tenantId: string;
  syncedAt: string;
  counts: Record<string, number>;
}

/** Upserts on the natural key and returns source_id -> row id. */
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

  const { data, error } = await getSupabase()
    .from(table)
    .upsert(rows, { onConflict: "tenant_id,source,source_id" })
    .select("id, source_id");

  if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`);

  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    bySourceId.set(String(r.source_id), String(r.id));
  }

  return bySourceId;
}

/**
 * Soft-deletes derived rows this run didn't see.
 *
 * Deliberately not a hard delete. A service that vanishes from the price book
 * may still have a published write-up attached, and dropping the row would
 * orphan that work.
 */
async function deactivateMissing(
  ctx: LoadContext,
  table: string,
  seenSourceIds: string[]
): Promise<void> {
  assertWritable(table);
  if (ctx.dryRun) return;

  let query = getSupabase()
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

async function resolveTenant(dryRun: boolean, slug: string): Promise<string> {
  if (dryRun) return "dry-tenant";

  const { data, error } = await getSupabase()
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

  const tenantId = await resolveTenant(dryRun, slug);
  const ctx: LoadContext = { dryRun, tenantId, syncedAt, counts: {} };

  let syncRunId: string | null = null;
  if (!dryRun) {
    const { data, error } = await getSupabase()
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
    syncRunId = String((data as Record<string, unknown>).id);
  }

  const unitIds = await upsertDerived(
    ctx,
    "business_units",
    dataset.businessUnits.map((unit) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: unit.sourceId,
      name: unit.name,
      official_name: unit.officialName,
      is_active: unit.isActive,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "business_units", [...unitIds.keys()]);

  const jobTypeIds = await upsertDerived(
    ctx,
    "job_types",
    dataset.jobTypes.map((type) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: type.sourceId,
      name: type.name,
      is_active: type.isActive,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "job_types", [...jobTypeIds.keys()]);

  const serviceIds = await upsertDerived(
    ctx,
    "services",
    dataset.services.map((service) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: service.sourceId,
      code: service.code,
      display_name: service.name,
      description: service.description,
      category: service.category,
      business_unit_id: service.businessUnitSourceId
        ? (unitIds.get(service.businessUnitSourceId) ?? null)
        : null,
      is_active: service.isActive,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "services", [...serviceIds.keys()]);

  const areaIds = await upsertDerived(
    ctx,
    "service_areas",
    dataset.serviceAreas.map((area) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: area.sourceId,
      name: area.name,
      zips: area.zips,
      cities: area.cities,
      is_active: area.isActive,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "service_areas", [...areaIds.keys()]);

  const brandIds = await upsertDerived(
    ctx,
    "brands",
    dataset.brands.map((brand) => ({
      tenant_id: tenantId,
      source: "servicetitan",
      source_id: brand.sourceId,
      name: brand.name,
      is_active: brand.isActive,
      last_synced_at: syncedAt,
    }))
  );
  await deactivateMissing(ctx, "brands", [...brandIds.keys()]);

  const total = Object.values(ctx.counts).reduce((sum, n) => sum + n, 0);

  if (!dryRun && syncRunId) {
    await getSupabase()
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), records_loaded: total })
      .eq("id", syncRunId);
  }

  for (const [table, count] of Object.entries(ctx.counts)) {
    console.log(`  ${table.padEnd(18)} ${String(count).padStart(5)}`);
  }
  console.log(`  ${"".padEnd(18)} ${"-".repeat(5)}`);
  console.log(`  ${"total".padEnd(18)} ${String(total).padStart(5)}\n`);
  console.log(`  Untouched (human-owned): ${FORBIDDEN.join(", ")}`);
  console.log(`  Authored content loads separately: npm run content:load\n`);

  if (dryRun) console.log(`  Dry run complete. Nothing was written.\n`);
}

main().catch((error) => {
  console.error(`\nLoad failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
