import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  loadCredentials,
  loadFaqs,
  saveCredentials,
  saveFaqs,
  type CredentialEntry,
  type FaqEntry,
} from "../data/content";
import type { Candidate, IntakeResult } from "./types";

/**
 * Promotes intake candidates into the authored content files.
 *
 *   npm run promote -- --domain calltitanz.com
 *   npm run promote -- --domain calltitanz.com --dry-run
 *
 * TWO RULES, both structural rather than a matter of care:
 *
 * 1. A human value is never overwritten. Only blank and TODO fields get filled.
 *    If extraction disagrees with something a person wrote, that's reported as
 *    a conflict and the person's value stands.
 *
 * 2. Nothing auto-approves. FAQs and credentials arrive with approved=false
 *    however confident the extraction was. A scraped answer is a promise made
 *    on the company's behalf, and a scraped license number is a compliance
 *    claim.
 */

const CONTENT_DIR = path.resolve(process.cwd(), "content");
const PROFILE_FILE = path.join(CONTENT_DIR, "business-profile.json");

/** True when a profile field is still unset — blank, null, or a TODO marker. */
function isUnset(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" || trimmed.toUpperCase().startsWith("TODO");
  }
  return false;
}

/**
 * Picks the value seen most often, weighted by confidence.
 *
 * Agreement across pages is the strongest signal available without a human.
 */
function best<T>(candidates: Candidate<T>[]): { value: T; method: string } | null {
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
  return ranked[0] ? { value: ranked[0].value, method: ranked[0].method } : null;
}

/**
 * Combines several intake runs into one candidate pool.
 *
 * Nothing is resolved here — every candidate keeps its own provenance and the
 * `best()` scoring decides later. Two independent sources landing on the same
 * phone number is exactly the agreement that should win, and flattening early
 * would throw that signal away.
 */
function mergeIntake(results: IntakeResult[]): IntakeResult {
  const merged = results[0];

  for (const next of results.slice(1)) {
    for (const key of Object.keys(merged.entity) as (keyof typeof merged.entity)[]) {
      // Each field is a homogeneous candidate array; the cast keeps the loop
      // generic without widening the public types.
      (merged.entity[key] as unknown[]).push(...(next.entity[key] as unknown[]));
    }

    merged.faqs.push(...next.faqs);
    merged.services.push(...next.services);
    merged.credentials.push(...next.credentials);
    merged.areas.push(...next.areas);
    merged.brands.push(...next.brands);
    merged.pagesFetched.push(...next.pagesFetched);
  }

  return merged;
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const domain = get("--domain");
  if (!domain) throw new Error("--domain is required, e.g. --domain calltitanz.com");

  const dryRun = argv.includes("--dry-run");
  const intakeDir = path.join(CONTENT_DIR, "intake", domain);

  if (!fs.existsSync(intakeDir)) {
    throw new Error(
      `No intake found at ${intakeDir}. Run: npm run intake -- --site https://${domain}`
    );
  }

  // Merge every source that has run — website.json, places.json, and whatever
  // gets added later. Candidates from different sources agreeing on a value is
  // the strongest corroboration available without asking a human.
  const sourceFiles = fs
    .readdirSync(intakeDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  if (sourceFiles.length === 0) {
    throw new Error(`No intake files in ${intakeDir}.`);
  }

  const sources = sourceFiles.map((file) => ({
    file,
    result: JSON.parse(fs.readFileSync(path.join(intakeDir, file), "utf8")) as IntakeResult,
  }));

  const result = mergeIntake(sources.map((source) => source.result));

  console.log(`\nPromote intake candidates`);
  console.log(`  domain  : ${domain}`);
  console.log(`  sources : ${sourceFiles.join(", ")}`);
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  console.log("");

  for (const source of sources) {
    for (const note of source.result.notes) {
      console.log(`  ! [${source.file}] ${note}\n`);
    }
  }

  // --- business profile ----------------------------------------------------
  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8")) as Record<string, unknown>;
  const address = (profile.address ?? {}) as Record<string, unknown>;

  const filled: string[] = [];
  const kept: string[] = [];
  const conflicts: string[] = [];

  const apply = (
    container: Record<string, unknown>,
    key: string,
    label: string,
    found: { value: unknown; method: string } | null
  ) => {
    if (!found) return;

    if (!isUnset(container[key])) {
      // A person already answered this. Their value wins; we only report that
      // extraction saw something different so it can be checked.
      if (String(container[key]).trim() !== String(found.value).trim()) {
        conflicts.push(`${label}: kept "${container[key]}", site says "${found.value}"`);
      } else {
        kept.push(label);
      }
      return;
    }

    container[key] = found.value;
    filled.push(`${label.padEnd(14)} ${String(found.value).slice(0, 44).padEnd(46)} ${found.method}`);
  };

  apply(profile, "name", "name", best(result.entity.name));
  apply(profile, "legalName", "legalName", best(result.entity.legalName));
  apply(profile, "description", "description", best(result.entity.description));
  apply(profile, "phone", "phone", best(result.entity.phone));
  apply(profile, "email", "email", best(result.entity.email));
  apply(profile, "gbpUrl", "gbpUrl", best(result.entity.gbpUrl));
  apply(profile, "foundedYear", "foundedYear", best(result.entity.foundedYear));
  apply(address, "street", "address.street", best(result.entity.street));
  apply(address, "city", "address.city", best(result.entity.city));
  apply(address, "region", "address.region", best(result.entity.region));
  apply(address, "postalCode", "address.postalCode", best(result.entity.postalCode));

  if (isUnset(profile.domain)) {
    profile.domain = domain;
    filled.push(`${"domain".padEnd(14)} ${domain.padEnd(46)} intake target`);
  }

  profile.address = address;

  // --- hours ---------------------------------------------------------------
  // All or nothing, and only when the week is currently unfilled. Merging a
  // partial week into hand-entered hours would produce a schedule nobody wrote
  // and nobody checked.
  const currentHours = Array.isArray(profile.hours) ? profile.hours : [];
  const hoursAreUnset = currentHours.every((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    return e.isClosed === true || isUnset(e.opens) || isUnset(e.closes);
  });

  const hoursCandidates = result.entity.hours;
  if (hoursCandidates.length > 0) {
    if (!hoursAreUnset) {
      conflicts.push(`hours: kept your existing week, a source also published hours`);
    } else {
      const byDay = new Map<number, { day: number; opens: string | null; closes: string | null; isClosed: boolean }>();
      for (const candidate of hoursCandidates) {
        if (!byDay.has(candidate.value.day)) byDay.set(candidate.value.day, candidate.value);
      }

      const week = [...byDay.values()].sort((a, b) => a.day - b.day);
      if (week.length > 0) {
        profile.hours = week.map((entry) => ({
          day: entry.day,
          isClosed: entry.isClosed,
          opens: entry.opens,
          closes: entry.closes,
        }));
        const open = week.filter((entry) => !entry.isClosed).length;
        filled.push(`${"hours".padEnd(14)} ${`${open} open day(s) of 7`.padEnd(46)} ${hoursCandidates[0].provenance.method}`);
      }
    }
  }

  if (filled.length > 0) {
    console.log(`  PROFILE — filled ${filled.length} empty field(s)`);
    for (const line of filled) console.log(`    ${line}`);
    console.log("");
  }

  if (conflicts.length > 0) {
    console.log(`  CONFLICTS — your value kept, site disagrees:`);
    for (const line of conflicts) console.log(`    ${line}`);
    console.log("");
  }

  if (kept.length > 0) {
    console.log(`  Already set and matching: ${kept.join(", ")}\n`);
  }

  // --- FAQs ----------------------------------------------------------------
  const existingFaqs = loadFaqs();
  const seenQuestions = new Set(existingFaqs.map((faq) => normalizeQuestion(faq.question)));

  const newFaqs: FaqEntry[] = result.faqs
    .filter((faq) => !seenQuestions.has(normalizeQuestion(faq.question)))
    .map((faq) => ({
      question: faq.question,
      answer: faq.answer,
      approved: false,
      published: false,
      provenance: {
        source: faq.provenance.source,
        url: faq.provenance.url,
        method: faq.provenance.method,
        confidence: faq.provenance.confidence,
      },
    }));

  // --- credentials ---------------------------------------------------------
  const existingCredentials = loadCredentials();
  const seenCredentials = new Set(
    existingCredentials.map((c) => `${c.kind}:${(c.identifier ?? c.title).toLowerCase()}`)
  );

  const newCredentials: CredentialEntry[] = result.credentials
    .filter((c) => !seenCredentials.has(`${c.kind}:${(c.identifier ?? c.title).toLowerCase()}`))
    .map((c) => ({
      kind: c.kind,
      title: c.title,
      identifier: c.identifier,
      issuer: null,
      validUntil: null,
      approved: false,
      published: false,
      provenance: {
        source: c.provenance.source,
        url: c.provenance.url,
        method: c.provenance.method,
        confidence: c.provenance.confidence,
      },
    }));

  console.log(`  FAQS`);
  console.log(`    ${newFaqs.length} new, ${existingFaqs.length} already present`);
  console.log(`    all new entries are approved=false`);
  console.log("");
  console.log(`  CREDENTIALS`);
  console.log(`    ${newCredentials.length} new, ${existingCredentials.length} already present`);
  for (const credential of newCredentials) {
    console.log(`      ${credential.title}${credential.identifier ? ` — ${credential.identifier}` : ""}`);
  }
  console.log("");

  if (dryRun) {
    console.log(`  Dry run complete. Nothing was written.\n`);
    return;
  }

  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2) + "\n", "utf8");
  const faqFile = saveFaqs([...existingFaqs, ...newFaqs]);
  const credentialFile = saveCredentials([...existingCredentials, ...newCredentials]);

  console.log(`  Written:`);
  console.log(`    ${PROFILE_FILE}`);
  console.log(`    ${faqFile}`);
  console.log(`    ${credentialFile}`);
  console.log("");
  console.log(`  Nothing is approved or published yet. Review the files, set`);
  console.log(`  approved and published where you're happy for an AI to say it,`);
  console.log(`  then run: npm run content:load\n`);
}

main().catch((error) => {
  console.error(`\nPromote failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
