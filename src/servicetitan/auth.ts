import axios from "axios";

/**
 * COPIED VERBATIM from the st-voice-booking-backend repo (C:\Users\Computer\Titanz).
 *
 * This duplication is deliberate — see OPEN-QUESTIONS.md 9.4. The voice agent is
 * live and answering real calls, so it does not get refactored to share code with
 * a project that has not proven its shape yet. Extract to a shared package only
 * once both sides are stable.
 *
 * Do not "improve" this file. If it changes here, check whether the voice agent
 * copy needs the same change (and vice versa) — silent drift is the known risk.
 *
 * Credentials come from a SEPARATE ServiceTitan app registration. See 10.1.
 *
 * ---
 *
 * ServiceTitan OAuth2 client-credentials auth.
 * Tokens are machine-to-machine (no end user, no refresh token) and expire
 * in ~900s. We cache in memory and re-fetch shortly before expiry.
 */

const ST_ENV = requireEnv("ST_ENV"); // "integration" | "production"

if (ST_ENV !== "integration" && ST_ENV !== "production") {
  throw new Error(`ST_ENV must be "integration" or "production", got "${ST_ENV}"`);
}

const AUTH_BASE_URL =
  ST_ENV === "production"
    ? "https://auth.servicetitan.io"
    : "https://auth-integration.servicetitan.io";

export const API_BASE_URL =
  ST_ENV === "production"
    ? "https://api.servicetitan.io"
    : "https://api-integration.servicetitan.io";

const TOKEN_SAFETY_BUFFER_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;
// Prevents duplicate concurrent token requests when multiple calls race in.
let pendingTokenRequest: Promise<string> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function fetchNewToken(): Promise<string> {
  const clientId = requireEnv("ST_CLIENT_ID");
  const clientSecret = requireEnv("ST_CLIENT_SECRET");

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post(`${AUTH_BASE_URL}/connect/token`, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const { access_token, expires_in } = response.data as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    accessToken: access_token,
    expiresAtMs: Date.now() + expires_in * 1000,
  };

  return access_token;
}

/**
 * Returns a valid access token, using the in-memory cache when possible.
 * Concurrent callers during a cache miss share one in-flight token request.
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    cachedToken &&
    cachedToken.expiresAtMs - TOKEN_SAFETY_BUFFER_MS > Date.now()
  ) {
    return cachedToken.accessToken;
  }

  if (!pendingTokenRequest) {
    pendingTokenRequest = fetchNewToken().finally(() => {
      pendingTokenRequest = null;
    });
  }

  return pendingTokenRequest;
}

export class ServiceTitanApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ServiceTitanApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Shared request helper for all ServiceTitan resource modules.
 * `basePath` lets each module target its own namespace, e.g.
 * "/crm/v2/tenant/{tenantId}" or "/jpm/v2/tenant/{tenantId}".
 */
export async function stRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  basePath: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | undefined> } = {}
): Promise<T> {
  const appKey = requireEnv("ST_APP_KEY");
  const url = `${API_BASE_URL}${basePath}${path}`;

  const doRequest = async (forceRefresh: boolean) => {
    const token = await getAccessToken(forceRefresh);
    return axios.request({
      method,
      url,
      params: options.query,
      data: options.body,
      headers: {
        Authorization: `Bearer ${token}`,
        "ST-App-Key": appKey,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    });
  };

  let response = await doRequest(false);

  // Retry once on 401 in case the cached token was invalidated server-side.
  if (response.status === 401) {
    response = await doRequest(true);
  }

  if (response.status >= 400) {
    const message =
      typeof response.data === "object" && response.data && "message" in (response.data as any)
        ? (response.data as any).message
        : `ServiceTitan API request failed with status ${response.status}`;
    throw new ServiceTitanApiError(response.status, response.data, message);
  }

  return response.data as T;
}

export function getTenantId(): string {
  return requireEnv("ST_TENANT_ID");
}
