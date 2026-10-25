import "server-only";
import type { HistoryRow, PilotRecordRow, SignoffData, SignoffField, SummaryRow } from "@/components/sheet/designer/migration";
import type { createClient } from "@/lib/supabase/server";
import { memberNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { kindLabel, pilotDefault, pilotState, readRunReport, runReportLines, when } from "@/modules/migration/report";
import { plural, shortHash, type PlanCounts } from "@/modules/sheet/migration-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The batch columns the Sign off tab reads. */
export type SignoffBatch = {
  id: string;
  file_name: string;
  status: string;
  is_sample: boolean;
  source_sha256: string;
  source_row_count: number;
  staged_row_count: number;
  verified_at: string | null;
  result_counts: unknown;
  committed_at: string | null;
  rolled_back_at: string | null;
  discarded_at: string | null;
  source_system: string;
  pilot_size: number | null;
  pilot_completed_at: string | null;
  pilot_counts: unknown;
  pilot_signed_off_at: string | null;
  pilot_signed_off_by: string | null;
  pilot_signoff_note: string | null;
  full_run_started_at: string | null;
  run_report: unknown;
};

const PILOT_ROWS = 100;

function day(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function counted(value: unknown): { matters: number; people_created: number; people_linked: number } {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const n = (key: string) => Number(record[key] ?? 0) || 0;
  return { matters: n("matters"), people_created: n("people_created"), people_linked: n("people_linked") };
}

/** The records an import created or linked so far (the pilot's, while it waits for sign-off), owner only (RLS). */
async function pilotRecords(supabase: Client, org: string, batch: string): Promise<{ rows: PilotRecordRow[]; more: string | null }> {
  const records = await supabase
    .from("migration_records")
    .select("record_table, record_id, row_number, source_reference, created", { count: "exact" })
    .eq("organization_id", org)
    .eq("batch_id", batch)
    .is("removed_at", null)
    .order("row_number")
    .order("record_table")
    .limit(PILOT_ROWS);
  const list = records.data ?? [];
  const matterIds = list.filter((row) => row.record_table === "matters").map((row) => row.record_id);
  const personIds = list.filter((row) => row.record_table === "persons").map((row) => row.record_id);
  const [matters, persons] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, title, reference").eq("organization_id", org).in("id", matterIds) : null,
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
  ]);
  const matter = new Map((matters?.data ?? []).map((row) => [row.id, row.reference ? `${row.reference} · ${row.title}` : row.title]));
  const person = new Map((persons?.data ?? []).map((row) => [row.id, row.display_name]));
  const rows: PilotRecordRow[] = list.map((row) => {
    const isMatter = row.record_table === "matters";
    const isPerson = row.record_table === "persons";
    const name = (isMatter ? matter.get(row.record_id) : isPerson ? person.get(row.record_id) : undefined) ?? "A record you can’t open";
    return {
      kind: isPerson && !row.created ? "Person (linked to an existing client)" : kindLabel(row.record_table).replace(/s$/, "").replace(/^People$/, "Person"),
      name,
      row: String(row.row_number),
      reference: row.source_reference ?? "—",
      href: isMatter ? `/sheet/matters/${row.record_id}` : isPerson ? `/sheet/clients?tab=person&person=${row.record_id}` : null,
    };
  });
  const total = records.count ?? list.length;
  return { rows, more: total > list.length ? `The first ${PILOT_ROWS} of ${total.toLocaleString("en-CA")} records are listed.` : null };
}

/** MIG-02: the Sign off tab: the plan, the pilot and its sign-off, the full run, and the run report. */
export async function signoffData(
  supabase: Client,
  staff: SheetStaff,
  batch: SignoffBatch,
  counts: PlanCounts | null,
  wire: Record<string, string>,
  history: HistoryRow[],
): Promise<SignoffData> {
  const tz = staff.timezone;
  const summary: SummaryRow[] = [];
  const source: SummaryRow = { term: "Source file", value: [batch.file_name, shortHash(batch.source_sha256)] };
  const checked: SummaryRow = {
    term: "Rows checked",
    value: batch.verified_at
      ? [`${plural(batch.source_row_count, "row")} in the file`, `${batch.staged_row_count.toLocaleString("en-CA")} staged, checksum matches`]
      : [`${plural(batch.source_row_count, "row")} in the file`, "not verified"],
  };
  const system: SummaryRow = { term: "Source system", value: batch.source_system };
  const data: SignoffData = { summary, action: null, rollback: null, history };
  const state = pilotState(batch);
  const pilotDone = counted(batch.pilot_counts);
  const pilotLine: SummaryRow = {
    term: "Pilot",
    value: [`${plural(pilotDone.matters, "matter")} of ${batch.pilot_size ?? 0}`, `${pilotDone.people_created.toLocaleString("en-CA")} new people, ${pilotDone.people_linked.toLocaleString("en-CA")} linked`],
  };

  if (batch.status === "staged" || batch.status === "checked") {
    if (counts) {
      summary.push(
        { term: "People", value: [`${counts.create.toLocaleString("en-CA")} new`, `${counts.link.toLocaleString("en-CA")} linked to existing`] },
        { term: "Matters", value: [counts.matters.toLocaleString("en-CA"), "all start at engagement pending until reviewed"] },
        { term: "Not imported", value: `${plural(counts.problem_rows, "row")} with problems` },
      );
      if (counts.confirm) summary.push({ term: "Waiting", value: `${plural(counts.confirm, "possible match", "possible matches")} to decide on Preview` });
    } else {
      summary.push({ term: "Plan", value: "Not checked yet: map your columns, then continue to preview" });
    }
    summary.push(source, checked);
    if (batch.is_sample) summary.push({ term: "Sample mode", value: "Imported as sample records" });
    const ready = state === "ready" && counts && !counts.confirm && counts.matters > 0;
    if (ready) {
      const settings = await supabase.from("migration_settings").select("pilot_max").eq("organization_id", staff.organizationId).maybeSingle();
      const max = settings.data?.pilot_max ?? 25;
      const size = pilotDefault(max, counts.matters);
      const fields: SignoffField[] = [
        {
          id: "migP",
          label: "Pilot size (matters)",
          hint: `The first matters in your file, with everyone on them. 1 to ${max}.`,
          kind: "number",
          attrs: { "data-mig-pilot": "1" },
          value: String(size),
          min: 1,
          max,
        },
        {
          id: "migS",
          label: "System the file came from",
          hint: "Imported records say “Imported from <system> on <date>”.",
          kind: "text",
          attrs: { "data-mig-system": "1" },
          value: batch.source_system,
          maxLength: 120,
        },
      ];
      data.fields = fields;
    }
    data.notice = {
      tone: "warn",
      title: "A pilot comes first",
      copy: "The pilot creates the first matters in your file. You check them and sign off before the rest can be imported, or roll the pilot back.",
    };
    data.action = { label: "Run the pilot", attrs: { "data-mig-act": "pilot", ...wire, ...(ready ? {} : { disabled: "" }) } };
  } else if (state === "pilot") {
    summary.push({ term: "Status", value: [`Pilot of ${plural(batch.pilot_size ?? 0, "matter")}`, "being created"] }, system, source, checked);
    data.action = { label: "Continue the pilot", attrs: { "data-mig-act": "commit", ...wire } };
  } else if (state === "review") {
    summary.push(pilotLine, system, source, checked);
    data.fields = [
      {
        id: "migN",
        label: "Sign-off note",
        hint: "What you checked in the pilot’s records. Kept with the import; you confirm it’s you first.",
        kind: "textarea",
        attrs: { "data-mig-note": "1" },
        value: "",
        maxLength: 1000,
      },
    ];
    data.notice = {
      tone: "warn",
      title: "The full import waits for your sign-off",
      copy: "Open the pilot’s records below and check them. If something is wrong, roll the pilot back, fix your file and upload it again.",
    };
    data.action = { label: "Sign off the pilot", attrs: { "data-mig-act": "signoff", ...wire } };
    data.pilot = await pilotRecords(supabase, staff.organizationId, batch.id);
  } else if (state === "signed") {
    const names = await memberNamesByUser(supabase, staff.organizationId, batch.pilot_signed_off_by);
    summary.push(
      pilotLine,
      { term: "Signed off", value: [when(batch.pilot_signed_off_at, tz), names ?? "the firm owner"] },
      { term: "Note", value: batch.pilot_signoff_note ?? "—" },
      system,
      source,
    );
    data.notice = { tone: "ok", title: "Pilot signed off", copy: "The full import creates the rest of the matters. The staged rows are checked against the upload’s checksum again first." };
    data.action = { label: "Run the full import", attrs: { "data-mig-act": "commit", ...wire } };
    data.pilot = await pilotRecords(supabase, staff.organizationId, batch.id);
  } else if (state === "full" || state === "legacy") {
    summary.push({ term: "Status", value: "Being created. Continue it, or roll back what was created." }, ...(batch.pilot_size ? [pilotLine] : []), system, source, checked);
    data.action = { label: "Continue the import", attrs: { "data-mig-act": "commit", ...wire } };
  } else if (batch.status === "committed" || batch.status === "rolled_back") {
    const done = (batch.result_counts ?? {}) as { matters?: number; people_created?: number; people_linked?: number; not_imported?: number };
    summary.push(
      { term: "People", value: [`${Number(done.people_created ?? 0).toLocaleString("en-CA")} new`, `${Number(done.people_linked ?? 0).toLocaleString("en-CA")} linked to existing`] },
      { term: "Matters", value: [Number(done.matters ?? 0).toLocaleString("en-CA"), "created at engagement pending"] },
      { term: "Not imported", value: `${plural(Number(done.not_imported ?? 0), "row")} with problems` },
      source,
      { term: "Signed off", value: day(batch.committed_at, tz) },
    );
    if (batch.pilot_size && batch.pilot_completed_at) summary.push(pilotLine);
    if (batch.is_sample) summary.push({ term: "Sample mode", value: "Imported as sample records" });
    if (batch.status === "rolled_back") summary.push({ term: "Rolled back", value: [day(batch.rolled_back_at, tz), "the import’s records were removed"] });
    const report = readRunReport(batch.run_report);
    if (report && batch.status === "committed") {
      const base = `/api/migration/report?batch=${encodeURIComponent(batch.id)}`;
      data.report = {
        rows: runReportLines(report, tz),
        downloads: [
          { label: "Download report (CSV)", href: `${base}&format=csv` },
          { label: "Download report (PDF)", href: `${base}&format=pdf` },
        ],
      };
    }
  } else {
    summary.push({ term: "Status", value: [day(batch.discarded_at, tz), "discarded before import; staged rows removed"] }, source);
  }

  if (batch.status === "committed" || batch.status === "committing") {
    const check = await supabase.rpc("migration_rollback_check", { p_org: staff.organizationId, p_batch: batch.id });
    const reasons = Array.isArray(check.data) ? (check.data as string[]) : [];
    const pilotOnly = state === "pilot" || state === "review" || state === "signed";
    data.rollback = { attrs: reasons.length ? null : { "data-mig-act": "rollback", ...wire }, reasons, ...(pilotOnly ? { label: "Roll back the pilot" } : {}) };
  }
  return data;
}

/** The display name of the member (of this firm) who is this user, or null. */
async function memberNamesByUser(supabase: Client, org: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const member = await supabase.from("memberships").select("id").eq("organization_id", org).eq("user_id", userId).limit(1).maybeSingle();
  if (!member.data) return null;
  const names = await memberNames(supabase, org);
  return names.get(member.data.id) ?? null;
}
