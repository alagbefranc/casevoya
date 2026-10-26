import "server-only";
import type { ReportsOutcomes } from "@/components/sheet/designer/reports";
import type { createClient } from "@/lib/supabase/server";
import type { EstimateRow } from "@/modules/government/status-provenance";
import { memberNames } from "@/modules/sheet/chrome-load";
import {
  ESTIMATE_DEFINITION,
  NO_ESTIMATE_NOTE,
  NO_PROGRAM,
  OUTCOMES_DEFINITION,
  outcomeSegments,
  programEstimates,
  programName,
  segmentsNote,
  type OutcomeRecord,
} from "@/modules/sheet/reports-outcomes";
import { DEFINITIONS } from "@/modules/sheet/reports-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The GOV-05 estimate columns, as the Government tab reads them. */
const ESTIMATE_COLUMNS =
  "id, matter_id, source_url, application_type, estimate_text, checked_on, page_retrieved_at, snapshot_sha256, status, entered_by_membership_id, reviewed_by_membership_id, reviewed_at, created_at, version, page_attested_by_membership_id, page_attested_on";

export type OutcomesInput = {
  supabase: Client;
  organizationId: string;
  timeZone: string;
  /** Leave sample records out unless the firm is exploring in sample mode. */
  live: boolean;
  /** One program (a key, or "none"), or every program. */
  program: string | null;
  /** Rows read per source; a source that reaches it marks the report partial. */
  limit: number;
  cap: { capped: boolean };
};

/**
 * The Processing and outcomes tab, as the signed-in staff member reads it (RLS decides the
 * matters, stage history and estimates). REP-02.
 */
export async function loadOutcomeSegments(input: OutcomesInput): Promise<ReportsOutcomes> {
  const { supabase, organizationId: org, live, limit, cap } = input;
  const read = <T>(result: { data: T[] | null } | null): T[] => {
    const list = result?.data ?? [];
    if (list.length >= limit) cap.capped = true;
    return list;
  };
  const transitions = await supabase
    .from("matter_stage_transitions")
    .select("matter_id, to_stage, created_at")
    .eq("organization_id", org)
    .in("to_stage", ["submitted", "decision_review"])
    .order("created_at", { ascending: true })
    .limit(limit);
  const submitted = new Map<string, string>();
  const decided = new Map<string, string>();
  for (const row of read(transitions)) {
    if (row.to_stage === "submitted" && !submitted.has(row.matter_id)) submitted.set(row.matter_id, row.created_at);
    if (row.to_stage === "decision_review" && !decided.has(row.matter_id)) decided.set(row.matter_id, row.created_at);
  }
  const ids = [...submitted.keys()];
  let mattersQuery = ids.length ? supabase.from("matters").select("id, created_at, outcome, program_pack_id, is_sample").eq("organization_id", org).in("id", ids) : null;
  if (mattersQuery && live) mattersQuery = mattersQuery.eq("is_sample", false);
  const matters = mattersQuery ? await mattersQuery : null;
  const matterRows = matters?.data ?? [];
  const packIds = [...new Set(matterRows.map((row) => row.program_pack_id).filter((id): id is string => Boolean(id)))];
  const shownIds = matterRows.map((row) => row.id);
  const [packs, estimates] = await Promise.all([
    packIds.length ? supabase.from("rule_pack_versions").select("id, program_key").in("id", packIds) : null,
    shownIds.length
      ? supabase.from("government_processing_estimates").select(ESTIMATE_COLUMNS).eq("organization_id", org).eq("status", "approved").in("matter_id", shownIds).limit(limit)
      : null,
  ]);
  const programOfPack = new Map((packs?.data ?? []).map((row) => [row.id, row.program_key]));
  const records: OutcomeRecord[] = matterRows.map((row) => ({
    matterId: row.id,
    program: row.program_pack_id ? (programOfPack.get(row.program_pack_id) ?? null) : null,
    createdAt: row.created_at,
    submittedAt: submitted.get(row.id) ?? null,
    decidedAt: decided.get(row.id) ?? null,
    outcome: row.outcome,
  }));
  const estimateRows = read(estimates as { data: (EstimateRow & { matter_id: string })[] | null } | null);
  const names = estimateRows.length ? await memberNames(supabase, org) : null;
  const byProgram = programEstimates(
    estimateRows,
    new Map(records.map((record) => [record.matterId, record.program])),
    names ? (id) => (id ? names.get(id) || "a licensed member" : "a licensed member") : undefined,
  );
  const result = outcomeSegments(records, {
    timeZone: input.timeZone,
    program: input.program,
    estimates: byProgram,
    linkFor: (key) => `/sheet/reports?tab=outcomes&program=${encodeURIComponent(key)}`,
  });
  const anyEstimate = result.rows.some((row) => row.estimate);
  return {
    rows: result.rows,
    note: segmentsNote(result.hidden, result.rows.length),
    definition: `${OUTCOMES_DEFINITION} ${ESTIMATE_DEFINITION}`,
    firm: { rows: result.firm, definition: DEFINITIONS.firm },
    detail: true,
    estimateNote: result.rows.length && !anyEstimate ? NO_ESTIMATE_NOTE : null,
    segment: input.program ? { label: `Showing one program: ${programName(input.program === NO_PROGRAM ? null : input.program)}`, clearHref: "/sheet/reports?tab=outcomes" } : null,
  };
}
