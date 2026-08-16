import { storage } from "../tenancy/storage";
export interface PostalAddress {
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
}

export interface OpeningHours {
  /** 0 = Sunday. */
  day: number;
  /** "07:00", 24-hour. Null when closed. */
  opens: string | null;
  closes: string | null;
  isClosed: boolean;
}

/**
 * How the business meets its customers — Google's storefront versus service
 * area distinction.
 *
 * Not cosmetic. It decides whether an address should be published at all: a
 * service-area business publishing a home address is a privacy problem, and one
 * publishing no served area cannot be matched to "near me" by anything.
 */
export type BusinessType = "storefront" | "service_area" | "hybrid";

/** Latitude/longitude, emitted as schema.org GeoCoordinates. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * A dated exception to the normal week — a holiday, a shutdown.
 *
 * schema.org models these separately from regular hours for a reason: "closed
 * Christmas Day" is a fact about one date, and folding it into the weekly
 * pattern would say the business is closed every Thursday forever.
 */
export interface SpecialHours {
  /** ISO date, "2026-12-25". */
  date: string;
  isClosed: boolean;
  opens: string | null;
  closes: string | null;
}

/**
 * An additional way to reach the business, beyond the canonical NAP number.
 *
 * The main phone stays a single field on purpose — it is the number that must
 * match every directory listing exactly. Everything else (a separate emergency
 * line, a billing department) belongs here, typed, so a crawler knows which is
 * which rather than seeing three interchangeable numbers.
 */
export interface ContactPointEntry {
  /** schema.org contactType — "customer service", "emergency", "billing". */
  contactType: string;
  phone: string | null;
  email: string | null;
}

/**
 * A free-form attribute, for the many Google Business Profile toggles that
 * schema.org has no dedicated property for.
 *
 * "Veteran-owned", "free estimates", "wheelchair accessible entrance". These
 * matter to the questions people actually ask an assistant, and dropping them
 * because the vocabulary lacks a field would lose real answers.
 * `additionalProperty` is schema.org's sanctioned escape hatch for exactly this.
 */
export interface AttributeEntry {
  name: string;
  value: string;
}

/**
 * The entity record — the answer to "who is this business".
 *
 * The foundation everything else rests on: an answer engine that cannot resolve
 * the business as a distinct entity cannot recommend it, however good the rest
 * of the content is.
 */
export interface BusinessProfile {
  name: string;
  legalName: string | null;
  description: string | null;
  /** Canonical NAP phone. Must match every directory listing exactly. */
  phone: string | null;
  email: string | null;
  domain: string | null;
  address: PostalAddress;
  /** Google Business Profile URL — the strongest corroboration signal. */
  gbpUrl: string | null;
  foundedYear: number | null;
  hours: OpeningHours[];

  /**
   * The business's primary Google category, verbatim — "Plumber", "Junk removal
   * service".
   *
   * Google's most important matching field, and the closest thing to a
   * machine-readable statement of what the business *is*. Free text rather than
   * an enum: Google's category list changes, and a stale enum would silently
   * reject a category that is perfectly valid.
   */
  primaryCategory: string | null;
  businessType: BusinessType;

  /**
   * schema.org type for the business — Plumber, HVACBusiness, LocalBusiness.
   *
   * Lives here rather than in settings because it publishes: it becomes the
   * `@type` of the business node, which is the single most important statement
   * in the markup. Its sibling `primaryCategory` says the same thing in
   * Google's vocabulary, and having the two on different pages invited them to
   * disagree.
   */
  schemaType: string;

  // --- identity & branding -------------------------------------------------
  /** Trading name or DBA, when it differs from both name and legalName. */
  alternateName: string | null;
  slogan: string | null;
  /** Absolute URL to the logo. Google wants square, at least 112x112. */
  logoUrl: string | null;
  /** Absolute URLs to photos of the business, vehicles or work. */
  imageUrls: string[];

  // --- commerce ------------------------------------------------------------
  /** schema.org priceRange, conventionally "$" to "$$$$". */
  priceRange: string | null;
  /** "Cash", "Credit Card", "Check", "Invoice", "Financing". */
  paymentAccepted: string[];
  /** ISO 4217, e.g. "USD". */
  currenciesAccepted: string | null;

  // --- reach ---------------------------------------------------------------
  /** Languages the business does business in, as schema.org knowsLanguage. */
  languages: string[];
  /**
   * Coordinates.
   *
   * Emitted for every business type, including service-area ones. Unlike a
   * street address it does not expose a doorstep when set to the middle of the
   * service area, and it is what lets a crawler answer "near me" at all.
   */
  geo: GeoPoint | null;
  /** Link to the business on a map — usually the Google Maps listing. */
  hasMap: string | null;

  // --- scale & trust -------------------------------------------------------
  numberOfEmployees: number | null;
  /** Awards and recognitions, one per entry. */
  awards: string[];
  /** Trade associations and accreditations — BBB, PHCC, NATE. */
  memberOf: string[];
  founder: string | null;

  // --- contact -------------------------------------------------------------
  contactPoints: ContactPointEntry[];
  /** Online booking, emitted as a ReserveAction rather than a bare link. */
  bookingUrl: string | null;

  // --- hours exceptions ----------------------------------------------------
  specialHours: SpecialHours[];

  // Registration identifiers — taxID, vatID, duns, leiCode, isicV4, branchCode
  // — and faxNumber were built here and removed. All are valid schema.org, and
  // none of them answers any question a person asks an assistant about a
  // plumber. Six form fields, six columns and six emit branches for facts no
  // answer engine would ever surface is the definition of markup that costs
  // more than it returns.

  // --- everything the vocabulary has no field for --------------------------
  attributes: AttributeEntry[];

  /**
   * Profiles on other platforms — Facebook, Yelp, BBB, Angi, LinkedIn.
   *
   * Becomes schema.org `sameAs`, and it is how an answer engine confirms the
   * business on this website is the same one it has seen elsewhere. One source
   * claiming a fact is an assertion; several independent profiles agreeing is
   * corroboration, which is what actually earns a citation.
   */
  sameAs: string[];
}

/**
 * Reads the authored business profile from `content/business-profile.json`.
 *
 * This is the entity record — the answer to "who is this business", which is
 * the question an AI has to resolve before it can recommend anyone. It's
 * authored, not derived: ServiceTitan doesn't hold a canonical NAP, opening
 * hours, or a Google Business Profile link.
 *
 * Kept as a file rather than only in the database so it can be edited in a
 * text editor, version-controlled, and read by the API before Supabase exists.
 * `npm run content:load` pushes it into the database.
 */



/** Placeholder marker used throughout the template. */
const TODO = "TODO";

export interface ProfileValidation {
  /** Fields still holding the TODO placeholder or left empty. */
  missing: string[];
  /** Problems serious enough that publishing would be actively harmful. */
  blocking: string[];
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toUpperCase().startsWith(TODO)) return null;
  return trimmed;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseAddress(raw: unknown): PostalAddress {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    street: str(r.street),
    city: str(r.city),
    region: str(r.region),
    postalCode: str(r.postalCode),
    country: str(r.country) ?? "US",
  };
}

function parseHours(raw: unknown): OpeningHours[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const day = num(e.day);
    if (day === null || day < 0 || day > 6) return [];

    const isClosed = e.isClosed === true;
    const opens = isClosed ? null : str(e.opens);
    const closes = isClosed ? null : str(e.closes);

    // A day that is neither closed nor has opening times is unknown, not open.
    // The unfilled template looks exactly like this, and letting it through
    // would count placeholder rows as real hours and emit meaningless
    // schema.org openingHoursSpecification entries.
    if (!isClosed && (!opens || !closes)) return [];

    return [{ day, opens, closes, isClosed }];
  });
}

/**
 * Defaults to storefront, which is the only safe default.
 *
 * Getting it wrong the other way publishes an address for a business that
 * deliberately hides one, and unset must not silently mean "hide the address"
 * for a business that has a real shopfront customers need to find.
 */
function parseBusinessType(raw: unknown): BusinessType {
  return raw === "service_area" || raw === "hybrid" ? raw : "storefront";
}

/** Plain string list — trimmed, blanks and placeholders dropped, deduped. */
function parseStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const value = str(entry);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Same, but only absolute http(s) URLs — see parseSameAs for why. */
function parseUrls(raw: unknown): string[] {
  return parseStrings(raw).filter((value) => /^https?:\/\//i.test(value));
}

function parseUrl(raw: unknown): string | null {
  const value = str(raw);
  return value && /^https?:\/\//i.test(value) ? value : null;
}

function parseGeo(raw: unknown): GeoPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const latitude = num(r.latitude);
  const longitude = num(r.longitude);
  if (latitude === null || longitude === null) return null;

  // Out-of-range coordinates are a data-entry slip, and publishing them puts
  // the business somewhere it isn't. 0,0 is the Atlantic and is what an unset
  // pair of numeric fields looks like.
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;

  return { latitude, longitude };
}

function parseSpecialHours(raw: unknown): SpecialHours[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const date = str(e.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

    const isClosed = e.isClosed === true;
    const opens = isClosed ? null : str(e.opens);
    const closes = isClosed ? null : str(e.closes);
    // Same rule as the weekly hours: neither closed nor timed means unknown.
    if (!isClosed && (!opens || !closes)) return [];

    return [{ date, isClosed, opens, closes }];
  });
}

function parseContactPoints(raw: unknown): ContactPointEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const phone = str(e.phone);
    const email = str(e.email);
    // A contact point with no way to contact anyone is not a contact point.
    if (!phone && !email) return [];
    return [{ contactType: str(e.contactType) ?? "customer service", phone, email }];
  });
}

function parseAttributes(raw: unknown): AttributeEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const name = str(e.name);
    if (!name) return [];
    return [{ name, value: str(e.value) ?? "Yes" }];
  });
}

function parseSameAs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of raw) {
    const value = str(entry);
    // Only absolute http(s) URLs. A bare "facebook.com/acme" in sameAs resolves
    // against the customer's own domain and points at a page that doesn't
    // exist, which is worse than omitting the link.
    if (!value || !/^https?:\/\//i.test(value)) continue;
    const key = value.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

export async function profileExists(tenant: string): Promise<boolean> {
  return (await storage().readProfile(tenant)) !== null;
}

export async function loadProfile(tenant: string): Promise<BusinessProfile | null> {
  const raw = await storage().readProfile(tenant);
  if (!raw) return null;

  return {
    name: str(raw.name) ?? "",
    legalName: str(raw.legalName),
    description: str(raw.description),
    phone: str(raw.phone),
    email: str(raw.email),
    domain: str(raw.domain),
    address: parseAddress(raw.address),
    gbpUrl: str(raw.gbpUrl),
    foundedYear: num(raw.foundedYear),
    hours: parseHours(raw.hours),
    primaryCategory: str(raw.primaryCategory),
    businessType: parseBusinessType(raw.businessType),
    schemaType: str(raw.schemaType) ?? "LocalBusiness",
    sameAs: parseSameAs(raw.sameAs),

    alternateName: str(raw.alternateName),
    slogan: str(raw.slogan),
    logoUrl: parseUrl(raw.logoUrl),
    imageUrls: parseUrls(raw.imageUrls),

    priceRange: str(raw.priceRange),
    paymentAccepted: parseStrings(raw.paymentAccepted),
    currenciesAccepted: str(raw.currenciesAccepted),

    languages: parseStrings(raw.languages),
    geo: parseGeo(raw.geo),
    hasMap: parseUrl(raw.hasMap),

    numberOfEmployees: num(raw.numberOfEmployees),
    awards: parseStrings(raw.awards),
    memberOf: parseStrings(raw.memberOf),
    founder: str(raw.founder),

    contactPoints: parseContactPoints(raw.contactPoints),
    bookingUrl: parseUrl(raw.bookingUrl),

    specialHours: parseSpecialHours(raw.specialHours),

    attributes: parseAttributes(raw.attributes),
  };
}

/**
 * Checks the profile for gaps.
 *
 * `blocking` is the short list: without these an AI cannot resolve the business
 * as an entity at all, so publishing anything else is pointless. `missing` is
 * everything else worth filling — each one is a fact that could be cited and
 * currently can't be.
 */
export function validateProfile(profile: BusinessProfile): ProfileValidation {
  const blocking: string[] = [];
  const missing: string[] = [];

  if (!profile.name) blocking.push("name");
  if (!profile.phone) blocking.push("phone — the canonical NAP number");

  // A service-area business legitimately has no address, and demanding one
  // would either block every such client forever or push someone into typing a
  // home address the owner deliberately hides. What it must have instead is
  // served areas, which is a separate content list.
  if (profile.businessType !== "service_area") {
    if (!profile.address.city || !profile.address.region) {
      blocking.push("address.city / address.region");
    }
  }

  if (!profile.primaryCategory) {
    missing.push("primaryCategory — what Google matches queries against");
  }
  if (profile.sameAs.length === 0) {
    missing.push("sameAs — no other profiles to corroborate the entity");
  }
  // The handful worth nagging about. The rest of the new fields are genuinely
  // optional — listing twenty "missing" items trains people to ignore the
  // banner, which costs more than the fields are worth.
  if (!profile.logoUrl) missing.push("logoUrl — assistants surface a logo with the answer");
  if (!profile.priceRange) missing.push("priceRange");
  if (profile.paymentAccepted.length === 0) missing.push("paymentAccepted");
  if (!profile.geo) missing.push("geo — coordinates are what answer \"near me\"");

  if (!profile.legalName) missing.push("legalName");
  if (!profile.description) missing.push("description");
  if (!profile.email) missing.push("email");
  if (!profile.domain) missing.push("domain");
  if (profile.businessType !== "service_area") {
    if (!profile.address.street) missing.push("address.street");
    if (!profile.address.postalCode) missing.push("address.postalCode");
  }
  if (!profile.gbpUrl) missing.push("gbpUrl — the strongest corroboration signal");
  if (!profile.foundedYear) missing.push("foundedYear");
  // A week where no day has opening times means the business is never open,
  // which is never what someone meant to say.
  if (profile.hours.filter((entry: OpeningHours) => !entry.isClosed).length === 0) {
    missing.push("hours — no day has opening times");
  }

  return { blocking, missing };
}

/** Raw profile JSON, for the editor — placeholders and all. */
export async function loadProfileRaw(tenant: string): Promise<Record<string, unknown>> {
  try {
    return (await storage().readProfile(tenant)) ?? {};
  } catch {
    return {};
  }
}

export async function saveProfileRaw(
  tenant: string,
  raw: Record<string, unknown>
): Promise<void> {
  await storage().writeProfile(tenant, raw);
}
