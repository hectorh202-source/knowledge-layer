import * as fs from "fs";
import * as path from "path";

/**
 * Where a client's working data lives.
 *
 * One interface, two implementations. Files are the local single-operator
 * setup this app began as, and remain the fallback whenever Supabase is not
 * configured — the CLI tools run that way, and it keeps the whole migration
 * reversible if something goes wrong halfway.
 *
 * Supabase is what makes the portal deployable at all. A container's filesystem
 * is ephemeral, so a file-backed portal would lose every client on each
 * release. That is the entire reason this layer exists.
 *
 * Everything here is async, including the file implementation where it need not
 * be. A synchronous fallback would mean two different shapes for the same
 * operation and a caller that works locally and breaks in production — the
 * expensive kind of difference. One signature, always.
 */

export type ContentKind = "services" | "service-areas" | "brands" | "faqs" | "credentials";

export const CONTENT_KINDS: ContentKind[] = [
  "services",
  "service-areas",
  "brands",
  "faqs",
  "credentials",
];

export type IntakeSource = "website" | "places";

/**
 * The `content_source` enum, mirrored.
 *
 * Kept in step with supabase/migrations by hand, which is a real cost — but the
 * alternative is a Postgres type error killing an entire batch of content over
 * one unrecognised label.
 */
export const CONTENT_SOURCES = ["gbp", "places", "website", "manual", "generated"] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

export interface Tier1State {
  report: unknown | null;
  manual: Record<string, { checked: boolean; note?: string }>;
}

export interface Storage {
  readonly kind: "files" | "supabase";

  listTenants(): Promise<string[]>;
  tenantExists(slug: string): Promise<boolean>;
  createTenant(slug: string): Promise<void>;
  deleteTenant(slug: string): Promise<void>;

  readSettings(slug: string): Promise<Record<string, unknown> | null>;
  writeSettings(slug: string, settings: Record<string, unknown>): Promise<void>;

  readProfile(slug: string): Promise<Record<string, unknown> | null>;
  writeProfile(slug: string, profile: Record<string, unknown>): Promise<void>;

  readContent(slug: string, kind: ContentKind): Promise<Record<string, unknown>[]>;
  writeContent(slug: string, kind: ContentKind, items: unknown[]): Promise<void>;

  readTier1(slug: string): Promise<Tier1State>;
  writeTier1(slug: string, state: Tier1State): Promise<void>;

  readIntake(slug: string, source: IntakeSource): Promise<Record<string, unknown> | null>;
  writeIntake(slug: string, source: IntakeSource, result: unknown): Promise<void>;
  /**
   * Every source that has run, with when it ran.
   *
   * `ranAt` is what makes the Sources view honest — a crawl from March
   * presented without a date reads as current, and the whole point of the view
   * is knowing whether the candidates on screen are stale.
   */
  listIntake(slug: string): Promise<IntakeRun[]>;
}

export interface IntakeRun {
  source: IntakeSource;
  result: Record<string, unknown>;
  /** ISO timestamp, or null when the store cannot say. */
  ranAt: string | null;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const TENANTS_DIR = path.join(process.cwd(), "content", "tenants");

export class FileStorage implements Storage {
  readonly kind = "files" as const;

  private dir(slug: string): string {
    return path.join(TENANTS_DIR, slug);
  }

  private read(file: string): Record<string, unknown> | null {
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private write(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  }

  async listTenants(): Promise<string[]> {
    if (!fs.existsSync(TENANTS_DIR)) return [];
    return fs
      .readdirSync(TENANTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  async tenantExists(slug: string): Promise<boolean> {
    return fs.existsSync(this.dir(slug));
  }

  async createTenant(slug: string): Promise<void> {
    fs.mkdirSync(this.dir(slug), { recursive: true });
  }

  async deleteTenant(slug: string): Promise<void> {
    fs.rmSync(this.dir(slug), { recursive: true, force: true });
  }

  async readSettings(slug: string) {
    return this.read(path.join(this.dir(slug), "settings.json"));
  }
  async writeSettings(slug: string, settings: Record<string, unknown>) {
    this.write(path.join(this.dir(slug), "settings.json"), settings);
  }

  async readProfile(slug: string) {
    return this.read(path.join(this.dir(slug), "business-profile.json"));
  }
  async writeProfile(slug: string, profile: Record<string, unknown>) {
    this.write(path.join(this.dir(slug), "business-profile.json"), profile);
  }

  async readContent(slug: string, kind: ContentKind) {
    const parsed = this.read(path.join(this.dir(slug), `${kind}.json`));
    const items = (parsed as { items?: unknown } | null)?.items;
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  }
  async writeContent(slug: string, kind: ContentKind, items: unknown[]) {
    this.write(path.join(this.dir(slug), `${kind}.json`), { items });
  }

  async readTier1(slug: string): Promise<Tier1State> {
    const parsed = this.read(path.join(this.dir(slug), "tier1.json")) as Tier1State | null;
    return { report: parsed?.report ?? null, manual: parsed?.manual ?? {} };
  }
  async writeTier1(slug: string, state: Tier1State) {
    this.write(path.join(this.dir(slug), "tier1.json"), state);
  }

  async readIntake(slug: string, source: IntakeSource) {
    return this.read(path.join(this.dir(slug), "intake", `${source}.json`));
  }
  async writeIntake(slug: string, source: IntakeSource, result: unknown) {
    this.write(path.join(this.dir(slug), "intake", `${source}.json`), result);
  }
  async listIntake(slug: string): Promise<IntakeRun[]> {
    const out: IntakeRun[] = [];
    for (const source of ["website", "places"] as IntakeSource[]) {
      const file = path.join(this.dir(slug), "intake", `${source}.json`);
      const result = this.read(file);
      if (!result) continue;
      out.push({ source, result, ranAt: fs.statSync(file).mtime.toISOString() });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/**
 * Reached with the service role.
 *
 * The portal has already authenticated the user and checked their agency by the
 * time anything here runs, and these are working tables rather than published
 * output — none of it is crawler-facing, and the anon key has no grant on them
 * at all.
 */
/** "08:00:00" to "08:00". Null and already-short values pass through. */
function trimSeconds(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2}:\d{2})(:\d{2})?/);
  return match ? match[1] : value;
}

export class SupabaseStorage implements Storage {
  readonly kind = "supabase" as const;

  constructor(private url: string, private key: string) {}

  private async rest(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    // DELETE with no representation returns an empty body.
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * Slug to tenant id.
   *
   * Cached for the life of the process: a slug's id never changes, and without
   * this every content read costs two round trips.
   */
  private ids = new Map<string, string>();

  private async tenantId(slug: string): Promise<string | null> {
    const cached = this.ids.get(slug);
    if (cached) return cached;

    const rows = (await this.rest(
      `tenants?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`
    )) as { id: string }[];

    if (rows.length === 0) return null;
    this.ids.set(slug, rows[0].id);
    return rows[0].id;
  }

  private async requireTenantId(slug: string): Promise<string> {
    const id = await this.tenantId(slug);
    if (!id) throw new Error(`No tenant "${slug}" in the database.`);
    return id;
  }

  async listTenants(): Promise<string[]> {
    const rows = (await this.rest(`tenants?select=slug&order=slug`)) as { slug: string }[];
    return rows.map((row) => row.slug);
  }

  async tenantExists(slug: string): Promise<boolean> {
    return (await this.tenantId(slug)) !== null;
  }

  /**
   * Idempotent, deliberately.
   *
   * A tenants row can already exist without the client being set up here at
   * all: `content:load` creates one to hang published content off. A plain
   * insert 409s on exactly those clients — the ones that most need the rest of
   * their data created.
   *
   * Check-then-insert rather than an upsert, because an upsert would write
   * `name: slug` over a real business name. The race it leaves is a 409 on
   * simultaneous creation of the same slug, which is the correct outcome.
   */
  async createTenant(slug: string): Promise<void> {
    const existing = await this.tenantId(slug);
    if (existing) return;

    const rows = (await this.rest(`tenants`, {
      method: "POST",
      body: JSON.stringify({ slug, name: slug }),
    })) as { id: string }[];
    if (rows?.[0]?.id) this.ids.set(slug, rows[0].id);
  }

  async deleteTenant(slug: string): Promise<void> {
    // Everything else cascades from the tenants row.
    await this.rest(`tenants?slug=eq.${encodeURIComponent(slug)}`, { method: "DELETE" });
    this.ids.delete(slug);
  }

  // --- settings -------------------------------------------------------------

  async readSettings(slug: string) {
    const id = await this.tenantId(slug);
    if (!id) return null;

    const rows = (await this.rest(`tenant_settings?tenant_id=eq.${id}&select=*`)) as
      | Record<string, unknown>[]
      | null;
    const row = rows?.[0];
    if (!row) return null;

    // Back into the shape the portal already speaks. The database is flat
    // because flat columns are editable and greppable; the app groups them
    // because that is how they are presented.
    return {
      slug,
      apiBaseUrl: row.api_base_url ?? "",
      sources: {
        servicesPageUrl: row.services_page_url ?? "",
        serviceAreasPageUrl: row.service_areas_page_url ?? "",
        googlePlaceId: row.google_place_id ?? "",
      },
      links: {
        cloudflareUrl: row.cloudflare_url ?? "",
        cloudflareOwner: row.cloudflare_owner ?? "",
        searchConsoleUrl: row.search_console_url ?? "",
        gbpManageUrl: row.gbp_manage_url ?? "",
        hostingProvider: row.hosting_provider ?? "",
        hostingUrl: row.hosting_url ?? "",
        registrar: row.registrar ?? "",
        cmsUrl: row.cms_url ?? "",
      },
      notes: row.notes ?? "",
      createdAt: row.created_at ?? "",
    };
  }

  async writeSettings(slug: string, settings: Record<string, unknown>) {
    const id = await this.requireTenantId(slug);
    const sources = (settings.sources ?? {}) as Record<string, string>;
    const links = (settings.links ?? {}) as Record<string, string>;

    await this.rest(`tenant_settings?on_conflict=tenant_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        tenant_id: id,
        api_base_url: settings.apiBaseUrl ?? "",
        services_page_url: sources.servicesPageUrl ?? "",
        service_areas_page_url: sources.serviceAreasPageUrl ?? "",
        google_place_id: sources.googlePlaceId ?? "",
        cloudflare_url: links.cloudflareUrl ?? "",
        cloudflare_owner: links.cloudflareOwner ?? "",
        search_console_url: links.searchConsoleUrl ?? "",
        gbp_manage_url: links.gbpManageUrl ?? "",
        hosting_provider: links.hostingProvider ?? "",
        hosting_url: links.hostingUrl ?? "",
        registrar: links.registrar ?? "",
        cms_url: links.cmsUrl ?? "",
        notes: settings.notes ?? "",
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // --- profile ---------------------------------------------------------------

  async readProfile(slug: string) {
    const id = await this.tenantId(slug);
    if (!id) return null;

    const rows = (await this.rest(`business_profile?tenant_id=eq.${id}&select=*`)) as
      | Record<string, unknown>[]
      | null;
    const row = rows?.[0];
    if (!row) return null;

    const hours = (await this.rest(
      `business_hours?tenant_id=eq.${id}&select=day_of_week,opens,closes,is_closed&order=day_of_week`
    )) as { day_of_week: number; opens: string | null; closes: string | null; is_closed: boolean }[];

    return {
      name: row.name ?? "",
      legalName: row.legal_name,
      description: row.description,
      phone: row.phone,
      email: row.email,
      domain: row.domain,
      address: {
        street: row.street,
        city: row.city,
        region: row.region,
        postalCode: row.postal_code,
        country: row.country ?? "US",
      },
      gbpUrl: row.gbp_url,
      foundedYear: row.founded_year,
      primaryCategory: row.primary_category,
      businessType: row.business_type ?? "storefront",
      schemaType: row.schema_type ?? "LocalBusiness",
      sameAs: row.same_as ?? [],
      alternateName: row.alternate_name,
      slogan: row.slogan,
      logoUrl: row.logo_url,
      imageUrls: row.image_urls ?? [],
      priceRange: row.price_range,
      paymentAccepted: row.payment_accepted ?? [],
      currenciesAccepted: row.currencies_accepted,
      languages: row.languages ?? [],
      geo:
        typeof row.geo_latitude === "number" && typeof row.geo_longitude === "number"
          ? { latitude: row.geo_latitude, longitude: row.geo_longitude }
          : null,
      hasMap: row.has_map,
      numberOfEmployees: row.number_of_employees,
      awards: row.awards ?? [],
      memberOf: row.member_of ?? [],
      founder: row.founder,
      contactPoints: row.contact_points ?? [],
      bookingUrl: row.booking_url,
      specialHours: row.special_hours ?? [],
      attributes: row.attributes ?? [],
      hours: hours.map((h) => ({
        day: h.day_of_week,
        // Postgres `time` comes back as HH:MM:SS where the file store holds
        // HH:MM. Left alone, the same client's markup differs depending on
        // which backend served it, which defeats the point of having two
        // interchangeable implementations.
        opens: trimSeconds(h.opens),
        closes: trimSeconds(h.closes),
        isClosed: h.is_closed,
      })),
    };
  }

  async writeProfile(slug: string, profile: Record<string, unknown>) {
    const id = await this.requireTenantId(slug);
    const address = (profile.address ?? {}) as Record<string, unknown>;
    const geo = (profile.geo ?? null) as { latitude?: number; longitude?: number } | null;

    // The raw profile is whatever is in the editor, placeholders included. Text
    // columns tolerate a stray "TODO"; typed ones reject it and take the whole
    // save down with them, which is how the hours bug surfaced.
    const num = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;

    await this.rest(`business_profile?on_conflict=tenant_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        tenant_id: id,
        name: profile.name ?? "",
        legal_name: profile.legalName ?? null,
        description: profile.description ?? null,
        phone: profile.phone ?? null,
        email: profile.email ?? null,
        domain: profile.domain ?? null,
        street: address.street ?? null,
        city: address.city ?? null,
        region: address.region ?? null,
        postal_code: address.postalCode ?? null,
        country: address.country ?? "US",
        gbp_url: profile.gbpUrl ?? null,
        founded_year: num(profile.foundedYear),
        primary_category: profile.primaryCategory ?? null,
        business_type: profile.businessType ?? "storefront",
        schema_type: profile.schemaType ?? "LocalBusiness",
        same_as: profile.sameAs ?? [],
        alternate_name: profile.alternateName ?? null,
        slogan: profile.slogan ?? null,
        logo_url: profile.logoUrl ?? null,
        image_urls: profile.imageUrls ?? [],
        price_range: profile.priceRange ?? null,
        payment_accepted: profile.paymentAccepted ?? [],
        currencies_accepted: profile.currenciesAccepted ?? null,
        languages: profile.languages ?? [],
        geo_latitude: num(geo?.latitude),
        geo_longitude: num(geo?.longitude),
        has_map: profile.hasMap ?? null,
        number_of_employees: num(profile.numberOfEmployees),
        awards: profile.awards ?? [],
        member_of: profile.memberOf ?? [],
        founder: profile.founder ?? null,
        contact_points: profile.contactPoints ?? [],
        booking_url: profile.bookingUrl ?? null,
        special_hours: profile.specialHours ?? [],
        attributes: profile.attributes ?? [],
      }),
    });

    // The tenant row carries the display name for the client list.
    await this.rest(`tenants?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: profile.name ?? slug }),
    });

    await this.writeHours(id, Array.isArray(profile.hours) ? profile.hours : []);
  }

  /**
   * The week, cleaned to what Postgres will accept as a `time`.
   *
   * The same rule `parseHours` applies when reading a profile: a value that is
   * not HH:MM is not a time, and a day that is neither closed nor timed is
   * unknown rather than open. The unfilled template is full of literal "TODO"
   * strings in exactly these fields, and sending one to a `time` column fails
   * the whole profile save with a type error.
   *
   * Rows are replaced rather than merged, so removing a day's hours in the
   * portal actually removes them instead of leaving yesterday's answer behind.
   */
  private async writeHours(tenantId: string, raw: unknown[]): Promise<void> {
    const time = (value: unknown): string | null =>
      typeof value === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(value.trim())
        ? trimSeconds(value.trim())
        : null;

    const rows = raw.flatMap((entry) => {
      const h = (entry ?? {}) as Record<string, unknown>;
      const day = typeof h.day === "number" ? h.day : null;
      if (day === null || day < 0 || day > 6) return [];

      const isClosed = h.isClosed === true;
      const opens = isClosed ? null : time(h.opens);
      const closes = isClosed ? null : time(h.closes);
      if (!isClosed && (!opens || !closes)) return [];

      return [{ tenant_id: tenantId, day_of_week: day, opens, closes, is_closed: isClosed }];
    });

    await this.rest(`business_hours?tenant_id=eq.${tenantId}`, { method: "DELETE" });
    if (rows.length === 0) return;

    await this.rest(`business_hours`, { method: "POST", body: JSON.stringify(rows) });
  }

  // --- content ---------------------------------------------------------------

  /** Column shapes differ per kind, so each needs its own mapping both ways. */
  private table(kind: ContentKind): string {
    return kind === "service-areas" ? "service_areas" : kind;
  }

  private toRow(kind: ContentKind, item: Record<string, unknown>, tenantId: string, index: number) {
    const claimed = (item.provenance as { source?: string } | undefined)?.source;

    const base = {
      tenant_id: tenantId,
      is_approved: item.approved === true,
      is_published: item.published === true,
      provenance: item.provenance ?? null,
      // Clamped to the enum. An extractor that learns a new source name would
      // otherwise fail the whole write with a Postgres type error, losing every
      // item in the batch over one unrecognised label — and the exact value
      // survives in `provenance` either way, which is where anything that cares
      // about origin actually reads it.
      source: CONTENT_SOURCES.includes(claimed as ContentSource) ? claimed : "manual",
    };

    if (kind === "services") {
      return { ...base, name: item.name, category: item.category ?? null, description: item.description ?? null, sort_order: index };
    }
    if (kind === "service-areas") {
      return { ...base, name: item.name, zips: item.zips ?? [] };
    }
    if (kind === "brands") {
      return { ...base, name: item.name };
    }
    if (kind === "faqs") {
      return { ...base, question: item.question, answer: item.answer, sort_order: index };
    }
    return {
      ...base,
      kind: item.kind ?? "license",
      title: item.title,
      identifier: item.identifier ?? null,
      issuer: item.issuer ?? null,
      valid_until: item.validUntil ?? null,
    };
  }

  private fromRow(kind: ContentKind, row: Record<string, unknown>): Record<string, unknown> {
    const base = {
      approved: row.is_approved === true,
      published: row.is_published === true,
      provenance: row.provenance ?? undefined,
    };

    if (kind === "services") return { ...base, name: row.name, category: row.category, description: row.description };
    if (kind === "service-areas") return { ...base, name: row.name, zips: row.zips ?? [] };
    if (kind === "brands") return { ...base, name: row.name };
    if (kind === "faqs") return { ...base, question: row.question, answer: row.answer };
    return {
      ...base,
      kind: row.kind,
      title: row.title,
      identifier: row.identifier,
      issuer: row.issuer,
      validUntil: row.valid_until,
    };
  }

  async readContent(slug: string, kind: ContentKind) {
    const id = await this.tenantId(slug);
    if (!id) return [];

    const order = kind === "services" || kind === "faqs" ? "&order=sort_order" : "";
    const rows = (await this.rest(
      `${this.table(kind)}?tenant_id=eq.${id}&select=*${order}`
    )) as Record<string, unknown>[];

    return rows.map((row) => this.fromRow(kind, row));
  }

  /**
   * Replace rather than merge.
   *
   * The portal edits a whole list at a time — approve one, delete another, add
   * a third — and has no per-row identity to reconcile against. Replacing is
   * the honest translation of what it actually does, and avoids inventing ids
   * the file store never had.
   */
  async writeContent(slug: string, kind: ContentKind, items: unknown[]) {
    const id = await this.requireTenantId(slug);

    await this.rest(`${this.table(kind)}?tenant_id=eq.${id}`, { method: "DELETE" });
    if (items.length === 0) return;

    await this.rest(this.table(kind), {
      method: "POST",
      body: JSON.stringify(
        items.map((item, index) => this.toRow(kind, item as Record<string, unknown>, id, index))
      ),
    });
  }

  // --- audit and intake ------------------------------------------------------

  async readTier1(slug: string): Promise<Tier1State> {
    const id = await this.tenantId(slug);
    if (!id) return { report: null, manual: {} };

    const rows = (await this.rest(`tier1_audits?tenant_id=eq.${id}&select=report,manual`)) as
      | { report: unknown; manual: Record<string, { checked: boolean }> }[]
      | null;

    const row = rows?.[0];
    return { report: row?.report ?? null, manual: row?.manual ?? {} };
  }

  async writeTier1(slug: string, state: Tier1State) {
    const id = await this.requireTenantId(slug);
    await this.rest(`tier1_audits?on_conflict=tenant_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        tenant_id: id,
        report: state.report,
        manual: state.manual,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  async readIntake(slug: string, source: IntakeSource) {
    const id = await this.tenantId(slug);
    if (!id) return null;

    const rows = (await this.rest(
      `intake_runs?tenant_id=eq.${id}&source=eq.${source}&select=result`
    )) as { result: Record<string, unknown> }[] | null;

    return rows?.[0]?.result ?? null;
  }

  async writeIntake(slug: string, source: IntakeSource, result: unknown) {
    const id = await this.requireTenantId(slug);
    await this.rest(`intake_runs?on_conflict=tenant_id,source`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        tenant_id: id,
        source,
        result,
        ran_at: new Date().toISOString(),
      }),
    });
  }

  async listIntake(slug: string): Promise<IntakeRun[]> {
    const id = await this.tenantId(slug);
    if (!id) return [];

    const rows = (await this.rest(
      `intake_runs?tenant_id=eq.${id}&select=source,result,ran_at&order=source`
    )) as { source: IntakeSource; result: Record<string, unknown>; ran_at: string }[];

    return rows.map((row) => ({ source: row.source, result: row.result, ranAt: row.ran_at }));
  }
}

// ---------------------------------------------------------------------------

let active: Storage | null = null;

/**
 * The store this process uses.
 *
 * Supabase when configured, files otherwise. Chosen once so a single run cannot
 * read from one and write to the other, which would split a client's data in
 * half with no error anywhere.
 *
 * `CONTENT_STORE=files` forces the file store even with Supabase configured.
 * That is the fallback for working offline, and — more usefully — for a machine
 * whose .env points at production: without it, having the keys present is
 * enough to silently move every read and write onto the live database.
 */
export function storage(): Storage {
  if (active) return active;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const forced = process.env.CONTENT_STORE?.trim().toLowerCase();

  if (forced === "files") {
    active = new FileStorage();
  } else if (forced === "supabase") {
    if (!url || !key) {
      throw new Error(
        "CONTENT_STORE=supabase but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.\n" +
          "  Refusing to fall back to files — that would write a client's data somewhere\n" +
          "  nobody is looking for it."
      );
    }
    active = new SupabaseStorage(url, key);
  } else {
    active = url && key ? new SupabaseStorage(url, key) : new FileStorage();
  }

  return active;
}

/** Testing and migration only. */
export function setStorage(store: Storage | null): void {
  active = store;
}
