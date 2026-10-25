import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  readScheduleOverview,
  scheduleDialog,
  scheduledLive,
  scheduledRows,
  scheduledUnavailable,
  type ScheduleDialogData,
  type ScheduledDesignerRow,
  type ScheduledLive,
} from "@/modules/sheet/scheduled-reports-present";

/**
 * Reports > Scheduled (REP-03): the schedules of the tabs the signed-in staff member can see, read
 * through public.scheduled_reports_overview (the database decides). When it can't be read, the tab
 * says so instead of showing an empty list as if nothing were scheduled.
 */
export async function loadScheduledReports(
  staff: SheetStaff,
): Promise<{ rows: ScheduledDesignerRow[]; live: ScheduledLive; dialog: ScheduleDialogData | null }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const { data, error } = await supabase.rpc("scheduled_reports_overview", { p_organization_id: staff.organizationId });
  if (error) return { rows: [], live: scheduledUnavailable(staff.organizationId), dialog: null };
  const overview = readScheduleOverview(data);
  return {
    rows: scheduledRows(overview),
    live: scheduledLive(staff.organizationId, overview),
    dialog: overview.tabs.length ? scheduleDialog(staff.organizationId, overview) : null,
  };
}
