import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { createSource, type SourceKind } from "../api/source/factory";
import { buildJsonLd, toScriptTag } from "./build";
import type { IntakeResult } from "../intake/types";

/**
 * Generates schema.org JSON-LD for a business.
 *
 *   npm run jsonld -- --tenant acme --domain acme.com --type Plumber
 *   npm run jsonld -- --tenant acme --domain acme.com --print
 *
 * Writes both the raw graph and a paste-ready <script> block to data/jsonld/.
 */

const CONTENT_DIR = path.resolve(process.cwd(), "content");

/**
 * Checks whether the site already publishes business markup.
 *
 * This matters: intake read TitanZ's NAP out of their existing Plumber JSON-LD,
 * so pasting ours in alongside would leave two independent business
 * definitions on one page and a crawler guessing which is authoritative. The
 * correct move there is replacement, not addition — and that's a decision a
 * person has to make, so say it rather than assume it.
 */
function detectExistingMarkup(domain: string): string[] {
  const websiteFile = path.join(CONTENT_DIR, "intake", domain, "website.json");
  if (!fs.existsSync(websiteFile)) return [];

  const intake = JSON.parse(fs.readFileSync(websiteFile, "utf8")) as IntakeResult;
  const methods = new Set<string>();

  for (const candidate of intake.entity.name) {
    if (candidate.provenance.method.startsWith("JSON-LD")) {
      methods.add(candidate.provenance.method.replace(/ name$/, ""));
    }
  }

  return [...methods];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const domain = get("--domain") ?? process.env.CATALOG_DOMAIN;
  if (!domain) throw new Error("--domain is required, e.g. --domain acme.com");

  // No default client. Generating markup for whoever happened to be hardcoded,
  // under a domain given on the command line, would state one business's facts
  // about another.
  const tenant = get("--tenant") ?? process.env.TENANT_SLUG?.trim();
  if (!tenant) throw new Error("No client. Pass --tenant <slug>, or set TENANT_SLUG.");

  const schemaType = get("--type") ?? "LocalBusiness";
  const sourceKind = (get("--source") ?? "auto") as SourceKind;

  const source = createSource(sourceKind, {
    tenant,
    includeUnreviewed: argv.includes("--include-unreviewed"),
  });

  console.log(`\nschema.org JSON-LD`);
  console.log(`  domain : ${domain}`);
  console.log(`  type   : ${schemaType}`);
  console.log(`  source : ${source.kind}\n`);

  const result = await buildJsonLd(source, { domain, schemaType });

  if (result.included.length > 0) {
    console.log(`  Included:`);
    for (const item of result.included) console.log(`    - ${item}`);
    console.log("");
  }

  for (const warning of result.warnings) console.log(`  ! ${warning}\n`);

  const existing = detectExistingMarkup(domain);
  if (existing.length > 0) {
    console.log(`  ! This site already publishes ${existing.join(", ")} markup.`);
    console.log(`    Two independent business definitions on one page make a crawler guess`);
    console.log(`    which is authoritative. REPLACE the existing block rather than adding`);
    console.log(`    this alongside it — or keep theirs and publish only the FAQPage node.\n`);
  }

  const json = JSON.stringify(result.graph, null, 2);

  if (argv.includes("--print")) {
    console.log(json + "\n");
  }

  const outDir = path.resolve(process.cwd(), "data", "jsonld");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonFile = path.join(outDir, `${domain}.jsonld`);
  const htmlFile = path.join(outDir, `${domain}.html`);
  fs.writeFileSync(jsonFile, json + "\n", "utf8");
  fs.writeFileSync(htmlFile, toScriptTag(result.graph), "utf8");

  const nodes = Array.isArray(result.graph["@graph"]) ? result.graph["@graph"].length : 0;
  console.log(`  ${nodes} node(s) written:`);
  console.log(`    ${jsonFile}`);
  console.log(`    ${htmlFile}   (paste into the page head)`);
  console.log("");
  console.log(`  Validate before publishing: search.google.com/test/rich-results\n`);
}

main().catch((error) => {
  console.error(`\nJSON-LD generation failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
