import "dotenv/config";
import { getSupabase, tenantSlug } from "./client";
import {
  loadBrands,
  loadCredentials,
  loadFaqs,
  loadServiceAreas,
  loadServices,
} from "../data/content";
import { loadProfile, profileExists, validateProfile } from "../data/profile";

/**
 * Loads the content files into Supabase.
 *
 *   npm run content:load -- --dry-run
 *   npm run content:load
 *   npm run content:load -- --publish
 *
 * Only approved entries are written at all. Unapproved candidates stay in the
 * files where a person can see them, rather than sitting in the database one
 * flag away from being served.
 */

function sourceOf(provenance: { source: string } | undefined): string {
  const source = provenance?.source;
  return source === "gbp" || source === "places" || source === "website" ? source : "manual";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const dryRun = argv.includes("--dry-run");
  const publish = argv.includes("--publish");
  const slug = get("--tenant") ?? tenantSlug();

  console.log(`\nLoad content into Supabase`);
  console.log(`  tenant : ${slug}`);
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  console.log("");

  if (!profileExists(slug)) throw new Error("content/business-profile.json not found.");

  const profile = loadProfile(slug);
  if (!profile) throw new Error("Could not read content/business-profile.json");

  const validation = validateProfile(profile);

  if (validation.blocking.length > 0) {
    console.log(`  Blocking gaps — an AI cannot resolve this business without them:`);
    for (const field of validation.blocking) console.log(`    - ${field}`);
    console.log(`\n  Fill these in content/business-profile.json and run again.`);
    console.log(`  Nothing was written.\n`);
    process.exit(1);
  }

  if (validation.missing.length > 0) {
    console.log(`  Missing (not blocking, but each is a fact that can't be cited):`);
    for (const field of validation.missing) console.log(`    - ${field}`);
    console.log("");
  }

  const services = loadServices(slug).filter((item) => item.approved);
  const areas = loadServiceAreas(slug).filter((item) => item.approved);
  const brands = loadBrands(slug).filter((item) => item.approved);
  const faqs = loadFaqs(slug).filter((item) => item.approved);
  const credentials = loadCredentials(slug).filter((item) => item.approved);

  const counts: [string, number, number][] = [
    ["services", services.length, loadServices(slug).length],
    ["service areas", areas.length, loadServiceAreas(slug).length],
    ["brands", brands.length, loadBrands(slug).length],
    ["faqs", faqs.length, loadFaqs(slug).length],
    ["credentials", credentials.length, loadCredentials(slug).length],
  ];

  console.log(`  name     : ${profile.name}`);
  console.log(`  phone    : ${profile.phone ?? "-"}`);
  console.log(`  location : ${[profile.address.city, profile.address.region].filter(Boolean).join(", ") || "-"}`);
  console.log(`  hours    : ${profile.hours.filter((h: { isClosed: boolean }) => !h.isClosed).length} open day(s)\n`);

  for (const [label, approved, total] of counts) {
    const suffix = total > approved ? `   (${total - approved} awaiting approval)` : "";
    console.log(`  ${label.padEnd(14)} ${String(approved).padStart(3)} approved${suffix}`);
  }
  console.log("");

  if (dryRun) {
    console.log(`  Dry run complete. Nothing was written.\n`);
    return;
  }

  const supabase = getSupabase();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .upsert({ slug, name: profile.name }, { onConflict: "slug" })
    .select("id")
    .single();

  if (tenantError) throw new Error(`Resolving tenant failed: ${tenantError.message}`);
  const tenantId = String((tenant as Record<string, unknown>).id);

  const { error: profileError } = await supabase.from("business_profile").upsert(
    {
      tenant_id: tenantId,
      name: profile.name,
      legal_name: profile.legalName,
      description: profile.description,
      phone: profile.phone,
      email: profile.email,
      domain: profile.domain,
      street: profile.address.street,
      city: profile.address.city,
      region: profile.address.region,
      postal_code: profile.address.postalCode,
      country: profile.address.country,
      gbp_url: profile.gbpUrl,
      founded_year: profile.foundedYear,
      response_time: profile.responseTime,
      emergency_service: profile.emergencyService,
      // Publishing is an explicit act — loading a draft must never make it live.
      is_published: publish,
    },
    { onConflict: "tenant_id" }
  );

  if (profileError) throw new Error(`Writing business profile failed: ${profileError.message}`);

  if (profile.hours.length > 0) {
    const { error } = await supabase.from("business_hours").upsert(
      profile.hours.map((entry: { day: number; opens: string | null; closes: string | null; isClosed: boolean }) => ({
        tenant_id: tenantId,
        day_of_week: entry.day,
        opens: entry.opens,
        closes: entry.closes,
        is_closed: entry.isClosed,
      })),
      { onConflict: "tenant_id,day_of_week" }
    );
    if (error) throw new Error(`Writing business hours failed: ${error.message}`);
  }

  const write = async (table: string, rows: Record<string, unknown>[], conflict: string) => {
    if (rows.length === 0) return;
    const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
    if (error) throw new Error(`Writing ${table} failed: ${error.message}`);
  };

  await write(
    "services",
    services.map((item, index) => ({
      tenant_id: tenantId,
      name: item.name,
      category: item.category,
      description: item.description,
      source: sourceOf(item.provenance),
      is_approved: true,
      is_published: item.published,
      sort_order: index,
    })),
    "tenant_id,name"
  );

  await write(
    "service_areas",
    areas.map((item) => ({
      tenant_id: tenantId,
      name: item.name,
      zips: item.zips,
      source: sourceOf(item.provenance),
      is_approved: true,
      is_published: item.published,
    })),
    "tenant_id,name"
  );

  await write(
    "brands",
    brands.map((item) => ({
      tenant_id: tenantId,
      name: item.name,
      source: sourceOf(item.provenance),
      is_approved: true,
      is_published: item.published,
    })),
    "tenant_id,name"
  );

  await write(
    "faqs",
    faqs.map((item, index) => ({
      tenant_id: tenantId,
      question: item.question,
      answer: item.answer,
      source: sourceOf(item.provenance),
      is_approved: true,
      is_published: item.published,
      sort_order: index,
    })),
    "tenant_id,question"
  );

  if (credentials.length > 0) {
    const { error } = await supabase.from("credentials").insert(
      credentials.map((item) => ({
        tenant_id: tenantId,
        kind: item.kind,
        title: item.title,
        identifier: item.identifier,
        issuer: item.issuer,
        valid_until: item.validUntil,
        source: sourceOf(item.provenance),
        is_approved: true,
        is_published: item.published,
      }))
    );
    if (error) throw new Error(`Writing credentials failed: ${error.message}`);
  }

  console.log(`  Written.\n`);

  if (!publish) {
    console.log(`  The business profile loaded as a draft, so the API will not serve it.`);
    console.log(`  Re-run with --publish once it has been reviewed.\n`);
  }
}

main().catch((error) => {
  console.error(`\nContent load failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
