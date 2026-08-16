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
import type {
  AttributeEntry,
  BusinessType,
  ContactPointEntry,
  SpecialHours,
} from "../../data/profile";

/**
 * Serves the API from Supabase.
 *
 * Uses the ANON key, never the service role key. That is the security boundary
 * of this layer: row level security decides what the public sees, and the anon
 * key is what makes RLS apply. A service role key here would silently expose
 * unpublished drafts and every other tenant's data.
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
          "Use --source files to serve from local content instead."
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
      throw new Error(`Tenant "${this.tenant}" not found. Has content been loaded?`);
    }

    this.tenantIdCache = String((data as Record<string, unknown>).id);
    return this.tenantIdCache;
  }

  /** Applies the approved-and-published gate unless previewing. */
  private gate(query: any) {
    if (this.includeUnreviewed) return query;
    return query.eq("is_approved", true).eq("is_published", true);
  }

  async business(): Promise<BusinessDto | null> {
    const tenantId = await this.tenantId();

    let query = this.client
      .from("business_profile")
      .select(
        "name, legal_name, description, phone, email, domain, street, city, region, " +
          "postal_code, country, gbp_url, founded_year, primary_category, business_type, schema_type, same_as, " +
          "alternate_name, slogan, logo_url, image_urls, price_range, payment_accepted, " +
          "currencies_accepted, languages, geo_latitude, geo_longitude, has_map, " +
          "number_of_employees, awards, member_of, founder, contact_points, " +
          "booking_url, special_hours, attributes"
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
        opens: text(h.opens),
        closes: text(h.closes),
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
      hours,
      primaryCategory: text(r.primary_category),
      businessType: businessType(r.business_type),
      schemaType: text(r.schema_type) ?? "LocalBusiness",
      sameAs: strings(r.same_as),

      alternateName: text(r.alternate_name),
      slogan: text(r.slogan),
      logoUrl: text(r.logo_url),
      imageUrls: strings(r.image_urls),

      priceRange: text(r.price_range),
      paymentAccepted: strings(r.payment_accepted),
      currenciesAccepted: text(r.currencies_accepted),

      languages: strings(r.languages),
      // Stored as two columns so they can be indexed and queried by distance;
      // reassembled into one object because half a coordinate is meaningless.
      geo:
        typeof r.geo_latitude === "number" && typeof r.geo_longitude === "number"
          ? { latitude: r.geo_latitude, longitude: r.geo_longitude }
          : null,
      hasMap: text(r.has_map),

      numberOfEmployees:
        typeof r.number_of_employees === "number" ? r.number_of_employees : null,
      awards: strings(r.awards),
      memberOf: strings(r.member_of),
      founder: text(r.founder),

      contactPoints: Array.isArray(r.contact_points)
        ? (r.contact_points as ContactPointEntry[])
        : [],
      bookingUrl: text(r.booking_url),

      specialHours: Array.isArray(r.special_hours) ? (r.special_hours as SpecialHours[]) : [],

      attributes: Array.isArray(r.attributes) ? (r.attributes as AttributeEntry[]) : [],

      serviceCount: services.length,
      serviceAreaCount: areas.length,
    };
  }

  async services(): Promise<ServiceDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.gate(
      this.client
        .from("services")
        .select("name, category, description")
        .eq("tenant_id", tenantId)
    ).order("sort_order");

    if (error) throw new Error(`Loading services failed: ${error.message}`);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      name: String(row.name),
      category: text(row.category),
      description: text(row.description),
    }));
  }

  async serviceAreas(): Promise<ServiceAreaDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.gate(
      this.client.from("service_areas").select("name, zips").eq("tenant_id", tenantId)
    ).order("name");

    if (error) throw new Error(`Loading service areas failed: ${error.message}`);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      name: String(row.name),
      zips: Array.isArray(row.zips) ? row.zips.map(String) : [],
      cities: [String(row.name)],
    }));
  }

  async brands(): Promise<BrandDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.gate(
      this.client.from("brands").select("name").eq("tenant_id", tenantId)
    ).order("name");

    if (error) throw new Error(`Loading brands failed: ${error.message}`);
    return (data ?? []).map((row: Record<string, unknown>) => ({ name: String(row.name) }));
  }

  async faqs(): Promise<FaqDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.gate(
      this.client.from("faqs").select("question, answer").eq("tenant_id", tenantId)
    ).order("sort_order");

    if (error) throw new Error(`Loading FAQs failed: ${error.message}`);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      question: String(row.question),
      answer: String(row.answer),
      service: null,
    }));
  }

  async credentials(): Promise<CredentialDto[]> {
    const tenantId = await this.tenantId();

    const { data, error } = await this.gate(
      this.client
        .from("credentials")
        .select("kind, title, identifier, issuer, valid_until")
        .eq("tenant_id", tenantId)
    );

    if (error) throw new Error(`Loading credentials failed: ${error.message}`);

    const today = new Date().toISOString().slice(0, 10);

    return (data ?? [])
      .filter((row: Record<string, unknown>) => {
        const validUntil = row.valid_until;
        return typeof validUntil !== "string" || validUntil >= today;
      })
      .map((row: Record<string, unknown>) => ({
        kind: String(row.kind),
        title: String(row.title),
        identifier: text(row.identifier),
        issuer: text(row.issuer),
        validUntil: text(row.valid_until),
      }));
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Postgres text[] arrives as an array; anything else means the column is null. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter((entry) => entry.trim() !== "") : [];
}

/**
 * The column has a check constraint, but the API must not crash on a row that
 * predates it or was written by hand.
 */
function businessType(value: unknown): BusinessType {
  return value === "service_area" || value === "hybrid" ? value : "storefront";
}
