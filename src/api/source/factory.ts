import { FileSource } from "./files";
import { SupabaseSource } from "./supabase";
import type { KnowledgeSource, SourceOptions } from "../types";

/**
 * Builds the knowledge source.
 *
 * Shared by the API and the JSON-LD generator so both read the same data
 * through the same gates. If the generator had its own reader, published
 * markup could drift from what the API serves — and the whole point is that
 * every surface states the same facts.
 */
export type SourceKind = "supabase" | "files" | "auto";

export function createSource(kind: SourceKind, options: SourceOptions): KnowledgeSource {
  if (kind === "files") return new FileSource(options);
  if (kind === "supabase") return new SupabaseSource(options);

  // Auto: prefer the real database, fall back to local files so the tooling is
  // always runnable.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return new SupabaseSource(options);
  }
  return new FileSource(options);
}
