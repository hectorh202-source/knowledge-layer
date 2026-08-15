import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { crawlSite } from "./crawl";
import type { Candidate, IntakeResult } from "./types";
import { intakeDir, readSettings } from "../tenancy/store";

/**
 * Website intake.
 *
 *   npm run intake -- --site https://titanzplumbing.com
 *   npm run intake -- --site https://example.com --max-pages 15
 *
 * Writes candidates to content/intake/<domain>/website.json. Nothing is
 * approved and nothing is published — a human promotes candidates into the
 * business profile and the authored tables.
 */

/**
 * Picks the value seen most often, breaking ties by confidence.
 *
 * Agreement across pages is the strongest signal available without a human:
 * a phone number in the header of every page is almost certainly the real one,
 * while one appearing once could be a vendor, a franchise, or a stale footer.
 */
function best<T>(candidates: Candidate<T>[]): { value: T; count: number; method: string } | null {
  if (candidates.length === 0) return null;

  const weight = { high: 3, medium: 2, low: 1 } as const;
  const groups = new Map<string, { value: T; count: number; score: number; method: string }>();

  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.value).toLowerCase();
    const existing = groups.get(key);

    if (existing) {
      existing.count++;
      existing.score += weight[candidate.provenance.confidence];
    } else {
      groups.set(key, {
        value: candidate.value,
        count: 1,
        score: weight[candidate.provenance.confidence],
        method: candidate.provenance.method,
      });
    }
  }

  const ranked = [...groups.values()].sort((a, b) => b.score - a.score || b.count - a.count);
  return ranked[0];
}

function summarize(result: IntakeResult): void {
  console.log(`  pages fetched : ${result.pagesFetched.length}`);
  if (result.pagesSkipped.length > 0) {
    console.log(`  pages skipped : ${result.pagesSkipped.length}`);
  }
  console.log("");

  const fields: [string, ReturnType<typeof best>][] = [
    ["name", best(result.entity.name)],
    ["phone", best(result.entity.phone)],
    ["email", best(result.entity.email)],
    ["street", best(result.entity.street)],
    ["city", best(result.entity.city)],
    ["region", best(result.entity.region)],
    ["postalCode", best(result.entity.postalCode)],
    ["foundedYear", best(result.entity.foundedYear)],
    ["gbpUrl", best(result.entity.gbpUrl)],
  ];

  console.log(`  ENTITY`);
  for (const [label, found] of fields) {
    if (found) {
      const value = String(found.value);
      const shown = value.length > 44 ? value.slice(0, 41) + "..." : value;
      console.log(`    ${label.padEnd(12)} ${shown.padEnd(46)} ${found.method}`);
    } else {
      console.log(`    ${label.padEnd(12)} ${"— not found".padEnd(46)}`);
    }
  }

  console.log("");
  console.log(`  CONTENT`);
  console.log(`    faqs         ${result.faqs.length}`);
  console.log(`    services     ${result.services.length}`);
  console.log(`    areas        ${result.areas.length}`);
  console.log(`    credentials  ${result.credentials.length}`);
  console.log(`    hours        ${result.entity.hours.length} entries`);

  if (result.notes.length > 0) {
    console.log("");
    for (const note of result.notes) console.log(`  ! ${note}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const tenant = get("--tenant") ?? process.env.TENANT_SLUG ?? "titanz";
  const settings = readSettings(tenant);
  const site = get("--site") ?? (settings?.domain ? `https://${settings.domain}` : undefined);
  if (!site) {
    throw new Error("No site. Pass --site, or set a domain on the client.");
  }

  const normalized = site.startsWith("http") ? site : `https://${site}`;
  const maxPages = Number(get("--max-pages") ?? 12);
  const delayMs = Number(get("--delay") ?? 1000);

  console.log(`\nWebsite intake`);
  console.log(`  site      : ${normalized}`);
  console.log(`  max pages : ${maxPages}`);
  console.log(`  delay     : ${delayMs}ms between requests (robots.txt respected)\n`);

  const result = await crawlSite({ site: normalized, maxPages, delayMs });

  summarize(result);

  const outDir = intakeDir(tenant);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "website.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  Candidates written to ${outFile}`);
  console.log(`\n  Nothing here is approved. Every value carries where it came from and`);
  console.log(`  how it was recognized, so it can be judged rather than trusted.\n`);
}

main().catch((error) => {
  console.error(`\nIntake failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
