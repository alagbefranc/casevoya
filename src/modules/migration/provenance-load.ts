import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { readProvenance, type Provenance } from "./provenance";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Which of these records an import of this firm brought in (MIG-02), for any staff member: the
 * source system, the import date and the original date. A failed read shows nothing as imported
 * rather than guessing.
 */
export async function loadImportProvenance(supabase: Client, organizationId: string, table: string, ids: readonly (string | null | undefined)[]): Promise<Map<string, Provenance>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].slice(0, 500);
  if (!unique.length) return new Map();
  try {
    const result = await supabase.rpc("imported_record_provenance", { p_org: organizationId, p_table: table, p_ids: unique });
    if (result.error) return new Map();
    return readProvenance(result.data);
  } catch {
    return new Map();
  }
}
