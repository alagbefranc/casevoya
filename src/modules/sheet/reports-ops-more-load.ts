import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { REPORT_READ, type ReportContext } from "@/modules/sheet/reports-load";
import {
  MORE_DEFINITIONS,
  intakeCompletion,
  overdueNote,
  overdueTasks,
  readiness,
  renewalWorkload,
  requestWaiting,
  type OpsMore,
  type RequestWaiting,
} from "@/modules/sheet/reports-ops-more";

type Client = Awaited<ReturnType<typeof createClient>>;
type Capped = { capped: boolean };

/** Stages a matter can only reach through Ready to submit (app.matter_stage_transition_allowed). */
const PAST_READY = ["submitted", "government_processing", "decision_review", "post_decision"] as const;
/** Ids per `.in()` filter, so a large firm's request stays a reasonable size. */
const CHUNK = 200;

function chunks<T>(list: T[]): T[][] {
  return Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, index) => list.slice(index * CHUNK, index * CHUNK + CHUNK));
}

function rows<T>(result: { data: T[] | null } | null, cap: Capped): T[] {
  const list = result?.data ?? [];
  if (list.length >= REPORT_READ) cap.capped = true;
  return list;
}

/** Sample matters the signed-in member can read, to leave out while sample mode is off. */
export async function sampleMatterIds(supabase: Client, org: string, live: boolean): Promise<Set<string>> {
  if (!live) return new Set();
  const result = await supabase.from("matters").select("id").eq("organization_id", org).eq("is_sample", true).limit(REPORT_READ);
  return new Set((result.data ?? []).map((row) => row.id));
}

export type OpenRequest = {
  id: string;
  matterId: string;
  personId: string;
  purpose: string;
  dueOn: string | null;
  waiting: RequestWaiting;
};

/**
 * Open document requests as the signed-in member reads them, each with where it waits. The
 * report's Outstanding documents card and the Documents page's requests list both use this, so
 * the figure and the list are the same rows.
 */
export async function loadOpenRequests(supabase: Client, org: string, today: string, sample: ReadonlySet<string>, cap: Capped = { capped: false }): Promise<OpenRequest[]> {
  const requests = await supabase
    .from("document_requests")
    .select("id, matter_id, person_id, purpose, due_on, status, expires_on, document_id")
    .eq("organization_id", org)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(REPORT_READ);
  const list = rows(requests, cap).filter((row) => !sample.has(row.matter_id));
  const documentIds = [...new Set(list.map((row) => row.document_id).filter((id): id is string => Boolean(id)))];
  const documents = (await Promise.all(chunks(documentIds).map((ids) => supabase.from("documents").select("id, current_version_id").eq("organization_id", org).in("id", ids)))).flatMap(
    (result) => result.data ?? [],
  );
  const versionIds = documents.map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const versions = (await Promise.all(chunks(versionIds).map((ids) => supabase.from("document_versions").select("id, review_state").eq("organization_id", org).in("id", ids)))).flatMap(
    (result) => result.data ?? [],
  );
  const versionOf = new Map(documents.map((row) => [row.id, row.current_version_id]));
  const reviewOf = new Map(versions.map((row) => [row.id, row.review_state as string]));
  return list.flatMap((row) => {
    const version = row.document_id ? versionOf.get(row.document_id) : null;
    const waiting = requestWaiting(
      { status: row.status, expiresOn: row.expires_on, hasDocument: Boolean(version), reviewState: version ? (reviewOf.get(version) ?? null) : null },
      today,
    );
    return waiting ? [{ id: row.id, matterId: row.matter_id, personId: row.person_id, purpose: row.purpose, dueOn: row.due_on, waiting }] : [];
  });
}

/** The Operations cards added for REP-01, read as the signed-in member (RLS decides). */
export async function loadOpsMore(ctx: ReportContext, cap: Capped, sample: ReadonlySet<string>): Promise<OpsMore> {
  const { supabase, staff, today, fromIso, nowIso, live } = ctx;
  const org = staff.organizationId;
  const now = new Date(nowIso);

  let intakeQuery = supabase
    .from("intake_requests")
    .select("response_id, matter_id, due_on")
    .eq("organization_id", org)
    .gte("created_at", fromIso)
    .lte("created_at", nowIso)
    .limit(REPORT_READ);
  if (live) intakeQuery = intakeQuery.eq("is_sample", false);

  const [tasks, intake, ready, past, renewals] = await Promise.all([
    // The Tasks page's Internal tab reads these rows (open and blocked internal tasks).
    supabase.from("tasks").select("matter_id, due_on, due_at, status").eq("organization_id", org).eq("audience", "internal").in("status", ["open", "blocked"]).limit(REPORT_READ),
    intakeQuery,
    supabase
      .from("matter_stage_transitions")
      .select("matter_id, created_at")
      .eq("organization_id", org)
      .eq("to_stage", "ready_to_submit")
      .order("created_at", { ascending: true })
      .limit(REPORT_READ),
    supabase.from("matters").select("id, is_sample").eq("organization_id", org).in("stage", [...PAST_READY]).limit(REPORT_READ),
    supabase.from("decision_renewals").select("matter_id, expires_on, remind_on, task_id, cancelled_at").eq("organization_id", org).is("cancelled_at", null).limit(REPORT_READ),
  ]);

  // Overdue tasks: the Tasks page's rule, sample matters counted apart.
  const overdue = overdueTasks(
    rows(tasks, cap).map((row) => ({ matterId: row.matter_id, dueOn: row.due_on, dueAt: row.due_at, status: row.status })),
    today,
    now,
    sample,
  );

  // Intake completion: forms sent in the period, completed when the response is submitted.
  const intakeRows = rows(intake, cap).filter((row) => !sample.has(row.matter_id));
  const responses = (
    await Promise.all(chunks(intakeRows.map((row) => row.response_id)).map((ids) => supabase.from("intake_responses").select("id, status").eq("organization_id", org).in("id", ids)))
  ).flatMap((result) => result.data ?? []);
  const submitted = new Set(responses.filter((row) => row.status === "submitted").map((row) => row.id));
  const intakeResult = intakeCompletion(
    intakeRows.map((row) => ({ submitted: submitted.has(row.response_id), dueOn: row.due_on })),
    today,
  );

  // Time to internal readiness: first move into Ready to submit, inside the period.
  const firstReady = new Map<string, string>();
  for (const row of rows(ready, cap)) if (!firstReady.has(row.matter_id)) firstReady.set(row.matter_id, row.created_at);
  const inPeriod = [...firstReady.entries()].filter(([, at]) => Date.parse(at) >= Date.parse(fromIso) && Date.parse(at) <= Date.parse(nowIso));
  const opened = (
    await Promise.all(
      chunks(inPeriod.map(([id]) => id)).map((ids) => {
        let query = supabase.from("matters").select("id, created_at").eq("organization_id", org).in("id", ids);
        if (live) query = query.eq("is_sample", false);
        return query;
      }),
    )
  ).flatMap((result) => result.data ?? []);
  const notRecorded = rows(past, cap).filter((row) => !(live && row.is_sample) && !firstReady.has(row.id)).length;
  const readyResult = readiness(
    opened.map((row) => ({ createdAt: row.created_at, readyAt: firstReady.get(row.id) ?? row.created_at })),
    notRecorded,
  );

  // Renewal workload: recorded expiries whose review task is still open.
  const renewalRows = rows(renewals, cap).filter((row) => !sample.has(row.matter_id));
  const taskStatus = new Map(
    (await Promise.all(chunks(renewalRows.map((row) => row.task_id)).map((ids) => supabase.from("tasks").select("id, status").eq("organization_id", org).in("id", ids))))
      .flatMap((result) => result.data ?? [])
      .map((row) => [row.id, row.status as string]),
  );
  const renewalResult = renewalWorkload(
    renewalRows.map((row) => {
      const status = taskStatus.get(row.task_id);
      return { expiresOn: row.expires_on, remindOn: row.remind_on, cancelled: Boolean(row.cancelled_at), taskOpen: status === "open" || status === "blocked" };
    }),
    today,
  );

  return {
    overdue: { ...overdue, note: overdueNote(overdue), definition: MORE_DEFINITIONS.overdue },
    intake: { ...intakeResult, definition: MORE_DEFINITIONS.intake },
    readiness: { ...readyResult, definition: MORE_DEFINITIONS.readiness },
    renewals: { ...renewalResult, definition: MORE_DEFINITIONS.renewals },
  };
}
