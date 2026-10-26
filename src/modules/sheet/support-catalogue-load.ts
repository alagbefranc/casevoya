import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { loadSheetTemplates } from "@/modules/sheet/templates-load";
import { supportCatalogue, type SupportCatalogueData, type SupportCatalogueJson } from "@/modules/sheet/support-catalogue-present";

/** SRC-12: Practice > Templates > What Casevoya supports, as this firm's staff see it. */
export async function loadSheetSupportCatalogue(staff: SheetStaff) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const [templates, catalogue] = await Promise.all([
    loadSheetTemplates(staff, "program", undefined),
    supabase.rpc("support_catalogue", { p_org: staff.organizationId }),
  ]);
  const json = catalogue.error || !catalogue.data || typeof catalogue.data !== "object" ? null : (catalogue.data as SupportCatalogueJson);
  const page: SupportCatalogueData = supportCatalogue(json, { timeZone: staff.timezone, staff: true });
  return { chrome: templates.chrome, header: templates.data, page: json ? page : { ...page, unavailable: true } };
}
