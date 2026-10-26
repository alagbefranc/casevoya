import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { PortalViewer } from "@/modules/portal/load";
import { schemaFields, type AnswerVersion, type Presence } from "@/modules/intake/present";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";

export type PortalIntakeForm = {
  responseId: string;
  matterId: string;
  title: string;
  versionNumber: number;
  status: "draft" | "submitted";
  frozen: boolean;
  submittedAt: string | null;
  /** When the response last changed: the "Saved" time before anything new is saved. */
  updatedAt: string;
  /** intake_responses.version: each save names it, so a stale save is a visible conflict. */
  version: number;
  fields: IntakeField[];
  answers: AnswerVersion[];
  /** Answer versions staff have reviewed (locked for a correction rather than an edit). */
  reviewed: string[];
  dueOn: string | null;
  message: string | null;
  isSample: boolean;
  /** Corrections this person asked for, newest first. */
  corrections: { reference: string; fieldKey: string | null; createdAt: string }[];
  /** INT-04: answers your firm copied from your earlier matter, to confirm or change before sending. */
  reuses?: PortalReuse[];
};

export type PortalReuse = {
  id: string;
  fieldKey: string;
  answerId: string;
  status: "needs_reconfirmation" | "confirmed" | "replaced";
  /** The earlier matter's reference. */
  originRef: string | null;
};

export type PortalIntake = {
  forms: PortalIntakeForm[];
  /** The form `?response=` names, when it is one of this person's. */
  selected: string | null;
};

const PRESENCES = new Set(["provided", "unknown", "not_applicable", "approximate"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The signed-in person's own intake forms (row-level security: a response is read by its own
 * person and by staff on the matter; a sponsor or family member never reads someone else's).
 * The form itself comes from public.intake_response_forms, so a form sent before a newer version
 * was published still opens as it was sent.
 */
export async function loadPortalIntake(viewer: PortalViewer, responseParam: string | null): Promise<PortalIntake> {
  const personId = viewer.person?.id;
  if (!personId) return { forms: [], selected: null };
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { data: responses } = await supabase
    .from("intake_responses")
    .select("id, matter_id, status, frozen_at, submitted_at, updated_at, version, created_at")
    .eq("organization_id", viewer.organizationId)
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = responses ?? [];
  if (rows.length === 0) return { forms: [], selected: null };
  const ids = rows.map((row) => row.id);
  const [forms, answers, requests, corrections, matters, reuses] = await Promise.all([
    supabase.rpc("intake_response_forms", { p_response_ids: ids }),
    supabase
      .from("intake_answer_versions")
      .select("id, response_id, field_key, presence, normalized_value, raw_value, created_at, created_by")
      .in("response_id", ids)
      .order("created_at", { ascending: true })
      .limit(2000),
    supabase.from("intake_requests").select("response_id, due_on, message, is_sample").in("response_id", ids),
    supabase.from("intake_corrections").select("response_id, correction_number, field_key, created_at").in("response_id", ids).order("created_at", { ascending: false }),
    supabase.from("matters").select("id, is_sample").in("id", [...new Set(rows.map((row) => row.matter_id))]),
    supabase.from("intake_fact_reuses").select("id, response_id, field_key, answer_id, status, origin_matter_id").in("response_id", ids),
  ]);
  const originIds = [...new Set((reuses.data ?? []).map((row) => row.origin_matter_id))];
  const origins = originIds.length ? await supabase.from("matters").select("id, reference").in("id", originIds) : null;
  const originRef = new Map((origins?.data ?? []).map((row) => [row.id, row.reference]));
  const answerRows = answers.data ?? [];
  const { data: reviews } = answerRows.length
    ? await supabase.from("intake_answer_reviews").select("answer_id").in("answer_id", answerRows.map((row) => row.id))
    : { data: [] as { answer_id: string }[] };
  const reviewed = new Set((reviews ?? []).map((row) => row.answer_id));
  const formById = new Map((forms.data ?? []).map((row) => [row.response_id, row]));
  const requestById = new Map((requests.data ?? []).map((row) => [row.response_id, row]));
  const sampleMatter = new Map((matters.data ?? []).map((row) => [row.id, row.is_sample]));

  const out: PortalIntakeForm[] = [];
  for (const row of rows) {
    const form = formById.get(row.id);
    if (!form) continue;
    const request = requestById.get(row.id);
    const mine = answerRows
      .filter((answer) => answer.response_id === row.id && PRESENCES.has(answer.presence))
      .map(
        (answer): AnswerVersion => ({
          id: answer.id,
          fieldKey: answer.field_key,
          presence: answer.presence as Presence,
          value: record(answer.normalized_value),
          raw: record(answer.raw_value),
          createdAt: answer.created_at,
          createdBy: answer.created_by,
        }),
      );
    out.push({
      responseId: row.id,
      matterId: row.matter_id,
      title: form.title,
      versionNumber: form.version_number,
      status: row.status === "submitted" ? "submitted" : "draft",
      frozen: Boolean(row.frozen_at),
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
      version: row.version,
      fields: schemaFields(form.schema),
      answers: mine,
      reviewed: mine.filter((answer) => reviewed.has(answer.id)).map((answer) => answer.id),
      dueOn: request?.due_on ?? null,
      message: request?.message ?? null,
      isSample: request?.is_sample ?? sampleMatter.get(row.matter_id) ?? false,
      corrections: (corrections.data ?? [])
        .filter((correction) => correction.response_id === row.id)
        .map((correction) => ({ reference: `CR-${String(correction.correction_number).padStart(4, "0")}`, fieldKey: correction.field_key, createdAt: correction.created_at })),
      reuses: (reuses.data ?? [])
        .filter((reuse) => reuse.response_id === row.id)
        .map((reuse) => ({ id: reuse.id, fieldKey: reuse.field_key, answerId: reuse.answer_id, status: reuse.status, originRef: originRef.get(reuse.origin_matter_id) ?? null })),
    });
  }
  const selected = responseParam && isUuid(responseParam) && out.some((form) => form.responseId === responseParam) ? responseParam : null;
  return { forms: out, selected };
}
