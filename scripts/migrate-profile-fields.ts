import * as fs from "fs";
import * as path from "path";
import { listTenantSlugs, profilePath, tenantDir } from "../src/tenancy/store";

/**
 * Moves name, domain and schemaType out of settings.json into
 * business-profile.json.
 *
 *   npx tsx scripts/migrate-profile-fields.ts --dry-run
 *   npx tsx scripts/migrate-profile-fields.ts
 *
 * They were stored in both files. The profile copy is what publishes; the
 * settings copy drove the nav label and nothing else, so editing it looked like
 * it worked and changed nothing a crawler sees.
 *
 * The profile wins wherever both hold a value, because the profile is what has
 * been reaching the outside world. Where the two disagree the settings value is
 * printed rather than discarded silently — a difference means someone edited
 * the field that does nothing, and they should see what they lost.
 */

const FIELDS = ["name", "domain", "schemaType"] as const;

function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  process.stdout.write(`\nMigrating profile-owned fields out of settings.json\n`);
  if (dryRun) process.stdout.write(`  DRY RUN — nothing will be written\n`);
  process.stdout.write("\n");

  for (const slug of listTenantSlugs()) {
    const settingsFile = path.join(tenantDir(slug), "settings.json");
    if (!fs.existsSync(settingsFile)) continue;

    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
    const profileFile = profilePath(slug);
    const profile: Record<string, unknown> = fs.existsSync(profileFile)
      ? (JSON.parse(fs.readFileSync(profileFile, "utf8")) as Record<string, unknown>)
      : {};

    process.stdout.write(`  ${slug}\n`);

    let changed = false;

    for (const field of FIELDS) {
      const fromSettings = typeof settings[field] === "string" ? (settings[field] as string) : "";
      const fromProfile = typeof profile[field] === "string" ? (profile[field] as string) : "";

      if (!fromSettings && !fromProfile) continue;

      const winner = fromProfile || fromSettings;

      if (fromSettings && fromProfile && fromSettings !== fromProfile) {
        process.stdout.write(`    ${field}: kept profile "${fromProfile}"\n`);
        process.stdout.write(`    ${" ".repeat(field.length)}  settings had "${fromSettings}" — discarded\n`);
      } else if (!fromProfile) {
        process.stdout.write(`    ${field}: moved "${winner}" into the profile\n`);
      } else {
        process.stdout.write(`    ${field}: already "${winner}", removed the settings copy\n`);
      }

      profile[field] = winner;
      if (field in settings) delete settings[field];
      changed = true;
    }

    // schemaType has a default rather than being absent, so a client created
    // before it existed on the profile still needs one.
    if (typeof profile.schemaType !== "string" || !profile.schemaType) {
      profile.schemaType = "LocalBusiness";
      process.stdout.write(`    schemaType: defaulted to LocalBusiness\n`);
      changed = true;
    }

    if (!changed) {
      process.stdout.write(`    nothing to do\n`);
      continue;
    }

    if (!dryRun) {
      fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2) + "\n", "utf8");
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n", "utf8");
    }
  }

  process.stdout.write(dryRun ? `\nDry run complete.\n\n` : `\nDone.\n\n`);
}

main();
