import "server-only";
import { createClient } from "@/lib/supabase/server";
import { clientRecordView, type ClientRecordView } from "@/modules/government/status-provenance";
import type { PortalViewer } from "@/modules/portal/load";

/**
 * GOV-05: the government statuses the firm shared on the client's matter, newest first, as
 * "Recorded by <firm> on <date>" (the same words the staff preview showed). Row-level security
 * shows a client only shared letters on their own matters. None when unreadable.
 */
export async function loadPortalGovernment(viewer: PortalViewer, matterId: string | null): Promise<ClientRecordView[]> {
  if (!matterId) return [];
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data, error } = await supabase
      .from("government_correspondence")
      .select("kind, received_on, action_requested, created_at")
      .eq("organization_id", viewer.organizationId)
      .eq("matter_id", matterId)
      .not("shared_with_client_at", "is", null)
      .order("received_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return [];
    return (data ?? []).map((row) => clientRecordView(row, viewer.organizationName, viewer.timezone));
  } catch {
    return [];
  }
}
