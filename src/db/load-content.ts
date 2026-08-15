import "dotenv/config";
import { getSupabase, tenantSlug } from "./client";
import { loadCredentials, loadFaqs } from "../data/content";
import { loadProfile, profileExists, validateProfile } from "../data/profile";

/**
 * Loads AUTHORED content into Supabase.
 *
 *   npm run content:load -- --dry-run
 *   npm run content:load
 *
 * Deliberately a separate program from `npm run load`.
 *
 * The ServiceTitan loader is automated and runs on a schedule; this one is
 * human-driven and runs when someone has written something. Keeping them apart
 * means the automated path has no code path that can reach authored tables at
 * all — the separation is structural rather than a matter of care.
 */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const dryRun = argv.includes("--dry-run");
  const slug = get("--tenant") ?? tenantSlug();
  const publish = argv.includes("--publish");

  console.log(`\nLoad authored content`);
  console.log(`  tenant : ${slug}`);
  if (dryRun) console.log(`  DRY RUN — nothing will be written`);
  console.log("");

  if (!profileExists()) {
    throw new Error("content/business-profile.json not found.");
  }

  const profile = loadProfile();
  if (!profile) throw new Error("Could not read content/business-profile.json");

  const validation = validateProfile(profile);

  if (validation.blocking.length > 0) {
    console.log(`  Blocking gaps — an AI cannot resolve this business without them:`);
    for (const field of validation.blocking) console.log(`    - ${field}`);
    console.log("");
    console.log(`  Fill these in content/business-profile.json and run again.`);
    console.log(`  Nothing was written.\n`);
    process.exit(1);
  }

  if (validation.missing.length > 0) {
    console.log(`  Missing (not blocking, but each is a fact that can't be cited):`);
    for (const field of validation.missing) console.log(`    - ${field}`);
    console.log("");
  }

  console.log(`  name          : ${profile.name}`);
  console.log(`  phone         : ${profile.phone ?? "-"}`);
  console.log(`  location      : ${[profile.address.city, profile.address.region].filter(Boolean).join(", ") || "-"}`);
  console.log(`  hours defined : ${profile.hours.length}/7 days`);
  console.log(`  publish       : ${publish ? "yes" : "no (loads as draft)"}`);
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
      // Publishing is an explicit act. Loading a draft should never make it
      // live by accident.
      is_published: publish,
    },
    { onConflict: "tenant_id" }
  );

  if (profileError) throw new Error(`Writing business profile failed: ${profileError.message}`);

  if (profile.hours.length > 0) {
    const { error: hoursError } = await supabase.from("business_hours").upsert(
      profile.hours.map((entry) => ({
        tenant_id: tenantId,
        day_of_week: entry.day,
        opens: entry.opens,
        closes: entry.closes,
        is_closed: entry.isClosed,
      })),
      { onConflict: "tenant_id,day_of_week" }
    );

    if (hoursError) throw new Error(`Writing business hours failed: ${hoursError.message}`);
  }

  // --- FAQs and credentials ------------------------------------------------
  // Only approved entries are written at all. Unapproved candidates stay in
  // the content files where a human can see them, rather than sitting in the
  // database one flag away from being served.
  const approvedFaqs = loadFaqs().filter((faq) => faq.approved);
  if (approvedFaqs.length > 0) {
    const { error } = await supabase.from("faqs").upsert(
      approvedFaqs.map((faq, index) => ({
        tenant_id: tenantId,
        question: faq.question,
        answer: faq.answer,
        origin: faq.provenance?.source === "website" ? "website" : "manual",
        is_approved: true,
        is_published: faq.published,
        sort_order: index,
      }))
    );
    if (error) throw new Error(`Writing FAQs failed: ${error.message}`);
  }

  const approvedCredentials = loadCredentials().filter((c) => c.approved);
  if (approvedCredentials.length > 0) {
    const { error } = await supabase.from("credentials").upsert(
      approvedCredentials.map((c) => ({
        tenant_id: tenantId,
        kind: c.kind,
        title: c.title,
        identifier: c.identifier,
        issuer: c.issuer,
        valid_until: c.validUntil,
        is_published: c.published,
      }))
    );
    if (error) throw new Error(`Writing credentials failed: ${error.message}`);
  }

  console.log(`  Business profile and ${profile.hours.length} day(s) of hours written.`);
  console.log(`  ${approvedFaqs.length} approved FAQ(s), ${approvedCredentials.length} approved credential(s).\n`);

  if (!publish) {
    console.log(`  Loaded as a draft. The API will not serve it until published.`);
    console.log(`  Re-run with --publish when it's been reviewed.\n`);
  }
}

main().catch((error) => {
  console.error(`\nContent load failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
