/**
 * Intake — pulling a business's facts out of sources it already has.
 *
 * This is the part that decides whether the platform is a product or consulting
 * with extra steps. Hand-curating TitanZ works because we know the business.
 * Customer #8 will not get two weeks of that, so the job is to assemble as
 * complete a picture as possible with the owner doing as little typing as
 * possible — then have them approve rather than author.
 *
 * Sources, in descending order of how universally available they are:
 *
 *   website  — everyone has one, no credentials, but extraction quality varies
 *   places   — public Google data, needs only OUR api key, not the customer's
 *              access, so it can be pulled before a contract is signed
 *   gbp      — full Google Business Profile; needs the owner to authorize
 *   crm      — richest structured data, needs integration
 *   calls    — the best FAQ source when it exists, but most customers won't
 *              have a voice agent, so nothing may depend on it
 *
 * NOTHING extracted is trusted. Every candidate lands unapproved with its
 * provenance attached, and a human promotes it.
 */

export type SourceKind = "website" | "places" | "gbp" | "crm" | "calls" | "generated";

/** Where a candidate came from, so a human reviewing it can judge it. */
export interface Provenance {
  source: SourceKind;
  /** Page or record it came from. */
  url: string | null;
  /** How it was recognized — "JSON-LD LocalBusiness", "tel: link", etc. */
  method: string;
  extractedAt: string;
  /**
   * Rough reliability. Structured markup is high; text pattern-matching is low.
   * Used to sort a review queue, never to auto-approve.
   */
  confidence: "high" | "medium" | "low";
}

export interface Candidate<T> {
  value: T;
  provenance: Provenance;
}

export interface EntityCandidates {
  name: Candidate<string>[];
  legalName: Candidate<string>[];
  description: Candidate<string>[];
  phone: Candidate<string>[];
  email: Candidate<string>[];
  street: Candidate<string>[];
  city: Candidate<string>[];
  region: Candidate<string>[];
  postalCode: Candidate<string>[];
  foundedYear: Candidate<number>[];
  gbpUrl: Candidate<string>[];
  hours: Candidate<{ day: number; opens: string | null; closes: string | null; isClosed: boolean }>[];
}

export interface FaqCandidate {
  question: string;
  answer: string;
  provenance: Provenance;
}

export interface ServiceCandidate {
  name: string;
  description: string | null;
  provenance: Provenance;
}

export interface CredentialCandidate {
  kind: string;
  title: string;
  identifier: string | null;
  provenance: Provenance;
}

export interface AreaCandidate {
  name: string;
  provenance: Provenance;
}

export interface BrandCandidate {
  name: string;
  provenance: Provenance;
}

/** Everything one intake run found, before any human has looked at it. */
export interface IntakeResult {
  domain: string;
  startedAt: string;
  finishedAt: string;
  pagesFetched: string[];
  pagesSkipped: { url: string; reason: string }[];
  entity: EntityCandidates;
  faqs: FaqCandidate[];
  services: ServiceCandidate[];
  credentials: CredentialCandidate[];
  areas: AreaCandidate[];
  brands: BrandCandidate[];
  notes: string[];
}

export function emptyEntityCandidates(): EntityCandidates {
  return {
    name: [],
    legalName: [],
    description: [],
    phone: [],
    email: [],
    street: [],
    city: [],
    region: [],
    postalCode: [],
    foundedYear: [],
    gbpUrl: [],
    hours: [],
  };
}

export function provenance(
  source: SourceKind,
  url: string | null,
  method: string,
  confidence: Provenance["confidence"]
): Provenance {
  return { source, url, method, extractedAt: new Date().toISOString(), confidence };
}
