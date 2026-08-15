import {
  isCurrent,
  loadBrands,
  loadCredentials,
  loadFaqs,
  loadServiceAreas,
  loadServices,
  servable,
} from "../../data/content";
import { loadProfile, validateProfile } from "../../data/profile";
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
 * Serves the API from the content files.
 *
 * Same gates as the database: approved by a human and published. Lets the whole
 * system run before Supabase exists, which is what keeps it reviewable.
 */
export class FileSource implements KnowledgeSource {
  readonly kind = "files" as const;
  readonly tenant: string;

  private includeUnreviewed: boolean;

  constructor(options: SourceOptions) {
    this.tenant = options.tenant;
    this.includeUnreviewed = options.includeUnreviewed;
  }

  async business(): Promise<BusinessDto | null> {
    const profile = loadProfile();
    if (!profile) return null;

    // Without a name, phone, and city there is no resolvable entity, and
    // serving one would put an unidentifiable business in front of a crawler.
    if (validateProfile(profile).blocking.length > 0 && !this.includeUnreviewed) {
      return null;
    }

    const [services, areas] = await Promise.all([this.services(), this.serviceAreas()]);

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
      serviceCount: services.length,
      serviceAreaCount: areas.length,
    };
  }

  async services(): Promise<ServiceDto[]> {
    return servable(loadServices(), this.includeUnreviewed).map((service) => ({
      name: service.name,
      category: service.category,
      description: service.description,
    }));
  }

  async serviceAreas(): Promise<ServiceAreaDto[]> {
    return servable(loadServiceAreas(), this.includeUnreviewed).map((area) => ({
      name: area.name,
      zips: area.zips,
      cities: [area.name],
    }));
  }

  async brands(): Promise<BrandDto[]> {
    return servable(loadBrands(), this.includeUnreviewed).map((brand) => ({ name: brand.name }));
  }

  async faqs(): Promise<FaqDto[]> {
    return servable(loadFaqs(), this.includeUnreviewed).map((faq) => ({
      question: faq.question,
      answer: faq.answer,
      service: null,
    }));
  }

  async credentials(): Promise<CredentialDto[]> {
    return servable(loadCredentials(), this.includeUnreviewed)
      // A lapsed license published as current is a compliance claim that
      // stopped being true.
      .filter(isCurrent)
      .map((credential) => ({
        kind: credential.kind,
        title: credential.title,
        identifier: credential.identifier,
        issuer: credential.issuer,
      }));
  }
}
