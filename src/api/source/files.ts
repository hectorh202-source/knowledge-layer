import { isCurrent, loadCredentials, loadFaqs } from "../../data/content";
import { latestRunDir, loadDataset } from "../../data/normalize";
import { loadProfile, validateProfile } from "../../data/profile";
import type { Dataset } from "../../data/types";
import type {
  BrandDto,
  BusinessDto,
  CredentialDto,
  FaqDto,
  KnowledgeSource,
  ServiceAreaDto,
  ServiceDto,
  SourceOptions,
} from "../types";

/**
 * Serves the API from local files instead of Supabase.
 *
 * Derived data comes from the latest export; the business profile comes from
 * content/business-profile.json. This exists so the API runs before a Supabase
 * project does — an API nobody can run is an API nobody reviews.
 *
 * What it cannot serve: FAQs, credentials, and service write-ups, which live
 * only in the database because they're authored through their own path. Those
 * being empty here is accurate rather than a gap.
 */
export class FileSource implements KnowledgeSource {
  readonly kind = "files" as const;
  readonly tenant: string;

  private dataset: Dataset;
  private includeUnreviewed: boolean;

  constructor(options: SourceOptions, dir?: string) {
    this.tenant = options.tenant;
    this.includeUnreviewed = options.includeUnreviewed;
    this.dataset = loadDataset(dir ?? latestRunDir());
  }

  async business(): Promise<BusinessDto | null> {
    const profile = loadProfile();
    if (!profile) return null;

    // A profile missing its name, phone, or city can't identify a business.
    // Serving it would put an unresolvable entity in front of a crawler.
    const validation = validateProfile(profile);
    if (validation.blocking.length > 0 && !this.includeUnreviewed) return null;

    return {
      name: profile.name,
      legalName: profile.legalName,
      description: profile.description,
      phone: profile.phone,
      email: profile.email,
      domain: profile.domain,
      address: profile.address,
      gbpUrl: profile.gbpUrl,
      foundedYear: profile.foundedYear,
      responseTime: profile.responseTime,
      emergencyService: profile.emergencyService,
      hours: profile.hours,
      serviceCount: this.dataset.services.filter((s) => s.isActive).length,
      serviceAreaCount: this.dataset.serviceAreas.filter((a) => a.isActive).length,
    };
  }

  async services(): Promise<ServiceDto[]> {
    return this.dataset.services
      .filter((service) => service.isActive)
      .map((service) => ({
        name: service.name,
        category: service.category,
        description: service.description,
      }));
  }

  async serviceAreas(): Promise<ServiceAreaDto[]> {
    return this.dataset.serviceAreas
      .filter((area) => area.isActive)
      .map((area) => ({ name: area.name, zips: area.zips, cities: area.cities }));
  }

  async brands(): Promise<BrandDto[]> {
    return this.dataset.brands
      .filter((brand) => brand.isActive)
      .map((brand) => ({ name: brand.name }));
  }

  /**
   * Approved and published only — the same gate the database applies.
   *
   * An extracted answer is a promise made on the company's behalf, so serving
   * anything unapproved would put words in their mouth in front of an AI.
   */
  async faqs(): Promise<FaqDto[]> {
    return loadFaqs()
      // includeUnreviewed lifts both gates — approval and publication. It is a
      // local preview switch, and a preview that can't show unapproved content
      // can't answer "what would this look like once I sign off?"
      .filter((faq) => this.includeUnreviewed || (faq.approved && faq.published))
      .map((faq) => ({ question: faq.question, answer: faq.answer, service: null }));
  }

  async credentials(): Promise<CredentialDto[]> {
    return loadCredentials()
      .filter((c) => this.includeUnreviewed || (c.approved && c.published))
      // A lapsed license published as current is a claim about compliance that
      // stopped being true.
      .filter(isCurrent)
      .map((c) => ({
        kind: c.kind,
        title: c.title,
        identifier: c.identifier,
        issuer: c.issuer,
      }));
  }
}
