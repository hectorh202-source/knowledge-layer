import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  BusinessDto,
  FaqDto,
  KnowledgeSource,
  PriceFactorDto,
  PricingDto,
  ServiceAreaDto,
  ServiceDto,
  SourceOptions,
} from "../types";

/**
 * Serves the API from Supabase.
 *
 * Uses the ANON key, not the service role key. That is deliberate and it is the
 * security boundary of this whole layer: row level security decides what the
 * public can see, and the anon key is what makes RLS apply. A service role key
 * here would silently expose unpublished drafts and every other tenant's data.
 */
export class SupabaseSource implements KnowledgeSource {
  readonly kind = "supabase" as const;
  readonly tenant: string;

  private client: SupabaseClient;
  private includeUnreviewed: boolean;
  private tenantIdCache: string | null = null;

  constructor(options: SourceOptions) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_ANON_KEY are required for the supabase source. " +
          "Use --source files to serve from the latest export instead."
      );
    }

    if (process.env.SUPABASE_SERVICE_ROLE_KEY === anonKey) {
      throw new Error(
        "SUPABASE_ANON_KEY is set to the service role key. That bypasses row level " +
          "security and would expose unpublished and cross-tenant data publicly."
      );
    }

    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
    this.tenant = options.tenant;
    this.includeUnreviewed = options.includeUnreviewed;
  }

  private async tenantId(): Promise<string> {
    if (this.tenantIdCache) return this.tenantIdCache;

    const { data, error } = await this.client
      .from("tenants")
      .select("id")
      .eq("slug", this.tenant)
      .single();

    if (error || !data) {
      throw new Error(`Tenant "${this.tenant}" not found. Has the loader run?`);
    }

    this.tenantIdCache = String((data as Record<string, unknown>).id);
    return this.tenantIdCache;
  }

  async business(): Promise<BusinessDto> {
    const tenantId = await this.tenantId();

    const { data } = await this.client
      .from("tenants")
      .select("name, domain")
      .eq("id", tenantId)
      .single();

    const [areas, services] = await Promise.all([this.serviceAreas(), this.services()]);
    const row = (data ?? {}) as Record<string, unknown>;

    return {
      name: typeof row.name === "string" ? row.name : this.tenant,
      domain: typeof row.domain === "string" ? row.domain : null,
      serviceAreaCount: areas.length,
      serviceCount: services.length,
    };
  }

  async services(): Promise<ServiceDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.client
      .from("services")
      .select("display_name, category, description")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("display_name");

    if (error) throw new Error(`Loading services failed: ${error.message}`);

    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: String(r.display_name),
        category: typeof r.category === "string" ? r.category : null,
        description: typeof r.description === "string" ? r.description : null,
      };
    });
  }

  async serviceAreas(): Promise<ServiceAreaDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.client
      .from("service_areas")
      .select("name, zips, cities")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(`Loading service areas failed: ${error.message}`);

    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: String(r.name),
        zips: Array.isArray(r.zips) ? r.zips.map(String) : [],
        cities: Array.isArray(r.cities) ? r.cities.map(String) : [],
      };
    });
  }

  /**
   * Pricing joins authored content to computed statistics.
   *
   * service_content is the driver, not price_stats. That ordering is the
   * safeguard: a service with statistics but no reviewed write-up simply does
   * not appear. Published numbers require a human to have signed off.
   */
  async pricing(): Promise<PricingDto[]> {
    const tenantId = await this.tenantId();

    let query = this.client
      .from("service_content")
      .select(
        "headline, price_factors, included, excluded, override_low, override_high, reviewed_at, job_type_id"
      )
      .eq("tenant_id", tenantId);

    if (!this.includeUnreviewed) {
      query = query.eq("is_published", true);
    }

    const { data: content, error } = await query;
    if (error) throw new Error(`Loading pricing content failed: ${error.message}`);
    if (!content || content.length === 0) return [];

    const jobTypeIds = content
      .map((row) => (row as Record<string, unknown>).job_type_id)
      .filter((id): id is string => typeof id === "string");

    const { data: stats } = await this.client
      .from("latest_price_stats")
      .select("job_type_id, publish_low, publish_high, thin_sample")
      .in("job_type_id", jobTypeIds);

    const statsByJobType = new Map(
      (stats ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return [String(r.job_type_id), r];
      })
    );

    return content.flatMap((row) => {
      const r = row as Record<string, unknown>;
      const stat = statsByJobType.get(String(r.job_type_id));

      // An explicit override always wins — it exists precisely for when the
      // statistics are wrong or the sample is too thin to trust.
      const low = numberOr(r.override_low, stat?.publish_low);
      const high = numberOr(r.override_high, stat?.publish_high);

      // No range from either source means there is nothing citable to publish.
      if (low === null || high === null) return [];

      return [
        {
          service: String(r.headline),
          currency: "USD" as const,
          low,
          high,
          unit: "job" as const,
          factors: parseFactors(r.price_factors),
          included: Array.isArray(r.included) ? r.included.map(String) : [],
          excluded: Array.isArray(r.excluded) ? r.excluded.map(String) : [],
          reviewedAt: typeof r.reviewed_at === "string" ? r.reviewed_at : null,
        },
      ];
    });
  }

  async faqs(): Promise<FaqDto[]> {
    const tenantId = await this.tenantId();

    let query = this.client
      .from("faqs")
      .select("question, answer, job_type_id")
      .eq("tenant_id", tenantId)
      .eq("is_approved", true)
      .order("sort_order");

    if (!this.includeUnreviewed) {
      query = query.eq("is_published", true);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Loading FAQs failed: ${error.message}`);

    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        question: String(r.question),
        answer: String(r.answer),
        service: null,
      };
    });
  }
}

function numberOr(primary: unknown, fallback: unknown): number | null {
  const first = toNumber(primary);
  if (first !== null) return first;
  return toNumber(fallback);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseFactors(value: unknown): PriceFactorDto[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.factor !== "string") return [];

    const effect = e.effect === "up" || e.effect === "down" ? e.effect : "varies";
    return [
      {
        factor: e.factor,
        effect,
        ...(typeof e.detail === "string" ? { detail: e.detail } : {}),
      },
    ];
  });
}
