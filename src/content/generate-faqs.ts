import "dotenv/config";
import {
  loadBrands,
  loadCredentials,
  loadFaqs,
  loadServiceAreas,
  loadServices,
  saveFaqs,
  type FaqEntry,
} from "../data/content";
import { loadProfile, type BusinessProfile, type OpeningHours } from "../data/profile";
import { readSettings } from "../tenancy/store";

/**
 * Builds question-and-answer content out of facts the client has already
 * approved.
 *
 *   npm run generate:faqs -- --tenant acme --dry-run
 *   npm run generate:faqs -- --tenant acme
 *
 * Every crawl ends with the same note: no FAQ content found, and question-and-
 * answer is the format answer engines quote most directly. Meanwhile the app
 * holds approved service areas, verified hours from Google, licence numbers and
 * brand lists — all of it structured, none of it in a form anything will ever
 * quote. This turns those facts into sentences.
 *
 * THREE RULES:
 *
 * 1. Approved inputs only. An unapproved area or licence is an unverified
 *    claim, and generating an answer from one launders a guess into a sentence
 *    that reads like a fact.
 *
 * 2. Answers assemble from data already held and nothing else. No pricing, no
 *    response times, no "we're the best in town". A plausible invented detail
 *    is the worst possible output because it survives review — it reads well.
 *
 * 3. No question per service. Thirty-four near-identical "Do you offer X?"
 *    entries is filler, and filler is actively harmful: it reads as spam to a
 *    person and gives an engine nothing quotable. Services get one roll-up.
 *    Volume is the failure mode here, not coverage.
 *
 * Everything lands unapproved, like every other extracted candidate.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface GeneratedFaq {
  question: string;
  answer: string;
  /** Which fact source produced it, for the run report. */
  from: string;
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** "Venice, North Port and Sarasota" — readable rather than comma-jammed. */
function joinList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "8:00am", from the 24-hour times the profile stores. */
function clockTime(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour)) return value;

  const suffix = hour >= 12 ? "pm" : "am";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${display}${suffix}` : `${display}:${String(minute).padStart(2, "0")}${suffix}`;
}

function isAlwaysOpen(hours: OpeningHours[]): boolean {
  const open = hours.filter((entry) => !entry.isClosed && entry.opens && entry.closes);
  return open.length === 7 && open.every((entry) => entry.opens === "00:00" && entry.closes === "23:59");
}

/**
 * The week as a sentence, collapsing runs of identical days.
 *
 * "Monday to Friday 8am to 5pm, Saturday 9am to 1pm" rather than seven clauses.
 * A schedule nobody can read is not an answer.
 */
function describeWeek(hours: OpeningHours[]): string {
  const byDay = new Map<number, OpeningHours>();
  for (const entry of hours) byDay.set(entry.day, entry);

  const parts: string[] = [];
  let runStart: number | null = null;
  let runValue = "";

  const valueFor = (day: number): string => {
    const entry = byDay.get(day);
    if (!entry || entry.isClosed || !entry.opens || !entry.closes) return "closed";
    return `${clockTime(entry.opens)} to ${clockTime(entry.closes)}`;
  };

  // Monday-first reads naturally; the stored week starts on Sunday.
  const order = [1, 2, 3, 4, 5, 6, 0];

  const flush = (endIndex: number): void => {
    if (runStart === null) return;
    const from = DAYS[order[runStart]];
    const to = DAYS[order[endIndex]];
    const span = runStart === endIndex ? from : `${from} to ${to}`;
    if (runValue !== "closed") parts.push(`${span} ${runValue}`);
    runStart = null;
  };

  for (let i = 0; i < order.length; i++) {
    const value = valueFor(order[i]);
    if (runStart === null) {
      runStart = i;
      runValue = value;
    } else if (value !== runValue) {
      flush(i - 1);
      runStart = i;
      runValue = value;
    }
  }
  flush(order.length - 1);

  return parts.join(", ");
}

export interface FaqInputs {
  profile: BusinessProfile;
  brands: string[];
  areas: string[];
  services: string[];
  credentials: { title: string; identifier: string | null; kind: string }[];
}

/**
 * Builds the questions. Kept separate from file writing so the wording can be
 * checked without touching a client's content.
 */
export function buildFaqs(input: FaqInputs): GeneratedFaq[] {
  const { profile, brands, areas, services, credentials } = input;
  const name = profile.name || "We";
  const faqs: GeneratedFaq[] = [];

  // Only ever three named areas in a sentence. A list of twelve cities is not
  // something anyone reads, and the full set already publishes as areaServed.
  const shortAreas = areas.slice(0, 3);
  const where = shortAreas.length > 0 ? ` in ${joinList(shortAreas)}` : "";
  const callToAction = profile.phone ? ` Call ${profile.phone} to book.` : "";

  // --- service areas -------------------------------------------------------
  // One per area is worth it where one per service is not: "do you serve
  // Venice" is a distinct question with a distinct answer, and location is how
  // these searches are actually phrased.
  for (const area of areas) {
    faqs.push({
      from: "service area",
      question: `Do you serve ${area}?`,
      answer: `Yes. ${name} covers ${area}.${callToAction}`.trim(),
    });
  }

  if (areas.length > 1) {
    faqs.push({
      from: "service areas",
      question: `What areas do you serve?`,
      answer: `${name} serves ${joinList(areas)}.${callToAction}`.trim(),
    });
  }

  // --- hours ---------------------------------------------------------------
  const week = describeWeek(profile.hours);

  if (isAlwaysOpen(profile.hours)) {
    faqs.push({
      from: "hours",
      question: `Are you open 24 hours?`,
      answer: `Yes. ${name} is open 24 hours a day, seven days a week.${callToAction}`.trim(),
    });
  } else if (week) {
    faqs.push({
      from: "hours",
      question: `What are your hours?`,
      answer: `${name} is open ${week}.${callToAction}`.trim(),
    });

    const weekend = profile.hours.filter(
      (entry) => (entry.day === 0 || entry.day === 6) && !entry.isClosed && entry.opens
    );
    faqs.push({
      from: "hours",
      question: `Are you open on weekends?`,
      answer:
        weekend.length > 0
          ? `Yes. ${name} is open ${joinList(
              weekend.map((entry) => `${DAYS[entry.day]} ${clockTime(entry.opens!)} to ${clockTime(entry.closes!)}`)
            )}.${callToAction}`.trim()
          : `${name} is closed on Saturday and Sunday. Weekday hours are ${week}.`,
    });
  }

  // --- credentials ---------------------------------------------------------
  if (credentials.length > 0) {
    const described = credentials.map((credential) =>
      credential.identifier ? `${credential.title} (${credential.identifier})` : credential.title
    );
    faqs.push({
      from: "credentials",
      question: `Are you licensed?`,
      answer: `Yes. ${name} holds ${joinList(described)}.`,
    });
  }

  // --- brands --------------------------------------------------------------
  for (const brand of brands) {
    faqs.push({
      from: "brand",
      question: `Do you service ${brand}?`,
      answer: `Yes. ${name} services ${brand} equipment${where}.${callToAction}`.trim(),
    });
  }

  if (brands.length > 1) {
    faqs.push({
      from: "brands",
      question: `What brands do you service?`,
      answer: `${name} services ${joinList(brands)}${where}.${callToAction}`.trim(),
    });
  }

  // --- services ------------------------------------------------------------
  // One roll-up, never one per service. See rule 3.
  if (services.length > 0) {
    // Eight is about as many as a sentence carries. The full list publishes as
    // an OfferCatalog either way, so this is for a reader, not a crawler.
    const listed = services.slice(0, 8);
    // Placed after the location, not before it: "offers A and B, among other
    // services, in Venice" reads correctly, where "among others in Venice"
    // attaches the qualifier to the wrong noun.
    const tail = services.length > listed.length ? ", among other services" : "";
    faqs.push({
      from: "services",
      question: `What services do you offer?`,
      answer: `${name} offers ${joinList(listed)}${where}${tail}.${callToAction}`.trim(),
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

  const approved = <T extends { approved: boolean }>(items: T[]): T[] =>
    items.filter((item) => item.approved);

  const brands = approved(loadBrands(tenant)).map((brand) => brand.name);
  const areas = approved(loadServiceAreas(tenant)).map((area) => area.name);
  const services = approved(loadServices(tenant)).map((service) => service.name);
  const credentials = approved(loadCredentials(tenant)).map((credential) => ({
    title: credential.title,
    identifier: credential.identifier,
    kind: credential.kind,
  }));

  console.log(`\nGenerate FAQs`);
  console.log(`  client : ${profile.name || tenant}`);
  console.log(
    `  inputs : ${areas.length} area(s), ${services.length} service(s), ` +
      `${brands.length} brand(s), ${credentials.length} credential(s), ` +
      `${profile.hours.filter((h) => !h.isClosed).length} open day(s)`
  );
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  console.log("");

  const generated = buildFaqs({ profile, brands, areas, services, credentials });

  if (generated.length === 0) {
    console.log(
      `  Nothing to build from. Approve some service areas, set the hours, or add\n` +
        `  credentials — every question here is assembled from an approved fact, so\n` +
        `  with no approved facts there is nothing to say.\n`
    );
    return;
  }

  // Never replace an existing question, however it got there. A hand-written
  // answer beats a generated one by definition.
  const existing = loadFaqs(tenant);
  const seen = new Set(existing.map((faq) => normalizeQuestion(faq.question)));

  const fresh = generated.filter((faq) => !seen.has(normalizeQuestion(faq.question)));
  const skipped = generated.length - fresh.length;

  for (const faq of fresh) {
    console.log(`  + [${faq.from}] ${faq.question}`);
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
      method: `assembled from approved ${faq.from} and the business profile`,
      confidence: "medium",
    },
  }));

  saveFaqs(tenant, [...existing, ...entries]);

  console.log(`  ${entries.length} FAQ(s) added, all unapproved.`);
  console.log(`  Read them before approving — an answer published in the business's`);
  console.log(`  name is a promise made on their behalf.\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nFAQ generation failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
