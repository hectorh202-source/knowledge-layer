/**
 * Public API shapes.
 *
 * Deliberately not database rows and not ServiceTitan records. This is the
 * third boundary in the pipeline:
 *
 *   ServiceTitan JSON  --normalize.ts-->  domain types
 *   domain types       --loader-------->  database rows
 *   database rows      --this file----->  public API
 *
 * Everything here is written for one reader: an answer engine deciding whether
 * it can name this business in a reply. That means concrete, resolvable facts —
 * a phone number, a postal code, a direct answer to a question — rather than
 * prose an AI has to interpret.
 */

import type { BusinessProfile, OpeningHours, PostalAddress } from "../data/profile";

/** Aliases kept so existing call sites and the OpenAPI spec still read clearly. */
export type AddressDto = PostalAddress;
export type HoursDto = OpeningHours;

/**
 * The entity record. The most important response in the API — everything else
 * is only useful once an AI can resolve who this business is.
 *
 * Derived from `BusinessProfile` rather than restated. The two were once
 * hand-maintained copies of the same field list, and they drifted every single
 * time a field was added or removed — each drift a compile error at best and a
 * field silently missing from the API at worst. The public shape is the profile
 * plus two counts; saying so in the type makes that permanent.
 */
export interface BusinessDto extends BusinessProfile {
  serviceCount: number;
  serviceAreaCount: number;
}

export interface ServiceDto {
  name: string;
  category: string | null;
  description: string | null;
}

export interface ServiceAreaDto {
  name: string;
  /** Real postal codes, so an AI can match a customer's location precisely. */
  zips: string[];
  cities: string[];
}

export interface BrandDto {
  name: string;
}

/** Question and answer — the shape an answer engine actually cites. */
export interface FaqDto {
  question: string;
  answer: string;
  service: string | null;
}

export interface CredentialDto {
  kind: string;
  title: string;
  identifier: string | null;
  issuer: string | null;
}

export interface KnowledgeSource {
  readonly kind: "supabase" | "files";
  readonly tenant: string;


  business(): Promise<BusinessDto | null>;
  services(): Promise<ServiceDto[]>;
  serviceAreas(): Promise<ServiceAreaDto[]>;
  brands(): Promise<BrandDto[]>;
  faqs(): Promise<FaqDto[]>;
  credentials(): Promise<CredentialDto[]>;
}

export interface SourceOptions {
  tenant: string;
  /**
   * Serve content no human has reviewed. Local inspection only — unreviewed
   * facts about a business are how a wrong phone number reaches an AI.
   */
  includeUnreviewed: boolean;
}
