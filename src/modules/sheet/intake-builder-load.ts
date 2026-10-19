import "server-only";
import type { IntakeBuilderData, IntakeTab } from "@/components/sheet/designer/intake-builder";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { FIELD_TYPES, builderPage, type TemplateRow } from "@/modules/sheet/intake-builder-present";
import type { SheetStaff } from "@/modules/sheet/load";

/**
 * The Designer's Intake form builder for a firm, read as the signed-in staff member (staff at
 * aal2 read drafts; RLS). Saving and publishing are decided by the database.
 */
export async function loadSheetIntakeBuilder(staff: SheetStaff, tab: IntakeTab, choice: { form?: string; field?: string }, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, templates, usage] = await Promise.all([
    loadSheetChrome(staff, "/sheet/intake-builder"),
    supabase
      .from("intake_templates")
      .select("id, stable_key, version_number, status, title, schema, updated_at, effective_on, version")
      .eq("organization_id", org)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.rpc("intake_template_usage", { p_organization_id: org }),
  ]);
  const rows: TemplateRow[] = (templates.data ?? []).map((row) => ({
    id: row.id,
    stableKey: row.stable_key,
    versionNumber: row.version_number,
    status: row.status,
    title: row.title,
    schema: row.schema,
    updatedAt: row.updated_at,
    effectiveOn: row.effective_on,
    version: row.version,
  }));
  const counts = new Map((usage.data ?? []).map((row) => [row.stable_key, row.matters]));
  const page = builderPage(rows, counts, choice, now);
  const data: IntakeBuilderData = {
    tab,
    title: page.title,
    pills: page.pills,
    publishLabel: page.publishLabel,
    section: page.section,
    palette: FIELD_TYPES.map((item) => ({ label: item.label, type: item.label })),
    rows: page.rows,
    settings: page.settings,
    vo: null,
    publishDisabled: page.publishDisabled,
    preview: page.preview,
    live: { organizationId: org, ...page.live },
  };
  return { chrome, data };
}
