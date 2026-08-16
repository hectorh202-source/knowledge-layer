import type { NextFunction, Request, Response } from "express";

/**
 * Authentication for the admin portal, backed by Supabase Auth.
 *
 * This is what lets the portal leave a laptop. Until now it bound to 127.0.0.1
 * and refused to start with NODE_ENV=production, because anyone who could reach
 * it could edit every client's data.
 *
 * WHY THE TOKEN LIVES IN AN httpOnly COOKIE, not localStorage:
 * the portal is one inline script, and a token readable by JavaScript is a
 * token any injected script can take. The browser sends the cookie; nothing in
 * the page can read it.
 *
 * WHY VALIDATION CALLS SUPABASE rather than verifying the JWT locally:
 * local verification cannot see a revoked session, so a sacked employee's token
 * keeps working until it expires. One HTTP call per request is the wrong price
 * to pay for that, so validated tokens are cached briefly — long enough to make
 * a page load cheap, short enough that revocation takes effect while someone is
 * still walking to the door.
 *
 * There is deliberately no signup route. Accounts are created in the Supabase
 * dashboard, and public signups should be turned off there. An admin portal
 * that lets strangers enrol is not an admin portal.
 */

const COOKIE = "kl_session";

/** How long a validated token is trusted without re-asking Supabase. */
const CACHE_MS = 60_000;

export interface SessionUser {
  id: string;
  email: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const validated = new Map<string, { user: SessionUser; checked: number }>();

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

/** Whether auth can run at all. Without Supabase configured, it cannot. */
export function authConfigured(): boolean {
  return config() !== null;
}

// --- cookies ---------------------------------------------------------------
// Parsed by hand rather than adding a dependency for six lines.

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function setSessionCookie(req: Request, res: Response, tokens: Tokens): void {
  const value = encodeURIComponent(JSON.stringify(tokens));
  // Secure only over HTTPS: setting it unconditionally would silently break
  // the localhost workflow, and a cookie the browser refuses to send looks
  // exactly like a broken login.
  const secure = req.protocol === "https" ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7};${secure}`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readTokens(req: Request): Tokens | null {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Tokens;
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

// --- Supabase Auth ---------------------------------------------------------

/** Exchanges email and password for tokens. Null when the credentials fail. */
export async function signIn(email: string, password: string): Promise<Tokens | null> {
  const cfg = config();
  if (!cfg) return null;

  const response = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!body.access_token || !body.refresh_token) return null;

  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function fetchUser(accessToken: string): Promise<SessionUser | null> {
  const cfg = config();
  if (!cfg) return null;

  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { id?: string; email?: string };
  return body.id ? { id: body.id, email: body.email ?? "" } : null;
}

async function refresh(refreshToken: string): Promise<Tokens | null> {
  const cfg = config();
  if (!cfg) return null;

  const response = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: cfg.key, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!body.access_token || !body.refresh_token) return null;

  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function signOut(req: Request): Promise<void> {
  const cfg = config();
  const tokens = readTokens(req);
  if (!cfg || !tokens) return;

  validated.delete(tokens.accessToken);

  // Best effort. A failure here still logs the browser out, because the cookie
  // is cleared regardless — but without it the refresh token stays usable.
  try {
    await fetch(`${cfg.url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: cfg.key, Authorization: `Bearer ${tokens.accessToken}` },
    });
  } catch {
    /* ignore */
  }
}

// --- middleware ------------------------------------------------------------

/**
 * Resolves the session, refreshing an expired access token in place.
 *
 * Returns null when there is no valid session, having already cleared a cookie
 * that can no longer be used.
 */
async function resolve(req: Request, res: Response): Promise<SessionUser | null> {
  const tokens = readTokens(req);
  if (!tokens) return null;

  const cached = validated.get(tokens.accessToken);
  if (cached && Date.now() - cached.checked < CACHE_MS) return cached.user;

  const user = await fetchUser(tokens.accessToken);
  if (user) {
    validated.set(tokens.accessToken, { user, checked: Date.now() });
    return user;
  }

  // Expired or revoked. Try the refresh token before giving up, so a session
  // does not end mid-task every hour.
  const renewed = await refresh(tokens.refreshToken);
  if (!renewed) {
    validated.delete(tokens.accessToken);
    clearSessionCookie(res);
    return null;
  }

  const renewedUser = await fetchUser(renewed.accessToken);
  if (!renewedUser) {
    clearSessionCookie(res);
    return null;
  }

  setSessionCookie(req, res, renewed);
  validated.set(renewed.accessToken, { user: renewedUser, checked: Date.now() });
  return renewedUser;
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

/**
 * Gate for everything the portal serves.
 *
 * An API request gets 401 and a page request gets redirected, because a browser
 * following a redirect to a JSON endpoint produces a login page rendered inside
 * a fetch handler — confusing to debug and useless to the caller.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  void (async () => {
    const user = await resolve(req, res);
    if (user) {
      req.user = user;
      next();
      return;
    }

    if (req.path.startsWith("/admin/api")) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    res.redirect("/login");
  })();
}

export { setSessionCookie, clearSessionCookie, readTokens };
