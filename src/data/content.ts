import { readItems, writeItems, type ContentKind } from "../tenancy/store";

/**
 * A client's content.
 *
 * Three sources fill these, in priority order:
 *   1. Google Business Profile — the most authoritative, already curated
 *   2. Their website — whatever Google doesn't carry
 *   3. A human — anything neither has
 *
 * Everything arrives as a candidate with `approved: false` and its provenance
 * attached. A person flips approved and published; nothing extracted is served
 * on a business's behalf until they do.
 */

export interface ContentProvenance {
  /** "gbp", "places", "website", or "manual". */
  source: string;
  url: string | null;
  method: string;
  confidence: "high" | "medium" | "low";
}

export interface Reviewable {
  approved: boolean;
  published: boolean;
  provenance?: ContentProvenance;
}

export interface ServiceEntry extends Reviewable {
  name: string;
  category: string | null;
  description: string | null;
}

export interface ServiceAreaEntry extends Reviewable {
  name: string;
  /** Real postal codes, so an AI can match a customer's location exactly. */
  zips: string[];
}

export interface BrandEntry extends Reviewable {
  name: string;
}

export interface FaqEntry extends Reviewable {
  question: string;
  answer: string;
}

export interface CredentialEntry extends Reviewable {
  kind: string;
  title: string;
  identifier: string | null;
  issuer: string | null;
  validUntil: string | null;
}

export const loadServices = (t: string) => readItems<ServiceEntry>(t, "services");
export const loadServiceAreas = (t: string) => readItems<ServiceAreaEntry>(t, "service-areas");
export const loadBrands = (t: string) => readItems<BrandEntry>(t, "brands");
export const loadFaqs = (t: string) => readItems<FaqEntry>(t, "faqs");
export const loadCredentials = (t: string) => readItems<CredentialEntry>(t, "credentials");

export const saveServices = (t: string, items: ServiceEntry[]) => writeItems(t, "services", items);
export const saveServiceAreas = (t: string, items: ServiceAreaEntry[]) =>
  writeItems(t, "service-areas", items);
export const saveBrands = (t: string, items: BrandEntry[]) => writeItems(t, "brands", items);
export const saveFaqs = (t: string, items: FaqEntry[]) => writeItems(t, "faqs", items);
export const saveCredentials = (t: string, items: CredentialEntry[]) =>
  writeItems(t, "credentials", items);

/** Generic access by kind, for the admin routes. */
export function loadByKind(
  tenant: string,
  kind: ContentKind
): Promise<Record<string, unknown>[]> {
  return readItems<Record<string, unknown>>(tenant, kind);
}

export function saveByKind(tenant: string, kind: ContentKind, items: unknown[]): Promise<void> {
  return writeItems(tenant, kind, items);
}

/** Live content only: approved by a human and marked for publication. */
export function servable<T extends Reviewable>(items: T[], includeUnreviewed: boolean): T[] {
  return items.filter((item) => includeUnreviewed || (item.approved && item.published));
}

/** Not expired as of today. Undated credentials are treated as current. */
export function isCurrent(credential: CredentialEntry): boolean {
  if (!credential.validUntil) return true;
  return credential.validUntil >= new Date().toISOString().slice(0, 10);
}

/**
 * The label shown for an item in the portal, per kind.
 *
 * Each content kind has a different "main" field, and the admin UI needs one
 * consistent way to render any of them.
 */
export function itemLabels(
  kind: ContentKind,
  item: Record<string, unknown>
): { primary: string; secondary: string | null } {
  switch (kind) {
    case "faqs":
      return { primary: String(item.question ?? ""), secondary: String(item.answer ?? "") };
    case "credentials":
      return {
        primary: String(item.title ?? ""),
        secondary: item.identifier ? String(item.identifier) : null,
      };
    case "service-areas":
      return {
        primary: String(item.name ?? ""),
        secondary: Array.isArray(item.zips) && item.zips.length > 0 ? item.zips.join(", ") : null,
      };
    case "services":
      return {
        primary: String(item.name ?? ""),
        secondary: item.category ? String(item.category) : null,
      };
    default:
      return { primary: String(item.name ?? ""), secondary: null };
  }
}
