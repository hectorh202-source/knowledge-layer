import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { detailsToIntake, fetchPlaceDetails, parsePlaceId } from "./places";
import type { IntakeResult } from "./types";
import { intakeDir, readSettings } from "../tenancy/store";

/**
 * Google Places intake.
 *
 *   npm run intake:places -- --tenant acme
 *   npm run intake:places -- --tenant acme --place-id ChIJ...
 *
 * Takes a place ID and nothing else. There is no search: Google returns no
 * service-area business from any queryable endpoint, and that is most of this
 * market. A client without a discoverable place ID gets entered by hand.
 *
 * The ID comes from Settings, or from the website crawl, which finds it in the
 * client's own embedded maps and review widgets.
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

  const tenant = get("--tenant") ?? process.env.TENANT_SLUG ?? "";
  const settings = readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}". Create it in the portal first.`);

  const domain = get("--domain") ?? settings.domain;
  if (!domain) throw new Error(`Client "${tenant}" has no domain set.`);

  const apiKey = get("--api-key") ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY is not set.\n" +
        "  Create a key at console.cloud.google.com with the Places API (New) enabled,\n" +
        "  then add GOOGLE_MAPS_API_KEY to .env."
    );
  }

  // The crawl writes place IDs it found in the site's markup.
  const websiteFile = path.join(intakeDir(tenant), "website.json");
  let websiteIntake: IntakeResult | null = null;
  if (fs.existsSync(websiteFile)) {
    websiteIntake = JSON.parse(fs.readFileSync(websiteFile, "utf8")) as IntakeResult;
  }

  const crawledIds = websiteIntake?.entity.placeId ?? [];
  // Only when the site agrees with itself. Several different IDs means a
  // multi-location business or a third-party widget carrying someone else's,
  // and guessing between them would import the wrong company.
  const crawledPlaceId = crawledIds.length === 1 ? parsePlaceId(crawledIds[0].value) : "";
  const settingsPlaceId = parsePlaceId(settings.sources.googlePlaceId);
  const typedPlaceId = parsePlaceId(get("--place-id"));

  const placeId = typedPlaceId || settingsPlaceId || crawledPlaceId;
  const source = typedPlaceId
    ? "entered by hand"
    : settingsPlaceId
      ? "from Settings"
      : "found in the site's markup by the website crawl";

  console.log(`\nGoogle Places intake`);
  console.log(`  domain : ${domain}`);

  if (!placeId) {
    const supplied = get("--place-id") || settings.sources.googlePlaceId?.trim() || "";

    if (supplied) {
      throw new Error(
        `That is not a Google place ID: ${supplied}\n` +
          `  Paste the ID itself (starts with ChIJ) or a Google URL containing one, such as\n` +
          `  a review link: search.google.com/local/writereview?placeid=ChIJ...\n` +
          `  A cid= link holds a different identifier and cannot be converted.`
      );
    }

    if (crawledIds.length > 1) {
      console.log(`\n  ${crawledIds.length} different place IDs are embedded on this site, so none was used:`);
      for (const candidate of crawledIds) console.log(`    ${candidate.value}`);
      console.log(`\n  Confirm which is the business and save it in Settings → Content sources.\n`);
      return;
    }

    console.log(
      `\n  No place ID.\n\n` +
        `  Crawl the website first — the ID is usually in the site's own embedded map or\n` +
        `  review widget. If the site has nothing from Google on it, ask the client for\n` +
        `  their Google review link and paste it into Settings → Content sources.\n\n` +
        `  Failing both, enter the business details by hand. There is no search fallback:\n` +
        `  Google does not return service-area businesses from any lookup endpoint.\n`
    );
    return;
  }

  console.log(`  placeId: ${placeId}  (${source})`);
  console.log("");

  const details = await fetchPlaceDetails(placeId, apiKey);
  const intake = detailsToIntake(details, domain);

  const openDays = intake.entity.hours.filter((h) => !h.value.isClosed).length;
  console.log(`  EXTRACTED`);
  console.log(`    name        ${bestValue(intake.entity.name) ?? "—"}`);
  console.log(`    phone       ${bestValue(intake.entity.phone) ?? "—"}`);
  console.log(`    city        ${bestValue(intake.entity.city) ?? "—"}`);
  console.log(`    region      ${bestValue(intake.entity.region) ?? "—"}`);
  console.log(`    postalCode  ${bestValue(intake.entity.postalCode) ?? "—"}`);
  console.log(`    hours       ${openDays} open day(s) of 7`);
  console.log("");

  for (const note of intake.notes) console.log(`  ! ${note}\n`);

  const outDir = intakeDir(tenant);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "places.json");
  fs.writeFileSync(outFile, JSON.stringify(intake, null, 2), "utf8");

  console.log(`  Candidates written to ${outFile}`);
  console.log(`  Now press Promote to move them into content.\n`);
}

main().catch((error) => {
  console.error(`\nPlaces intake failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
