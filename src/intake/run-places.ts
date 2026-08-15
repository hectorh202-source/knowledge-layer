import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  detailsToIntake,
  fetchPlaceDetails,
  matchPlace,
  searchPlaces,
  type PlacesOptions,
} from "./places";
import type { IntakeResult } from "./types";
import { intakeDir, readSettings } from "../tenancy/store";

/**
 * Google Places intake.
 *
 *   npm run intake:places -- --domain calltitanz.com
 *   npm run intake:places -- --domain example.com --query "Acme Plumbing Tampa FL"
 *
 * Uses our own API key — the customer authorizes nothing. Reads the website
 * intake, if present, to build the search query and to corroborate the match.
 */



/** Picks the most-agreed value from a candidate list. */
function bestValue<T>(candidates: { value: T; provenance: { confidence: string } }[]): T | null {
  if (candidates.length === 0) return null;

  const weight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const groups = new Map<string, { value: T; score: number }>();

  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.value).toLowerCase();
    const existing = groups.get(key);
    const score = weight[candidate.provenance.confidence] ?? 1;
    if (existing) existing.score += score;
    else groups.set(key, { value: candidate.value, score });
  }

  return [...groups.values()].sort((a, b) => b.score - a.score)[0]?.value ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const tenant = get("--tenant") ?? process.env.TENANT_SLUG ?? "titanz";
  const settings = readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}". Create it in the portal first.`);

  const domain = get("--domain") ?? settings.domain;
  if (!domain) throw new Error(`Client "${tenant}" has no domain set.`);

  const apiKey = get("--api-key") ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not set.\n" +
        "  Create a key at console.cloud.google.com with the Places API (New) enabled,\n" +
        "  then add GOOGLE_MAPS_API_KEY to .env. This is your key, not the customer's —\n" +
        "  no authorization from them is required."
    );
  }

  // Reuse whatever the website crawl already established, both to build a good
  // search query and to corroborate the match.
  const websiteFile = path.join(intakeDir(tenant), "website.json");
  let websiteIntake: IntakeResult | null = null;
  if (fs.existsSync(websiteFile)) {
    websiteIntake = JSON.parse(fs.readFileSync(websiteFile, "utf8")) as IntakeResult;
  }

  const knownName = websiteIntake ? bestValue(websiteIntake.entity.name) : null;
  const knownPhone = websiteIntake ? bestValue(websiteIntake.entity.phone) : null;
  const knownCity = websiteIntake ? bestValue(websiteIntake.entity.city) : null;
  const knownRegion = websiteIntake ? bestValue(websiteIntake.entity.region) : null;

  const derivedQuery = [knownName, knownCity, knownRegion].filter(Boolean).join(" ");
  const query = get("--query") ?? (derivedQuery || domain);

  const options: PlacesOptions = {
    apiKey,
    query,
    expectPhone: knownPhone,
    expectDomain: domain,
  };

  console.log(`\nGoogle Places intake`);
  console.log(`  domain : ${domain}`);
  console.log(`  query  : ${query}`);
  if (!websiteIntake) {
    console.log(`  ! No website intake found, so the match cannot be corroborated.`);
    console.log(`    Run npm run intake first for a much safer match.`);
  }
  console.log("");

  const results = await searchPlaces(options);
  console.log(`  ${results.length} search result(s)`);
  for (const place of results) {
    console.log(`    ${place.name}${place.address ? ` — ${place.address}` : ""}`);
  }
  console.log("");

  const match = matchPlace(results, options);
  if (!match) {
    console.log(`  No results. Try a more specific --query.\n`);
    return;
  }

  console.log(`  Matched: ${match.place.name}`);
  console.log(`    ${match.reasons.join("; ")}`);
  console.log(`    confident: ${match.confident ? "yes" : "NO — verify before promoting"}`);
  console.log("");

  const details = await fetchPlaceDetails(match.place.id, options);
  const intake = detailsToIntake(details, domain, match);

  const definedHours = intake.entity.hours.filter((h) => !h.value.isClosed).length;
  console.log(`  EXTRACTED`);
  console.log(`    name        ${bestValue(intake.entity.name) ?? "—"}`);
  console.log(`    phone       ${bestValue(intake.entity.phone) ?? "—"}`);
  console.log(`    city        ${bestValue(intake.entity.city) ?? "—"}`);
  console.log(`    region      ${bestValue(intake.entity.region) ?? "—"}`);
  console.log(`    postalCode  ${bestValue(intake.entity.postalCode) ?? "—"}`);
  console.log(`    hours       ${definedHours} open day(s) of 7`);
  console.log("");

  for (const note of intake.notes) console.log(`  ! ${note}\n`);

  const outDir = intakeDir(tenant);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "places.json");
  fs.writeFileSync(outFile, JSON.stringify(intake, null, 2), "utf8");

  console.log(`  Candidates written to ${outFile}`);
  console.log(`  Merge with: npm run promote -- --tenant ${tenant}\n`);
}

main().catch((error) => {
  console.error(`\nPlaces intake failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
