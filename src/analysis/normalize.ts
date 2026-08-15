import * as fs from "fs";
import * as path from "path";
import type { Dataset, Invoice, Job, JobType } from "./types";

/**
 * THE MAPPING BOUNDARY.
 *
 * This is the only file that knows what ServiceTitan's JSON looks like.
 * Everything downstream speaks our own types from `types.ts`.
 *
 * The mock data's field names are educated guesses (OPEN-QUESTIONS.md 4.5), so
 * every field is read through `pick()` with a list of plausible names rather
 * than a single hardcoded one. When the real export arrives, the fix is adding
 * the true name to a candidate list here — not chasing field names through the
 * rest of the codebase.
 *
 * Anything unmappable becomes null and shows up in the coverage report, rather
 * than silently defaulting to zero. A quiet zero would understate revenue and
 * look like a real answer.
 */

const RAW_DIR = path.resolve(process.cwd(), "data", "raw");

/** Reads the first present key from a record. */
function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readJson(dir: string, name: string): Record<string, unknown>[] {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

/** Most recent export run directory. */
export function latestRunDir(): string {
  if (!fs.existsSync(RAW_DIR)) {
    throw new Error(`No exports found. Run: npm run export -- --mock`);
  }
  const runs = fs
    .readdirSync(RAW_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (runs.length === 0) {
    throw new Error(`No exports found in ${RAW_DIR}. Run: npm run export -- --mock`);
  }
  return path.join(RAW_DIR, runs[runs.length - 1]);
}

function normalizeJobTypes(rows: Record<string, unknown>[]): JobType[] {
  return rows.flatMap((row) => {
    const id = asNumber(pick(row, ["id", "jobTypeId"]));
    const name = asString(pick(row, ["name", "displayName"]));
    if (id === null || name === null) return [];

    const units = pick(row, ["businessUnitIds", "businessUnitId"]);
    const businessUnitIds = Array.isArray(units)
      ? units.map(asNumber).filter((n): n is number => n !== null)
      : asNumber(units) !== null
        ? [asNumber(units) as number]
        : [];

    return [{ id, name, businessUnitIds }];
  });
}

function normalizeJobs(rows: Record<string, unknown>[]): Job[] {
  return rows.flatMap((row) => {
    const id = asNumber(pick(row, ["id", "jobId"]));
    if (id === null) return [];

    // Lead source lives in a custom field array in ServiceTitan, which is a
    // per-tenant convention rather than a fixed schema. Best-effort only —
    // it matters for Layer 5 attribution, not for revenue.
    let leadSource: string | null = null;
    const customFields = pick(row, ["customFields"]);
    if (Array.isArray(customFields)) {
      for (const field of customFields) {
        if (field && typeof field === "object") {
          const f = field as Record<string, unknown>;
          if (asString(f.name)?.toLowerCase().includes("lead source")) {
            leadSource = asString(f.value);
          }
        }
      }
    }

    return [
      {
        id,
        jobTypeId: asNumber(pick(row, ["jobTypeId", "typeId"])),
        businessUnitId: asNumber(pick(row, ["businessUnitId"])),
        completedOn: asString(pick(row, ["completedOn", "completedOnUtc"])),
        leadSource,
      },
    ];
  });
}

function normalizeInvoices(rows: Record<string, unknown>[]): Invoice[] {
  return rows.flatMap((row) => {
    const id = asNumber(pick(row, ["id", "invoiceId"]));
    if (id === null) return [];

    // ServiceTitan nests the job reference as `job: { id, number, type }`.
    // A flat `jobId` is the plausible alternative, so try both.
    let jobId: number | null = null;
    const job = pick(row, ["job"]);
    if (job && typeof job === "object") {
      jobId = asNumber((job as Record<string, unknown>).id);
    }
    if (jobId === null) jobId = asNumber(pick(row, ["jobId"]));

    // Pre-tax is what the work sold for. Falling back to `total` would fold
    // sales tax into revenue and inflate every published price range.
    const subTotal = asNumber(pick(row, ["subTotal", "subtotal"]));
    const total = asNumber(pick(row, ["total", "amount"]));

    return [
      {
        id,
        jobId,
        subTotal: subTotal ?? total ?? 0,
        total: total ?? subTotal ?? 0,
        invoiceDate: asString(pick(row, ["invoiceDate", "createdOn"])),
      },
    ];
  });
}

/** Loads and normalizes one export run. */
export function loadDataset(dir: string): Dataset {
  const manifestPath = path.join(dir, "_manifest.json");
  const manifest: Record<string, unknown> = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};

  return {
    jobTypes: normalizeJobTypes(readJson(dir, "job-types")),
    jobs: normalizeJobs(readJson(dir, "jobs-completed")),
    invoices: normalizeInvoices(readJson(dir, "invoices")),
    source: {
      dir,
      environment: asString(manifest.environment) ?? "unknown",
      mock: manifest.mock === true,
    },
  };
}
