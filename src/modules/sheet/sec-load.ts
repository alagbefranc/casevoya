import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import type { FirmSubscription } from "@/modules/sheet/settings-billing-present";
import {
  cancelDialog,
  continuityBanner,
  continuityPanel,
  readContinuity,
  readDeletionOverview,
  retentionDeletionData,
  type CancelDialogData,
  type ContinuityBannerData,
  type ContinuityPanelData,
  type RetentionDeletionData,
} from "@/modules/sheet/sec-present";

type Client = Awaited<ReturnType<typeof createClient>>;

async function profileNames(supabase: Client, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  return new Map((data ?? []).filter((row) => row.display_name).map((row) => [row.id, row.display_name as string]));
}

/** SEC-07, firm owner only: eligible matters, deletion jobs and tombstones; null for anyone else or on a read error. */
export async function loadRetentionDeletion(staff: SheetStaff): Promise<RetentionDeletionData | null> {
  if (staff.role !== "firm_owner") return null;
  const supabase = await createClient({ organizationId: staff.organizationId });
  const { data, error } = await supabase.rpc("retention_deletion_overview", { p_organization_id: staff.organizationId });
  if (error) return null;
  const overview = readDeletionOverview(data);
  if (!overview) return null;
  const names = await profileNames(supabase, [...overview.jobs.map((job) => job.approvedBy), ...overview.tombstones.map((tomb) => tomb.approvedBy)]);
  return retentionDeletionData(overview, { organizationId: staff.organizationId, timeZone: staff.timezone, names });
}

/**
 * SEC-10 on Settings > Subscription: the After cancelling panel (owner and finance), the Cancel
 * subscription dialog's dates (owner, a live Stripe subscription not already ending) and the
 * firm's transfers for the After the window dialog (owner).
 */
export async function loadContinuity(staff: SheetStaff, detail: FirmSubscription | null): Promise<{ panel: ContinuityPanelData | null; cancel: CancelDialogData | null }> {
  if (!detail) return { panel: null, cancel: null };
  const isOwner = staff.role === "firm_owner";
  let transfers: { id: string; receivingFirm: string; status: string }[] = [];
  if (isOwner && detail.continuity && detail.continuity.phase !== "none" && detail.continuity.phase !== "archived") {
    const supabase = await createClient({ organizationId: staff.organizationId });
    const { data } = await supabase.rpc("firm_transfers_overview", { p_organization_id: staff.organizationId });
    transfers = (Array.isArray(data) ? data : [])
      .map((row) => row as Record<string, unknown>)
      .filter((row) => typeof row.id === "string" && typeof row.receiving_firm === "string")
      .map((row) => ({ id: row.id as string, receivingFirm: row.receiving_firm as string, status: typeof row.status === "string" ? row.status : "open" }));
  }
  const panel = continuityPanel(detail.continuity ?? null, { organizationId: staff.organizationId, timeZone: staff.timezone, isOwner, transfers });
  const sub = detail.subscription;
  const canCancel = isOwner && sub && sub.has_stripe_subscription && !sub.cancel_at && ["active", "past_due", "restricted"].includes(sub.status);
  return {
    panel,
    cancel: canCancel ? cancelDialog({ organizationId: staff.organizationId, periodEnd: sub.current_period_end, windowDays: detail.grace.export_window_days, timeZone: staff.timezone }) : null,
  };
}

/** The banner across the app (every staff member): ending, export window or archived; null otherwise or on a read error. */
export async function loadContinuityBanner(supabase: Client, staff: SheetStaff): Promise<ContinuityBannerData | null> {
  const { data, error } = await supabase.rpc("subscription_continuity", { p_organization_id: staff.organizationId });
  if (error) return null;
  return continuityBanner(readContinuity(data), staff.timezone, staff.role === "firm_owner" || staff.role === "finance_user");
}
