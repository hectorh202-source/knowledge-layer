import {
  emptyEntityCandidates,
  provenance,
  type IntakeResult,
} from "./types";

/**
 * Google Places API (New) intake, by place ID.
 *
 * Deliberately has no search. Home-services businesses are overwhelmingly
 * service-area businesses that hide their street address, and Google returns
 * none of those from any queryable surface — Text Search, Autocomplete and the
 * legacy Find Place endpoints were each tested against a live, verified,
 * well-reviewed listing and every one came back empty. That is Google policy,
 * not a gap to engineer around: SABs are mostly home-based, and a searchable API
 * would publish home addresses in bulk.
 *
 * So the place ID is the input. It comes from the client's own site, where the
 * crawl finds it, or from Settings where someone pasted it. If neither exists,
 * the business gets entered by hand — which is a smaller cost than a pile of
 * fallbacks that each fail in their own way.
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

const DETAILS_URL = "https://places.googleapis.com/v1/places";

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

/**
 * Pulls a place ID out of whatever a client actually sends you.
 *
 * Asking a business owner for their "place ID" gets you a link, because that is
 * what Google gives them — a review request, a Maps share, a directions URL.
 * Requiring the bare identifier means someone hand-edits a URL for every client,
 * which is tedious and a good way to truncate an ID by one character.
 *
 * Returns "" when there is no ID present. A `cid=` link holds a *different*
 * identifier that cannot be converted to a place ID without a browser, so those
 * are rejected rather than mangled into a wrong lookup.
 */
export function parsePlaceId(input: string | null | undefined): string {
  if (!input) return "";
  const value = input.trim();
  if (!value) return "";

  if (/^ChIJ[A-Za-z0-9_-]{16,}$/.test(value)) return value;

  const embedded = value.match(/ChIJ[A-Za-z0-9_-]{16,}/);
  return embedded ? embedded[0] : "";
}

async function googleFetch(
  url: string,
  apiKey: string,
  fieldMask: string
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    const message = (error?.message as string) ?? `HTTP ${response.status}`;
    throw new Error(`Places API: ${message}`);
  }

  return payload;
}

export async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<Record<string, unknown>> {
  return googleFetch(`${DETAILS_URL}/${placeId}`, apiKey, DETAIL_FIELDS);
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

  // A business open around the clock is a single period: day 0, midnight, and
  // no close at all — Google does not enumerate the other six days. Read
  // literally that says "open Sunday, closed the rest of the week", which is the
  // opposite of the truth and would go straight into the customer's JSON-LD as
  // a six-day closure. Verified against a live 24/7 listing.
  if (periods.length === 1) {
    const only = periods[0] as Record<string, unknown> | null;
    const open = only?.open as Record<string, unknown> | undefined;
    if (open && !only?.close && (open.hour ?? 0) === 0 && (open.minute ?? 0) === 0) {
      return Array.from({ length: 7 }, (_unused, day) => ({
        day,
        opens: "00:00",
        closes: "23:59",
        isClosed: false,
      }));
    }
  }

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

/**
 * Converts Place Details into intake candidates.
 *
 * Everything is high confidence because a place ID identifies exactly one
 * listing — there is no matching step left to be wrong about.
 */
export function detailsToIntake(
  details: Record<string, unknown>,
  domain: string
): IntakeResult {
  const now = new Date().toISOString();
  const entity = emptyEntityCandidates();
  const notes: string[] = [];

  const mapsUri = typeof details.googleMapsUri === "string" ? details.googleMapsUri : null;
  const p = (method: string) => provenance("places", mapsUri, method, "high");

  const displayName = details.displayName as Record<string, unknown> | undefined;
  if (typeof displayName?.text === "string") {
    entity.name.push({ value: displayName.text, provenance: p("Places displayName") });
  }

  if (typeof details.nationalPhoneNumber === "string") {
    entity.phone.push({ value: details.nationalPhoneNumber, provenance: p("Places nationalPhoneNumber") });
  }

  if (mapsUri) {
    entity.gbpUrl.push({ value: mapsUri, provenance: p("Places googleMapsUri") });
  }

  if (typeof details.id === "string") {
    entity.placeId.push({ value: details.id, provenance: p("Places id") });
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
  const status = typeof details.businessStatus === "string" ? details.businessStatus : null;
  if (status && status !== "OPERATIONAL") {
    notes.push(`Google lists this business as ${status}, not OPERATIONAL.`);
  }

  if (!address.city) {
    notes.push(
      "Google returned no address for this listing, so it is a service-area business. " +
        "Nothing is wrong — it simply means the address fields stay empty and the listing " +
        "cannot be found by any Google search, only by place ID."
    );
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
