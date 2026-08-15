import {
  isCurrent,
  loadBrands,
  loadCredentials,
  loadFaqs,
  loadServiceAreas,
  loadServices,
} from "../data/content";
import { loadProfile, validateProfile } from "../data/profile";

/**
 * Gathers everything for the review dashboard.
 *
 * Reads the content files directly rather than going through KnowledgeSource,
 * because the whole point is seeing what is NOT yet approved. The public API
 * deliberately cannot show that; this view deliberately must.
 */

export interface ReviewItem {
  primary: string;
  secondary: string | null;
  approved: boolean;
  published: boolean;
  source: string;
  confidence: string;
  note: string | null;
}

export interface ReviewSection {
  key: string;
  label: string;
  items: ReviewItem[];
  approved: number;
  published: number;
}

export interface ProfileField {
  label: string;
  value: string | null;
  blocking: boolean;
}

export interface DashboardData {
  businessName: string;
  domain: string | null;
  profileFields: ProfileField[];
  blocking: string[];
  missing: string[];
  openDays: number;
  sections: ReviewSection[];
  totalItems: number;
  totalApproved: number;
}

function describe(entry: { provenance?: { source: string; confidence: string } }): {
  source: string;
  confidence: string;
} {
  return {
    source: entry.provenance?.source ?? "manual",
    confidence: entry.provenance?.confidence ?? "—",
  };
}

function summarize(key: string, label: string, items: ReviewItem[]): ReviewSection {
  return {
    key,
    label,
    items,
    approved: items.filter((item) => item.approved).length,
    published: items.filter((item) => item.approved && item.published).length,
  };
}

export function buildDashboardData(): DashboardData {
  const profile = loadProfile();
  const validation = profile
    ? validateProfile(profile)
    : { blocking: ["no business profile"], missing: [] };

  const profileFields: ProfileField[] = profile
    ? [
        { label: "Name", value: profile.name || null, blocking: true },
        { label: "Phone", value: profile.phone, blocking: true },
        { label: "City", value: profile.address.city, blocking: true },
        { label: "State", value: profile.address.region, blocking: true },
        { label: "Street", value: profile.address.street, blocking: false },
        { label: "ZIP", value: profile.address.postalCode, blocking: false },
        { label: "Email", value: profile.email, blocking: false },
        { label: "Domain", value: profile.domain, blocking: false },
        { label: "Founded", value: profile.foundedYear ? String(profile.foundedYear) : null, blocking: false },
        { label: "Google profile", value: profile.gbpUrl, blocking: false },
        { label: "Response time", value: profile.responseTime, blocking: false },
      ]
    : [];

  const services = loadServices().map<ReviewItem>((item) => ({
    primary: item.name,
    secondary: item.category,
    approved: item.approved,
    published: item.published,
    ...describe(item),
    note: null,
  }));

  const areas = loadServiceAreas().map<ReviewItem>((item) => ({
    primary: item.name,
    secondary: item.zips.length > 0 ? item.zips.join(", ") : null,
    approved: item.approved,
    published: item.published,
    ...describe(item),
    // ZIPs are what let an answer engine match a location exactly.
    note: item.zips.length === 0 ? "no ZIP codes" : null,
  }));

  const brands = loadBrands().map<ReviewItem>((item) => ({
    primary: item.name,
    secondary: null,
    approved: item.approved,
    published: item.published,
    ...describe(item),
    note: null,
  }));

  const faqs = loadFaqs().map<ReviewItem>((item) => ({
    primary: item.question,
    secondary: item.answer,
    approved: item.approved,
    published: item.published,
    ...describe(item),
    note: null,
  }));

  const credentials = loadCredentials().map<ReviewItem>((item) => ({
    primary: item.title,
    secondary: item.identifier,
    approved: item.approved,
    published: item.published,
    ...describe(item),
    note: isCurrent(item) ? null : "EXPIRED — will never be served",
  }));

  const sections = [
    summarize("services", "Services", services),
    summarize("areas", "Service areas", areas),
    summarize("brands", "Brands", brands),
    summarize("faqs", "Questions & answers", faqs),
    summarize("credentials", "Licenses & credentials", credentials),
  ];

  const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0);
  const totalApproved = sections.reduce((sum, section) => sum + section.approved, 0);

  return {
    businessName: profile?.name || "No business profile",
    domain: profile?.domain ?? null,
    profileFields,
    blocking: validation.blocking,
    missing: validation.missing,
    openDays: profile ? profile.hours.filter((entry) => !entry.isClosed).length : 0,
    sections,
    totalItems,
    totalApproved,
  };
}
