import "server-only";
import type { RenewalPanelData } from "@/components/sheet/designer/matter-renewal";
import type { createClient } from "@/lib/supabase/server";
import { buildRenewalPanel, type ContactState, type FeeRow, type RenewalRow, type TimingRow } from "@/modules/sheet/renewal-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Roles that see the card (app.gov_staff_roles); the database decides what each may change. */
const GOV_STAFF = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);

const RENEWAL_COLUMNS =
  "id, decision_id, document_label, expires_on, document_version_id, remind_on, timing_id, task_id, owner_membership_id, recorded_by_membership_id, client_person_id, service_scope, fee_section, fee_group, fee_name, lead_id, reminder_set_at, reminder_set_by_membership_id, cancelled_at, cancel_reason, created_at, version";
const TIMING_COLUMNS =
  "id, program_key, applies_to, timing_text, lead_days, source_url, source_section, form_number, form_modified_on, checked_on, current_to, snapshot_sha256, status, version";
const FEE_COLUMNS = "id, section, fee_group, name, amount_cents, currency, source_url, retrieved_at, snapshot_sha256, status, reviewed_at";

export type RenewalLoadInput = {
  organizationId: string;
  role: string;
  licensed: boolean;
  timezone: string;
  today: string;
  matter: { id: string; is_sample: boolean; stage: string };
  program: { key: string; label: string } | null;
  tasks: { id: string; status: string; due_on: string | null }[];
  documentIds: string[];
  memberName: (id: string | null) => string;
};

/**
 * DEC-02: the Expiry and renewal card on the matter's Decisions tab, read as the signed-in member
 * (row-level security decides). Null for anyone outside the matter's staff, or when the records
 * can't be read: the card is then left out rather than shown empty as if nothing were recorded.
 */
export async function loadRenewalPanel(supabase: Client, input: RenewalLoadInput): Promise<RenewalPanelData | null> {
  if (!GOV_STAFF.has(input.role)) return null;
  const org = input.organizationId;
  const [decisions, renewals, timings, fees, contact, docs] = await Promise.all([
    supabase
      .from("decision_records")
      .select("id")
      .eq("organization_id", org)
      .eq("matter_id", input.matter.id)
      .eq("state", "confirmed")
      .eq("outcome", "approved")
      .order("confirmed_at", { ascending: false })
      .limit(1),
    supabase.from("decision_renewals").select(RENEWAL_COLUMNS).eq("organization_id", org).eq("matter_id", input.matter.id).order("expires_on", { ascending: true }).limit(50),
    supabase.from("renewal_timings").select(TIMING_COLUMNS).eq("organization_id", org).in("status", ["pending_review", "approved"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("government_fee_references").select(FEE_COLUMNS).eq("organization_id", org).eq("status", "approved").order("position", { ascending: true }).limit(500),
    supabase.rpc("renewal_contact_state", { p_matter_id: input.matter.id }),
    input.documentIds.length
      ? supabase.from("documents").select("id, purpose").eq("organization_id", org).in("id", input.documentIds.slice(0, 200))
      : null,
  ]);
  if (decisions.error || renewals.error || timings.error) return null;
  const decisionId = decisions.data?.[0]?.id ?? null;
  const rows = (renewals.data ?? []) as RenewalRow[];
  // Nothing to show before an approval is confirmed, unless something was recorded already.
  if (!decisionId && rows.length === 0) return null;

  const purpose = new Map((docs?.data ?? []).map((row) => [row.id, row.purpose as string]));
  const versions = purpose.size
    ? await supabase
        .from("document_versions")
        .select("id, document_id, version_number, upload_state")
        .eq("organization_id", org)
        .in("document_id", [...purpose.keys()])
        .eq("upload_state", "clean")
        .order("version_number", { ascending: false })
        .limit(200)
    : null;
  const files = (versions?.data ?? []).map((row) => ({ id: row.id, label: `${purpose.get(row.document_id) ?? "Document"}, version ${row.version_number}` }));

  const state = contact.error ? null : (contact.data as { allowed?: boolean; reason?: string; name?: string | null } | null);
  const contactState: ContactState =
    state && typeof state.reason === "string" ? { allowed: state.allowed === true, reason: state.reason, name: state.name ?? null } : null;

  return buildRenewalPanel({
    organizationId: org,
    role: input.role,
    licensed: input.licensed,
    today: input.today,
    timezone: input.timezone,
    decisionId,
    sample: input.matter.is_sample,
    closed: input.matter.stage === "closed",
    program: input.program,
    renewals: rows,
    tasks: new Map(input.tasks.map((task) => [task.id, { status: task.status, due_on: task.due_on }])),
    timings: (timings.data ?? []) as TimingRow[],
    fees: fees.error ? null : ((fees.data ?? []) as FeeRow[]),
    contact: contactState,
    files,
    memberName: input.memberName,
  });
}
