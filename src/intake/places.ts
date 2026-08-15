import {
  emptyEntityCandidates,
  provenance,
  type IntakeResult,
} from "./types";

/**
 * Google Places API (New) intake.
 *
 * The strategic point of this source: it uses OUR API key and needs no
 * authorization from the customer. A profile can be pre-filled during a sales
 * call, before anything is signed — which is a different onboarding experience
 * from "please grant us access to your Google Business Profile."
 *
 * The full GBP API gives more (Q&A, posts, attributes) but requires the owner
 * to OAuth in. That's a separate source for later.
 *
 * LICENSING CONSTRAINT, and it shapes how this output may be used:
 * Google's terms allow indefinite storage of `place_id` only. Most other
 * fields — hours, address, ratings — must not be cached beyond roughly 30
 * days. So everything here lands as an unapproved candidate for the owner to
 * confirm, after which it becomes *their* asserted fact rather than Google's
 * cached data. Do not treat Places as a source of record.
 *
 * Review text is deliberately not extracted. Ratings and counts are facts worth
 * noting; republishing the reviews themselves is someone else's copyrighted
 * content.
 */

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/** Fields requested from Text Search, used only to identify the right place. */
const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
].join(",");

/** Fields requested from Place Details. */
const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours",
  "rating",
  "userRatingCount",
  "businessStatus",
  "primaryTypeDisplayName",
  "editorialSummary",
].join(",");

export interface PlacesOptions {
  apiKey: string;
  /** Free-text query, e.g. "TitanZ Plumbing Port Charlotte FL". */
  query: string;
  /** Used to confirm the match is the right business. */
  expectPhone?: string | null;
  expectDomain?: string | null;
}

interface PlaceSummary {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
}

/** Digits only, so "+1-941-875-9669" and "(941) 875-9669" compare equal. */
function phoneKey(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function hostKey(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

async function googleFetch(
  url: string,
  apiKey: string,
  fieldMask: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    const message = (error?.message as string) ?? `HTTP ${response.status}`;
    throw new Error(`Places API: ${message}`);
  }

  return payload;
}

async function searchPlaces(options: PlacesOptions): Promise<PlaceSummary[]> {
  const payload = await googleFetch(SEARCH_URL, options.apiKey, SEARCH_FIELDS, {
    textQuery: options.query,
    maxResultCount: 5,
  });

  const places = Array.isArray(payload.places) ? payload.places : [];

  return places.map((raw) => {
    const p = raw as Record<string, unknown>;
    const displayName = p.displayName as Record<string, unknown> | undefined;

    return {
      id: String(p.id ?? ""),
      name: String(displayName?.text ?? ""),
      address: typeof p.formattedAddress === "string" ? p.formattedAddress : null,
      phone: typeof p.nationalPhoneNumber === "string" ? p.nationalPhoneNumber : null,
      website: typeof p.websiteUri === "string" ? p.websiteUri : null,
    };
  });
}

export interface MatchResult {
  place: PlaceSummary;
  /** Why we believe this is the right business. */
  reasons: string[];
  confident: boolean;
}

/**
 * Picks the right place from search results.
 *
 * Matching matters more than it looks: promoting the wrong business's hours and
 * phone number into a customer's profile would be worse than having none, and
 * "first result" is not a good enough reason. A phone or domain match is
 * evidence; a name that merely looks similar is not.
 */
export function matchPlace(
  results: PlaceSummary[],
  options: PlacesOptions
): MatchResult | null {
  if (results.length === 0) return null;

  const wantPhone = phoneKey(options.expectPhone);
  const wantHost = hostKey(options.expectDomain);

  let bestMatch: MatchResult | null = null;

  for (const place of results) {
    const reasons: string[] = [];

    if (wantPhone && phoneKey(place.phone) === wantPhone) {
      reasons.push("phone number matches");
    }
    if (wantHost && hostKey(place.website) === wantHost) {
      reasons.push("website domain matches");
    }

    const confident = reasons.length > 0;

    if (confident) return { place, reasons, confident };
    if (!bestMatch) {
      bestMatch = { place, reasons: ["first search result, nothing corroborated"], confident: false };
    }
  }

  return bestMatch;
}

function mapAddressComponents(
  components: unknown
): { street: string | null; city: string | null; region: string | null; postalCode: string | null } {
  const out = { street: null as string | null, city: null as string | null, region: null as string | null, postalCode: null as string | null };
  if (!Array.isArray(components)) return out;

  let streetNumber = "";
  let route = "";

  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const types = Array.isArray(c.types) ? c.types.map(String) : [];
    const long = typeof c.longText === "string" ? c.longText : null;
    const short = typeof c.shortText === "string" ? c.shortText : null;

    if (types.includes("street_number")) streetNumber = long ?? "";
    else if (types.includes("route")) route = long ?? "";
    else if (types.includes("locality")) out.city = long;
    // Short form is the postal abbreviation, which is what an address wants.
    else if (types.includes("administrative_area_level_1")) out.region = short ?? long;
    else if (types.includes("postal_code")) out.postalCode = long;
  }

  const street = `${streetNumber} ${route}`.trim();
  if (street) out.street = street;

  return out;
}

/** Google periods use 0 = Sunday, matching our own day numbering. */
function mapOpeningHours(
  regular: unknown
): { day: number; opens: string | null; closes: string | null; isClosed: boolean }[] {
  if (!regular || typeof regular !== "object") return [];
  const periods = (regular as Record<string, unknown>).periods;
  if (!Array.isArray(periods)) return [];

  const byDay = new Map<number, { opens: string; closes: string }>();

  for (const raw of periods) {
    if (!raw || typeof raw !== "object") continue;
    const period = raw as Record<string, unknown>;
    const open = period.open as Record<string, unknown> | undefined;
    const close = period.close as Record<string, unknown> | undefined;
    if (!open || typeof open.day !== "number") continue;

    const pad = (value: unknown) => String(typeof value === "number" ? value : 0).padStart(2, "0");
    const opens = `${pad(open.hour)}:${pad(open.minute)}`;

    // A period with no close is a 24-hour day in Google's model.
    const closes = close ? `${pad(close.hour)}:${pad(close.minute)}` : "23:59";

    byDay.set(open.day, { opens, closes });
  }

  const hours: { day: number; opens: string | null; closes: string | null; isClosed: boolean }[] = [];
  for (let day = 0; day <= 6; day++) {
    const found = byDay.get(day);
    hours.push(
      found
        ? { day, opens: found.opens, closes: found.closes, isClosed: false }
        : { day, opens: null, closes: null, isClosed: true }
    );
  }

  return hours;
}

export async function fetchPlaceDetails(
  placeId: string,
  options: PlacesOptions
): Promise<Record<string, unknown>> {
  return googleFetch(`${DETAILS_URL}/${placeId}`, options.apiKey, DETAIL_FIELDS);
}

/** Converts Place Details into intake candidates. */
export function detailsToIntake(
  details: Record<string, unknown>,
  domain: string,
  match: MatchResult
): IntakeResult {
  const now = new Date().toISOString();
  const entity = emptyEntityCandidates();
  const notes: string[] = [];

  const mapsUri = typeof details.googleMapsUri === "string" ? details.googleMapsUri : null;
  const confidence = match.confident ? "high" : "low";
  const p = (method: string) => provenance("places", mapsUri, method, confidence);

  const displayName = details.displayName as Record<string, unknown> | undefined;
  if (typeof displayName?.text === "string") {
    entity.name.push({ value: displayName.text, provenance: p("Places displayName") });
  }

  if (typeof details.nationalPhoneNumber === "string") {
    entity.phone.push({ value: details.nationalPhoneNumber, provenance: p("Places nationalPhoneNumber") });
  }

  if (typeof details.websiteUri === "string") {
    entity.gbpUrl.push({ value: mapsUri ?? details.websiteUri, provenance: p("Places googleMapsUri") });
  } else if (mapsUri) {
    entity.gbpUrl.push({ value: mapsUri, provenance: p("Places googleMapsUri") });
  }

  const address = mapAddressComponents(details.addressComponents);
  if (address.street) entity.street.push({ value: address.street, provenance: p("Places addressComponents") });
  if (address.city) entity.city.push({ value: address.city, provenance: p("Places addressComponents") });
  if (address.region) entity.region.push({ value: address.region, provenance: p("Places addressComponents") });
  if (address.postalCode) {
    entity.postalCode.push({ value: address.postalCode, provenance: p("Places addressComponents") });
  }

  const summary = details.editorialSummary as Record<string, unknown> | undefined;
  if (typeof summary?.text === "string") {
    entity.description.push({ value: summary.text, provenance: p("Places editorialSummary") });
  }

  for (const entry of mapOpeningHours(details.regularOpeningHours)) {
    entity.hours.push({ value: entry, provenance: p("Places regularOpeningHours") });
  }

  // --- notes ---------------------------------------------------------------
  if (!match.confident) {
    notes.push(
      `Match NOT corroborated — ${match.reasons.join("; ")}. Verify this is the right ` +
        `business before promoting anything from it.`
    );
  }

  const status = typeof details.businessStatus === "string" ? details.businessStatus : null;
  if (status && status !== "OPERATIONAL") {
    notes.push(`Google lists this business as ${status}, not OPERATIONAL.`);
  }

  if (typeof details.rating === "number") {
    const count = typeof details.userRatingCount === "number" ? details.userRatingCount : 0;
    notes.push(
      `Google rating ${details.rating} from ${count} reviews. Recorded as a corroboration ` +
        `signal; review text is not extracted.`
    );
  }

  notes.push(
    "Google's terms permit indefinite storage of place_id only; other fields must not be " +
      "cached long-term. Confirm these with the owner so they become the owner's asserted " +
      "facts rather than cached Google data."
  );

  return {
    domain,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    pagesFetched: mapsUri ? [mapsUri] : [],
    pagesSkipped: [],
    entity,
    faqs: [],
    services: [],
    credentials: [],
    areas: [],
    brands: [],
    notes,
  };
}

export { searchPlaces };
