import "server-only";
import { SUPPORT_SHEET_HREF } from "@/modules/sheet/support-catalogue-present";
import type { TemplatesTab } from "@/components/sheet/designer/templates";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { EMAIL_TEMPLATES } from "@/modules/email/designs/catalog";
import { frenchApproved } from "@/modules/email/designs/french";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import type { MessageTemplateDialogData } from "@/components/sheet/designer/templates";
import { designUse, firmMessageRows, messageRows, programRows, templatesData, type CatalogRow, type RuleRow } from "@/modules/sheet/templates-present";
import type { ChecklistItemInput, ChecklistsLiveData, ConditionOption } from "@/modules/sheet/checklist-present";
import { fieldLabel, schemaFields } from "@/modules/intake/present";
import { claimAddData, claimFactsFor } from "@/modules/sheet/source-claims-load";
import { partialAlert } from "@/modules/sheet/states-present";
import { liveClaimsData, OFFICIAL_CLAIMS_PAGE, officialClaimView, type OfficialClaimJson } from "@/modules/sheet/official-claims-present";

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
export async function loadSheetTemplates(
  staff: SheetStaff,
  tab: TemplatesTab,
  view: string | undefined,
  now: Date = new Date(),
  /** Live official claims (#188): the search and page on Source review, the claim on Rule detail. */
  official: { claim?: string; query?: string; offset?: string } = {},
) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, packs, pinnedMatters, agreementTemplates, agreements, versions, definitions, reviews, evidence, items, names] = await Promise.all([
    loadSheetChrome(staff, "/sheet/templates"),
    supabase.from("rule_pack_versions").select("id, program_key, jurisdiction, pack_version, status, organization_id, next_review_at").order("updated_at", { ascending: false }).limit(READ),
    supabase.from("matters").select("program_pack_id").eq("organization_id", org).not("program_pack_id", "is", null).limit(1000),
    supabase.from("agreement_templates").select("id, name, kind, status, approved_at, approved_by, version").eq("organization_id", org).order("updated_at", { ascending: false }).limit(READ),
    supabase.from("agreements").select("template_id, matter_id").eq("organization_id", org).not("template_id", "is", null).limit(1000),
    supabase
      .from("rule_versions")
      .select("id, organization_id, definition_id, version_number, version, status, status_reason, effective_from, effective_to, next_review_at, claim, output_value, applicability, applicability_note")
      // Live official claims have their own list below the register (#188); the register is the firm's review work.
      .eq("origin", "firm_entry")
      .order("updated_at", { ascending: false })
      .limit(READ),
    supabase.from("rule_definitions").select("id, stable_key, jurisdiction, program_key").limit(READ),
    supabase.from("professional_reviews").select("rule_version_id, reviewer_membership_id, decided_at, decision").eq("organization_id", org).order("decided_at", { ascending: false }).limit(READ),
    supabase
      .from("rule_evidence")
      .select(
        "rule_version_id, snapshot_id, source_section, source_url, evidence_excerpt, form_number, form_modified_on, published_on, modified_on, last_amended_on, current_to, checked_on, page_attested_on, page_attested_by_membership_id",
      )
      .limit(READ),
    supabase.from("rule_pack_items").select("pack_id, rule_version_id").limit(1000),
    memberNames(supabase, org),
  ]);

  const snapshotIds = [...new Set((evidence.data ?? []).map((row) => row.snapshot_id).filter((id): id is string => Boolean(id)))];
  const snapshots = snapshotIds.length ? await supabase.from("source_snapshots").select("id, source_id, publisher, final_url, retrieved_at, content_hash").in("id", snapshotIds) : null;
  const sourceIds = [...new Set((snapshots?.data ?? []).map((row) => row.source_id))];
  const sources = sourceIds.length ? await supabase.from("official_sources").select("id, title").in("id", sourceIds) : null;

  const pinned = tally((pinnedMatters.data ?? []).map((row) => row.program_pack_id));
  // Distinct matters per agreement template (two agreements on one matter count once).
  const used = tally([...new Set((agreements.data ?? []).map((row) => `${row.template_id}|${row.matter_id}`))].map((key) => key.split("|")[0]));
  const definitionOf = new Map((definitions.data ?? []).map((row) => [row.id, row]));
  const reviewerOf = new Map<string, string>();
  const approvedAt = new Map<string, string>();
  for (const review of reviews.data ?? []) {
    if (review.decision !== "approved") continue;
    if (!reviewerOf.has(review.rule_version_id)) reviewerOf.set(review.rule_version_id, names.get(review.reviewer_membership_id) ?? "Licensed reviewer");
    if (!approvedAt.has(review.rule_version_id)) approvedAt.set(review.rule_version_id, review.decided_at);
  }
  const snapshotOf = new Map((snapshots?.data ?? []).map((row) => [row.id, row]));
  const titleOf = new Map((sources?.data ?? []).map((row) => [row.id, row.title]));
  const packMatters = new Map<string, number>();
  for (const item of items.data ?? []) packMatters.set(item.rule_version_id, (packMatters.get(item.rule_version_id) ?? 0) + (pinned.get(item.pack_id) ?? 0));

  const rules: RuleRow[] = (versions.data ?? []).flatMap((row) => {
    const definition = definitionOf.get(row.definition_id);
    if (!definition) return [];
    const cited = (evidence.data ?? []).filter((item) => item.rule_version_id === row.id);
    const captured = cited.map((item) => ({ item, snapshot: item.snapshot_id ? snapshotOf.get(item.snapshot_id) : undefined })).filter((pair) => pair.snapshot);
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
        // SRC-01/02/03: a firm's claim (the platform catalog stays read only here).
        ...(row.organization_id ? { facts: claimFactsFor(row, cited, snapshotOf, approvedAt.get(row.id) ?? null, reviewerOf.get(row.id) ?? null, names) } : {}),
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
  // OPS-04: the firm's own message and announcement templates (not archived).
  const firm = tab === "messages"
    ? ((
        await supabase
          .from("message_templates")
          .select("id, use_for, name, title, body, status, version, approved_at, approved_by_membership_id")
          .eq("organization_id", org)
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(READ)
      ).data ?? [])
    : [];
  const opened = view && isUuid(view) ? firm.find((row) => row.id === view) : undefined;
  const messageDialog: MessageTemplateDialogData | null =
    tab === "messages"
      ? {
          organizationId: org,
          edit: opened
            ? {
                id: opened.id,
                version: opened.version,
                useFor: opened.use_for === "announcement" ? "announcement" : "message",
                name: opened.name,
                title: opened.title ?? "",
                body: opened.body,
                status: opened.status === "approved" ? "approved" : "draft",
              }
            : null,
          canApprove: staff.role === "firm_owner" || staff.role === "licensed_consultant",
          canWrite: staff.role === "firm_owner" || staff.role === "licensed_consultant" || staff.role === "case_manager",
        }
      : null;
  const data = templatesData({
    tab,
    program: programRows(packRows, pinned, agreementRows, used),
    messages: [
      ...firmMessageRows(
        firm.map((row) => ({
          id: row.id,
          useFor: row.use_for,
          name: row.name,
          status: row.status,
          approvedAt: row.approved_at,
          approvedBy: row.approved_by_membership_id ? (names.get(row.approved_by_membership_id) ?? null) : null,
        })),
        staff.timezone,
      ),
      ...messageRows(catalog, use, staff.timezone),
    ],
    rules,
    packs: packRows.length,
    selected,
    today: isoDateInTimeZone(now, staff.timezone),
    viewer: { organizationId: org, role: staff.role, today: isoDateInTimeZone(now, staff.timezone), timeZone: staff.timezone, now },
    addClaim: claimAddData(staff, isoDateInTimeZone(now, staff.timezone)),
  });
  // SRC-12: Program templates links to What Casevoya supports.
  data.program.supportHref = SUPPORT_SHEET_HREF;
  // #188: the live official claims (Source review) and one of them with its history (Rule detail).
  let liveFailed = false;
  if (tab === "sources") {
    const query = (official.query ?? "").trim().slice(0, 120);
    const offset = Math.max(0, Math.min(Number.parseInt(official.offset ?? "0", 10) || 0, 100_000));
    const live = await supabase.rpc("official_claims", { p_query: query || (null as unknown as string), p_program: null as unknown as string, p_limit: OFFICIAL_CLAIMS_PAGE, p_offset: offset });
    liveFailed = Boolean(live.error);
    data.sources.live = liveClaimsData(live.error ? null : (live.data as { total?: unknown; rows?: unknown }), { query, offset, timeZone: staff.timezone });
  }
  if (tab === "rule" && official.claim && isUuid(official.claim)) {
    const [claim, history] = await Promise.all([
      supabase.rpc("official_claim", { p_definition_id: official.claim }),
      supabase.rpc("rule_claim_history", { p_definition_id: official.claim }),
    ]);
    data.officialClaim = officialClaimView(claim.error ? null : (claim.data as OfficialClaimJson | null), history.error ? [] : history.data, {
      organizationId: org,
      role: staff.role,
      timeZone: staff.timezone,
    });
  }
  // DOC-01: the firm's checklist templates; a failed read shows as partial below (DES-04).
  let checklistsFailed = false;
  if (tab === "checklists") {
    data.checklists.live = await loadChecklists(supabase, staff, names).catch(() => undefined);
    checklistsFailed = !data.checklists.live;
  }
  // DES-04: a read that failed or hit its limit makes the lists and counts partial; say so.
  const partial = partialAlert([
    { label: "Program templates", count: (packs.data ?? []).length, cap: READ, failed: Boolean(packs.error) },
    { label: "Rule versions", count: (versions.data ?? []).length, cap: READ, failed: Boolean(versions.error) },
    { label: "Rule evidence", count: (evidence.data ?? []).length, cap: READ, failed: Boolean(evidence.error) },
    { label: "Agreement templates", count: (agreementTemplates.data ?? []).length, cap: READ, failed: Boolean(agreementTemplates.error) },
    { label: "Live official claims", count: 0, cap: READ, failed: liveFailed },
    { label: "Checklist templates", count: data.checklists.live?.templates.length ?? 0, cap: READ, failed: checklistsFailed },
  ]);
  return { chrome, data, messageDialog, partial };
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
  // A failed read is shown as "couldn't load" (DES-04), never as a firm without checklists.
  if (templates.error || items.error) throw new Error("checklist templates couldn't load");
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
