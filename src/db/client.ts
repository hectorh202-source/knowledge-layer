import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for the loader.
 *
 * Uses the service role key, which bypasses row level security. That is correct
 * for a trusted server-side loader and wrong for anything user-facing — the
 * public API layer built later must use the anon key so RLS actually applies.
 *
 * Created lazily so that `--dry-run` works with no credentials configured.
 */

let cached: SupabaseClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env, or run with --dry-run to preview without a database.`
    );
  }
  return value;
}

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  return cached;
}

export function tenantSlug(): string {
  return process.env.TENANT_SLUG ?? "titanz";
}
