import "dotenv/config";
import { CONTENT_KINDS, FileStorage, SupabaseStorage } from "../src/tenancy/storage";

/**
 * Compares every client on disk against the same client in Supabase.
 *
 *   npx tsx scripts/verify-migration.ts
 *
 * Read-only. A migration that reports success has proved the writes were
 * accepted, not that the data survived the trip — a column that silently
 * dropped a value, a placeholder normalised to null, a content kind written to
 * the wrong table all look identical from the writing end.
 *
 * Differences are not automatically faults. Hours holding "TODO" are dropped on
 * the way in deliberately, and that shows up here as a difference. The point is
 * that every one of them is visible and explainable rather than discovered
 * later by a customer.
 */

interface Row {
  label: string;
  files: string;
  db: string;
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return String(value.length);
  if (typeof value === "string") return value.length > 34 ? value.slice(0, 31) + "..." : value || "—";
  return String(value);
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");

  const files = new FileStorage();
  const db = new SupabaseStorage(url, key);

  let differences = 0;

  for (const slug of await files.listTenants()) {
    console.log(`\n${slug}`);

    const [fileProfile, dbProfile] = await Promise.all([
      files.readProfile(slug),
      db.readProfile(slug),
    ]);
    const [fileSettings, dbSettings] = await Promise.all([
      files.readSettings(slug),
      db.readSettings(slug),
    ]);

    if (!dbProfile && !dbSettings) {
      console.log(`  NOT IN SUPABASE\n`);
      differences++;
      continue;
    }

    const rows: Row[] = [
      { label: "name", files: fmt(fileProfile?.name), db: fmt(dbProfile?.name) },
      { label: "phone", files: fmt(fileProfile?.phone), db: fmt(dbProfile?.phone) },
      { label: "domain", files: fmt(fileProfile?.domain), db: fmt(dbProfile?.domain) },
      { label: "schemaType", files: fmt(fileProfile?.schemaType), db: fmt(dbProfile?.schemaType) },
      { label: "sameAs", files: fmt(fileProfile?.sameAs), db: fmt(dbProfile?.sameAs) },
      { label: "hours", files: fmt(fileProfile?.hours), db: fmt(dbProfile?.hours) },
      {
        label: "placeId",
        files: fmt((fileSettings?.sources as Record<string, unknown>)?.googlePlaceId),
        db: fmt((dbSettings?.sources as Record<string, unknown>)?.googlePlaceId),
      },
      { label: "apiBaseUrl", files: fmt(fileSettings?.apiBaseUrl), db: fmt(dbSettings?.apiBaseUrl) },
    ];

    for (const kind of CONTENT_KINDS) {
      const [a, b] = await Promise.all([files.readContent(slug, kind), db.readContent(slug, kind)]);
      rows.push({ label: kind, files: String(a.length), db: String(b.length) });

      const approvedA = a.filter((item) => item.approved === true).length;
      const approvedB = b.filter((item) => item.approved === true).length;
      if (approvedA !== approvedB) {
        rows.push({ label: `  ${kind} approved`, files: String(approvedA), db: String(approvedB) });
      }
    }

    const [fileTier1, dbTier1] = await Promise.all([files.readTier1(slug), db.readTier1(slug)]);
    rows.push({
      label: "tier1 report",
      files: fileTier1.report ? "yes" : "—",
      db: dbTier1.report ? "yes" : "—",
    });
    rows.push({
      label: "tier1 manual",
      files: String(Object.keys(fileTier1.manual).length),
      db: String(Object.keys(dbTier1.manual).length),
    });

    const [fileIntake, dbIntake] = await Promise.all([files.listIntake(slug), db.listIntake(slug)]);
    rows.push({
      label: "intake runs",
      files: fileIntake.map((run) => run.source).sort().join(",") || "—",
      db: dbIntake.map((run) => run.source).sort().join(",") || "—",
    });

    console.log(`  ${"".padEnd(20)} ${"files".padEnd(36)} supabase`);
    for (const row of rows) {
      const same = row.files === row.db;
      if (!same) differences++;
      console.log(
        `  ${same ? " " : "!"} ${row.label.padEnd(18)} ${row.files.padEnd(36)} ${row.db}`
      );
    }
  }

  console.log(
    differences === 0
      ? `\nEverything matches.\n`
      : `\n${differences} difference(s), marked with !. Check each one before trusting the migration.\n`
  );
}

main().catch((error) => {
  console.error(`\nVerification failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
