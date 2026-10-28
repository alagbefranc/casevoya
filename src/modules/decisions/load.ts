import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  buildApprovalFollowUp,
  type ClosureTaskRow,
  type DeliveryRow,
  type FollowUpEventRow,
  type FollowUpStepRow,
  type SummaryRow,
} from "@/modules/decisions/present";
import type { GovernmentRecords } from "@/modules/sheet/government-present";
import { localInput } from "@/modules/sheet/government-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const STEP_COLUMNS =
  "id, program_key, label, timing_text, source_url, source_section, form_number, form_modified_on, checked_on, current_to, snapshot_sha256, status, reviewed_by_membership_id, reviewed_at, review_note, version, page_attested_by_membership_id, page_attested_on";
const SUMMARY_COLUMNS =
  "id, number, body, status, drafted_by_membership_id, approved_by_membership_id, approved_at, body_sha256, superseded_at, updated_at, version";
const DELIVERY_COLUMNS =
  "id, document_version_id, document_label, method, delivered_at, note, delivered_by_membership_id, acknowledgement, acknowledged_at, acknowledged_on, ack_recorded_by_membership_id, ack_evidence_version_id, ack_evidence_note, version";

export type ApprovalLoadInput = {
  organizationId: string;
  matterId: string;
  role: string;
  licensed: boolean;
  timezone: string;
  today: string;
  now: Date;
  memberName: (membershipId: string | null) => string;
  userName: (userId: string | null) => string;
};

/**
 * DEC-02: the Decisions tab's approval follow-up, read as the signed-in member (row-level security
 * decides). Null when no approval is recorded on the matter, or the member isn't matter staff.
 */
export async function loadApprovalFollowUp(supabase: Client, records: GovernmentRecords, input: ApprovalLoadInput) {
  const approvals = records.decisions.filter((row) => row.outcome === "approved");
  const approval = approvals.find((row) => row.state === "confirmed") ?? approvals[0] ?? null;
  if (!approval) return null;
  const org = input.organizationId;

  const [matter, steps, events, summaries, deliveries, refs] = await Promise.all([
    supabase.from("matters").select("program_pack_id").eq("organization_id", org).eq("id", input.matterId).maybeSingle(),
    supabase.from("approval_follow_up_steps").select(STEP_COLUMNS).eq("organization_id", org).in("status", ["approved", "pending_review", "retired"]).order("created_at").limit(300),
    supabase
      .from("approval_follow_up_events")
      .select("step_id, ticked, membership_id, created_at")
      .eq("organization_id", org)
      .eq("matter_id", input.matterId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("conditions_summaries").select(SUMMARY_COLUMNS).eq("organization_id", org).eq("matter_id", input.matterId).order("created_at", { ascending: false }).limit(50),
    supabase.from("decision_deliveries").select(DELIVERY_COLUMNS).eq("organization_id", org).eq("matter_id", input.matterId).order("delivered_at", { ascending: false }).limit(100),
    supabase.from("document_matter_refs").select("document_id").eq("organization_id", org).eq("matter_id", input.matterId).is("removed_at", null).limit(200),
  ]);

  const packId = matter.data?.program_pack_id ?? null;
  const documentIds = [...new Set((refs.data ?? []).map((row) => row.document_id))];
  const closureTasks = records.followUps.filter((row) => row.task && records.decisions.some((decision) => decision.id === row.decision_id && decision.outcome === "approved"));
  const taskIds = closureTasks.map((row) => row.task?.id).filter((id): id is string => Boolean(id));
  const [pack, documents, taskEvents] = await Promise.all([
    packId ? supabase.from("rule_pack_versions").select("program_key").eq("id", packId).maybeSingle() : null,
    documentIds.length ? supabase.from("documents").select("id, purpose, current_version_id").eq("organization_id", org).in("id", documentIds) : null,
    taskIds.length
      ? supabase
          .from("task_events")
          .select("task_id, to_status, actor_user_id, created_at")
          .eq("organization_id", org)
          .in("task_id", taskIds)
          .eq("event_kind", "status")
          .order("created_at", { ascending: false })
          .limit(500)
      : null,
  ]);
  const versionIds = (documents?.data ?? []).map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const versions = versionIds.length
    ? await supabase.from("document_versions").select("id, upload_state, original_filename").eq("organization_id", org).in("id", versionIds)
    : null;
  const clean = new Map((versions?.data ?? []).filter((row) => row.upload_state === "clean").map((row) => [row.id, row.original_filename]));
  const files = (documents?.data ?? [])
    .filter((row) => row.current_version_id && clean.has(row.current_version_id))
    .map((row) => ({ versionId: row.current_version_id as string, label: row.purpose || clean.get(row.current_version_id as string) || "Document" }));

  // Who finished each closure task: the newest status event to done.
  const doneEvent = new Map<string, { actor: string | null; at: string }>();
  for (const event of taskEvents?.data ?? []) {
    if (event.to_status === "done" && !doneEvent.has(event.task_id)) doneEvent.set(event.task_id, { actor: event.actor_user_id, at: event.created_at });
  }
  const closure: ClosureTaskRow[] = closureTasks.map((row) => {
    const task = row.task as NonNullable<(typeof row)["task"]>;
    const done = doneEvent.get(task.id);
    return {
      kind: row.kind,
      task: { ...task, completed_at: task.status === "done" ? (done?.at ?? null) : null },
      doneBy: task.status === "done" && done ? input.userName(done.actor) : null,
    };
  });

  return buildApprovalFollowUp({
    organizationId: org,
    matterId: input.matterId,
    role: input.role,
    licensed: input.licensed,
    timezone: input.timezone,
    today: input.today,
    nowLocal: localInput(input.now, input.timezone),
    memberName: input.memberName,
    userName: input.userName,
    approval: { id: approval.id, state: approval.state, confirmedAt: approval.confirmed_at },
    programKey: pack?.data?.program_key ?? null,
    steps: (steps.data ?? []) as FollowUpStepRow[],
    events: (events.data ?? []) as FollowUpEventRow[],
    closure,
    summaries: (summaries.data ?? []) as SummaryRow[],
    deliveries: (deliveries.data ?? []) as DeliveryRow[],
    files,
  });
}
