import * as fs from "fs";
import * as path from "path";

/**
 * Writes raw export output to disk.
 *
 * Everything lands under data/raw/<timestamp>/, which is gitignored — these
 * files hold real customer and revenue data and must not be committed.
 *
 * Each run gets its own directory so exports are comparable over time rather
 * than overwriting each other. Disk is cheap; a lost baseline is not.
 */

const RAW_DIR = path.resolve(process.cwd(), "data", "raw");

export interface ExportRun {
  id: string;
  dir: string;
  startedAt: string;
}

/** Timestamp safe for use as a directory name on Windows. */
function runId(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

export function createRun(): ExportRun {
  const now = new Date();
  const id = runId(now);
  const dir = path.join(RAW_DIR, id);

  fs.mkdirSync(dir, { recursive: true });

  return { id, dir, startedAt: now.toISOString() };
}

/** Writes one target's records. Returns the path for the manifest. */
export function writeRecords(run: ExportRun, name: string, records: unknown[]): string {
  const file = path.join(run.dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(records, null, 2), "utf8");
  return file;
}

/**
 * Writes the run manifest — what was requested, what came back, what failed.
 *
 * This is the file to read after the first run. The failures tell you which
 * endpoint paths and filter params were guessed wrong.
 */
export function writeManifest(run: ExportRun, manifest: Record<string, unknown>): string {
  const file = path.join(run.dir, "_manifest.json");
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), "utf8");
  return file;
}
