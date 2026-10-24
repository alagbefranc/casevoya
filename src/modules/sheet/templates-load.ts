import "server-only";
import type { TemplatesTab } from "@/components/sheet/designer/templates";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { EMAIL_TEMPLATES } from "@/modules/email/designs/catalog";
import { frenchApproved } from "@/modules/email/designs/french";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { designUse, messageRows, programRows, templatesData, type CatalogRow, type RuleRow } from "@/modules/sheet/templates-present";
import type { ChecklistItemInput, ChecklistsLiveData, ConditionOption } from "@/modules/sheet/checklist-present";
import { fieldLabel, schemaFields } from "@/modules/intake/present";

const READ = 200;

function tally(values: readonly (string | null)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/**
 * The Designer's Templates page, read as the signed-in staff member: program packs and rule
 * versions the firm may see (RLS), the firm's agreement templates, and the approved email
 * catalog. Read only.
 */
export async function loadSheetTemplates(staff: SheetStaff, tab: TemplatesTab, view: string | undefined, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, packs, pinnedMatters, agreementTemplates, agreements, versions, definitions, reviews, evidence, items, names] = await Promise.all([
    loadSheetChrome(staff, "/sheet/templates"),
    supabase.from("rule_pack_versions").select("id, program_key, jurisdiction, pack_version, status, organization_id, next_review_at").order("updated_at", { ascending: false }).limit(READ),
    supabase.from("matters").select("program_pack_id").eq("organization_id", org).not("program_pack_id", "is", null).limit(1000),
    supabase.from("agreement_templates").select("id, name, kind, status, approved_at, approved_by, version").eq("organization_id", org).order("updated_at", { ascending: false }).limit(READ),
    supabase.from("agreements").select("template_id, matter_id").eq("organization_id", org).not("template_id", "is", null).limit(1000),
    supabase.from("rule_versions").select("id, definition_id, version_number, status, effective_from, next_review_at, claim, applicability_note").order("updated_at", { ascending: false }).limit(READ),
    supabase.from("rule_definitions").select("id, stable_key, jurisdiction, program_key").limit(READ),
    supabase.from("professional_reviews").select("rule_version_id, reviewer_membership_id, decided_at").eq("organization_id", org).order("decided_at", { ascending: false }).limit(READ),
    supabase.from("rule_evidence").select("rule_version_id, snapshot_id, source_section").limit(READ),
    supabase.from("rule_pack_items").select("pack_id, rule_version_id").limit(1000),
    memberNames(supabase, org),
  ]);

  const snapshotIds = [...new Set((evidence.data ?? []).map((row) => row.snapshot_id))];
  const snapshots = snapshotIds.length ? await supabase.from("source_snapshots").select("id, source_id, publisher, final_url, retrieved_at").in("id", snapshotIds) : null;
  const sourceIds = [...new Set((snapshots?.data ?? []).map((row) => row.source_id))];
  const sources = sourceIds.length ? await supabase.from("official_sources").select("id, title").in("id", sourceIds) : null;

  const pinned = tally((pinnedMatters.data ?? []).map((row) => row.program_pack_id));
  // Distinct matters per agreement template (two agreements on one matter count once).
  const used = tally([...new Set((agreements.data ?? []).map((row) => `${row.template_id}|${row.matter_id}`))].map((key) => key.split("|")[0]));
  const definitionOf = new Map((definitions.data ?? []).map((row) => [row.id, row]));
  const reviewerOf = new Map<string, string>();
  for (const review of reviews.data ?? []) {
    if (!reviewerOf.has(review.rule_version_id)) reviewerOf.set(review.rule_version_id, names.get(review.reviewer_membership_id) ?? "Licensed reviewer");
  }
  const snapshotOf = new Map((snapshots?.data ?? []).map((row) => [row.id, row]));
  const titleOf = new Map((sources?.data ?? []).map((row) => [row.id, row.title]));
  const packMatters = new Map<string, number>();
  for (const item of items.data ?? []) packMatters.set(item.rule_version_id, (packMatters.get(item.rule_version_id) ?? 0) + (pinned.get(item.pack_id) ?? 0));

  const rules: RuleRow[] = (versions.data ?? []).flatMap((row) => {
    const definition = definitionOf.get(row.definition_id);
    if (!definition) return [];
    const cited = (evidence.data ?? []).filter((item) => item.rule_version_id === row.id);
    const captured = cited.map((item) => ({ item, snapshot: snapshotOf.get(item.snapshot_id) })).filter((pair) => pair.snapshot);
    const latest = [...captured].sort((a, b) => (b.snapshot?.retrieved_at ?? "").localeCompare(a.snapshot?.retrieved_at ?? ""))[0];
    return [
      {
        id: row.id,
        stableKey: definition.stable_key,
        versionNumber: row.version_number,
        jurisdiction: definition.jurisdiction,
        programKey: definition.program_key,
        status: row.status,
        effectiveFrom: row.effective_from,
        nextReviewAt: row.next_review_at,
        claim: row.claim,
        applicabilityNote: row.applicability_note,
        reviewer: reviewerOf.get(row.id) ?? null,
        lastChecked: latest?.snapshot?.retrieved_at ?? null,
        affected: packMatters.get(row.id) ?? 0,
        source: latest?.snapshot
          ? {
              publisher: latest.snapshot.publisher,
              url: latest.snapshot.final_url,
              title: titleOf.get(latest.snapshot.source_id) ?? null,
              retrievedAt: latest.snapshot.retrieved_at,
              section: latest.item.source_section,
            }
          : null,
      },
    ];
  });

  const catalog: CatalogRow[] = Object.values(EMAIL_TEMPLATES).map((template) => ({
    id: template.id,
    name: template.name,
    audience: template.audience,
    status: template.status,
    frenchApproved: frenchApproved(template.id),
  }));
  // What the firm actually sent, per design and language (RLS: staff who can read the matter).
  const deliveries = await supabase
    .from("email_deliveries")
    .select("template, context, status, updated_at")
    .eq("organization_id", org)
    .eq("status", "sent")
    .order("updated_at", { ascending: false })
    .limit(2000);
  const use = designUse(deliveries.data ?? []);
  const agreementRows = (agreementTemplates.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by ? (names.get(row.approved_by) ?? null) : null,
    version: row.version,
  }));
  const packRows = (packs.data ?? []).map((row) => ({
    id: row.id,
    programKey: row.program_key,
    jurisdiction: row.jurisdiction,
    packVersion: row.pack_version,
    status: row.status,
    firm: row.organization_id !== null,
    nextReviewAt: row.next_review_at,
  }));
  const selected = view && isUuid(view) ? (rules.find((rule) => rule.id === view) ?? null) : null;
  const data = templatesData({
    tab,
    program: programRows(packRows, pinned, agreementRows, used),
    messages: messageRows(catalog, use, staff.timezone),
    rules,
    packs: packRows.length,
    selected,
    today: isoDateInTimeZone(now, staff.timezone),
  });
  if (tab === "checklists") data.checklists.live = await loadChecklists(supabase, staff, names).catch(() => undefined);
  return { chrome, data };
}

const DRAFT_ROLES = ["firm_owner", "licensed_consultant", "case_manager"];

/**
 * DOC-01: the firm's checklist templates (RLS: staff of the firm) with their items, and the intake
 * questions with fixed answers an item can depend on (from the firm's published intake forms).
 */
async function loadChecklists(supabase: Awaited<ReturnType<typeof createClient>>, staff: SheetStaff, names: Map<string, string>): Promise<ChecklistsLiveData> {
  const org = staff.organizationId;
  const [templates, items, forms] = await Promise.all([
    supabase.from("checklist_templates").select("id, stable_key, title, version_number, status, version, approved_by_membership_id").eq("organization_id", org).order("stable_key").order("version_number", { ascending: false }).limit(READ),
    supabase.from("checklist_template_items").select("*").eq("organization_id", org).order("position").limit(2000),
    supabase.from("intake_templates").select("schema, status").eq("organization_id", org).eq("status", "published").limit(50),
  ]);
  const conditions = new Map<string, ConditionOption>();
  for (const form of forms.data ?? []) {
    for (const field of schemaFields(form.schema)) {
      if (field.type !== "choice" || !field.options?.length || conditions.has(field.key)) continue;
      conditions.set(field.key, { key: field.key, label: fieldLabel(field), answers: field.options });
    }
  }
  return {
    organizationId: org,
    edit: DRAFT_ROLES.includes(staff.role),
    approve: staff.role === "licensed_consultant",
    conditions: [...conditions.values()].sort((a, b) => a.label.localeCompare(b.label)),
    templates: (templates.data ?? []).map((row) => ({
      id: row.id,
      stableKey: row.stable_key,
      title: row.title,
      versionNumber: row.version_number,
      status: row.status,
      rowVersion: row.version,
      approvedBy: row.approved_by_membership_id ? (names.get(row.approved_by_membership_id) ?? null) : null,
      items: (items.data ?? [])
        .filter((item) => item.template_id === row.id)
        .map((item) => ({
          item_key: item.item_key,
          purpose: item.purpose,
          explanation: item.explanation,
          owner: item.owner === "staff" ? "staff" : "client",
          due_offset_days: item.due_offset_days,
          acceptable_formats: item.acceptable_formats as ChecklistItemInput["acceptable_formats"],
          review_criteria: item.review_criteria ?? "",
          records_expiry: item.records_expiry,
          party_role: item.party_role ?? "",
          condition_field: item.condition_field ?? "",
          condition_equals: item.condition_equals ?? "",
        })),
    })),
  };
}
