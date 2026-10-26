import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { VendorTermsAckRow } from "@/modules/sheet/vo-vendor-terms-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The firm's AI vendor terms acknowledgements (newest first), with who acknowledged, read through RLS. */
export async function loadVendorTermsAcks(supabase: Client, org: string): Promise<VendorTermsAckRow[]> {
  const { data } = await supabase
    .from("vo_vendor_terms_acknowledgements")
    .select("terms_version, acknowledged_by, acknowledged_at")
    .eq("organization_id", org)
    .order("acknowledged_at", { ascending: false })
    .limit(10);
  const rows = data ?? [];
  const users = [...new Set(rows.map((row) => row.acknowledged_by))];
  const profiles = users.length ? await supabase.from("profiles").select("id, display_name").in("id", users) : null;
  const name = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  return rows.map((row) => ({ version: row.terms_version, at: row.acknowledged_at, by: name.get(row.acknowledged_by) || "The firm owner" }));
}
