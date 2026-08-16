import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";

/**
 * Per-tenant storage.
 *
 * Every client gets a directory under content/tenants/<slug>/. Adding a client
 * is creating a directory — no shared files to edit, no cross-client blast
 * radius, and the same shape whether there is one client or two hundred.
 *
 * Files rather than a database on purpose, for now: they are diffable,
 * editable by hand when something goes wrong, and work before Supabase exists.
 * `npm run content:load` pushes a tenant into the database when it is ready.
 */

const TENANTS_DIR = path.resolve(process.cwd(), "content", "tenants");
const LEGACY_DIR = path.resolve(process.cwd(), "content");

export type ContentKind =
  | "services"
  | "service-areas"
  | "brands"
  | "faqs"
  | "credentials";

export const CONTENT_KINDS: ContentKind[] = [
  "services",
  "service-areas",
  "brands",
  "faqs",
  "credentials",
];

/**
 * Where this client's infrastructure lives, and who owns it.
 *
 * The links save hunting for the right dashboard. The ownership fields are the
 * more important half: they record whether an account belongs to the client or
 * to us, which is what makes churn a matter of losing access rather than
 * untangling custody of someone's DNS.
 */
export interface TenantLinks {
  /** Direct link to the zone in whichever Cloudflare account holds it. */
  cloudflareUrl: string;
  cloudflareOwner: "" | "client" | "agency";
  searchConsoleUrl: string;
  /** The "manage" view, distinct from the public profile URL on the profile. */
  gbpManageUrl: string;
  hostingProvider: string;
  hostingUrl: string;
  registrar: string;
  /** Where the site itself is edited — WP admin, Squarespace, etc. */
  cmsUrl: string;
}

export const EMPTY_LINKS: TenantLinks = {
  cloudflareUrl: "",
  cloudflareOwner: "",
  searchConsoleUrl: "",
  gbpManageUrl: "",
  hostingProvider: "",
  hostingUrl: "",
  registrar: "",
  cmsUrl: "",
};

/**
 * Pages the extractor should read directly, when someone knows where they are.
 *
 * Guessing at URL conventions and nav wording fails on any site that words
 * things its own way — "What We Do" instead of "/services" is enough to find
 * nothing. Whoever onboards a client can see the right page in ten seconds, so
 * a pasted URL is more accurate than any amount of pattern matching, costs
 * nothing, and adds no dependency.
 *
 * Optional throughout. Left blank, extraction falls back to the heuristics.
 */
export interface TenantSources {
  servicesPageUrl: string;
  serviceAreasPageUrl: string;
  /**
   * Google place ID — and for most clients this is not optional in practice.
   *
   * Home-services businesses are overwhelmingly service-area businesses that
   * hide their street address, and Google's Text Search does not return
   * address-less SABs. Searching the exact business name returns nothing at
   * all, however live and well-reviewed the listing is. They are reachable by
   * place ID and effectively only by place ID, so for a plumber, hauler or HVAC
   * company this field is the entire route in rather than a fallback.
   */
  googlePlaceId: string;
}

export const EMPTY_SOURCES: TenantSources = {
  servicesPageUrl: "",
  serviceAreasPageUrl: "",
  googlePlaceId: "",
};

/**
 * Operational configuration for a client — how we work on them, as opposed to
 * what we publish about them, which is the business profile.
 *
 * `name`, `domain` and `schemaType` appear here but are **not stored here**.
 * They are read from and written to `business-profile.json`, which is the one
 * source of truth for anything that reaches a crawler. They used to be stored
 * in both places, and the two copies drifted: editing "Business name" in
 * Settings renamed the nav label while the published markup kept the old name,
 * with nothing to indicate the edit had no effect.
 *
 * They stay on this interface so the many callers that reasonably expect
 * `settings.domain` keep working; `readSettings` merges them in and
 * `writeSettings` sends them back to the profile.
 */
export interface TenantSettings {
  slug: string;
  /** From the business profile. Editing it here writes to the profile. */
  name: string;
  /** From the business profile. Root domain for markup and the catalog. */
  domain: string;
  /** From the business profile. schema.org type — Plumber, LocalBusiness. */
  schemaType: string;
  /** Public URL of this tenant's API, once deployed. */
  apiBaseUrl: string;
  sources: TenantSources;
  links: TenantLinks;
  createdAt: string;
  notes: string;
}

export interface TenantSummary extends TenantSettings {
  itemCount: number;
  approvedCount: number;
  publishedCount: number;
  hasProfile: boolean;
  blockingCount: number;
  tier1?: {
    ran: boolean;
    passed: number;
    failed: number;
    manualDone: number;
    manualTotal: number;
    complete: boolean;
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function tenantDir(slug: string): string {
  return path.join(TENANTS_DIR, slug);
}

function settingsPath(slug: string): string {
  return path.join(tenantDir(slug), "settings.json");
}

export function profilePath(slug: string): string {
  return path.join(tenantDir(slug), "business-profile.json");
}

export function contentPath(slug: string, kind: ContentKind): string {
  return path.join(tenantDir(slug), `${kind}.json`);
}

export function intakeDir(slug: string): string {
  return path.join(tenantDir(slug), "intake");
}

export async function tenantExists(slug: string): Promise<boolean> {
  return storage().tenantExists(slug);
}

export async function listTenantSlugs(): Promise<string[]> {
  return storage().listTenants();
}

export async function readSettings(slug: string): Promise<TenantSettings | null> {
  const store = storage();
  const parsed = (await store.readSettings(slug)) as TenantSettings | null;
  if (!parsed) return null;

  // name, domain and schemaType are read from the profile, never from settings.
  // They were once stored in both and drifted — renaming in Settings relabelled
  // the nav while the published markup kept the old name.
  const profile = (await store.readProfile(slug)) ?? {};
  const str = (value: unknown): string => (typeof value === "string" ? value : "");

  return {
    ...parsed,
    // Backfill so settings written before a field existed still load.
    sources: { ...EMPTY_SOURCES, ...(parsed.sources ?? {}) },
    links: { ...EMPTY_LINKS, ...(parsed.links ?? {}) },
    slug,
    name: str(profile.name) || parsed.name || "",
    domain: str(profile.domain) || parsed.domain || "",
    schemaType: str(profile.schemaType) || parsed.schemaType || "LocalBusiness",
  };
}

export async function writeSettings(settings: TenantSettings): Promise<void> {
  const store = storage();

  // The three shared fields go to the profile, and are kept out of settings
  // entirely so there is nothing left to drift.
  const profile = (await store.readProfile(settings.slug)) ?? {};
  await store.writeProfile(settings.slug, {
    ...profile,
    name: settings.name,
    domain: settings.domain,
    schemaType: settings.schemaType,
  });

  const { name, domain, schemaType, ...operational } = settings;
  await store.writeSettings(settings.slug, operational);
}

const EMPTY_PROFILE = {
  name: "",
  legalName: null,
  description: null,
  phone: null,
  email: null,
  domain: null,
  address: { street: null, city: null, region: null, postalCode: null, country: "US" },
  gbpUrl: null,
  foundedYear: null,
  hours: [] as unknown[],
  primaryCategory: null,
  businessType: "storefront",
  schemaType: "LocalBusiness",
  sameAs: [] as string[],

  alternateName: null,
  slogan: null,
  logoUrl: null,
  imageUrls: [] as string[],

  priceRange: null,
  paymentAccepted: [] as string[],
  currenciesAccepted: "USD",

  languages: [] as string[],
  geo: null,
  hasMap: null,

  numberOfEmployees: null,
  awards: [] as string[],
  memberOf: [] as string[],
  founder: null,

  contactPoints: [] as unknown[],
  bookingUrl: null,

  specialHours: [] as unknown[],

  attributes: [] as unknown[],
};

/**
 * Creates a client.
 *
 * Deliberately does almost nothing: a settings file, an empty profile, and
 * empty content files. Everything else arrives from intake or from a person.
 * A new client that starts with invented defaults is a client whose data
 * nobody trusts.
 */
export async function createTenant(input: {
  name: string;
  domain: string;
  slug?: string;
  schemaType?: string;
}): Promise<TenantSettings> {
  const store = storage();
  const slug = slugify(input.slug || input.name);
  if (!slug) throw new Error("Could not derive a slug from that name.");
  if (await store.tenantExists(slug)) {
    throw new Error(`A client with slug "${slug}" already exists.`);
  }

  const domain = input.domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  // Two clients on one domain would generate conflicting JSON-LD and catalogs
  // for the same site — a crawler would have no way to tell which is
  // authoritative. The slug check above won't catch it, since slugs come from
  // the business name.
  const existing = await Promise.all((await listTenantSlugs()).map(readSettings));
  const clash = existing.find(
    (other) => other?.domain && other.domain.toLowerCase() === domain.toLowerCase()
  );

  if (clash) {
    throw new Error(`"${clash.name}" already uses ${domain}. One client per domain.`);
  }

  const settings: TenantSettings = {
    slug,
    name: input.name.trim(),
    domain,
    schemaType: input.schemaType || "LocalBusiness",
    apiBaseUrl: "",
    sources: { ...EMPTY_SOURCES },
    links: { ...EMPTY_LINKS },
    createdAt: new Date().toISOString(),
    notes: "",
  };

  await store.createTenant(slug);

  // Profile first. writeSettings writes name, domain and schemaType *into* the
  // profile, so creating the empty profile afterwards would erase them.
  await store.writeProfile(slug, {
    ...EMPTY_PROFILE,
    name: settings.name,
    domain,
    schemaType: settings.schemaType,
  });

  await writeSettings(settings);

  for (const kind of CONTENT_KINDS) {
    await store.writeContent(slug, kind, []);
  }

  return settings;
}

export async function deleteTenant(slug: string): Promise<void> {
  const store = storage();
  if (!(await store.tenantExists(slug))) throw new Error(`No client "${slug}".`);
  await store.deleteTenant(slug);
}

/**
 * Moves a pre-tenancy single-client setup into content/tenants/<slug>/.
 *
 * Runs once, on startup. Without it the content already gathered for the first
 * client would be stranded in the old location.
 *
 * Deliberately talks to the filesystem directly rather than through `storage()`:
 * it is a file-layout migration, moving files that only ever existed on disk
 * into the place the file store expects them. Run against Supabase it is a
 * no-op, which is correct — a database that never had the old layout has
 * nothing to migrate.
 */
export function migrateLegacyContent(slug: string): boolean {
  const legacyProfile = path.join(LEGACY_DIR, "business-profile.json");
  if (!fs.existsSync(legacyProfile) || fs.existsSync(tenantDir(slug))) return false;

  fs.mkdirSync(tenantDir(slug), { recursive: true });

  // No name/domain here: they live in the legacy profile, which is moved into
  // place below, and settings has not stored them since the two copies drifted.
  const settings = {
    slug,
    apiBaseUrl: "",
    sources: { ...EMPTY_SOURCES },
    links: { ...EMPTY_LINKS },
    createdAt: new Date().toISOString(),
    notes: "Migrated from the single-client layout.",
  };
  fs.writeFileSync(settingsPath(slug), JSON.stringify(settings, null, 2) + "\n", "utf8");

  fs.renameSync(legacyProfile, profilePath(slug));

  for (const kind of CONTENT_KINDS) {
    const from = path.join(LEGACY_DIR, `${kind}.json`);
    if (fs.existsSync(from)) fs.renameSync(from, contentPath(slug, kind));
    else fs.writeFileSync(contentPath(slug, kind), JSON.stringify({ items: [] }, null, 2) + "\n", "utf8");
  }

  const legacyIntake = path.join(LEGACY_DIR, "intake");
  if (fs.existsSync(legacyIntake)) fs.renameSync(legacyIntake, intakeDir(slug));

  return true;
}

/** Reads a content file's items. */
export async function readItems<T>(slug: string, kind: ContentKind): Promise<T[]> {
  return (await storage().readContent(slug, kind)) as T[];
}

export async function writeItems<T>(slug: string, kind: ContentKind, items: T[]): Promise<void> {
  await storage().writeContent(slug, kind, items as unknown[]);
}

// --- Tier 1 audit state ----------------------------------------------------

function auditPath(slug: string): string {
  return path.join(tenantDir(slug), "tier1.json");
}

export interface Tier1State {
  /** Last automated run, whatever shape the audit produced. */
  report: unknown | null;
  /** Manual items, keyed by check id. */
  manual: Record<string, { checked: boolean; note: string; updatedAt: string }>;
}

export async function readTier1(slug: string): Promise<Tier1State> {
  return (await storage().readTier1(slug)) as Tier1State;
}

export async function writeTier1(slug: string, state: Tier1State): Promise<void> {
  await storage().writeTier1(slug, state);
}
