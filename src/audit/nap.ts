import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseJsonLdBlocks } from "../intake/jsonld";
import { isBusinessNode, nodesOf } from "./verify-markup";
import { loadProfile } from "../data/profile";
import { intakeDir, readSettings } from "../tenancy/store";
import type { IntakeResult } from "../intake/types";

/**
 * Compares the business's name, address and phone across every source we hold.
 *
 *   npm run audit:nap -- --tenant acme
 *
 * Inconsistent NAP is the ordinary reason an entity fails to resolve. An answer
 * engine seeing "941-500-3351" on the website and "(941) 500-3350" on Google has
 * no way to know those are one business, so neither record accumulates the
 * corroboration that earns a citation — and the fix is a five-minute edit nobody
 * knew was needed.
 *
 * All of this data was already sitting in the tenant folder unexamined. The
 * crawl writes what the site says, the Places intake writes what Google says,
 * the profile holds what a person confirmed, and nothing ever compared the
 * three. Promote reports conflicts, but only against the profile, only at
 * promote time, and only in run output nobody reads twice.
 *
 * The fourth source is the markup already live on the customer's own site,
 * which is frequently an SEO plugin publishing a name that matches neither.
 *
 * Comparison is normalised, not literal. "(941) 500-3351" and "941-500-3351"
 * are the same number, and reporting them as a conflict would bury the real
 * ones — an audit that cries wolf gets ignored, which is worse than no audit.
 */

export type NapField = "name" | "phone" | "street" | "city" | "region" | "postalCode";

export interface NapValue {
  source: string;
  raw: string;
  /** Normalised form actually used for comparison. */
  key: string;
}

/** Sources that hold the same normalised value — one side of a disagreement. */
export interface NapGroup {
  /** The value as one of its sources writes it, for display. */
  raw: string;
  sources: string[];
}

export interface NapFinding {
  field: NapField;
  /** True when every source that has an opinion agrees. */
  agrees: boolean;
  severity: "high" | "medium";
  values: NapValue[];
  /**
   * The distinct values, each with the sources holding it.
   *
   * Listing sources flat reads as four different answers when it is usually two
   * camps of two — and which sources agree is the whole diagnosis. "Google and
   * the profile say one thing, the website says another" tells you where to go;
   * four lines of near-identical text does not.
   */
  groups: NapGroup[];
}

export interface NapReport {
  sources: string[];
  findings: NapFinding[];
  conflicts: number;
  notes: string[];
}

const STREET_WORDS: Record<string, string> = {
  street: "st", str: "st",
  road: "rd",
  avenue: "ave", av: "ave",
  boulevard: "blvd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  place: "pl",
  suite: "ste", unit: "ste", apartment: "ste", apt: "ste",
  north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};

function normalize(field: NapField, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (field === "phone") {
    // Digits only, and drop a US country code. Formatting is not a conflict.
    const digits = trimmed.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  }

  if (field === "postalCode") {
    // ZIP+4 and ZIP describe the same place.
    return trimmed.replace(/\D/g, "").slice(0, 5);
  }

  const base = trimmed
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (field === "street") {
    // "1 Main Street" and "1 Main St" are one address written two ways, and a
    // directory listing almost never uses the same abbreviations as a website.
    return base
      .split(" ")
      .map((word) => STREET_WORDS[word] ?? word)
      .join(" ");
  }

  return base;
}

/** Picks the most-agreed candidate from an intake file's list. */
function bestCandidate(candidates: { value: string; provenance: { confidence: string } }[]): string {
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const weight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const scores = new Map<string, number>();
  for (const candidate of candidates) {
    if (typeof candidate?.value !== "string") continue;
    scores.set(
      candidate.value,
      (scores.get(candidate.value) ?? 0) + (weight[candidate.provenance?.confidence] ?? 1)
    );
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
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

function fromEntity(entity: IntakeResult["entity"]): Partial<Record<NapField, string>> {
  return {
    name: bestCandidate(entity.name),
    phone: bestCandidate(entity.phone),
    street: bestCandidate(entity.street),
    city: bestCandidate(entity.city),
    region: bestCandidate(entity.region),
    postalCode: bestCandidate(entity.postalCode),
  };
}

/** Pulls NAP out of whatever business markup the live site already publishes. */
async function fromLiveSite(domain: string): Promise<Partial<Record<NapField, string>> | null> {
  try {
    const response = await fetch(`https://${domain}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;

    const node = parseJsonLdBlocks(await response.text())
      .flatMap(nodesOf)
      .find(isBusinessNode);
    if (!node) return null;

    const address = (node.address ?? {}) as Record<string, unknown>;
    const str = (value: unknown): string => (typeof value === "string" ? value : "");

    return {
      name: str(node.name),
      phone: str(node.telephone),
      street: str(address.streetAddress),
      city: str(address.addressLocality),
      region: str(address.addressRegion),
      postalCode: str(address.postalCode),
    };
  } catch {
    return null;
  }
}

const FIELDS: { field: NapField; severity: "high" | "medium" }[] = [
  // Name and phone are what an engine matches records on. A mismatch there
  // means two businesses as far as it can tell.
  { field: "name", severity: "high" },
  { field: "phone", severity: "high" },
  { field: "street", severity: "medium" },
  { field: "city", severity: "high" },
  { field: "region", severity: "medium" },
  { field: "postalCode", severity: "medium" },
];

export async function auditNap(tenant: string, options?: { skipLive?: boolean }): Promise<NapReport> {
  const settings = readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}".`);

  const notes: string[] = [];
  const collected: { source: string; values: Partial<Record<NapField, string>> }[] = [];

  const profile = loadProfile(tenant);
  if (profile) {
    collected.push({
      source: "profile",
      values: {
        name: profile.name,
        phone: profile.phone ?? "",
        street: profile.address.street ?? "",
        city: profile.address.city ?? "",
        region: profile.address.region ?? "",
        postalCode: profile.address.postalCode ?? "",
      },
    });
  }

  const website = readIntake(tenant, "website.json");
  if (website) collected.push({ source: "website crawl", values: fromEntity(website.entity) });
  else notes.push("No website crawl yet, so the site's own details were not compared.");

  const places = readIntake(tenant, "places.json");
  if (places) collected.push({ source: "Google", values: fromEntity(places.entity) });
  else notes.push("No Google Places data yet — the most valuable comparison is missing.");

  if (!options?.skipLive && settings.domain) {
    const live = await fromLiveSite(settings.domain);
    if (live) collected.push({ source: "live site markup", values: live });
  }

  const findings: NapFinding[] = [];

  for (const { field, severity } of FIELDS) {
    const values: NapValue[] = [];

    for (const entry of collected) {
      const raw = (entry.values[field] ?? "").trim();
      // Absent is not a conflict. A source that says nothing about a field
      // disagrees with nobody, and flagging it would turn every thin profile
      // into a wall of false findings.
      if (!raw) continue;
      values.push({ source: entry.source, raw, key: normalize(field, raw) });
    }

    if (values.length < 2) continue;

    const byKey = new Map<string, NapGroup>();
    for (const value of values) {
      const existing = byKey.get(value.key);
      if (existing) existing.sources.push(value.source);
      else byKey.set(value.key, { raw: value.raw, sources: [value.source] });
    }

    // Largest camp first — the majority reading is what someone will most
    // often keep, so it belongs at the top of the comparison.
    const groups = [...byKey.values()].sort((a, b) => b.sources.length - a.sources.length);

    findings.push({ field, agrees: groups.length === 1, severity, values, groups });
  }

  const conflicts = findings.filter((finding) => !finding.agrees).length;

  if (collected.length < 2) {
    notes.push(
      "Fewer than two sources hold NAP data, so there is nothing to compare. " +
        "Crawl the website and pull from Google first."
    );
  }

  return { sources: collected.map((entry) => entry.source), findings, conflicts, notes };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--tenant");
  const tenant = i !== -1 ? argv[i + 1] : process.env.TENANT_SLUG ?? "";

  const report = await auditNap(tenant, { skipLive: argv.includes("--no-live") });

  console.log(`\nNAP consistency`);
  console.log(`  sources : ${report.sources.join(", ") || "none"}`);
  console.log(`  compared: ${report.findings.length} field(s)`);
  console.log(`  conflicts: ${report.conflicts}\n`);

  for (const finding of report.findings) {
    const mark = finding.agrees ? "ok  " : finding.severity === "high" ? "HIGH" : "med ";
    console.log(`  ${mark}  ${finding.field}`);
    if (finding.agrees) {
      console.log(`        all ${finding.values.length} source(s) agree: ${finding.groups[0].raw}`);
    } else {
      for (const group of finding.groups) {
        console.log(`        ${group.raw}`);
        console.log(`          — ${group.sources.join(", ")}`);
      }
    }
    console.log("");
  }

  for (const note of report.notes) console.log(`  ! ${note}\n`);

  if (report.conflicts > 0) {
    console.log(
      `  Each conflict is a reason an answer engine may treat these as different\n` +
        `  businesses. Decide which value is correct, set it in the business profile,\n` +
        `  then correct it at the source that disagrees.\n`
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nNAP audit failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
