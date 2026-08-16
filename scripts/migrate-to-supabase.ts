import "dotenv/config";
import { CONTENT_KINDS } from "../src/tenancy/store";
import { FileStorage, SupabaseStorage } from "../src/tenancy/storage";

/**
 * Copies every client on disk into Supabase.
 *
 *   npx tsx scripts/migrate-to-supabase.ts --dry-run
 *   npx tsx scripts/migrate-to-supabase.ts
 *   npx tsx scripts/migrate-to-supabase.ts --tenant acme
 *
 * A copy, not a move. Nothing under content/tenants/ is touched or deleted, so
 * the file store stays a working fallback and a bad run costs nothing but a
 * re-run. Every write is an upsert keyed on the slug, so running it twice is
 * the same as running it once.
 *
 * It does NOT overwrite a client that already has data in Supabase unless
 * --force is passed. The likely mistake here is running this after a week of
 * portal edits and silently reverting them to whatever the files last held.
 */

interface Counts {
  settings: number;
  profile: number;
  content: number;
  tier1: number;
  intake: number;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const only = get("--tenant");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env.");
  }

  const files = new FileStorage();
  const db = new SupabaseStorage(url, key);

  const slugs = (await files.listTenants()).filter((slug) => !only || slug === only);

  console.log(`\nCopy clients from disk into Supabase`);
  console.log(`  clients : ${slugs.length ? slugs.join(", ") : "(none on disk)"}`);
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  if (force) console.log(`  FORCE — existing Supabase data will be overwritten`);
  console.log("");

  if (slugs.length === 0) return;

  for (const slug of slugs) {
    const counts: Counts = { settings: 0, profile: 0, content: 0, tier1: 0, intake: 0 };
    console.log(`  ${slug}`);

    // The name has to come from somewhere before the tenant row exists, and the
    // profile is the only place that holds it.
    const profile = await files.readProfile(slug);
    const settings = await files.readSettings(slug);

    if (!profile && !settings) {
      console.log(`    nothing on disk — skipped\n`);
      continue;
    }

    // Settings, not the tenant row. A client that has only ever been through
    // `content:load` already HAS a tenant row and published content rows, and
    // still needs everything the portal writes. Settings are written by the
    // portal and by this script and nothing else, so their presence is the one
    // reliable sign that this client has already been migrated.
    const already = (await db.readSettings(slug)) !== null;
    if (already && !force) {
      console.log(`    already migrated — skipped (pass --force to overwrite)\n`);
      continue;
    }

    if (dryRun) {
      const content = await Promise.all(CONTENT_KINDS.map((kind) => files.readContent(slug, kind)));
      const intake = await files.listIntake(slug);
      const tier1 = await files.readTier1(slug);
      console.log(`    settings   ${settings ? "yes" : "—"}`);
      console.log(`    profile    ${profile ? "yes" : "—"}`);
      console.log(`    content    ${content.reduce((sum, items) => sum + items.length, 0)} item(s)`);
      console.log(`    tier1      ${tier1.report ? "report" : "—"}, ${Object.keys(tier1.manual).length} manual`);
      console.log(`    intake     ${intake.map((run) => run.source).join(", ") || "—"}\n`);
      continue;
    }

    await db.createTenant(slug);

    // Profile first: createTenant seeds a row from the slug, and everything
    // downstream reads the name from the profile rather than the tenant row.
    if (profile) {
      await db.writeProfile(slug, profile);
      counts.profile = 1;
    }

    for (const kind of CONTENT_KINDS) {
      const items = await files.readContent(slug, kind);
      await db.writeContent(slug, kind, items);
      counts.content += items.length;
    }

    const tier1 = await files.readTier1(slug);
    if (tier1.report || Object.keys(tier1.manual).length > 0) {
      await db.writeTier1(slug, tier1);
      counts.tier1 = 1;
    }

    for (const run of await files.listIntake(slug)) {
      await db.writeIntake(slug, run.source, run.result);
      counts.intake++;
    }

    // Settings LAST, because their presence is what marks this client as
    // migrated. Written first, a run that dies partway through leaves a client
    // that looks done and gets skipped on the retry — which is exactly what
    // happened the first time this ran. Every write above is idempotent, so a
    // crashed run is safe to simply repeat.
    if (settings) {
      await db.writeSettings(slug, settings);
      counts.settings = 1;
    }

    console.log(
      `    ${counts.content} content item(s), ` +
        `${counts.intake} intake run(s), ` +
        `profile ${counts.profile ? "yes" : "—"}, ` +
        `settings ${counts.settings ? "yes" : "—"}, ` +
        `tier1 ${counts.tier1 ? "yes" : "—"}\n`
    );
  }

  console.log(
    dryRun
      ? `Dry run complete. Nothing was written.\n`
      : `Done. The files are untouched — set CONTENT_STORE=files to read from them again.\n`
  );
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
