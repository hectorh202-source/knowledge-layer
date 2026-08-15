/**
 * Public API shapes.
 *
 * Deliberately not database rows and not ServiceTitan records. This is the
 * third boundary in the pipeline:
 *
 *   ServiceTitan JSON  --normalize.ts-->  domain types
 *   domain types       --loader-------->  database rows
 *   database rows      --this file----->  public API
 *
 * Each boundary means an upstream change is absorbed in one place. Internal ids,
 * sync timestamps, and unreviewed drafts stop here and never reach a consumer.
 */

export interface ServiceDto {
  name: string;
  category: string | null;
  description: string | null;
}

export interface ServiceAreaDto {
  name: string;
  zips: string[];
  cities: string[];
}

export interface PriceFactorDto {
  factor: string;
  /** Which direction this pushes the price. */
  effect: "up" | "down" | "varies";
  detail?: string;
}

/**
 * The endpoint that matters. An AI cannot cite a number nobody published.
 *
 * `low`/`high` are a reviewed range, never a raw min-max — see stats.ts for why.
 * `factors` is what makes the range defensible rather than a bare price tag.
 */
export interface PricingDto {
  service: string;
  currency: "USD";
  low: number;
  high: number;
  unit: "job";
  factors: PriceFactorDto[];
  included: string[];
  excluded: string[];
  /** ISO date a human last signed off on this. Staleness is a public fact. */
  reviewedAt: string | null;
}

export interface FaqDto {
  question: string;
  answer: string;
  service: string | null;
}

export interface BusinessDto {
  name: string;
  domain: string | null;
  serviceAreaCount: number;
  serviceCount: number;
}

/**
 * Where the API reads from.
 *
 * Two implementations: Supabase (real) and files (the latest export on disk).
 * The file source exists because there is no Supabase project yet, and an API
 * that cannot run is an API nobody reviews. Same reasoning as `--mock`.
 */
export interface KnowledgeSource {
  readonly kind: "supabase" | "files";
  readonly tenant: string;

  business(): Promise<BusinessDto>;
  services(): Promise<ServiceDto[]>;
  serviceAreas(): Promise<ServiceAreaDto[]>;
  pricing(): Promise<PricingDto[]>;
  faqs(): Promise<FaqDto[]>;
}

export interface SourceOptions {
  tenant: string;
  /**
   * Serve pricing that no human has reviewed. Local inspection only.
   * Publishing an unreviewed statistical range is how a thin sample becomes a
   * quote you have to walk back on the phone.
   */
  includeUnreviewed: boolean;
}
