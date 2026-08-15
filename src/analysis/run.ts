import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { latestRunDir, loadDataset } from "./normalize";
import { buildRevenueReport } from "./revenue";
import type { JobTypeRevenue, RevenueReport } from "./types";

/**
 * Revenue and pricing analysis over an export run.
 *
 *   npm run analyze
 *   npm run analyze -- --run data/raw/2026-08-15T17-15-46-810
 *   npm run analyze -- --top 8
 *
 * Answers OPEN-QUESTIONS 4.1 and 4.3: which service actually makes the money,
 * and what each one really costs.
 */

const money = (value: number): string =>
  "$" + Math.round(value).toLocaleString("en-US");

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : text.padStart(width);
}

function printRevenueTable(rows: JobTypeRevenue[], totalRevenue: number, top: number): void {
  console.log(
    `  ${pad("SERVICE", 34)}${padLeft("JOBS", 6)}${padLeft("REVENUE", 12)}${padLeft("SHARE", 8)}${padLeft("MEDIAN", 10)}`
  );
  console.log(`  ${"-".repeat(70)}`);

  let cumulative = 0;
  for (const row of rows.slice(0, top)) {
    cumulative += row.revenueShare;
    console.log(
      `  ${pad(row.jobTypeName, 34)}` +
        `${padLeft(String(row.jobCount), 6)}` +
        `${padLeft(money(row.revenue), 12)}` +
        `${padLeft((row.revenueShare * 100).toFixed(1) + "%", 8)}` +
        `${padLeft(money(row.distribution.median), 10)}` +
        (row.thinSample ? "  thin" : "")
    );
  }

  if (rows.length > top) {
    const rest = rows.slice(top);
    const restRevenue = rest.reduce((sum, row) => sum + row.revenue, 0);
    console.log(
      `  ${pad(`... ${rest.length} more`, 34)}${padLeft("", 6)}${padLeft(money(restRevenue), 12)}` +
        `${padLeft(((restRevenue / totalRevenue) * 100).toFixed(1) + "%", 8)}`
    );
  }
}

function printPricingDetail(rows: JobTypeRevenue[], top: number): void {
  for (const row of rows.slice(0, top)) {
    const d = row.distribution;
    console.log(`\n  ${row.jobTypeName}${row.thinSample ? "   [THIN SAMPLE]" : ""}`);
    console.log(
      `      publish : ${money(row.publishRange.low)} - ${money(row.publishRange.high)}` +
        `     (from p10-p90, rounded outward)`
    );
    console.log(
      `      actual  : low ${money(d.min)}  p25 ${money(d.p25)}  median ${money(d.median)}` +
        `  p75 ${money(d.p75)}  high ${money(d.max)}`
    );
    console.log(`      n = ${d.n} invoices`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const runArg = get("--run");
  const top = Number(get("--top") ?? 10);

  const dir = runArg ? path.resolve(process.cwd(), runArg) : latestRunDir();
  const dataset = loadDataset(dir);
  const report = buildRevenueReport(dataset);

  console.log(`\nRevenue & pricing analysis`);
  console.log(`  source      : ${path.basename(dir)}`);
  console.log(`  environment : ${report.source.environment}${report.source.mock ? "  (MOCK DATA)" : ""}`);
  console.log(
    `  coverage    : ${report.coverage.invoicesJoined}/${report.coverage.invoices} invoices joined to a typed job`
  );
  console.log(`  revenue     : ${money(report.totalRevenue)} across ${report.byRevenue.length} services\n`);

  if (report.warnings.length > 0) {
    for (const warning of report.warnings) {
      console.log(`  ! ${warning}`);
    }
    console.log("");
  }

  console.log(`BY REVENUE — the ranking that decides what to write first\n`);
  printRevenueTable(report.byRevenue, report.totalRevenue, top);

  console.log(`\n\nBY VOLUME — the ranking that decides what customers ask about\n`);
  printRevenueTable(report.byVolume, report.totalRevenue, top);

  // Where the two rankings disagree is the interesting part: high-volume,
  // low-revenue services drive the phone calls, high-revenue ones pay the bills,
  // and both need pricing pages for different reasons.
  const revenueTop = new Set(report.byRevenue.slice(0, 5).map((r) => r.jobTypeName));
  const volumeTop = report.byVolume.slice(0, 5).map((r) => r.jobTypeName);
  const volumeOnly = volumeTop.filter((name) => !revenueTop.has(name));

  if (volumeOnly.length > 0) {
    console.log(`\n\n  High volume but outside the revenue top 5: ${volumeOnly.join(", ")}`);
    console.log(`  These drive call volume and AI queries even though they don't lead revenue.`);
  }

  console.log(`\n\nPUBLISHABLE PRICE RANGES\n`);
  printPricingDetail(report.byRevenue, top);

  console.log(`\n\n  Write pricing pages for these first (first 80% of revenue):`);
  for (const name of report.topEightyPercent) {
    console.log(`    - ${name}`);
  }

  const outDir = path.resolve(process.cwd(), "data", "analysis");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${path.basename(dir)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n  Full report: ${outFile}\n`);
}

try {
  main();
} catch (error) {
  console.error(`\nAnalysis failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
