import { MIN_SAMPLE_FOR_PUBLISHING, publishableRange, summarize } from "./stats";
import type {
  CoverageReport,
  Dataset,
  JobTypeRevenue,
  RevenueReport,
} from "./types";

/**
 * Joins invoices to jobs to job types, then rolls up revenue per service.
 *
 * This answers OPEN-QUESTIONS 4.1 (which service brings in the most revenue)
 * and 4.3 (real price ranges, not the owner's estimate).
 *
 * Coverage is reported alongside the numbers on purpose. A revenue ranking
 * computed from 60% of invoices is a different claim than one computed from
 * 99%, and the difference should never be invisible.
 */

export function buildRevenueReport(dataset: Dataset): RevenueReport {
  const jobById = new Map(dataset.jobs.map((job) => [job.id, job]));
  const jobTypeById = new Map(dataset.jobTypes.map((type) => [type.id, type]));

  // Accumulate invoice amounts per job type.
  const amountsByType = new Map<number, number[]>();
  const jobsSeenByType = new Map<number, Set<number>>();

  let invoicesJoined = 0;
  let invoicesOrphaned = 0;
  let invoicesWithoutJobRef = 0;
  const jobIdsWithInvoice = new Set<number>();

  for (const invoice of dataset.invoices) {
    if (invoice.jobId === null) {
      invoicesWithoutJobRef++;
      continue;
    }

    const job = jobById.get(invoice.jobId);
    if (!job) {
      invoicesOrphaned++;
      continue;
    }

    jobIdsWithInvoice.add(job.id);

    if (job.jobTypeId === null) continue;

    invoicesJoined++;

    const amounts = amountsByType.get(job.jobTypeId) ?? [];
    amounts.push(invoice.subTotal);
    amountsByType.set(job.jobTypeId, amounts);

    const seen = jobsSeenByType.get(job.jobTypeId) ?? new Set<number>();
    seen.add(job.id);
    jobsSeenByType.set(job.jobTypeId, seen);
  }

  // Completed jobs per type, counted independently of invoicing so the gap
  // between "work done" and "work billed in this window" stays visible.
  const jobCountByType = new Map<number, number>();
  let jobsWithoutType = 0;
  for (const job of dataset.jobs) {
    if (job.jobTypeId === null) {
      jobsWithoutType++;
      continue;
    }
    jobCountByType.set(job.jobTypeId, (jobCountByType.get(job.jobTypeId) ?? 0) + 1);
  }

  const totalRevenue = [...amountsByType.values()]
    .flat()
    .reduce((sum, amount) => sum + amount, 0);

  const rows: JobTypeRevenue[] = [...amountsByType.entries()].map(([jobTypeId, amounts]) => {
    const distribution = summarize(amounts);
    return {
      jobTypeId,
      jobTypeName: jobTypeById.get(jobTypeId)?.name ?? `Unknown type ${jobTypeId}`,
      invoiceCount: amounts.length,
      jobCount: jobCountByType.get(jobTypeId) ?? amounts.length,
      revenue: distribution.total,
      revenueShare: totalRevenue > 0 ? distribution.total / totalRevenue : 0,
      distribution,
      publishRange: publishableRange(distribution),
      thinSample: amounts.length < MIN_SAMPLE_FOR_PUBLISHING,
    };
  });

  const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
  const byVolume = [...rows].sort((a, b) => b.jobCount - a.jobCount);

  // Which services carry the first 80% of revenue — the set worth writing
  // pricing pages for first.
  const topEightyPercent: string[] = [];
  let cumulative = 0;
  for (const row of byRevenue) {
    topEightyPercent.push(row.jobTypeName);
    cumulative += row.revenueShare;
    if (cumulative >= 0.8) break;
  }

  const coverage: CoverageReport = {
    jobs: dataset.jobs.length,
    invoices: dataset.invoices.length,
    invoicesJoined,
    invoicesOrphaned,
    invoicesWithoutJobRef,
    jobsWithoutInvoice: dataset.jobs.length - jobIdsWithInvoice.size,
    jobsWithoutType,
  };

  return {
    generatedAt: new Date().toISOString(),
    source: dataset.source,
    coverage,
    totalRevenue,
    byRevenue,
    byVolume,
    topEightyPercent,
    warnings: buildWarnings(dataset, coverage, rows),
  };
}

/**
 * Problems worth surfacing before anyone acts on these numbers.
 *
 * These are the checks that matter most when the real export replaces the mock,
 * because that's when field-mapping mistakes show up as coverage collapse rather
 * than as an error.
 */
function buildWarnings(
  dataset: Dataset,
  coverage: CoverageReport,
  rows: JobTypeRevenue[]
): string[] {
  const warnings: string[] = [];

  if (dataset.source.mock) {
    warnings.push(
      "Mock data. These numbers describe a fictional business — see OPEN-QUESTIONS 4.5."
    );
  }

  if (dataset.invoices.length === 0) {
    warnings.push("No invoices loaded. Revenue analysis is empty.");
  }

  if (dataset.jobTypes.length === 0) {
    warnings.push("No job types loaded — every service will show as 'Unknown type'.");
  }

  if (coverage.invoicesWithoutJobRef > 0) {
    const pct = ((coverage.invoicesWithoutJobRef / coverage.invoices) * 100).toFixed(1);
    warnings.push(
      `${coverage.invoicesWithoutJobRef} invoices (${pct}%) carry no job reference — ` +
        `revenue for those is excluded. If this is large, the job-id field name is likely wrong in normalize.ts.`
    );
  }

  if (coverage.invoicesOrphaned > 0) {
    const pct = ((coverage.invoicesOrphaned / coverage.invoices) * 100).toFixed(1);
    warnings.push(
      `${coverage.invoicesOrphaned} invoices (${pct}%) reference a job outside the export window.`
    );
  }

  if (coverage.jobsWithoutType > 0) {
    warnings.push(`${coverage.jobsWithoutType} jobs have no job type and are excluded from ranking.`);
  }

  const thin = rows.filter((row) => row.thinSample);
  if (thin.length > 0) {
    warnings.push(
      `${thin.length} service(s) have fewer than ${MIN_SAMPLE_FOR_PUBLISHING} invoices. ` +
        `Their ranges describe noise — do not publish them without widening the window.`
    );
  }

  return warnings;
}
