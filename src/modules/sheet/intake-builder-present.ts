/**
 * Pure helpers for the Sheet's Intake form builder: a form's versioned schema (the stored
 * intake_templates.schema, see app.intake_schema_ok) in the Designer's words, and the edits the
 * builder makes to it. Field keys are stable and never derived from a label after creation (INT-01).
 * Shared by the server page and the browser builder, so both describe a field the same way.
 */

export type IntakeField = {
  key: string;
  type: string;
  labels: Record<string, string>;
  required?: boolean;
  /** Builder hints stored in the schema: "short" or "long" text, "yes_no" choice. */
  ui?: string;
  options?: string[];
  show_when?: { field: string; equals: unknown };
  section_key?: string;
  allow_unknown?: boolean;
  allow_not_applicable?: boolean;
};

export type IntakeSchema = { fields: IntakeField[] };

/** The palette, in the Designer's order, limited to what the stored schema supports and the builder can configure. */
export const FIELD_TYPES = [
  { label: "Short text", type: "text", ui: "short" },
  { label: "Long text", type: "text", ui: "long" },
  { label: "Date", type: "date" },
  { label: "Yes / No", type: "choice", ui: "yes_no" },
  { label: "Country", type: "country" },
  { label: "Address", type: "address" },
  { label: "File upload", type: "file_request" },
  { label: "Repeating rows", type: "repeatable" },
  { label: "Declaration", type: "declaration" },
] as const;

export type FieldBadge = { tone: "gr" | "blue"; label: string };

export type FieldRow = {
  key: string;
  label: string;
  typeLabel: string;
  note: string;
  conditional: boolean;
  badge: FieldBadge | null;
};

/** The section key that lets the other people on a matter (a sponsor too) see an answer. */
export const SHARED_SECTION = "shared_family_record";

export function fieldLabel(field: IntakeField, locale = "en-CA"): string {
  return field.labels?.[locale] || field.labels?.["en-CA"] || field.labels?.["fr-CA"] || field.key;
}

export function typeLabel(field: IntakeField): string {
  if (field.type === "text") return field.ui === "long" ? "Long text" : "Short text";
  if (field.type === "choice") return field.ui === "yes_no" ? "Yes / No" : "Choice";
  const known: Record<string, string> = {
    date: "Date",
    country: "Country",
    address: "Address",
    file_request: "File upload",
    repeatable: "Repeating rows",
    declaration: "Declaration",
    relationship: "Relationship",
  };
  return known[field.type] ?? field.type;
}

/** A field with no flag keeps the original rule: Unknown and Not applicable are accepted. */
export function allowsUnknown(field: IntakeField): boolean {
  return field.allow_unknown !== false;
}

export function allowsNotApplicable(field: IntakeField): boolean {
  return field.allow_not_applicable !== false;
}

function equalsText(value: unknown): string {
  if (value === true || value === "yes") return "Yes";
  if (value === false || value === "no") return "No";
  return String(value);
}

export function fieldRow(field: IntakeField, locale = "en-CA"): FieldRow {
  const conditional = Boolean(field.show_when);
  const badge: FieldBadge | null = conditional
    ? { tone: "blue", label: "Conditional" }
    : field.allow_unknown === true
      ? { tone: "gr", label: "Unknown allowed" }
      : field.allow_not_applicable === true
        ? { tone: "gr", label: "N/A allowed" }
        : null;
  return {
    key: field.key,
    label: fieldLabel(field, locale),
    typeLabel: typeLabel(field),
    note: conditional ? `Shows if “${equalsText(field.show_when?.equals)}” above` : field.required ? "Required" : "Optional",
    conditional,
    badge,
  };
}

/** The four switches in Field settings, in the Designer's order. */
export function fieldToggles(field: IntakeField): { label: string; on: boolean }[] {
  return [
    { label: "Required", on: Boolean(field.required) },
    { label: "Allow “Unknown”", on: allowsUnknown(field) },
    { label: "Allow “Not applicable”", on: allowsNotApplicable(field) },
    { label: "Show to sponsor", on: field.section_key === SHARED_SECTION },
  ];
}

/** Flips one switch (0..3) on a field. */
export function toggleField(field: IntakeField, index: number): IntakeField {
  if (index === 0) return { ...field, required: !field.required };
  if (index === 1) return { ...field, allow_unknown: !allowsUnknown(field) };
  if (index === 2) return { ...field, allow_not_applicable: !allowsNotApplicable(field) };
  if (index === 3) {
    const next = { ...field };
    if (field.section_key === SHARED_SECTION) delete next.section_key;
    else next.section_key = SHARED_SECTION;
    return next;
  }
  return field;
}

/** A key that is not used yet: "question_1", "question_2"… Keys stay fixed once created. */
export function nextKey(fields: readonly IntakeField[]): string {
  const used = new Set(fields.map((field) => field.key));
  let n = fields.length + 1;
  while (used.has(`question_${n}`)) n++;
  return `question_${n}`;
}

export function newField(label: string, fields: readonly IntakeField[], locale = "en-CA"): IntakeField | null {
  const kind = FIELD_TYPES.find((item) => item.label === label);
  if (!kind) return null;
  const field: IntakeField = {
    key: nextKey(fields),
    type: kind.type,
    labels: { [locale]: "New question" },
    required: false,
    allow_unknown: false,
    allow_not_applicable: false,
  };
  const ui = "ui" in kind ? kind.ui : undefined;
  if (ui) field.ui = ui;
  if (ui === "yes_no") field.options = ["yes", "no"];
  return field;
}

export function relabel(field: IntakeField, label: string, locale = "en-CA"): IntakeField {
  return { ...field, labels: { ...field.labels, [locale]: label.slice(0, 300) } };
}

export type TemplateRow = {
  id: string;
  stableKey: string;
  versionNumber: number;
  status: string;
  title: string;
  schema: unknown;
  updatedAt: string;
  effectiveOn: string | null;
  version: number;
};

export type BuilderPage = {
  title: string;
  pills: (string | { left: string; right: string })[];
  publishLabel: string;
  section: { left: string; right: string };
  rows: (FieldRow & { selected: boolean })[];
  settings: { label: string; toggles: { label: string; on: boolean }[] };
  live: { stableKey: string; title: string; templateId: string | null; version: number | null; status: "draft" | "published" | "new"; schema: string };
};

const DEFAULT_KEY = "intake_form";
const DEFAULT_TITLE = "Intake form";

function dayMonthOf(date: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${months[month - 1]}`;
}

function since(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "autosaved just now";
  if (minutes < 60) return `autosaved ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `autosaved ${hours} h ago`;
  return `saved ${Math.round(hours / 24)} d ago`;
}

/**
 * The form the builder shows: the chosen stable key (or the most recently changed form), as its
 * draft when there is one, else its published version (read as the start of the next draft).
 */
export function builderPage(templates: readonly TemplateRow[], usage: ReadonlyMap<string, number>, choice: { form?: string; field?: string }, now: Date): BuilderPage {
  const recent = [...templates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const key = choice.form && templates.some((row) => row.stableKey === choice.form) ? choice.form : recent[0]?.stableKey;
  const versions = templates.filter((row) => row.stableKey === key).sort((a, b) => b.versionNumber - a.versionNumber);
  const draft = versions.find((row) => row.status === "draft") ?? null;
  const published = versions.find((row) => row.status === "published") ?? null;
  const current = draft ?? published ?? versions[0] ?? null;
  const fields = readSchema(current?.schema).fields;
  const selectedKey = fields.some((field) => field.key === choice.field) ? choice.field : fields[0]?.key;
  const selected = fields.find((field) => field.key === selectedKey) ?? null;
  const used = key ? (usage.get(key) ?? 0) : 0;
  const nextVersion = (versions[0]?.versionNumber ?? 0) + (draft ? 0 : 1);
  const state = draft
    ? { left: "Draft", right: since(draft.updatedAt, now) }
    : published
      ? { left: "Published", right: published.effectiveOn ? `in effect from ${dayMonthOf(published.effectiveOn)}` : "in effect" }
      : current
        ? { left: "Superseded", right: "edit to start a new draft" }
        : { left: "New form", right: "add a field to start" };
  return {
    title: current ? `${current.title} v${current.versionNumber}` : DEFAULT_TITLE,
    pills: [state, `Used by ${used} matter${used === 1 ? "" : "s"}`],
    publishLabel: `Publish v${draft ? draft.versionNumber : nextVersion}`,
    section: { left: current?.title ?? DEFAULT_TITLE, right: `${fields.length} field${fields.length === 1 ? "" : "s"}` },
    rows: fields.map((field) => ({ ...fieldRow(field), selected: field.key === selectedKey })),
    settings: selected ? { label: fieldLabel(selected), toggles: fieldToggles(selected) } : { label: "", toggles: fieldToggles({ key: "", type: "text", labels: {} }).map((toggle) => ({ ...toggle, on: false })) },
    live: {
      stableKey: key ?? DEFAULT_KEY,
      title: current?.title ?? DEFAULT_TITLE,
      templateId: draft?.id ?? null,
      version: draft?.version ?? null,
      status: draft ? "draft" : current ? "published" : "new",
      schema: JSON.stringify({ fields }),
    },
  };
}

export function readSchema(value: unknown): IntakeSchema {
  const fields = (value as { fields?: unknown } | null)?.fields;
  return { fields: Array.isArray(fields) ? (fields.filter((field) => field && typeof field === "object" && typeof (field as IntakeField).key === "string") as IntakeField[]) : [] };
}
