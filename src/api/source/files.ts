import * as fs from "fs";
import * as path from "path";
import { latestRunDir, loadDataset } from "../../analysis/normalize";
import { buildRevenueReport } from "../../analysis/revenue";
import type {
  BusinessDto,
  FaqDto,
  KnowledgeSource,
  PricingDto,
  ServiceAreaDto,
  ServiceDto,
  SourceOptions,
} from "../types";

/**
 * Serves the API from the latest export on disk instead of Supabase.
 *
 * This exists so the API is runnable before a Supabase project exists. It reads
 * the same files the loader reads, so what you see here is what would land in
 * the database.
 *
 * The important thing it CANNOT do: serve authored content. Pricing factors,
 * FAQs, policies, and credentials live only in the database because they're
 * written by a person, not derived from an export. So `/v1/faqs` is empty here
 * and `/v1/pricing` returns nothing unless --include-unreviewed is set.
 *
 * That emptiness is accurate, not a bug. It's the shape of the real bottleneck:
 * the pipeline is finished and the content isn't.
 */
export class FileSource implements KnowledgeSource {
  readonly kind = "files" as const;
  readonly tenant: string;

  private dir: string;
  private includeUnreviewed: boolean;

  constructor(options: SourceOptions, dir?: string) {
    this.tenant = options.tenant;
    this.includeUnreviewed = options.includeUnreviewed;
    this.dir = dir ?? latestRunDir();
  }

  private readRaw(name: string): Record<string, unknown>[] {
    const file = path.join(this.dir, `${name}.json`);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  }

  async business(): Promise<BusinessDto> {
    const [areas, services] = await Promise.all([this.serviceAreas(), this.services()]);
    return {
      name: this.tenant,
      domain: null,
      serviceAreaCount: areas.length,
      serviceCount: services.length,
    };
  }

  async services(): Promise<ServiceDto[]> {
    const categories = new Map(
      this.readRaw("pricebook-categories").map((row) => [String(row.id), String(row.name ?? "")])
    );

    return this.readRaw("pricebook-services")
      .filter((row) => row.active !== false)
      .map((row) => ({
        name: String(row.displayName ?? "Unnamed service"),
        category: categories.get(String(row.categoryId)) ?? null,
        description: typeof row.description === "string" ? row.description : null,
      }));
  }

  async serviceAreas(): Promise<ServiceAreaDto[]> {
    return this.readRaw("zones")
      .filter((row) => row.active !== false)
      .map((row) => ({
        name: String(row.name ?? "Unnamed area"),
        zips: Array.isArray(row.zips) ? row.zips.map(String) : [],
        cities: Array.isArray(row.cities) ? row.cities.map(String) : [],
      }));
  }

  async pricing(): Promise<PricingDto[]> {
    // No authored content on disk, so every range here is unreviewed by
    // definition. Serving these publicly would put unvetted statistics in front
    // of an AI, including the thin samples the analysis step flagged.
    if (!this.includeUnreviewed) return [];

    const report = buildRevenueReport(loadDataset(this.dir));

    return report.byRevenue
      .filter((row) => !row.thinSample)
      .map((row) => ({
        service: row.jobTypeName,
        currency: "USD" as const,
        low: row.publishRange.low,
        high: row.publishRange.high,
        unit: "job" as const,
        factors: [],
        included: [],
        excluded: [],
        reviewedAt: null,
      }));
  }

  async faqs(): Promise<FaqDto[]> {
    // Authored only. There is nothing to read from an export.
    return [];
  }
}
