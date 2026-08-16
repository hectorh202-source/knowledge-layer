# Setup

## Requirements

- **Node 18 or newer.** `fetch` is used without a polyfill.
- **Git Bash or PowerShell** on Windows. Both work; the examples below are shell-agnostic.
- No database is required to start. The app runs entirely from files until you
  choose to add Supabase.

## Install

```bash
npm install
```

```bash
cp .env.example .env
```

Then start the portal:

```bash
npm run portal
```

It serves on <http://localhost:3100> and binds to `127.0.0.1` only. There is no
authentication yet, which is exactly why it stays off the network — do not
expose the port.

## Environment

`.env` is gitignored. `.env.example` is committed and must never contain a real
key.

| Variable | Needed for | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Google Places intake | Your key, not the customer's. See below. |
| `SUPABASE_URL` | Publishing to a database | Optional. Files work without it. |
| `SUPABASE_ANON_KEY` | The public API | **Must be the anon key.** See the warning below. |
| `SUPABASE_SERVICE_ROLE_KEY` | The content loader | Server-side only. Never send to a browser. |
| `PLATFORM_ADMIN_EMAILS` | Creating agencies | Comma separated. Empty means no platform tier. |
| `TENANT_SLUG` | CLI default | Convenience only; `--tenant` overrides it. |
| `CATALOG_DOMAIN` | Catalog generation | Tier 3. |
| `API_BASE_URL` | OpenAPI `servers` block | Tier 3. A spec advertising localhost is worse than none. |

> **The anon key is a security boundary, not a preference.** The public API uses
> it so row-level security applies. A service-role key there would silently
> expose unpublished drafts and every other tenant's data. The code refuses to
> start if the two are set to the same value.

## Authentication

The portal uses Supabase Auth. With `SUPABASE_URL` and `SUPABASE_ANON_KEY` set,
every route except `/login` and `/health` requires a session.

**Create your account in the Supabase dashboard** — Authentication → Users → Add
user. There is deliberately no signup route in the app: an admin portal that
lets strangers enrol is not an admin portal.

**Then turn signups off** — Authentication → Sign In / Providers → *Allow new
users to sign up*. Leave the email provider itself enabled; that is what lets
you log in.

**Confirm the user.** With "Confirm email" on, an unconfirmed account is refused
at login regardless of password. The dashboard's Add user dialog has an
auto-confirm option; use it, or the first login fails with no obvious cause.

### How the session works

The access and refresh tokens live in an **httpOnly cookie**, not localStorage.
The portal is one inline script, and a token JavaScript can read is a token any
injected script can take.

Validation **calls Supabase** rather than verifying the JWT locally, so a
revoked session actually stops working — local verification cannot see
revocation, and a departed employee's token would keep working until it expired.
Validated tokens are cached for 60 seconds, so a page load is not a burst of
auth calls but revocation still takes effect quickly.

Expired access tokens refresh transparently, so a session does not end mid-task
every hour.

### Running it somewhere other than localhost

```bash
npm run portal -- --host 0.0.0.0
```

This is **refused unless Supabase is configured**. The portal edits every
client's data and shells out to the intake tools, so exposing it is a deliberate
act. Put TLS in front of it — the session cookie only gets its `Secure` flag
when the request arrives over HTTPS.

## Google Cloud setup

This is the fiddliest part, and the errors are unhelpful. In order:

**1. Enable Places API (New).** In *APIs & Services → Library*, search for
"Places API (New)". It is a **separate entry** from the legacy "Places API", and
enabling one does not enable the other.

**2. Enable billing.** Places refuses requests without a billing account even
inside the free tier.

**3. Restrict the key, then check the restriction.** Under *Credentials → your
key → API restrictions*, either leave it unrestricted or add **Places API
(New)** explicitly.

### Reading the errors

| Message | Means |
|---|---|
| `Requests to this API ... are blocked` | Key restriction excludes Places API (New). The request reached Google and was refused before execution — the endpoint path is fine. |
| `You're calling a legacy API, which is not enabled` | You hit a `maps.googleapis.com` endpoint without legacy Places enabled. |
| `REQUEST_DENIED` | Usually billing, sometimes restriction. |
| `{}` with HTTP 200 | Not an error. Google found nothing — see [google.md](google.md), because this is expected for most home-services businesses. |

Key changes take a few minutes to propagate. If a restriction looks right and
still fails, wait five minutes before changing anything else.

## Verifying the install

```bash
npm run typecheck
```

Then open the portal and check **System → Status**, which reports whether each
key is set.

To confirm the Google key works end to end, add a client with a known place ID
and run **Sources → Google Places**. See [google.md](google.md) for how to find
a place ID, because searching by name will not do it.

## What is not required

**Supabase.** The file source serves everything. Add a database when you have
enough clients that files are inconvenient, not before.

**Cloudflare.** Only needed for the edge-injection delivery route and for
fixing host-level crawler blocking. It requires a nameserver change, which moves
email with it — see [gotchas.md](gotchas.md#dns-changes-move-email-too).

**A public API deployment.** Tier 3. The markup route works without it.
