import { listTenantSlugs, readSettings } from "../tenancy/store";

/**
 * Which client a request is for.
 *
 * One deployment serves every client, and the request's hostname is what says
 * which. A client's own domain CNAMEs here:
 *
 *   api.acme.com  CNAME  <the deployment>
 *
 * That is not merely convenient. Data served from the client's own domain is a
 * stronger entity signal to an answer engine than the same data served from
 * ours — it is the business corroborating itself rather than a third party
 * vouching for it.
 *
 * The alternative, one deployment per client, was what this replaced: a
 * separate deploy, separate secrets and separate bill for every customer, and
 * a security fix that has to be rolled out N times.
 */

/** How long a hostname mapping is trusted before it is rebuilt. */
const TTL_MS = 60_000;

interface Cached {
  map: Map<string, string>;
  builtAt: number;
}

let cache: Cached | null = null;
let building: Promise<Map<string, string>> | null = null;

/** Lowercased, port stripped. "API.Acme.com:443" and "api.acme.com" are one host. */
export function normalizeHost(host: string | undefined): string {
  if (!host) return "";
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

function hostOf(url: string): string {
  try {
    return normalizeHost(new URL(url).host);
  } catch {
    // Bare hostnames are common in that field — it is typed by a person.
    return normalizeHost(url.replace(/^.*:\/\//, "").replace(/\/.*$/, ""));
  }
}

/**
 * Every hostname that resolves to a client.
 *
 * Two ways in, both derived from configuration the operator already fills in:
 * whatever `apiBaseUrl` points at, and `api.<domain>` as the convention. A
 * client's bare domain is deliberately not registered — that is their website,
 * and it does not point here.
 */
async function build(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const slug of await listTenantSlugs()) {
    const settings = await readSettings(slug);
    if (!settings) continue;

    const hosts: string[] = [];
    if (settings.apiBaseUrl) hosts.push(hostOf(settings.apiBaseUrl));
    if (settings.domain) hosts.push(`api.${normalizeHost(settings.domain)}`);

    for (const host of hosts) {
      if (!host) continue;
      // First registration wins, and a collision is logged rather than
      // silently resolved. Two clients claiming one hostname means one of them
      // is about to have their data served under the other's name, which is
      // the worst failure this system has.
      const existing = map.get(host);
      if (existing && existing !== slug) {
        console.error(`  ! ${host} is claimed by both "${existing}" and "${slug}" — kept "${existing}"`);
        continue;
      }
      map.set(host, slug);
    }
  }

  return map;
}

async function currentMap(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache.map;

  // Collapse concurrent rebuilds. A cold cache under crawler traffic would
  // otherwise fan one expiry out into a read per in-flight request.
  if (!building) {
    building = build()
      .then((map) => {
        cache = { map, builtAt: Date.now() };
        return map;
      })
      .finally(() => {
        building = null;
      });
  }

  return building;
}

/**
 * The client this hostname belongs to, or null.
 *
 * Null is deliberately not "fall back to a default client". An unrecognised
 * host serving some arbitrary business's data is worse than an error: the
 * caller has no way to tell they got the wrong company.
 */
export async function resolveTenant(host: string | undefined): Promise<string | null> {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  return (await currentMap()).get(normalized) ?? null;
}

/** Every hostname currently mapped, for the boot banner and diagnostics. */
export async function knownHosts(): Promise<{ host: string; slug: string }[]> {
  return [...(await currentMap()).entries()]
    .map(([host, slug]) => ({ host, slug }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** Testing, and after a client is created or deleted. */
export function forgetHosts(): void {
  cache = null;
}
