import "dotenv/config";
import { loadBrands, loadFaqs, loadServiceAreas, saveFaqs, type FaqEntry } from "../data/content";
import { loadProfile } from "../data/profile";
import { readSettings } from "../tenancy/store";

/**
 * Turns the brand list into question-and-answer content.
 *
 *   npm run generate:brand-faqs -- --tenant acme --dry-run
 *   npm run generate:brand-faqs -- --tenant acme
 *
 * Why this exists: "who repairs Trane in Sarasota" is a real query pattern in
 * home services, but a brand sitting in the profile only ever became
 * `knowsAbout: ["Trane"]` — a bare name with no stated relationship, which
 * Google ignores for rich results and an assistant can do little with. What
 * gets retrieved and quoted is prose. A brand is worth having only once
 * somebody can read a sentence saying what the business does with it.
 *
 * TWO RULES, both about not inventing things:
 *
 * 1. Only approved brands. An unapproved brand is an unverified claim, and
 *    generating an answer from it would launder a guess into a sentence that
 *    reads like a fact.
 *
 * 2. Answers are assembled only from data already held — the brand name, the
 *    business name, approved service areas, the phone number. Nothing about
 *    pricing, response times, certifications or whether they install as well as
 *    repair, because none of that is known here. A plausible invented detail is
 *    the worst possible output: it survives review precisely because it reads
 *    well.
 *
 * Everything lands unapproved, like every other extracted candidate.
 */

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** "Venice, North Port and Sarasota" — readable rather than comma-jammed. */
function joinAreas(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface GeneratedFaq {
  question: string;
  answer: string;
}

/**
 * Builds the questions. Exported separately from the file writing so the
 * wording can be tested without touching a client's content.
 */
export function buildBrandFaqs(input: {
  businessName: string;
  brands: string[];
  areas: string[];
  phone: string | null;
}): GeneratedFaq[] {
  const { businessName, brands, phone } = input;
  if (brands.length === 0) return [];

  // At most three named areas. A sentence listing twelve cities is not an
  // answer anyone reads, and the full list already publishes as areaServed.
  const areaNames = input.areas.slice(0, 3);
  const where = areaNames.length > 0 ? ` in ${joinAreas(areaNames)}` : "";
  const callToAction = phone ? ` Call ${phone} to book.` : "";

  const faqs: GeneratedFaq[] = [];

  // One per brand — this is the question people actually type.
  for (const brand of brands) {
    faqs.push({
      question: `Do you service ${brand}?`,
      answer:
        `Yes. ${businessName} services ${brand} equipment${where}.${callToAction}`.trim(),
    });
  }

  // One roll-up, which answers the comparison question the per-brand entries
  // cannot: what else do they cover.
  if (brands.length > 1) {
    faqs.push({
      question: `What brands do you service?`,
      answer:
        `${businessName} services ${joinAreas(brands)}${where}.${callToAction}`.trim(),
    });
  }

  return faqs;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const tenant = get("--tenant") ?? process.env.TENANT_SLUG ?? "";
  const dryRun = argv.includes("--dry-run");

  const settings = readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}". Create it in the portal first.`);

  const profile = loadProfile(tenant);
  if (!profile) throw new Error(`Client "${tenant}" has no business profile.`);

  const approvedBrands = loadBrands(tenant).filter((brand) => brand.approved);
  const allBrands = loadBrands(tenant);

  console.log(`\nBrand FAQs`);
  console.log(`  client : ${profile.name || tenant}`);
  console.log(`  brands : ${approvedBrands.length} approved of ${allBrands.length}`);
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  console.log("");

  if (approvedBrands.length === 0) {
    console.log(
      allBrands.length === 0
        ? `  No brands recorded. Add the brands this business services in the Brands\n` +
          `  section, or crawl a site that lists them.\n`
        : `  ${allBrands.length} brand(s) recorded but none approved. An unapproved brand is\n` +
          `  an unverified claim, and an answer built from one would read as fact.\n` +
          `  Approve the brands you are sure of, then run this again.\n`
    );
    return;
  }

  const generated = buildBrandFaqs({
    businessName: profile.name || tenant,
    brands: approvedBrands.map((brand) => brand.name),
    areas: loadServiceAreas(tenant)
      .filter((area) => area.approved)
      .map((area) => area.name),
    phone: profile.phone,
  });

  // Never replace a question that already exists, however it got there. A
  // hand-written answer is better than a generated one by definition.
  const existing = loadFaqs(tenant);
  const seen = new Set(existing.map((faq) => normalizeQuestion(faq.question)));

  const fresh = generated.filter((faq) => !seen.has(normalizeQuestion(faq.question)));
  const skipped = generated.length - fresh.length;

  for (const faq of fresh) {
    console.log(`  + ${faq.question}`);
    console.log(`      ${faq.answer}\n`);
  }

  if (skipped > 0) console.log(`  ${skipped} already exist and were left alone.\n`);

  if (fresh.length === 0) {
    console.log(`  Nothing new to add.\n`);
    return;
  }

  if (dryRun) {
    console.log(`  Dry run complete. Nothing was written.\n`);
    return;
  }

  const entries: FaqEntry[] = fresh.map((faq) => ({
    question: faq.question,
    answer: faq.answer,
    approved: false,
    published: false,
    provenance: {
      source: "generated",
      url: null,
      method: "assembled from approved brands, service areas and the business profile",
      confidence: "medium",
    },
  }));

  saveFaqs(tenant, [...existing, ...entries]);

  console.log(`  ${entries.length} FAQ(s) added, all unapproved.`);
  console.log(`  Read them before approving — an answer published in the business's`);
  console.log(`  name is a promise made on their behalf.\n`);
}

// Only run when invoked directly, so buildBrandFaqs stays importable.
if (require.main === module) {
  main().catch((error) => {
    console.error(`\nBrand FAQ generation failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
