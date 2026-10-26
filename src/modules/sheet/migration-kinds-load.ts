import "server-only";
import type { BalanceRow, MapRow, MatchRow, PreviewRow, SensitivityRow, SummaryRow, ValueRow } from "@/components/sheet/designer/migration";
import { memberNames } from "@/modules/sheet/chrome-load";
import { loadImportProvenance } from "@/modules/migration/provenance-load";
import { importedNote } from "@/modules/sheet/imported-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { DATE_ORDERS, type Batch, type Client, type Row } from "@/modules/sheet/migration-load";
import {
  guessDateOrder,
  hiddenValue,
  KIND_FIELDS,
  KIND_VALUE_FIELDS,
  KIND_VALUE_OPTIONS,
  kindLabel,
  money,
  plural,
  readSensitivity,
  rowResult,
  SENSITIVITY_LABELS,
  shortHash,
  suggestKindColumns,
  suggestKindValue,
  suggestSensitivity,
  type OtherKind,
  type PlanCounts,
  type Sensitivity,
} from "@/modules/sheet/migration-present";

/**
 * MIG-01: Map columns, Preview and Sign off for the import kinds other than clients and matters,
 * and the sensitivity classification for every kind. Read through RLS as the firm owner. Values of
 * a column classified sensitive are never shown: its class is shown instead.
 */

const PREVIEW_ROWS = 50;
const MATCH_ROWS = 100;
const DATE_FIELDS = ["person_birth", "related_birth", "recorded_on", "written_on", "due_on", "created_on", "date", "dated_on", "as_of"];

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** The saved classification once the mapping is saved, else suggestions from the headings. */
export function sensitivityOf(batch: Batch): Record<string, Sensitivity> {
  const mapping = batch.mapping as { columns?: unknown } | null;
  return mapping && typeof mapping === "object" && mapping.columns ? readSensitivity(batch.sensitivity) : suggestSensitivity(batch.headers);
}

export function sensitivityRows(batch: Batch, sens: Record<string, Sensitivity>): SensitivityRow[] {
  const options: [string, string][] = [["", "Not sensitive"], ...(Object.entries(SENSITIVITY_LABELS) as [string, string][])];
  return batch.headers.map((column, index) => ({
    column: column || `Column ${index + 1}`,
    select: { attrs: { "data-mig-sens": String(index) }, value: sens[String(index)] ?? "", options },
  }));
}

/** The class of the column a field is mapped to, when the owner classified it. */
export function fieldSensitivity(batch: Batch, field: string): Sensitivity | null {
  const mapping = batch.mapping as { columns?: Record<string, unknown> } | null;
  const index = mapping?.columns?.[field];
  if (typeof index !== "number") return null;
  return readSensitivity(batch.sensitivity)[String(index)] ?? null;
}

/** Whether a row problem's column (a heading) is classified sensitive. */
export function problemColumnSensitive(batch: Batch, column: string | undefined): boolean {
  const index = column ? batch.headers.indexOf(column) : -1;
  return index >= 0 && Boolean(readSensitivity(batch.sensitivity)[String(index)]);
}

type KindMapping = {
  columns?: Record<string, number | null>;
  date_order?: "dmy" | "mdy" | "ymd";
  default_owner?: string | null;
  default_date_kind?: string | null;
  values?: Record<string, Record<string, string>>;
};

export async function kindMapData(supabase: Client, staff: SheetStaff, batch: Batch, wire: Record<string, string>) {
  const org = staff.organizationId;
  const kind = batch.kind as OtherKind;
  const fields = KIND_FIELDS[kind];
  const [firstRows, members, names] = await Promise.all([
    supabase.from("migration_rows").select("cells").eq("batch_id", batch.id).order("row_number").limit(20),
    supabase
      .from("memberships")
      .select("id, role")
      .eq("organization_id", org)
      .eq("status", "active")
      .in("role", ["case_manager", "licensed_consultant", "firm_owner", "assistant"]),
    memberNames(supabase, org),
  ]);
  const samples = (firstRows.data ?? []).map((row) => row.cells as string[]);
  const sens = sensitivityOf(batch);
  const sampleOf = (index: number) =>
    sens[String(index)] ? hiddenValue(sens[String(index)]) : samples.map((cells) => (cells[index] ?? "").trim()).find(Boolean) ?? "—";
  const mapping = (batch.mapping ?? {}) as KindMapping;
  const saved = mapping.columns && Object.keys(mapping.columns).length ? mapping : null;
  const columns: Record<string, number | null> = saved?.columns ?? suggestKindColumns(kind, batch.headers);
  const fieldAt = new Map<number, string>();
  for (const [field, index] of Object.entries(columns)) if (typeof index === "number") fieldAt.set(index, field);
  const dateSamples = DATE_FIELDS.flatMap((field) => {
    const index = columns[field];
    return typeof index === "number" ? samples.map((cells) => cells[index] ?? "") : [];
  });
  const guess = guessDateOrder(dateSamples);
  const dateOrder = saved?.date_order ?? guess.order;

  const values: ValueRow[] = [];
  const unmapped = new Map<string, number>();
  for (const field of KIND_VALUE_FIELDS[kind]) {
    const index = columns[field];
    if (typeof index !== "number") continue;
    const result = await supabase.rpc("migration_column_values", { p_org: org, p_batch: batch.id, p_column: index });
    const list = (Array.isArray(result.data) ? result.data : []) as { key: string; value: string; rows: number }[];
    let missing = 0;
    for (const item of list) {
      const value = saved?.values?.[field]?.[item.key] ?? suggestKindValue(field, item.key) ?? "";
      if (!value) missing++;
      values.push({
        column: batch.headers[index] || `Column ${index + 1}`,
        value: item.value,
        rows: plural(item.rows, "row"),
        select: { attrs: { "data-mig-val": field, "data-key": item.key }, value, options: [["", "Needs review"], ...(KIND_VALUE_OPTIONS[field] ?? [])] },
      });
    }
    unmapped.set(field, missing);
  }

  const fieldOptions: [string, string][] = [
    ["", "Not imported"],
    ...fields.map(({ field, label, required }) => [field, `${label[0]} · ${label[1]}${required ? " (required)" : ""}`] as [string, string]),
  ];
  const rows: MapRow[] = batch.headers.map((column, index) => {
    const field = fieldAt.get(index) ?? null;
    const entry = field ? fields.find((item) => item.field === field) : undefined;
    let check: MapRow["check"] = field ? "OK" : "Not imported";
    if (field && DATE_FIELDS.includes(field)) check = saved ? "Date order confirmed" : guess.certain ? "Date order from your dates" : "Check the date order below";
    if (field === "reference") check = "Your Casevoya reference, or the old reference from your client import";
    if (field === "person" || field === "related") check = "Found among your clients by email, or by name";
    if (field === "assignee") check = "Found among your team by sign-in email";
    if (field === "file") check = "Found in the ZIP by name or path";
    const missing = field ? unmapped.get(field) ?? 0 : 0;
    if (missing) check = { tone: "chg", label: `${plural(missing, "value")} to map below` };
    return {
      column: column || `Column ${index + 1}`,
      sample: sampleOf(index),
      field: entry ? entry.label : null,
      check,
      select: { attrs: { "data-mig-col": String(index) }, value: field ?? "", options: fieldOptions },
    };
  });
  const staffOptions: [string, string][] = [["", "Choose…"], ...(members.data ?? []).map((row) => [row.id, names.get(row.id) ?? "Unassigned"] as [string, string])];
  const settings = {
    dateOrder: { attrs: { "data-mig-date": "1" }, value: dateOrder, options: DATE_ORDERS },
    owner: kind === "tasks" ? { attrs: { "data-mig-owner": "1" }, value: saved?.default_owner ?? "", options: staffOptions } : null,
    dateKind:
      kind === "key_dates"
        ? { attrs: { "data-mig-datekind": "1" }, value: saved?.default_date_kind ?? "", options: [["", "Choose…"], ...KIND_VALUE_OPTIONS.date_kind] as [string, string][] }
        : null,
  };
  return {
    rows,
    next: { attrs: { "data-mig-act": "map", ...wire } },
    settings,
    values,
    sensitivity: sensitivityRows(batch, sens),
    discard: { "data-mig-act": "discard", ...wire },
  };
}

const KIND_HEADS: Record<OtherKind, [string, string, string]> = {
  relationships: ["Person", "Related person", "Relationship"],
  notes: ["Note", "Original date", "Matter"],
  tasks: ["Task", "Due", "Matter"],
  key_dates: ["Date", "Day", "Matter"],
  documents: ["File", "Person", "Matter"],
  opening_balances: ["Balance", "As of", "Matter"],
};

const MATCH_WORDS: Record<OtherKind, [string, string]> = {
  relationships: ["An existing relationship", "The same two people and relationship"],
  notes: ["An existing note", "The same note text on the matter"],
  tasks: ["An existing task", "The same title and due date on the matter"],
  key_dates: ["An existing date", "The same label and day on the matter"],
  documents: ["An existing document", "The same file (SHA-256) for the person"],
  opening_balances: ["An existing opening balance", "The same kind, amount and as-of date on the matter"],
};

export async function kindPreviewData(supabase: Client, org: string, batch: Batch, wire: Record<string, string>) {
  const kind = batch.kind as OtherKind;
  const columns = "row_number, normalized, plan, problems, match_person_id, match_row_number, match_detail, decision, decision_target, match_record_id, match_record_table";
  const [first, matched] = await Promise.all([
    supabase.from("migration_rows").select(columns).eq("batch_id", batch.id).order("row_number").limit(PREVIEW_ROWS),
    supabase
      .from("migration_rows")
      .select(columns)
      .eq("batch_id", batch.id)
      .or("match_record_id.not.is.null,match_row_number.not.is.null")
      .order("row_number")
      .limit(MATCH_ROWS),
  ]);
  const rows = (first.data ?? []) as Row[];
  const matches = (matched.data ?? []) as Row[];
  const all = [...rows, ...matches];
  const ids = (key: string) => [...new Set(all.map((row) => text(row.normalized?.[key])).filter((id): id is string => Boolean(id)))];
  const matterIds = ids("matter_id");
  const personIds = [...new Set([...ids("person_id"), ...ids("related_id")])];
  const [matters, people] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", matterIds) : null,
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
  ]);
  const matterName = new Map((matters?.data ?? []).map((row) => [row.id, row.reference ?? row.title]));
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const hide = (field: string, value: string | null) => {
    const cls = fieldSensitivity(batch, field);
    return cls && value ? hiddenValue(cls) : value ?? "—";
  };
  const matterOf = (row: Row) => matterName.get(text(row.normalized?.matter_id) ?? "") ?? "—";
  const personOf = (row: Row, key = "person_id") => hide(key === "person_id" ? "person" : "related", personName.get(text(row.normalized?.[key]) ?? "") ?? null);
  const label = (field: string, value: unknown) => KIND_VALUE_OPTIONS[field]?.find(([key]) => key === value)?.[1].replace(/ \(.*\)$/, "") ?? null;
  const cells = (row: Row): [string, string, string] => {
    const n = row.normalized ?? {};
    switch (kind) {
      case "relationships":
        return [personOf(row), personOf(row, "related_id"), label("relationship", n.relationship) ?? "—"];
      case "notes": {
        const body = text(n.body);
        return [hide("body", body ? (body.length > 60 ? `${body.slice(0, 60)}…` : body) : null), text(n.original_on) ?? "—", matterOf(row)];
      }
      case "tasks":
        return [hide("title", text(n.title)), text(n.due_on) ?? "—", matterOf(row)];
      case "key_dates":
        return [hide("label", text(n.label)), text(n.due_on) ?? "—", matterOf(row)];
      case "documents":
        return [hide("file", text(n.file_name)), personOf(row), matterOf(row)];
      default: {
        const cents = typeof n.amount_cents === "number" ? n.amount_cents : null;
        const amount = cents != null ? `${label("balance_kind", n.balance_kind) ?? "Balance"} ${money(cents, text(n.currency) ?? "CAD")}` : null;
        return [hide("amount", amount), text(n.as_of) ?? "—", matterOf(row)];
      }
    }
  };
  const previewRows: PreviewRow[] = rows.map((row) => {
    const [a, b, c] = cells(row);
    const result = rowResult(row.plan, row.decision_target?.startsWith("row:") ? "row" : row.decision_target ? "person" : null);
    return { row: String(row.row_number), person: a, birth: b, matter: c, result: row.plan === "create" ? { ...result, label: "New record" } : result };
  });
  const editable = batch.status === "staged" || batch.status === "checked";
  const matchRows: MatchRow[] = matches
    .filter((row) => row.plan === "confirm" || row.plan === "link" || row.decision)
    .map((row) => {
      const act = (same: boolean) => ({ "data-mig-act": "decide", "data-row": String(row.row_number), "data-same": same ? "1" : "0", ...wire });
      return {
        row: String(row.row_number),
        person: cells(row)[0],
        existing: row.match_record_id ? MATCH_WORDS[kind][0] : `Row ${row.match_row_number} of this file`,
        same: MATCH_WORDS[kind][1],
        decided: row.decision === "same" ? "Same record: nothing new is created." : row.decision === "different" ? "Different: imported as its own record." : null,
        actions: editable
          ? [
              ...(row.decision === "same" ? [] : [{ label: "Same record", attrs: act(true) }]),
              ...(row.decision === "different" ? [] : [{ label: "Different", attrs: act(false) }]),
            ]
          : [],
      };
    });
  return { rows: previewRows, matches: matchRows, heads: KIND_HEADS[kind] };
}

/** The Sign off summary lines of a non-client batch before and after its import. */
export function kindSummary(batch: Batch, counts: PlanCounts | null, when: (iso: string | null) => string): SummaryRow[] {
  const kind = batch.kind as OtherKind;
  const summary: SummaryRow[] = [{ term: "Kind", value: kindLabel(kind) }];
  const sens = readSensitivity(batch.sensitivity);
  const classes = [...new Set(Object.values(sens))].map((cls) => SENSITIVITY_LABELS[cls].toLowerCase());
  if (batch.status === "committed" || batch.status === "rolled_back") {
    const done = (batch.result_counts ?? {}) as { records_created?: number; records_linked?: number; files_held?: number; not_imported?: number };
    summary.push(
      { term: "Records", value: [`${Number(done.records_created ?? 0).toLocaleString("en-CA")} new`, `${Number(done.records_linked ?? 0).toLocaleString("en-CA")} kept as existing`] },
      { term: "Not imported", value: `${plural(Number(done.not_imported ?? 0), "row")} with problems` },
    );
    if (Number(done.files_held ?? 0) > 0) summary.push({ term: "Files held", value: `${plural(Number(done.files_held), "file")} didn’t pass the upload checks` });
    summary.push({ term: "Signed off", value: when(batch.committed_at) });
  } else if (counts) {
    summary.push(
      { term: "Records", value: [`${counts.create.toLocaleString("en-CA")} new`, `${counts.link.toLocaleString("en-CA")} kept as existing`] },
      { term: "Not imported", value: `${plural(counts.problem_rows, "row")} with problems` },
    );
    if (counts.confirm) summary.push({ term: "Waiting", value: `${plural(counts.confirm, "possible duplicate")} to decide on Preview` });
  } else {
    summary.push({ term: "Plan", value: "Not checked yet: map your columns, then continue to preview" });
  }
  if (kind === "opening_balances") summary.push({ term: "Review", value: ["Each balance waits for billing staff to approve it", "nothing is posted to invoices or client accounts"] });
  if (kind === "key_dates") summary.push({ term: "Dates", value: "Imported as tentative until someone confirms each one" });
  if (kind === "documents" && batch.attachment_sha256) {
    summary.push({ term: "ZIP", value: [batch.attachment_name ?? "files.zip", `${plural(batch.attachment_files ?? 0, "file")}, ${shortHash(batch.attachment_sha256)}`] });
  }
  summary.push({ term: "Sensitive columns", value: classes.length ? `${plural(Object.keys(sens).length, "column")}: ${classes.join(", ")}` : "None classified" });
  return summary;
}

/** An opening-balances import's balances on Sign off, with Approve / Reject while pending. */
export async function balanceRows(supabase: Client, staff: SheetStaff, batch: Batch): Promise<BalanceRow[]> {
  const list = await supabase
    .from("opening_balances")
    .select("id, matter_id, kind, amount_cents, currency, as_of, status")
    .eq("organization_id", staff.organizationId)
    .eq("batch_id", batch.id)
    .order("created_at")
    .limit(200);
  const balances = list.data ?? [];
  const matterIds = [...new Set(balances.map((row) => row.matter_id))];
  const matters = matterIds.length ? await supabase.from("matters").select("id, reference, title").eq("organization_id", staff.organizationId).in("id", matterIds) : null;
  const matterName = new Map((matters?.data ?? []).map((row) => [row.id, row.reference ?? row.title]));
  // MIG follow-ups: each balance says where it came from, with its as-of date as the original date.
  const imports = await loadImportProvenance(supabase, staff.organizationId, "opening_balances", balances.map((row) => row.id));
  return balances.map((row) => ({
    key: row.id,
    matter: matterName.get(row.matter_id) ?? "—",
    imported: importedNote(imports, row.id, staff.timezone),
    kind: KIND_VALUE_OPTIONS.balance_kind.find(([value]) => value === row.kind)?.[1] ?? row.kind,
    amount: money(Number(row.amount_cents), row.currency),
    asOf: row.as_of,
    state:
      row.status === "approved"
        ? { tone: "ok", label: "Approved" }
        : row.status === "rejected"
          ? { tone: "bad", label: "Rejected" }
          : { tone: "chg", label: "Pending review" },
    actions:
      row.status === "pending_review"
        ? [
            { label: "Approve", attrs: { "data-mig-act": "review-balance", "data-org": staff.organizationId, "data-id": row.id, "data-approve": "1" } },
            { label: "Reject", attrs: { "data-mig-act": "review-balance", "data-org": staff.organizationId, "data-id": row.id, "data-approve": "0" } },
          ]
        : [],
  }));
}
