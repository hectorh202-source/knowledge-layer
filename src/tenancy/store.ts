import * as fs from "fs";
import * as path from "path";

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

export interface TenantSettings {
  slug: string;
  name: string;
  /** Root domain the markup and catalog are published on. */
  domain: string;
  /** schema.org type — Plumber, HVACBusiness, Electrician, LocalBusiness. */
  schemaType: string;
  /** Public URL of this tenant's API, once deployed. */
  apiBaseUrl: string;
  createdAt: string;
  notes: string;
}

export interface TenantSummary extends TenantSettings {
  itemCount: number;
  approvedCount: number;
  publishedCount: number;
  hasProfile: boolean;
  blockingCount: number;
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

export function tenantExists(slug: string): boolean {
  return fs.existsSync(settingsPath(slug));
}

export function listTenantSlugs(): string[] {
  if (!fs.existsSync(TENANTS_DIR)) return [];
  return fs
    .readdirSync(TENANTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && tenantExists(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function readSettings(slug: string): TenantSettings | null {
  if (!tenantExists(slug)) return null;
  try {
    return JSON.parse(fs.readFileSync(settingsPath(slug), "utf8")) as TenantSettings;
  } catch {
    return null;
  }
}

export function writeSettings(settings: TenantSettings): void {
  fs.mkdirSync(tenantDir(settings.slug), { recursive: true });
  fs.writeFileSync(settingsPath(settings.slug), JSON.stringify(settings, null, 2) + "\n", "utf8");
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
  responseTime: null,
  emergencyService: false,
  hours: [] as unknown[],
};

/**
 * Creates a client.
 *
 * Deliberately does almost nothing: a settings file, an empty profile, and
 * empty content files. Everything else arrives from intake or from a person.
 * A new client that starts with invented defaults is a client whose data
 * nobody trusts.
 */
export function createTenant(input: {
  name: string;
  domain: string;
  slug?: string;
  schemaType?: string;
}): TenantSettings {
  const slug = slugify(input.slug || input.name);
  if (!slug) throw new Error("Could not derive a slug from that name.");
  if (tenantExists(slug)) throw new Error(`A client with slug "${slug}" already exists.`);

  const domain = input.domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  // Two clients on one domain would generate conflicting JSON-LD and catalogs
  // for the same site — a crawler would have no way to tell which is
  // authoritative. The slug check above won't catch it, since slugs come from
  // the business name.
  const clash = listTenantSlugs()
    .map(readSettings)
    .find((existing) => existing?.domain && existing.domain.toLowerCase() === domain.toLowerCase());

  if (clash) {
    throw new Error(`"${clash.name}" already uses ${domain}. One client per domain.`);
  }

  const settings: TenantSettings = {
    slug,
    name: input.name.trim(),
    domain,
    schemaType: input.schemaType || "LocalBusiness",
    apiBaseUrl: "",
    createdAt: new Date().toISOString(),
    notes: "",
  };

  fs.mkdirSync(tenantDir(slug), { recursive: true });
  writeSettings(settings);

  fs.writeFileSync(
    profilePath(slug),
    JSON.stringify({ ...EMPTY_PROFILE, name: settings.name, domain }, null, 2) + "\n",
    "utf8"
  );

  for (const kind of CONTENT_KINDS) {
    fs.writeFileSync(contentPath(slug, kind), JSON.stringify({ items: [] }, null, 2) + "\n", "utf8");
  }

  return settings;
}

export function deleteTenant(slug: string): void {
  if (!tenantExists(slug)) throw new Error(`No client "${slug}".`);
  fs.rmSync(tenantDir(slug), { recursive: true, force: true });
}

/**
 * Moves a pre-tenancy single-client setup into content/tenants/<slug>/.
 *
 * Runs once, on startup. Without it the content already gathered for the first
 * client would be stranded in the old location.
 */
export function migrateLegacyContent(slug = "titanz"): boolean {
  const legacyProfile = path.join(LEGACY_DIR, "business-profile.json");
  if (!fs.existsSync(legacyProfile) || tenantExists(slug)) return false;

  fs.mkdirSync(tenantDir(slug), { recursive: true });

  const raw = JSON.parse(fs.readFileSync(legacyProfile, "utf8")) as Record<string, unknown>;
  const name = typeof raw.name === "string" && raw.name ? raw.name : slug;
  const domain = typeof raw.domain === "string" ? raw.domain : "";

  writeSettings({
    slug,
    name,
    domain,
    schemaType: "LocalBusiness",
    apiBaseUrl: "",
    createdAt: new Date().toISOString(),
    notes: "Migrated from the single-client layout.",
  });

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
export function readItems<T>(slug: string, kind: ContentKind): T[] {
  const file = contentPath(slug, kind);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { items?: T[] };
    return parsed.items ?? [];
  } catch {
    return [];
  }
}

/** Writes a content file, preserving any existing header comment. */
export function writeItems<T>(slug: string, kind: ContentKind, items: T[]): void {
  const file = contentPath(slug, kind);
  let comment: string[] | undefined;

  if (fs.existsSync(file)) {
    try {
      comment = (JSON.parse(fs.readFileSync(file, "utf8")) as { _comment?: string[] })._comment;
    } catch {
      // Unreadable file gets replaced rather than blocking the write.
    }
  }

  fs.mkdirSync(tenantDir(slug), { recursive: true });
  const payload = comment ? { _comment: comment, items } : { items };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}
