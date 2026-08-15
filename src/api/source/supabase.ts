import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  BrandDto,
  BusinessDto,
  CredentialDto,
  FaqDto,
  HoursDto,
  KnowledgeSource,
  ServiceAreaDto,
  ServiceDto,
  SourceOptions,
} from "../types";

/**
 * Serves the API from Supabase.
 *
 * Uses the ANON key, not the service role key. That is the security boundary of
 * this whole layer: row level security decides what the public can see, and the
 * anon key is what makes RLS apply. A service role key here would silently
 * expose unpublished drafts and every other tenant's data.
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
          "Use --source files to serve from local files instead."
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

  async business(): Promise<BusinessDto | null> {
    const tenantId = await this.tenantId();

    let query = this.client
      .from("business_profile")
      .select(
        "name, legal_name, description, phone, email, domain, street, city, region, " +
          "postal_code, country, gbp_url, founded_year, response_time, emergency_service"
      )
      .eq("tenant_id", tenantId);

    if (!this.includeUnreviewed) query = query.eq("is_published", true);

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Loading business profile failed: ${error.message}`);
    if (!data) return null;

    const r = data as unknown as Record<string, unknown>;

    const { data: hoursRows } = await this.client
      .from("business_hours")
      .select("day_of_week, opens, closes, is_closed")
      .eq("tenant_id", tenantId)
      .order("day_of_week");

    const hours: HoursDto[] = (hoursRows ?? []).map((row) => {
      const h = row as Record<string, unknown>;
      return {
        day: Number(h.day_of_week),
        opens: typeof h.opens === "string" ? h.opens : null,
        closes: typeof h.closes === "string" ? h.closes : null,
        isClosed: h.is_closed === true,
      };
    });

    const [services, areas] = await Promise.all([this.services(), this.serviceAreas()]);

    return {
      name: String(r.name),
      legalName: text(r.legal_name),
      description: text(r.description),
      phone: text(r.phone),
      email: text(r.email),
      domain: text(r.domain),
      address: {
        street: text(r.street),
        city: text(r.city),
        region: text(r.region),
        postalCode: text(r.postal_code),
        country: text(r.country) ?? "US",
      },
      gbpUrl: text(r.gbp_url),
      foundedYear: typeof r.founded_year === "number" ? r.founded_year : null,
      responseTime: text(r.response_time),
      emergencyService: r.emergency_service === true,
      hours,
      serviceCount: services.length,
      serviceAreaCount: areas.length,
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
        category: text(r.category),
        description: text(r.description),
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

  async brands(): Promise<BrandDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.client
      .from("brands")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(`Loading brands failed: ${error.message}`);
    return (data ?? []).map((row) => ({ name: String((row as Record<string, unknown>).name) }));
  }

  async faqs(): Promise<FaqDto[]> {
    const tenantId = await this.tenantId();

    let query = this.client
      .from("faqs")
      .select("question, answer")
      .eq("tenant_id", tenantId)
      .order("sort_order");

    // Both gates lift together, matching the file source. Note that RLS also
    // enforces approved-and-published for anonymous readers, so this flag can
    // only widen results for a caller the policies already trust.
    if (!this.includeUnreviewed) {
      query = query.eq("is_approved", true).eq("is_published", true);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Loading FAQs failed: ${error.message}`);

    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return { question: String(r.question), answer: String(r.answer), service: null };
    });
  }

  async credentials(): Promise<CredentialDto[]> {
    const tenantId = await this.tenantId();

    let query = this.client
      .from("credentials")
      .select("kind, title, identifier, issuer, valid_until")
      .eq("tenant_id", tenantId);

    if (!this.includeUnreviewed) query = query.eq("is_published", true);

    const { data, error } = await query;
    if (error) throw new Error(`Loading credentials failed: ${error.message}`);

    const today = new Date().toISOString().slice(0, 10);

    return (data ?? [])
      // A lapsed license published as current is the worst kind of stale
      // record — it's a claim about compliance that stopped being true.
      .filter((row) => {
        const validUntil = (row as Record<string, unknown>).valid_until;
        return typeof validUntil !== "string" || validUntil >= today;
      })
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          kind: String(r.kind),
          title: String(r.title),
          identifier: text(r.identifier),
          issuer: text(r.issuer),
        };
      });
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
