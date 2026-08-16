import "dotenv/config";
import { parseJsonLdBlocks } from "../intake/jsonld";
import { buildJsonLd } from "../jsonld/build";
import { FileSource } from "../api/source/files";
import { readSettings } from "../tenancy/store";

/**
 * Checks whether the markup we generated is actually live on the customer's
 * site, and whether it still matches.
 *
 *   npm run verify:markup -- --tenant acme
 *
 * This is the piece that makes pasted markup safe to rely on. A snippet copied
 * into a page head is correct the day it is pasted and drifts from then on:
 * hours change in the portal, nobody re-pastes, and the site keeps serving last
 * quarter's answer. Everything looks right from inside the portal, which is the
 * worst shape a failure can take.
 *
 * Read as a non-rendering crawler reads: raw HTML, no JavaScript executed. That
 * is deliberate rather than lazy. GPTBot, ClaudeBot and PerplexityBot largely
 * do not run scripts, so markup injected client-side is invisible to exactly
 * the readers this product exists to reach. If it does not appear here, it does
 * not appear for them.
 */

export type MarkupStatus = "missing" | "foreign" | "stale" | "current";

export interface FieldDiff {
  field: string;
  ours: string;
  theirs: string;
}

export interface VerifyResult {
  url: string;
  status: MarkupStatus;
  /** How many ld+json blocks the page carries, ours or not. */
  blocksFound: number;
  /** Business-type nodes found that are not ours — a competing entity claim. */
  foreignBusinessNodes: string[];
  differences: FieldDiff[];
  notes: string[];
}

const BUSINESS_TYPE = /Business|Organization|Plumber|Electrician|Contractor|Locksmith|Store/i;

export function isBusinessNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((entry) => typeof entry === "string" && BUSINESS_TYPE.test(entry));
}

/** Flattens an @graph wrapper so both shapes compare the same way. */
export function nodesOf(block: Record<string, unknown>): Record<string, unknown>[] {
  const graph = block["@graph"];
  if (Array.isArray(graph)) {
    return graph.filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null);
  }
  return [block];
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (typeof node.name === "string") return node.name;
  }
  return "";
}

/** The fields worth comparing — the ones that change and that get quoted. */
function compare(
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  const simple = ["name", "telephone", "email", "priceRange", "url"];
  for (const field of simple) {
    const a = text(ours[field]);
    const b = text(theirs[field]);
    if (a && a !== b) diffs.push({ field, ours: a, theirs: b || "(absent)" });
  }

  const ourAddress = (ours.address ?? {}) as Record<string, unknown>;
  const theirAddress = (theirs.address ?? {}) as Record<string, unknown>;
  for (const field of ["streetAddress", "addressLocality", "addressRegion", "postalCode"]) {
    const a = text(ourAddress[field]);
    const b = text(theirAddress[field]);
    if (a && a !== b) {
      diffs.push({ field: `address.${field}`, ours: a, theirs: b || "(absent)" });
    }
  }

  // Hours compare by shape rather than value. A day-by-day diff of seven
  // entries buries the finding; what matters is that the week is different.
  const ourHours = Array.isArray(ours.openingHoursSpecification)
    ? ours.openingHoursSpecification.length
    : 0;
  const theirHours = Array.isArray(theirs.openingHoursSpecification)
    ? theirs.openingHoursSpecification.length
    : 0;
  if (ourHours !== theirHours) {
    diffs.push({
      field: "openingHoursSpecification",
      ours: `${ourHours} day(s)`,
      theirs: `${theirHours} day(s)`,
    });
  }

  const ourSameAs = Array.isArray(ours.sameAs) ? ours.sameAs.length : 0;
  const theirSameAs = Array.isArray(theirs.sameAs) ? theirs.sameAs.length : 0;
  if (ourSameAs !== theirSameAs) {
    diffs.push({ field: "sameAs", ours: `${ourSameAs} link(s)`, theirs: `${theirSameAs} link(s)` });
  }

  return diffs;
}

export async function verifyMarkup(tenant: string): Promise<VerifyResult> {
  const settings = await readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}".`);
  if (!settings.domain) throw new Error(`Client "${tenant}" has no domain set.`);

  const url = `https://${settings.domain}`;
  const notes: string[] = [];

  const built = await buildJsonLd(new FileSource({ tenant, includeUnreviewed: false }), {
    domain: settings.domain,
    schemaType: settings.schemaType,
  });

  const ourNodes = nodesOf(built.graph);
  const ourBusiness = ourNodes.find(isBusinessNode);

  if (!ourBusiness) {
    notes.push(
      "Nothing to compare against — the portal is not generating a business node yet. " +
        "Approve and publish the profile first."
    );
  }

  // A browser user agent on purpose. Some hosts rate-limit crawler agents, and
  // a 429 here would look like missing markup rather than a blocked request —
  // which is a separate finding the Tier 1 audit already reports.
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "text/html",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return {
      url,
      status: "missing",
      blocksFound: 0,
      foreignBusinessNodes: [],
      differences: [],
      notes: [`The site returned HTTP ${response.status}, so nothing could be read.`],
    };
  }

  const html = await response.text();
  const blocks = parseJsonLdBlocks(html);
  const liveNodes = blocks.flatMap(nodesOf);
  const liveBusinesses = liveNodes.filter(isBusinessNode);

  if (liveBusinesses.length === 0) {
    notes.push(
      blocks.length === 0
        ? "No JSON-LD on the page at all. The snippet has not been installed."
        : `${blocks.length} JSON-LD block(s) found, but none describes a business. ` +
          `Whatever is there is markup for something else — an article, a breadcrumb trail.`
    );
    return { url, status: "missing", blocksFound: blocks.length, foreignBusinessNodes: [], differences: [], notes };
  }

  // Match on @id, which is the anchor we mint. Anything else claiming to be
  // this business is somebody else's markup — usually an SEO plugin — and two
  // business nodes on one page is worse than one, because a crawler has no way
  // to tell which is authoritative.
  const ourId = typeof ourBusiness?.["@id"] === "string" ? ourBusiness["@id"] : "";
  const mine = liveBusinesses.find((node) => ourId && node["@id"] === ourId);
  const foreign = liveBusinesses
    .filter((node) => node !== mine)
    .map((node) => `${text(node["@type"]) || "Business"}: ${text(node.name) || "(unnamed)"}`);

  if (foreign.length > 0) {
    notes.push(
      `${foreign.length} other business node(s) on the page, probably from an SEO plugin. ` +
        `Two competing descriptions of one business is worse than one — a crawler cannot tell ` +
        `which is authoritative. Turn the other one off rather than adding to it.`
    );
  }

  if (!mine) {
    return {
      url,
      status: "foreign",
      blocksFound: blocks.length,
      foreignBusinessNodes: foreign,
      differences: [],
      notes: [
        ...notes,
        "None of the business markup on the page is ours — no node carries our @id. " +
          "The snippet has not been installed, or was installed and later overwritten.",
      ],
    };
  }

  const differences = ourBusiness ? compare(ourBusiness, mine) : [];

  if (differences.length > 0) {
    notes.push(
      "The snippet is installed but out of date. Copy it again and replace the old one — " +
        "this is what a pasted snippet does every time the profile changes."
    );
  }

  return {
    url,
    status: differences.length > 0 ? "stale" : "current",
    blocksFound: blocks.length,
    foreignBusinessNodes: foreign,
    differences,
    notes,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--tenant");
  const tenant = i !== -1 ? argv[i + 1] : process.env.TENANT_SLUG ?? "";

  const result = await verifyMarkup(tenant);

  const label: Record<MarkupStatus, string> = {
    missing: "NOT INSTALLED",
    foreign: "NOT OURS",
    stale: "OUT OF DATE",
    current: "LIVE AND CURRENT",
  };

  console.log(`\nMarkup verification`);
  console.log(`  url    : ${result.url}`);
  console.log(`  status : ${label[result.status]}`);
  console.log(`  blocks : ${result.blocksFound} ld+json block(s) on the page\n`);

  for (const node of result.foreignBusinessNodes) {
    console.log(`  other business node on the page: ${node}`);
  }
  if (result.foreignBusinessNodes.length > 0) console.log("");

  for (const diff of result.differences) {
    console.log(`  ${diff.field}`);
    console.log(`    portal : ${diff.ours}`);
    console.log(`    site   : ${diff.theirs}`);
  }
  if (result.differences.length > 0) console.log("");

  for (const note of result.notes) console.log(`  ! ${note}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nVerification failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
