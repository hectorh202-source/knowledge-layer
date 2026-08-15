/**
 * Seeded pseudo-random helpers.
 *
 * Deterministic on purpose — the same seed produces the same dataset every run,
 * so a change in analysis output means the analysis changed, not the data.
 * Pass a different --seed when you want a different shaped business.
 */

/** mulberry32 — small, fast, good enough for fixtures. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rand {
  constructor(private rng: () => number) {}

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  bool(probability = 0.5): boolean {
    return this.rng() < probability;
  }

  /**
   * Picks an index from a weight array, proportional to the weights.
   * Used so job volume is realistic — lots of drain clearings, few repipes.
   */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.float(0, total);
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  /**
   * A value inside [min, max], skewed toward the lower end.
   *
   * Real job pricing isn't uniform — most jobs land near the bottom of the
   * range and a long tail runs high. Averaging a uniform distribution would
   * make every service look like its midpoint, which would quietly make the
   * pricing analysis useless.
   */
  skewed(min: number, max: number, skew = 1.7): number {
    const t = Math.pow(this.rng(), skew);
    return min + t * (max - min);
  }

  /** Rounds to a price-looking number: nearest $5 under $1k, nearest $25 above. */
  money(value: number): number {
    const step = value < 1000 ? 5 : 25;
    return Math.round(value / step) * step;
  }

  /** A date between `start` and `end`, as an ISO string. */
  dateBetween(start: Date, end: Date): string {
    const ms = this.float(start.getTime(), end.getTime());
    return new Date(ms).toISOString();
  }
}
