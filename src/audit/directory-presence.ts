import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { DIRECTORIES, directoryFor, type Directory } from "./directories";
import { loadProfile } from "../data/profile";
import { loadServiceAreas } from "../data/content";
import { intakeDir, readSettings } from "../tenancy/store";
import type { IntakeResult } from "../intake/types";

/**
 * Where this business is listed, as far as can honestly be established.
 *
 *   npm run audit:directories -- --tenant acme
 *
 * Two states only, and the distinction is the whole design:
 *
 *   found    — a profile URL we can point at. Proven.
 *   unknown  — we have no evidence either way. NOT "missing".
 *
 * There is deliberately no "not listed". Directory search cannot be performed
 * from a server: Yelp returns 403 to a browser-agent request for both its search
 * page and a profile URL known to exist, Facebook returns 400, and BBB and Bing
 * answer 200 with results rendered in JavaScript so the HTML contains only the
 * query echoed back. Anything built on those responses would report "not listed
 * on Yelp" for a business plainly listed on Yelp.
 *
 * A confident false negative is worse than an admitted gap. It gets acted on —
 * someone creates a duplicate listing, which is actively harmful — and once an
 * audit has lied twice nobody reads the rest of it.
 *
 * So the unknowns come with a prefilled search link and take about ten seconds
 * each to settle by hand.
 */

export type PresenceState = "found" | "unknown";

export interface DirectoryPresence {
  id: string;
  name: string;
  why: string;
  state: PresenceState;
  /** Profile URL, when one was found. */
  url: string | null;
  /** Where the URL came from — the site, the profile, existing markup. */
  via: string | null;
  /** Prefilled search, for the ones a person has to check. */
  searchUrl: string;
}

export interface DirectoryReport {
  business: string;
  where: string;
  entries: DirectoryPresence[];
  found: number;
  unknown: number;
  /** Profile links found that belong to no directory we track. */
  otherProfiles: string[];
  notes: string[];
}

function readIntake(tenant: string, file: string): IntakeResult | null {
  const full = path.join(intakeDir(tenant), file);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8")) as IntakeResult;
  } catch {
    return null;
  }
}

export function auditDirectories(tenant: string): DirectoryReport {
  const settings = readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}".`);

  const profile = loadProfile(tenant);
  const notes: string[] = [];

  // Every URL we hold that might be a profile somewhere, with its origin, so a
  // finding can say where the evidence came from rather than asserting it.
  const candidates: { url: string; via: string }[] = [];

  for (const url of profile?.sameAs ?? []) {
    candidates.push({ url, via: "business profile" });
  }

  const website = readIntake(tenant, "website.json");
  if (website) {
    for (const candidate of website.entity.profiles ?? []) {
      candidates.push({ url: candidate.value, via: "linked from the website" });
    }
  } else {
    notes.push("No website crawl yet — the site's own links are the main evidence, so run one.");
  }

  const business = profile?.name || settings.name || tenant;

  /**
   * Where to search. This matters more than it looks: searching "Junk Chucker"
   * unlocated returns a business in Ontario, which this project established the
   * hard way.
   *
   * A service-area business has no address, so the served areas are the honest
   * fallback. The domain is never used — "find_loc=junkchucker.com" is not a
   * place, and a search link that returns nothing looks like an absent listing.
   */
  const areas = loadServiceAreas(tenant)
    .filter((area) => area.approved)
    .map((area) => area.name);

  const where =
    [profile?.address.city, profile?.address.region].filter(Boolean).join(", ") ||
    areas[0] ||
    "";

  if (!where) {
    notes.push(
      "No city and no approved service areas, so these searches are unlocated and " +
        "will return similarly named businesses anywhere. Approve a service area first."
    );
  }

  const matched = new Map<string, { url: string; via: string }>();
  const otherProfiles: string[] = [];

  for (const candidate of candidates) {
    const directory: Directory | null = directoryFor(candidate.url);
    if (!directory) {
      if (!otherProfiles.includes(candidate.url)) otherProfiles.push(candidate.url);
      continue;
    }
    // First one wins; the profile is listed before the crawl for that reason.
    if (!matched.has(directory.id)) matched.set(directory.id, candidate);
  }

  const entries: DirectoryPresence[] = DIRECTORIES.map((directory) => {
    const hit = matched.get(directory.id);
    return {
      id: directory.id,
      name: directory.name,
      why: directory.why,
      state: hit ? "found" : "unknown",
      url: hit?.url ?? null,
      via: hit?.via ?? null,
      searchUrl: directory.search(business, where),
    };
  });

  const found = entries.filter((entry) => entry.state === "found").length;

  if (found > 0 && profile) {
    const inSameAs = new Set(profile.sameAs.map((url) => url.toLowerCase()));
    const missing = entries.filter(
      (entry) => entry.url && !inSameAs.has(entry.url.toLowerCase())
    );
    if (missing.length > 0) {
      notes.push(
        `${missing.length} profile link(s) found on the site are not in the business ` +
          `profile's Other profiles list. Add them — that list becomes sameAs, which is ` +
          `how an engine confirms these listings describe one business.`
      );
    }
  }

  return {
    business,
    where,
    entries,
    found,
    unknown: entries.length - found,
    otherProfiles,
    notes,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--tenant");
  const tenant = i !== -1 ? argv[i + 1] : process.env.TENANT_SLUG ?? "";

  const report = auditDirectories(tenant);

  console.log(`\nDirectory presence`);
  console.log(`  business : ${report.business}`);
  console.log(`  location : ${report.where || "(not set)"}`);
  console.log(`  found    : ${report.found} of ${report.entries.length}\n`);

  for (const entry of report.entries) {
    if (entry.state === "found") {
      console.log(`  found    ${entry.name}`);
      console.log(`           ${entry.url}`);
      console.log(`           via ${entry.via}\n`);
    } else {
      console.log(`  unknown  ${entry.name}`);
      console.log(`           check: ${entry.searchUrl}\n`);
    }
  }

  if (report.otherProfiles.length > 0) {
    console.log(`  Other profile links found on the site:`);
    for (const url of report.otherProfiles) console.log(`    ${url}`);
    console.log("");
  }

  for (const note of report.notes) console.log(`  ! ${note}\n`);

  console.log(
    `  "unknown" means no evidence either way, not "not listed". These platforms\n` +
      `  cannot be searched automatically — Yelp refuses server requests even for\n` +
      `  profiles that exist — so each one is about ten seconds by hand.\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\nDirectory audit failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
