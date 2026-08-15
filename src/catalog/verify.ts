/**
 * Endpoint verification.
 *
 * The rule this file enforces: never advertise something that isn't there.
 *
 * A catalog is a signpost. If an agent follows an entry and hits nothing — or
 * hits an endpoint that returns an empty array where the description promised
 * pricing — that's worse than having published no catalog at all. It burns the
 * one impression you get, and it does it silently, because no human is watching
 * when a crawler reads the file.
 *
 * So the generator probes every URL before it will include it, and checks that
 * the capability actually has content behind it, not just a 200.
 */

export interface ProbeResult {
  url: string;
  ok: boolean;
  status: number | null;
  /** Item count for a data endpoint, when it could be determined. */
  count: number | null;
  error: string | null;
}

const TIMEOUT_MS = 8_000;

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON body. Status still tells us whether it's reachable.
    }

    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Probes a data endpoint and reports how many items it actually returns. */
export async function probeDataEndpoint(url: string): Promise<ProbeResult> {
  try {
    const { status, body } = await fetchJson(url);

    if (status < 200 || status >= 300) {
      return { url, ok: false, status, count: null, error: `HTTP ${status}` };
    }

    let count: number | null = null;
    if (body && typeof body === "object") {
      const data = (body as Record<string, unknown>).data;
      if (Array.isArray(data)) count = data.length;
      else if (data && typeof data === "object") count = 1;
      // An explicit null is an empty single-object endpoint. Leaving count at
      // null would read as "couldn't tell" and let the entry through.
      else if (data === null) count = 0;
    }

    return { url, ok: true, status, count, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { url, ok: false, status: null, count: null, error: message };
  }
}

/** Probes an OpenAPI document — reachable, parses, and describes real paths. */
export async function probeOpenApi(url: string): Promise<ProbeResult> {
  try {
    const { status, body } = await fetchJson(url);

    if (status < 200 || status >= 300) {
      return { url, ok: false, status, count: null, error: `HTTP ${status}` };
    }

    const paths =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).paths
        : undefined;

    if (!paths || typeof paths !== "object") {
      return {
        url,
        ok: false,
        status,
        count: null,
        error: "Response has no `paths` object — not a usable OpenAPI document",
      };
    }

    return { url, ok: true, status, count: Object.keys(paths).length, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { url, ok: false, status: null, count: null, error: message };
  }
}
