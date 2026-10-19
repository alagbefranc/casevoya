import "server-only";
import type {
  ErrorRow,
  HistoryRow,
  MapRow,
  MatchRow,
  MigrationData,
  MigrationHeaderData,
  MigrationTab,
  PreviewRow,
  SelectData,
  SummaryRow,
  ValueRow,
} from "@/components/sheet/designer/migration";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { loadNewMatterDialog } from "@/modules/sheet/matters-load";
import {
  guessDateOrder,
  MIGRATION_FIELDS,
  planCounts,
  plural,
  ROLE_LABELS,
  rowResult,
  shortHash,
  STAGE_LABELS,
  suggestColumns,
  suggestValue,
  VALUE_FIELDS,
  type MigrationField,
  type MigrationMapping,
  type ValueField,
} from "@/modules/sheet/migration-present";
import type { SheetQuery } from "@/modules/sheet/present";

const TABS = new Set<MigrationTab>(["map", "preview", "errors", "signoff"]);
const OPEN = new Set(["staged", "checked", "committing"]);
const PREVIEW_ROWS = 50;
const ERROR_ROWS = 200;
const MATCH_ROWS = 100;

type Batch = {
  id: string;
  file_name: string;
  status: string;
  is_sample: boolean;
  source_sha256: string;
  source_row_count: number;
  staged_row_count: number;
  verified_at: string | null;
  headers: string[];
  mapping: unknown;
  plan_counts: unknown;
  result_counts: unknown;
  exceptions: unknown;
  created_at: string;
  committed_at: string | null;
  rolled_back_at: string | null;
  discarded_at: string | null;
  staging_purged_at: string | null;
};

type Row = {
  row_number: number;
  normalized: Record<string, unknown> | null;
  plan: string | null;
  problems: { column?: string; problem?: string; fix?: string }[] | null;
  match_person_id: string | null;
  match_row_number: number | null;
  match_detail: string[] | null;
  decision: string | null;
  decision_target: string | null;
};

const STATE: Record<string, { tone: "ok" | "chg" | "bad" | "unv" | "blue"; label: string }> = {
  staged: { tone: "chg", label: "Mapping" },
  checked: { tone: "blue", label: "Checked" },
  committing: { tone: "chg", label: "Importing" },
  committed: { tone: "ok", label: "Imported" },
  rolled_back: { tone: "unv", label: "Rolled back" },
  discarded: { tone: "unv", label: "Discarded" },
};

const DATE_ORDERS: [string, string][] = [
  ["dmy", "Day / month / year (09/03/1984)"],
  ["mdy", "Month / day / year (03/09/1984)"],
  ["ymd", "Year-month-day only (1984-03-09)"],
];

function day(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readMapping(value: unknown): MigrationMapping | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<MigrationMapping>;
  if (!record.columns || typeof record.columns !== "object" || record.columns.name == null) return null;
  return {
    columns: record.columns,
    date_order: record.date_order ?? "dmy",
    default_consultant: record.default_consultant ?? null,
    values: record.values ?? {},
  };
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The Designer's Migration import page for a firm owner, read through RLS (owner only). */
export async function loadSheetMigration(staff: SheetStaff, query: SheetQuery) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const tab: MigrationTab = TABS.has(query.tab as MigrationTab) ? (query.tab as MigrationTab) : "map";
  const chrome = await loadSheetChrome(staff, "/sheet/migration");

  if (staff.role !== "firm_owner") {
    const page: MigrationData = {
      tab,
      empty: { title: "Only the firm owner imports records", copy: "An import brings client records in from another system, so only the firm owner can see and run one." },
    };
    return { chrome, header: { tab, pill: null } satisfies MigrationHeaderData, page };
  }

  const all = await supabase
    .from("migration_batches")
    .select(
      "id, file_name, status, is_sample, source_sha256, source_row_count, staged_row_count, verified_at, headers, mapping, plan_counts, result_counts, exceptions, created_at, committed_at, rolled_back_at, discarded_at, staging_purged_at",
    )
    .eq("organization_id", org)
    .order("created_at", { ascending: true })
    .limit(200);
  const batches = (all.data ?? []) as Batch[];
  const open = batches.find((batch) => OPEN.has(batch.status)) ?? null;
  const chosen = query.id && isUuid(query.id) ? batches.find((batch) => batch.id === query.id) : undefined;
  const current = chosen ?? open ?? batches[batches.length - 1] ?? null;
  const header: MigrationHeaderData = {
    tab,
    pill: current ? [`Import ${batches.indexOf(current) + 1} of ${batches.length}`, current.file_name] : null,
  };
  const wire: Record<string, string> = current ? { "data-org": org, "data-batch": current.id } : { "data-org": org };
  const history: HistoryRow[] = [...batches].reverse().map((batch) => ({
    key: batch.id,
    file: batch.file_name,
    when: day(batch.created_at, staff.timezone),
    rows: plural(batch.source_row_count, "row"),
    state: STATE[batch.status] ?? STATE.staged,
    href: `/sheet/migration?tab=signoff&id=${batch.id}`,
  }));

  const page: MigrationData = { tab };
  const staging = current && !current.staging_purged_at ? current : null;
  const counts = current ? planCounts(current.plan_counts) : null;
  const nothing = { title: "No import yet", copy: "Choose a CSV file on Map columns. Nothing goes live until you sign off." };

  if (tab === "map") {
    if (!open) {
      page.upload = { attrs: { "data-mig-act": "upload", "data-org": org } };
    } else if (current?.id !== open.id) {
      page.empty = { title: "Another import is open", copy: "Its columns are on this tab once you open it. Finish or discard it before starting another." };
    } else if (open.status === "committing" || open.staging_purged_at) {
      page.empty = { title: "This import is being created", copy: "Go to Sign off to continue it, or to roll back what was created." };
    } else {
      page.map = await mapData(supabase, staff, open, wire);
    }
    return { chrome, header, page };
  }

  if (!current) {
    page.empty = nothing;
    if (tab === "signoff") page.signoff = null;
    return { chrome, header, page };
  }

  if (tab === "preview") {
    if (!staging || !counts) {
      page.empty = staging
        ? { title: "Not checked yet", copy: "Map your columns, then choose Continue to preview." }
        : { title: "The preview isn’t kept", copy: "Staged rows are removed once an import is done. Sign off shows what was created." };
      return { chrome, header, page };
    }
    page.preview = await previewData(supabase, org, current, wire);
    return { chrome, header, page };
  }

  if (tab === "errors") {
    page.errors = await errorsData(supabase, current, staging, counts);
    if (!page.errors) {
      page.empty =
        current.status === "discarded"
          ? { title: "This import was discarded", copy: "Nothing from it was imported, and its staged rows were removed." }
          : { title: "Not checked yet", copy: "Map your columns, then choose Continue to preview." };
    }
    return { chrome, header, page };
  }

  page.signoff = await signoffData(supabase, staff, current, counts, wire, history);
  return { chrome, header, page };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function valueOptions(supabase: Client, staff: SheetStaff) {
  const [dialog, members, names] = await Promise.all([
    loadNewMatterDialog(supabase, staff),
    supabase.from("memberships").select("id, role").eq("organization_id", staff.organizationId).eq("status", "active").in("role", ["case_manager", "licensed_consultant", "firm_owner"]),
    memberNames(supabase, staff.organizationId),
  ]);
  const staffOptions = (members.data ?? []).map((row) => ({ value: row.id, label: names.get(row.id) ?? "Unassigned" }));
  return {
    consultants: dialog.consultants,
    programs: dialog.programs,
    staff: staffOptions,
  };
}

async function mapData(supabase: Client, staff: SheetStaff, batch: Batch, wire: Record<string, string>) {
  const org = staff.organizationId;
  const [firstRows, options] = await Promise.all([
    supabase.from("migration_rows").select("cells").eq("batch_id", batch.id).order("row_number").limit(20),
    valueOptions(supabase, staff),
  ]);
  const samples = (firstRows.data ?? []).map((row) => row.cells as string[]);
  const sampleOf = (index: number) => samples.map((cells) => (cells[index] ?? "").trim()).find(Boolean) ?? "—";
  const saved = readMapping(batch.mapping);
  const suggested = suggestColumns(batch.headers);
  const columns: Partial<Record<MigrationField, number | null>> = saved?.columns ?? suggested;
  const fieldAt = new Map<number, MigrationField>();
  for (const [field, index] of Object.entries(columns)) if (typeof index === "number") fieldAt.set(index, field as MigrationField);
  const dobIndex = columns.date_of_birth;
  const guess = guessDateOrder(typeof dobIndex === "number" ? samples.map((cells) => cells[dobIndex] ?? "") : []);
  const dateOrder = saved?.date_order ?? guess.order;

  // Distinct values of each mapped value column, with the saved or an exact-match suggestion.
  const values: ValueRow[] = [];
  const unmapped = new Map<ValueField, number>();
  const optionsFor = (field: ValueField): [string, string][] => {
    const review: [string, string] = ["", "Needs review"];
    const none: [string, string] = ["none", "Not imported"];
    // "none" for a program keeps the matter and leaves its program to choose later.
    if (field === "program") return [review, ["none", "No program yet (choose it on the matter)"], ...options.programs.map((option) => [option.value, option.label] as [string, string])];
    if (field === "stage") return [review, none, ...Object.entries(STAGE_LABELS)];
    if (field === "consultant") return [review, ...options.consultants.map((option) => [option.value, option.label] as [string, string])];
    if (field === "case_manager") return [review, none, ...options.staff.map((option) => [option.value, option.label] as [string, string])];
    return [review, none, ...Object.entries(ROLE_LABELS)];
  };
  const suggestionOptions = (field: ValueField) => {
    if (field === "program") return options.programs.map((option) => ({ value: option.value, label: option.label.split(" · ")[0] }));
    if (field === "stage") return Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }));
    if (field === "consultant") return options.consultants.map((option) => ({ value: option.value, label: option.label.replace(/ \(.*\)$/, "") }));
    if (field === "case_manager") return options.staff;
    return [];
  };
  for (const field of VALUE_FIELDS) {
    const index = columns[field];
    if (typeof index !== "number") continue;
    const result = await supabase.rpc("migration_column_values", { p_org: org, p_batch: batch.id, p_column: index });
    const list = (Array.isArray(result.data) ? result.data : []) as { key: string; value: string; rows: number }[];
    const choices = optionsFor(field);
    let missing = 0;
    for (const item of list) {
      const savedValue = saved?.values[field]?.[item.key];
      const value = savedValue ?? suggestValue(field, item.key, suggestionOptions(field)) ?? "";
      if (!value) missing++;
      values.push({
        column: batch.headers[index] || `Column ${index + 1}`,
        value: item.value,
        rows: plural(item.rows, "row"),
        select: { attrs: { "data-mig-val": field, "data-key": item.key }, value, options: choices },
      });
    }
    unmapped.set(field, missing);
  }

  const fieldOptions: [string, string][] = [["", "Not imported"], ...MIGRATION_FIELDS.map(({ field, label }) => [field, `${label[0]} · ${label[1]}`] as [string, string])];
  const orderLabel = dateOrder === "mdy" ? "Month/day" : dateOrder === "ymd" ? "Year-first" : "Day/month";
  const rows: MapRow[] = batch.headers.map((column, index) => {
    const field = fieldAt.get(index) ?? null;
    const label = field ? MIGRATION_FIELDS.find((entry) => entry.field === field)?.label ?? null : null;
    let check: MapRow["check"] = field ? "OK" : "Not imported";
    if (field === "date_of_birth") check = saved ? `${orderLabel} order confirmed` : guess.certain ? `${orderLabel} order (from your dates)` : "Check the date order below";
    if (field === "reference") check = "Groups rows into one matter; kept on the import record";
    if (field === "stage") check = "Kept on the import record; matters start at engagement pending";
    if (field === "name_extra") check = "Joined after the legal name with a space";
    if (field && (VALUE_FIELDS as readonly string[]).includes(field)) {
      const missing = unmapped.get(field as ValueField) ?? 0;
      if (missing) check = { tone: "chg", label: `${plural(missing, "value")} to map below` };
    }
    // No published program template to map to: say so instead of offering only "no program".
    if (field === "program" && options.programs.length === 0) check = { tone: "chg", label: "No program templates published yet: matters import without one" };
    return {
      column: column || `Column ${index + 1}`,
      sample: sampleOf(index),
      field: label,
      check,
      select: { attrs: { "data-mig-col": String(index) }, value: field ?? "", options: fieldOptions },
    };
  });
  const consultantChoices: [string, string][] = [["", "Choose…"], ...options.consultants.map((option) => [option.value, option.label] as [string, string])];
  const settings: { dateOrder: SelectData; consultant: SelectData } = {
    dateOrder: { attrs: { "data-mig-date": "1" }, value: dateOrder, options: DATE_ORDERS },
    consultant: { attrs: { "data-mig-default": "1" }, value: saved?.default_consultant ?? "", options: consultantChoices },
  };
  return {
    rows,
    next: { attrs: { "data-mig-act": "map", ...wire } },
    settings,
    values,
    discard: { "data-mig-act": "discard", ...wire },
  };
}

async function previewData(supabase: Client, org: string, batch: Batch, wire: Record<string, string>) {
  const columns = "row_number, normalized, plan, problems, match_person_id, match_row_number, match_detail, decision, decision_target";
  const [first, matched] = await Promise.all([
    supabase.from("migration_rows").select(columns).eq("batch_id", batch.id).order("row_number").limit(PREVIEW_ROWS),
    supabase
      .from("migration_rows")
      .select(columns)
      .eq("batch_id", batch.id)
      .or("match_person_id.not.is.null,match_row_number.not.is.null")
      .order("row_number")
      .limit(MATCH_ROWS),
  ]);
  const rows = (first.data ?? []) as Row[];
  const matches = (matched.data ?? []) as Row[];
  const personIds = [...new Set(matches.map((row) => row.match_person_id).filter((id): id is string => Boolean(id)))];
  const people = personIds.length ? await supabase.from("persons").select("id, display_name, created_at").eq("organization_id", org).in("id", personIds) : null;
  const personName = new Map((people?.data ?? []).map((row) => [row.id, `${row.display_name} (client since ${row.created_at.slice(0, 4)})`]));
  const name = (row: Row) => text(row.normalized?.name) ?? "—";
  const previewRows: PreviewRow[] = rows.map((row) => ({
    row: String(row.row_number),
    person: name(row),
    birth: text(row.normalized?.date_of_birth) ?? "—",
    matter: text(row.normalized?.reference) ?? "—",
    result: rowResult(row.plan, row.decision_target?.startsWith("row:") ? "row" : row.decision_target ? "person" : null),
  }));
  const editable = batch.status === "staged" || batch.status === "checked";
  const matchRows: MatchRow[] = matches
    .filter((row) => row.plan === "confirm" || row.plan === "link" || row.decision)
    .map((row) => {
      const act = (same: boolean) => ({ "data-mig-act": "decide", "data-row": String(row.row_number), "data-same": same ? "1" : "0", ...wire });
      return {
        row: String(row.row_number),
        person: name(row),
        existing: row.match_person_id
          ? personName.get(row.match_person_id) ?? "A client record you can’t open"
          : `Row ${row.match_row_number} of this file`,
        same: row.match_detail?.length ? `Same ${joinWords(row.match_detail)}` : "—",
        decided: row.decision === "same" ? "Same person." : row.decision === "different" ? "Different people." : null,
        actions: editable
          ? [
              ...(row.decision === "same" ? [] : [{ label: "Same person", attrs: act(true) }]),
              ...(row.decision === "different" ? [] : [{ label: "Different people", attrs: act(false) }]),
            ]
          : [],
      };
    });
  return { rows: previewRows, matches: matchRows };
}

async function errorsData(supabase: Client, batch: Batch, staging: Batch | null, counts: ReturnType<typeof planCounts>) {
  if (staging && counts) {
    const problem = await supabase
      .from("migration_rows")
      .select("row_number, problems")
      .eq("batch_id", batch.id)
      .in("plan", ["error", "review", "skip"])
      .order("row_number")
      .limit(ERROR_ROWS);
    const rows: ErrorRow[] = ((problem.data ?? []) as Pick<Row, "row_number" | "problems">[]).flatMap((row) =>
      (row.problems ?? []).map((item) => ({ row: String(row.row_number), column: item.column ?? "—", problem: item.problem ?? "", fix: item.fix ?? "" })),
    );
    const ready = counts.create + counts.link;
    const waiting = counts.confirm ? ` ${plural(counts.confirm, "row")} wait for a decision on Preview.` : "";
    if (!counts.problem_rows) return { ok: true, title: "No row has a problem", copy: `${plural(ready, "row")} ${ready === 1 ? "is" : "are"} ready.${waiting}`, rows: [] };
    return {
      title: `${counts.problem_rows.toLocaleString("en-CA")} of ${plural(counts.rows, "row")} ${counts.problem_rows === 1 ? "has" : "have"} problems`,
      copy: `${plural(ready, "row")} ${ready === 1 ? "is" : "are"} ready.${waiting}${counts.problem_rows > ERROR_ROWS ? ` The first ${ERROR_ROWS} are listed.` : ""}`,
      rows,
    };
  }
  if (batch.status === "committed" || batch.status === "committing" || batch.status === "rolled_back") {
    const report = (Array.isArray(batch.exceptions) ? batch.exceptions : []) as { row?: number; column?: string; problem?: string; fix?: string }[];
    const done = (batch.result_counts ?? {}) as { rows?: number; not_imported?: number };
    const skipped = Number(done.not_imported ?? 0);
    return {
      ok: skipped === 0,
      title: skipped ? `${skipped.toLocaleString("en-CA")} of ${plural(Number(done.rows ?? batch.source_row_count), "row")} weren’t imported` : "Every row was imported",
      copy: "This report is kept with the import. Values from your file aren’t kept.",
      rows: report.slice(0, ERROR_ROWS).map((item) => ({ row: String(item.row ?? "—"), column: item.column ?? "—", problem: item.problem ?? "", fix: item.fix ?? "" })),
    };
  }
  return null;
}

async function signoffData(
  supabase: Client,
  staff: SheetStaff,
  batch: Batch,
  counts: ReturnType<typeof planCounts>,
  wire: Record<string, string>,
  history: HistoryRow[],
) {
  const summary: SummaryRow[] = [];
  const source: SummaryRow = { term: "Source file", value: [batch.file_name, shortHash(batch.source_sha256)] };
  const checked: SummaryRow = {
    term: "Rows checked",
    value: batch.verified_at
      ? [`${plural(batch.source_row_count, "row")} in the file`, `${batch.staged_row_count.toLocaleString("en-CA")} staged, checksum matches`]
      : [`${plural(batch.source_row_count, "row")} in the file`, "not verified"],
  };
  let action: { label: string; attrs: Record<string, string> } | null = null;
  let rollback: { attrs: Record<string, string> | null; reasons: string[] } | null = null;

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
    const ready = batch.status === "checked" && counts && !counts.confirm && counts.matters > 0;
    action = { label: "Sign off and import", attrs: { "data-mig-act": "commit", ...wire, ...(ready ? {} : { disabled: "" }) } };
  } else if (batch.status === "committing") {
    summary.push({ term: "Status", value: "Being created. Continue it, or roll back what was created." }, source, checked);
    action = { label: "Continue the import", attrs: { "data-mig-act": "commit", ...wire } };
  } else if (batch.status === "committed" || batch.status === "rolled_back") {
    const done = (batch.result_counts ?? {}) as { matters?: number; people_created?: number; people_linked?: number; not_imported?: number };
    summary.push(
      { term: "People", value: [`${Number(done.people_created ?? 0).toLocaleString("en-CA")} new`, `${Number(done.people_linked ?? 0).toLocaleString("en-CA")} linked to existing`] },
      { term: "Matters", value: [Number(done.matters ?? 0).toLocaleString("en-CA"), "created at engagement pending"] },
      { term: "Not imported", value: `${plural(Number(done.not_imported ?? 0), "row")} with problems` },
      source,
      { term: "Signed off", value: day(batch.committed_at, staff.timezone) },
    );
    if (batch.is_sample) summary.push({ term: "Sample mode", value: "Imported as sample records" });
    if (batch.status === "rolled_back") summary.push({ term: "Rolled back", value: [day(batch.rolled_back_at, staff.timezone), "the import’s records were removed"] });
  } else {
    summary.push({ term: "Status", value: [day(batch.discarded_at, staff.timezone), "discarded before import; staged rows removed"] }, source);
  }

  if (batch.status === "committed" || batch.status === "committing") {
    const check = await supabase.rpc("migration_rollback_check", { p_org: staff.organizationId, p_batch: batch.id });
    const reasons = Array.isArray(check.data) ? (check.data as string[]) : [];
    rollback = { attrs: reasons.length ? null : { "data-mig-act": "rollback", ...wire }, reasons };
  }
  return { summary, action, rollback, history };
}
