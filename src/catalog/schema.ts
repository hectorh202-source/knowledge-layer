/**
 * ARD ai-catalog.json manifest shapes.
 *
 * WHAT IS CONFIRMED (read from agenticresourcediscovery.org/ai_catalog_spec/):
 *   - Four root elements: specVersion, host, entries, collections
 *   - host carries displayName and identifier (a domain or DID)
 *   - entries carry identifier, displayName, type, url, description
 *   - trustManifest is an optional per-entry object; the baseline manifest is
 *     unsigned, so no key management is needed (OPEN-QUESTIONS 1.2)
 *   - Identifiers use a domain-scoped URN convention
 *   - "application/mcp-server+json" is the media type for an MCP server
 *
 * WHAT IS NOT:
 *   - The media type for an OpenAPI document. The spec page documents only the
 *     MCP one and defers the full list to an external repository. Ours is a
 *     guess, isolated in MEDIA_TYPES below. (OPEN-QUESTIONS 1.3)
 *   - Whether specVersion should be "1.0" or "0.9". The spec page example shows
 *     "1.0"; our June notes recorded a v0.9 draft. The spec may have shipped
 *     1.0 in the interim, or the page may be ahead of the published schema.
 *
 * A malformed catalog is worse than no catalog, so every uncertain value is
 * overridable from the CLI rather than baked in.
 */

export interface CatalogHost {
  displayName: string;
  /** Domain or DID. Binds the catalog to a publisher. */
  identifier: string;
}

export interface CatalogEntry {
  /** Domain-scoped URN, e.g. urn:ai:titanzplumbing.com:api:knowledge */
  identifier: string;
  displayName: string;
  /** Media type. Entries are typed by media type, not a short type string. */
  type: string;
  url: string;
  description: string;
}

export interface CatalogManifest {
  specVersion: string;
  host: CatalogHost;
  entries: CatalogEntry[];
  /** Sub-catalogs and departmental feeds. Empty until there's a reason. */
  collections: unknown[];
}

/**
 * Media types, with provenance marked. Only the first is confirmed.
 */
export const MEDIA_TYPES = {
  /** Confirmed — appears verbatim in the spec's own example. */
  mcpServer: "application/mcp-server+json",
  /** UNCONFIRMED — plausible by convention, not documented. Override with --openapi-type. */
  openapi: "application/openapi+json",
  /** UNCONFIRMED — not documented anywhere we've read. Unused until A2A exists. */
  a2aAgent: "application/a2a-agent+json",
} as const;

/** Default spec version. See the note above about 1.0 vs 0.9. */
export const DEFAULT_SPEC_VERSION = "1.0";

/**
 * Builds a domain-scoped URN.
 *
 * The domain is embedded by construction, so a tenant's identifiers can't
 * collide with anyone else's — and the generator needs tenant domain as a
 * first-class input rather than a config afterthought.
 */
export function buildUrn(domain: string, kind: string, slug: string): string {
  return `urn:ai:${domain}:${kind}:${slug}`;
}
