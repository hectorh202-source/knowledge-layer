import type { Distribution } from "./types";

/**
 * Distribution math for job pricing.
 *
 * The important decision here is which numbers become a *published* price range.
 * Min–max is the wrong answer: one cancelled job billed at a diagnostic fee and
 * one disaster job with a slab tear-out would widen "water heater replacement"
 * to $150–$9,000, which is useless to a customer and useless to an AI.
 *
 * p10–p90 describes what actually happens on most jobs while still admitting the
 * tail exists.
 */

/** Linear-interpolated percentile (the R-7 / Excel convention). */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const rank = (sortedValues.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);

  if (lower === upper) return sortedValues[lower];

  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function summarize(values: number[]): Distribution {
  if (values.length === 0) {
    return { n: 0, min: 0, p10: 0, p25: 0, median: 0, p75: 0, p90: 0, max: 0, mean: 0, total: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);

  return {
    n: sorted.length,
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    mean: total / sorted.length,
    total,
  };
}

/** Rounds down to a clean number a customer would expect to see. */
function roundDown(value: number): number {
  const step = value < 1000 ? 25 : value < 5000 ? 50 : 100;
  return Math.floor(value / step) * step;
}

/** Rounds up to a clean number. */
function roundUp(value: number): number {
  const step = value < 1000 ? 25 : value < 5000 ? 50 : 100;
  return Math.ceil(value / step) * step;
}

/**
 * The range to actually put on a pricing page.
 *
 * Widened outward to clean numbers rather than inward — a published range that
 * quietly excludes real jobs is a range you have to walk back on the phone.
 */
export function publishableRange(distribution: Distribution): { low: number; high: number } {
  return {
    low: roundDown(distribution.p10),
    high: roundUp(distribution.p90),
  };
}

/**
 * Below this many invoices, a percentile range is describing noise.
 * Seven repipes cannot tell you what a repipe costs.
 */
export const MIN_SAMPLE_FOR_PUBLISHING = 12;
