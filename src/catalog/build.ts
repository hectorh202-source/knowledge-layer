import {
  buildUrn,
  DEFAULT_SPEC_VERSION,
  MEDIA_TYPES,
  type CatalogEntry,
  type CatalogManifest,
} from "./schema";
import { probeDataEndpoint, probeOpenApi, type ProbeResult } from "./verify";

/**
 * Builds the ai-catalog.json manifest.
 *
 * The manifest is small. What matters is what gets left out of it — see the
 * exclusion reporting below. "Publish it pointing at things that exist, even if
 * that's just an OpenAPI doc over your data. A catalog advertising an A2A agent
 * you haven't built is worse than a small honest one."
 */

export interface BuildOptions {
  domain: string;
  displayName: string;
  apiBaseUrl: string;
  specVersion: string;
  openapiMediaType: string;
  /** Emit entries even when their endpoints fail verification. */
  allowUnverified: boolean;
}

export interface ExcludedEntry {
  what: string;
  reason: string;
}

export interface BuildResult {
  manifest: CatalogManifest;
  excluded: ExcludedEntry[];
  probes: ProbeResult[];
  warnings: string[];
}

/** The capabilities the API can expose, and how to describe each one. */
const CAPABILITIES = [
  { path: "/v1/services", label: "services offered" },
  { path: "/v1/service-areas", label: "service areas with postal codes" },
  { path: "/v1/pricing", label: "reviewed price ranges" },
  { path: "/v1/faqs", label: "answers to common customer questions" },
];

export async function buildCatalog(options: BuildOptions): Promise<BuildResult> {
  const base = options.apiBaseUrl.replace(/\/+$/, "");
  const entries: CatalogEntry[] = [];
  const excluded: ExcludedEntry[] = [];
  const warnings: string[] = [];
  const probes: ProbeResult[] = [];

  // --- probe each capability so the description reflects reality -----------
  const populated: string[] = [];

  for (const capability of CAPABILITIES) {
    const probe = await probeDataEndpoint(`${base}${capability.path}`);
    probes.push(probe);

    if (!probe.ok) {
      excluded.push({
        what: capability.path,
        reason: probe.error ?? "unreachable",
      });
      continue;
    }

    // A 200 with an empty array is the dangerous case: the endpoint works, so
    // nothing errors, but the promise in the description is hollow.
    if (probe.count === 0) {
      excluded.push({
        what: capability.path,
        reason: "reachable but returns no items — not advertised",
      });
      continue;
    }

    populated.push(capability.label);
  }

  // --- the API entry -------------------------------------------------------
  const openapiUrl = `${base}/openapi.json`;
  const openapiProbe = await probeOpenApi(openapiUrl);
  probes.push(openapiProbe);

  const canPublishApi = openapiProbe.ok && populated.length > 0;

  if (canPublishApi || options.allowUnverified) {
    if (!canPublishApi) {
      warnings.push(
        "API entry included despite failing verification, because --allow-unverified was set."
      );
    }

    entries.push({
      identifier: buildUrn(options.domain, "api", "knowledge"),
      displayName: `${options.displayName} Knowledge API`,
      type: options.openapiMediaType,
      url: openapiUrl,
      description:
        populated.length > 0
          ? `Structured facts about ${options.displayName}: ${formatList(populated)}. Read-only.`
          : `Structured facts about ${options.displayName}. Read-only.`,
    });
  } else if (!openapiProbe.ok) {
    excluded.push({
      what: "API entry",
      reason: `OpenAPI document not usable — ${openapiProbe.error}`,
    });
  } else {
    excluded.push({
      what: "API entry",
      reason:
        "every capability is empty, so the entry would promise data that isn't there",
    });
  }

  // --- surfaces that don't exist yet ---------------------------------------
  // Listed explicitly so their absence is a recorded decision rather than an
  // oversight someone rediscovers in three months.
  excluded.push({
    what: `MCP server (${MEDIA_TYPES.mcpServer})`,
    reason: "not built — Layer 3, deferred until the API is deployed",
  });
  excluded.push({
    what: "A2A agent",
    reason:
      "not built — near-zero registry adoption, deferred until something is actually querying",
  });

  // --- uncertainty the operator has to know about --------------------------
  if (options.openapiMediaType === MEDIA_TYPES.openapi) {
    warnings.push(
      `Media type "${MEDIA_TYPES.openapi}" is unverified — the spec documents only the MCP ` +
        `type. A wrong media type may make the manifest invalid. See OPEN-QUESTIONS 1.3.`
    );
  }

  if (options.specVersion === DEFAULT_SPEC_VERSION) {
    warnings.push(
      `specVersion "${DEFAULT_SPEC_VERSION}" comes from the spec page's example. Our June notes ` +
        `recorded a v0.9 draft. Confirm before publishing. Override with --spec-version.`
    );
  }

  const manifest: CatalogManifest = {
    specVersion: options.specVersion,
    host: {
      displayName: options.displayName,
      identifier: options.domain,
    },
    entries,
    // Nested catalogs. Nothing to point at while there's one tenant and one API.
    collections: [],
  };

  return { manifest, excluded, probes, warnings };
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
