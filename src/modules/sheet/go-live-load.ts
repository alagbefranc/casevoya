import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { goLivePanel, readGoLiveStatus, type GoLivePanelData } from "@/modules/sheet/go-live-present";

/** Settings › Subscription's Go live panel, from public.firm_go_live_status(); null if it can't be read. */
export async function loadGoLivePanel(staff: SheetStaff): Promise<GoLivePanelData | null> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const { data, error } = await supabase.rpc("firm_go_live_status");
  const status = error ? null : readGoLiveStatus(data);
  return status ? goLivePanel(status, { firmName: staff.organizationName, timeZone: staff.timezone }) : null;
}
