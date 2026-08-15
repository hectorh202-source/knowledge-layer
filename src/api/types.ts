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

export interface AddressDto {
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
}

export interface HoursDto {
  /** 0 = Sunday. */
  day: number;
  opens: string | null;
  closes: string | null;
  isClosed: boolean;
}

/**
 * The entity record. The most important response in the API — everything else
 * is only useful once an AI can resolve who this business is.
 */
export interface BusinessDto {
  name: string;
  legalName: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  domain: string | null;
  address: AddressDto;
  gbpUrl: string | null;
  foundedYear: number | null;
  responseTime: string | null;
  emergencyService: boolean;
  hours: HoursDto[];
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
