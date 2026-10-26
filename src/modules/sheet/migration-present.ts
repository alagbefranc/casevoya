/**
 * Pure helpers for the Sheet's Migration import page (T044, PRD §25): the Casevoya fields a column
 * can map to, suggestions the owner confirms, the words for each row's plan, and how a database
 * refusal reads. The database plans and decides every row (app.migration_evaluate).
 */
import { safeAccessError } from "@/lib/auth/step-up";
import { mixedFileMessage } from "@/modules/migration/one-kind";

export type MigrationField =
  | "name"
  | "name_extra"
  | "email"
  | "date_of_birth"
  | "phone"
  | "role"
  | "reference"
  | "title"
  | "program"
  | "stage"
  | "consultant"
  | "case_manager";

/** The Designer's "Casevoya field" words: entity, then field. */
export const MIGRATION_FIELDS: { field: MigrationField; label: [string, string] }[] = [
  { field: "name", label: ["Person", "legal name"] },
  // A second name column (last name after first name): joined to the legal name with a space.
  { field: "name_extra", label: ["Person", "legal name, second part (joined after)"] },
  { field: "date_of_birth", label: ["Person", "date of birth"] },
  { field: "email", label: ["Person", "email"] },
  { field: "phone", label: ["Person", "phone"] },
  { field: "role", label: ["Person", "role on the matter"] },
  { field: "reference", label: ["Matter", "old reference"] },
  { field: "title", label: ["Matter", "title"] },
  { field: "program", label: ["Matter", "program"] },
  { field: "stage", label: ["Matter", "stage"] },
  { field: "consultant", label: ["Matter", "responsible consultant"] },
  { field: "case_manager", label: ["Matter", "case manager"] },
];

/** Fields whose source values map to configured values. */
export const VALUE_FIELDS = ["program", "stage", "consultant", "case_manager", "role"] as const;
export type ValueField = (typeof VALUE_FIELDS)[number];

export type MigrationMapping = {
  columns: Partial<Record<MigrationField, number | null>>;
  date_order: DateOrder;
  default_consultant: string | null;
  values: Partial<Record<ValueField, Record<string, string>>>;
};

export type DateOrder = "dmy" | "mdy" | "ymd";

const HINTS: Record<MigrationField, RegExp> = {
  name: /^(full |legal |client |applicant |person |first |given )?name$|^first ?name$|^given ?names?$|^client$|^applicant$|^person$/i,
  name_extra: /^(last|family|sur) ?name$|^surname$/i,
  email: /e-?mail/i,
  date_of_birth: /^(dob|d\.o\.b\.?|date of birth|birth ?date|birthday|born)$/i,
  phone: /phone|mobile|cell|^tel/i,
  role: /^(role|relationship|party|participant)$/i,
  reference: /file ?#|file (no|number|ref)|^ref|reference|case ?(#|no|number|id)|matter ?(#|no|number|id)/i,
  title: /^(matter|case) ?(title|name)$/i,
  program: /program|stream|category|application type|visa type/i,
  stage: /^(status|stage|phase)$/i,
  consultant: /consultant|rcic|responsible|lawyer|advisor|adviser/i,
  case_manager: /case ?manager|assigned to|handler|^owner$/i,
};

/** Which column (index) each field likely comes from, by its heading. Each column is used once. */
export function suggestColumns(headers: readonly string[]): Partial<Record<MigrationField, number>> {
  const used = new Set<number>();
  const result: Partial<Record<MigrationField, number>> = {};
  const order: MigrationField[] = ["email", "date_of_birth", "phone", "case_manager", "consultant", "reference", "title", "program", "stage", "role", "name_extra", "name"];
  for (const field of order) {
    const index = headers.findIndex((header, i) => !used.has(i) && HINTS[field].test(header.trim()));
    if (index >= 0) {
      used.add(index);
      result[field] = index;
    }
  }
  return result;
}

/**
 * The date order the samples allow. A first part over 12 means day first; a second part over 12
 * means month first; four digits first is ISO. Otherwise day first, and the owner confirms.
 */
export function guessDateOrder(samples: readonly string[]): { order: DateOrder; certain: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  let iso = 0;
  let other = 0;
  for (const sample of samples) {
    const value = sample.trim();
    if (!value) continue;
    // ISO dates (year first, optionally with a time) are unambiguous: they never vote for an order.
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
      iso++;
      continue;
    }
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}$/.exec(value);
    if (!match) continue;
    other++;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { order: "dmy", certain: true };
  if (monthFirst && !dayFirst) return { order: "mdy", certain: true };
  // Only ISO dates in the column: year first, and nothing to confirm.
  if (iso && other === 0) return { order: "ymd", certain: true };
  return { order: "dmy", certain: false };
}

/** A source value as the database keys it (app.migration_key). */
export function valueKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

const ROLE_WORDS = new Set(["applicant", "dependant", "sponsor", "employer", "guardian"]);

/**
 * A configured value for one source value, only when it is exactly that value's name (or key).
 * Anything else stays unmapped, so its rows read "needs review" until a person chooses.
 */
export function suggestValue(field: ValueField, key: string, options: readonly { value: string; label: string; aliases?: string[] }[]): string | null {
  if (field === "role") return ROLE_WORDS.has(key) ? key : null;
  for (const option of options) {
    const names = [option.label, option.value, ...(option.aliases ?? [])].map((name) => valueKey(name.replace(/_/g, " ")));
    if (names.includes(key.replace(/_/g, " "))) return option.value;
  }
  return null;
}

export const STAGE_LABELS: Record<string, string> = {
  engagement_pending: "Engagement pending",
  intake: "Intake",
  evidence_collection: "Evidence collection",
  preparation: "Preparation",
  consultant_review: "Consultant review",
  client_confirmation: "Client confirmation",
  ready_to_submit: "Ready to submit",
  submitted: "Submitted",
  government_processing: "Government processing",
  decision_review: "Decision review",
  post_decision: "Post-decision",
  closed: "Closed",
};

export const ROLE_LABELS: Record<string, string> = {
  applicant: "Applicant",
  sponsor: "Sponsor",
  dependant: "Dependant",
  guardian: "Guardian",
  employer: "Employer",
};

export type MigrationBadge = { tone: "ok" | "chg" | "bad" | "unv" | "blue"; label: string; detail?: string };

/** The Preview tab's Result for one row. */
export function rowResult(plan: string | null, linkedTo: "person" | "row" | null): MigrationBadge {
  switch (plan) {
    case "create":
      return { tone: "ok", label: "New person" };
    case "link":
      return { tone: "ok", label: "Matches existing", detail: linkedTo === "row" ? "same as an earlier row" : "linked" };
    case "confirm":
      return { tone: "chg", label: "Possible match", detail: "confirm" };
    case "review":
      return { tone: "chg", label: "Needs review" };
    case "error":
      return { tone: "bad", label: "Error" };
    case "skip":
      return { tone: "unv", label: "Not imported" };
    default:
      return { tone: "unv", label: "Not checked yet" };
  }
}

// ---------------------------------------------------------------------------
// MIG-01: the other kinds of import and the sensitivity classification
// ---------------------------------------------------------------------------

export type MigrationKind = "clients_matters" | "relationships" | "notes" | "tasks" | "key_dates" | "documents" | "opening_balances";
export type OtherKind = Exclude<MigrationKind, "clients_matters">;

/** What a file can hold, in the order the upload picker lists them. */
export const MIGRATION_KINDS: { kind: MigrationKind; label: string }[] = [
  { kind: "clients_matters", label: "Clients and matters" },
  { kind: "relationships", label: "People relationships" },
  { kind: "notes", label: "Notes" },
  { kind: "tasks", label: "Tasks" },
  { kind: "key_dates", label: "Key dates" },
  { kind: "documents", label: "Documents (CSV manifest and a ZIP of the files)" },
  { kind: "opening_balances", label: "Financial opening balances" },
];

export function isMigrationKind(value: unknown): value is MigrationKind {
  return typeof value === "string" && MIGRATION_KINDS.some((entry) => entry.kind === value);
}

export function kindLabel(kind: string): string {
  return MIGRATION_KINDS.find((entry) => entry.kind === kind)?.label.replace(/ \(.*\)$/, "") ?? "Clients and matters";
}

export type KindField = { field: string; label: [string, string]; required?: boolean };

/** Each kind's Casevoya fields, in the order Map columns offers them (database: app.migration_kind_columns). */
export const KIND_FIELDS: Record<OtherKind, KindField[]> = {
  relationships: [
    { field: "person", label: ["Person", "name or email"], required: true },
    { field: "person_birth", label: ["Person", "date of birth (tells people apart)"] },
    { field: "related", label: ["Related person", "name or email"], required: true },
    { field: "related_birth", label: ["Related person", "date of birth"] },
    { field: "relationship", label: ["Relationship", "type"], required: true },
    { field: "recorded_on", label: ["Relationship", "date recorded"] },
  ],
  notes: [
    { field: "reference", label: ["Matter", "reference"] },
    { field: "person", label: ["Person", "name or email (when there is no matter column)"] },
    { field: "person_birth", label: ["Person", "date of birth"] },
    { field: "body", label: ["Note", "text"], required: true },
    { field: "author", label: ["Note", "original author"] },
    { field: "written_on", label: ["Note", "original date"] },
  ],
  tasks: [
    { field: "reference", label: ["Matter", "reference"], required: true },
    { field: "title", label: ["Task", "title"], required: true },
    { field: "due_on", label: ["Task", "due date"] },
    { field: "assignee", label: ["Task", "assignee’s staff email"] },
    { field: "status", label: ["Task", "status"] },
    { field: "priority", label: ["Task", "priority"] },
    { field: "created_on", label: ["Task", "original creation date"] },
  ],
  key_dates: [
    { field: "reference", label: ["Matter", "reference"], required: true },
    { field: "label", label: ["Date", "what it is"], required: true },
    { field: "date", label: ["Date", "day"], required: true },
    { field: "date_kind", label: ["Date", "kind"] },
    { field: "recorded_on", label: ["Date", "date recorded"] },
  ],
  documents: [
    { field: "file", label: ["Document", "file name in the ZIP"], required: true },
    { field: "person", label: ["Person", "name or email"], required: true },
    { field: "person_birth", label: ["Person", "date of birth"] },
    { field: "reference", label: ["Matter", "reference"], required: true },
    { field: "document_type", label: ["Document", "type"], required: true },
    { field: "dated_on", label: ["Document", "original date"] },
  ],
  opening_balances: [
    { field: "reference", label: ["Matter", "reference"], required: true },
    { field: "balance_kind", label: ["Balance", "kind"], required: true },
    { field: "amount", label: ["Balance", "amount"], required: true },
    { field: "currency", label: ["Balance", "currency"] },
    { field: "as_of", label: ["Balance", "as-of date"], required: true },
    { field: "description", label: ["Balance", "description"] },
  ],
};

/** Fields whose source values map to configured values, per kind (app.migration_kind_values). */
export const KIND_VALUE_FIELDS: Record<OtherKind, string[]> = {
  relationships: ["relationship"],
  notes: [],
  tasks: ["status", "priority"],
  key_dates: ["date_kind"],
  documents: [],
  opening_balances: ["balance_kind"],
};

/** The values a source value can map to. The relationship types are public.person_relationship_type's own. */
export const KIND_VALUE_OPTIONS: Record<string, [string, string][]> = {
  relationship: [
    ["spouse", "Spouse"],
    ["parent", "Parent"],
    ["child", "Child"],
    ["payer", "Payer"],
    ["sponsor", "Sponsor"],
    ["household", "Household"],
    ["other", "Other"],
    ["none", "Not imported"],
  ],
  status: [
    ["open", "Open"],
    ["done", "Done"],
    ["cancelled", "Cancelled"],
  ],
  priority: [
    ["low", "Low"],
    ["normal", "Normal"],
    ["high", "High"],
    ["critical", "Critical"],
  ],
  date_kind: [
    ["legal", "Legal deadline"],
    ["correspondence", "Correspondence"],
    ["internal", "Internal"],
  ],
  balance_kind: [
    ["receivable", "Receivable (the client owes it)"],
    ["advance", "Advance (held for the client)"],
    ["none", "Not imported"],
  ],
};

const KIND_HINTS: Record<string, RegExp> = {
  reference: /file ?#|file (no|number|ref)|^ref|reference|case ?(#|no|number|id)|^matter( ?(#|no|number|id|ref))?$/i,
  person: /^(client|person|name|full name|applicant|client name|person name|client email|email|e-?mail)$/i,
  person_birth: /^(dob|d\.o\.b\.?|date of birth|birth ?date|client dob)$/i,
  related: /^(related( person)?|other person|related to|relative|family member|linked person)$/i,
  related_birth: /^(related|relative|other) (dob|date of birth)$/i,
  relationship: /^(relationship|relation|relationship type|type)$/i,
  recorded_on: /^(recorded|recorded on|date recorded|created|created on|entered)$/i,
  body: /^(note|notes|text|body|comment|comments|content|details)$/i,
  author: /^(author|by|written by|staff|user|created by)$/i,
  written_on: /^(date|note date|written|written on|created|created on|timestamp)$/i,
  title: /^(task|title|task title|subject|description|to ?do)$/i,
  due_on: /^(due|due date|due on|deadline)$/i,
  assignee: /assign|owner|responsible|staff email/i,
  status: /^(status|state|done)$/i,
  priority: /^(priority|importance|urgency)$/i,
  created_on: /^(created|created on|date created|opened)$/i,
  label: /^(what|label|event|description|name|type of date)$/i,
  date: /^(date|when|day|expiry|expires|expiry date|due)$/i,
  date_kind: /^(kind|type|category)$/i,
  file: /^(file|file ?name|filename|path|document|attachment)$/i,
  document_type: /^(type|document type|doc type|category|kind|description)$/i,
  dated_on: /^(date|dated|document date|issued|issue date)$/i,
  balance_kind: /^(type|kind|balance type|account)$/i,
  amount: /amount|balance|total|owing|owed/i,
  currency: /^(currency|cur|ccy)$/i,
  as_of: /^(as of|as-of|as at|date|balance date|statement date)$/i,
  description: /^(description|memo|note|details)$/i,
};

/** Which column each of a kind's fields likely comes from, by heading. Each column is used once; the owner confirms. */
export function suggestKindColumns(kind: OtherKind, headers: readonly string[]): Record<string, number> {
  const used = new Set<number>();
  const result: Record<string, number> = {};
  for (const { field } of KIND_FIELDS[kind]) {
    const hint = KIND_HINTS[field];
    if (!hint) continue;
    const index = headers.findIndex((header, i) => !used.has(i) && hint.test(header.trim()));
    if (index >= 0) {
      used.add(index);
      result[field] = index;
    }
  }
  return result;
}

/** A configured value for a source value of a kind's value field, only when it is that value's exact word or label. */
export function suggestKindValue(field: string, key: string): string | null {
  for (const [value, label] of KIND_VALUE_OPTIONS[field] ?? []) {
    if (value === "none") continue;
    if (key === value || key === valueKey(label.replace(/ \(.*\)$/, ""))) return value;
  }
  return null;
}

export type Sensitivity = "identity" | "narrative" | "health" | "financial";

export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  identity: "Identity number",
  narrative: "Immigration narrative",
  health: "Health",
  financial: "Financial",
};

const SENSITIVITY_HINTS: [Sensitivity, RegExp][] = [
  ["identity", /passport|\buci\b|client id|\bsin\b|social insurance|national id|id (no|number|#)|identity|(permit|visa|document|licen[cs]e) ?(no|number|#)/i],
  ["health", /medical|health|diagnos|condition|disabilit|illness|treatment/i],
  ["narrative", /narrative|story|background|persecution|refusal|reason for|explanation|personal statement|^notes?$/i],
  ["financial", /amount|balance|bank|income|salary|\bfunds?\b|payment|\bfees?\b|retainer|trust|invoice|owing|owed/i],
];

/** Columns whose heading suggests sensitive values, by zero-based index. A suggestion the owner confirms on Map columns. */
export function suggestSensitivity(headers: readonly string[]): Record<string, Sensitivity> {
  const result: Record<string, Sensitivity> = {};
  headers.forEach((header, index) => {
    const match = SENSITIVITY_HINTS.find(([, hint]) => hint.test(header.trim()));
    if (match) result[String(index)] = match[0];
  });
  return result;
}

export function readSensitivity(value: unknown): Record<string, Sensitivity> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Sensitivity> = {};
  for (const [key, cls] of Object.entries(value as Record<string, unknown>)) {
    if (/^\d{1,2}$/.test(key) && typeof cls === "string" && cls in SENSITIVITY_LABELS) result[key] = cls as Sensitivity;
  }
  return result;
}

/** What shows instead of a sensitive value: its class, never the value. */
export function hiddenValue(cls: Sensitivity): string {
  return `Hidden · ${SENSITIVITY_LABELS[cls].toLowerCase()}`;
}

/** A row problem with any quoted value from a sensitive column taken out. */
export function maskProblem(problem: string, sensitive: boolean): string {
  return sensitive ? problem.replace(/“[^”]*”/g, "This value") : problem;
}

/** Cents as the firm reads money: "$1,250.50 CAD". */
export function money(cents: number, currency: string): string {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export type PlanCounts = {
  rows: number;
  create: number;
  link: number;
  confirm: number;
  review: number;
  error: number;
  skip: number;
  matters: number;
  matters_waiting: number;
  problem_rows: number;
  /** Records ready to import (create + link); for clients and matters, the matters. */
  ready: number;
};

export function planCounts(value: unknown): PlanCounts | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const n = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : Number(record[key] ?? 0) || 0);
  return {
    rows: n("rows"),
    create: n("create"),
    link: n("link"),
    confirm: n("confirm"),
    review: n("review"),
    error: n("error"),
    skip: n("skip"),
    matters: n("matters"),
    matters_waiting: n("matters_waiting"),
    problem_rows: n("problem_rows"),
    ready: record.ready === undefined ? n("matters") : n("ready"),
  };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-CA")} ${count === 1 ? one : many}`;
}

/** "hash 51c0…e2": the first four and last two hex digits of the file's SHA-256. */
export function shortHash(sha256: string): string {
  return sha256.length >= 6 ? `hash ${sha256.slice(0, 4)}…${sha256.slice(-2)}` : "hash —";
}

/** User-facing copy for a refused migration write. Never passes a database message through. */
export function migrationError(message: string): string {
  if (/firm owner step-up|step-up is required/i.test(message)) return "Confirm it’s you with your authenticator, then try again.";
  if (/staff access denied/i.test(message)) return "Only the firm owner can import records.";
  if (/finish or discard the open import/i.test(message)) return "Finish or discard the import in progress first.";
  if (/larger than 5 MB/i.test(message)) return "The file is larger than 5 MB. Split it and import each part.";
  if (/up to 5,000 rows/i.test(message)) return "Import up to 5,000 rows at a time.";
  // MIG-02: the pilot and its sign-off.
  if (/run a pilot first/i.test(message)) return "Run a pilot first. The full import waits for your sign-off of the pilot.";
  if (/needs the firm owner'?s sign-off|needs the firm owner’s sign-off/i.test(message)) return "Sign off the pilot first. The full import waits for it.";
  const pilotMax = /a pilot is 1 to (\d+) matters/i.exec(message);
  if (pilotMax) return `A pilot is 1 to ${pilotMax[1]} matters.`;
  if (/note of 3 to 1,000/i.test(message)) return "Add a note of 3 to 1,000 characters saying what you checked.";
  if (/pilot is not finished/i.test(message)) return "The pilot isn’t finished yet. Continue it first.";
  if (/already signed off/i.test(message)) return "The pilot is already signed off. Reload the page.";
  if (/no pilot to sign off/i.test(message)) return "This import has no pilot to sign off. Reload the page.";
  if (/source system in 120/i.test(message)) return "Name the system the file came from in 120 characters or fewer.";
  if (/decide every possible match/i.test(message)) return "Decide every possible match on Preview first.";
  if (/no row is ready/i.test(message)) return "No row is ready to import yet. Fix the row errors first.";
  if (/run the dry run|can't be checked now|can’t be checked now/i.test(message)) return "Check the preview before signing off.";
  if (/sample mode changed/i.test(message)) return "Sample mode changed since the upload. Discard this import and upload the file again.";
  if (/record totals don/i.test(message)) return "The records created didn’t match the preview, so the import stopped. Roll it back from Sign off.";
  const refused = /migration row (\d+): the matter was refused \((\w+)\)/i.exec(message);
  if (refused) {
    return refused[2] === "licence"
      ? `Row ${refused[1]}: a licence blocks the responsible consultant, so the import stopped. You can roll back what was created.`
      : `Row ${refused[1]}: the matter couldn’t be created, so the import stopped. You can roll back what was created.`;
  }
  if (/licence blocks/i.test(message)) return "A licence blocks a responsible consultant, so the import stopped. You can roll back what was created.";
  if (/active licensed consultant/i.test(message)) return "Each responsible consultant must be an active licensed consultant.";
  if (/map a column to the person/i.test(message)) return "Map a column to the person’s legal name.";
  if (/each column maps to one field/i.test(message)) return "Each Casevoya field can come from one column only.";
  if (/mapping is not valid/i.test(message)) return "The mapping couldn’t be saved. Reload the page and try again.";
  if (/not being committed|already checked|no longer takes rows|can't be mapped now|can’t be mapped now|can't change now|can’t change now/i.test(message)) {
    return "This import has moved on. Reload the page.";
  }
  if (/only an import that isn/i.test(message)) return "A signed-off import can only be rolled back.";
  if (/no possible match/i.test(message)) return "That row has no possible match any more. Reload the page.";
  if (/migration batch not found/i.test(message)) return "That import isn’t there any more. Reload the page.";
  if (/matched person is no longer there/i.test(message)) return "A matched client record was removed, so the import stopped. Check the preview again.";
  // MIG decision 2: one kind per file.
  const mixed = mixedFileMessage(message);
  if (mixed) return mixed;
  // MIG-01: the other kinds.
  const required = /required field \((\w+)\)/i.exec(message);
  if (required) {
    const field = Object.values(KIND_FIELDS).flat().find((entry) => entry.field === required[1]);
    return `Map a column to each required field${field ? `: ${field.label[0].toLowerCase()} ${field.label[1]}` : ""}.`;
  }
  if (/map a column to each required field/i.test(message)) return "Map a column to each required field.";
  if (/choose what the file holds/i.test(message)) return "Choose what the file holds.";
  if (/kind can't change now|kind can’t change now|doesn't take a ZIP now|doesn’t take a ZIP now/i.test(message)) return "This import has moved on. Reload the page.";
  if (/add the ZIP of files first/i.test(message)) return "Add the ZIP of files first.";
  if (/ZIP is larger than 25 MB|file list is not valid/i.test(message)) return "The ZIP is larger than 25 MB or couldn’t be read. Split the files into smaller ZIPs.";
  if (/stored file doesn't match|stored file doesn’t match|file was not stored for this import|hasn't been checked yet|hasn’t been checked yet/i.test(message)) {
    return "A file couldn’t be stored as the preview showed, so the import stopped. Sign off again to continue.";
  }
  if (/matched record is no longer there/i.test(message)) return "A matched record was removed, so the import stopped. Check the preview again.";
  if (/the matter is no longer there|the person is no longer there/i.test(message)) return "A matter or person in the file was removed, so the import stopped. Check the preview again.";
  if (/an internal task needs an active staff owner/i.test(message)) return "An assignee left the team, so the import stopped. Check the preview again.";
  if (/sample mode; only sample matters/i.test(message)) return "Sample mode changed since the upload. Discard this import and upload the file again.";
  if (/already reviewed/i.test(message)) return "That opening balance was already reviewed. Reload the page.";
  if (/a reason is required|note must be 3 to 500/i.test(message)) return "Give a reason of 3 to 500 characters.";
  if (/importer cannot review/i.test(message)) return "Someone else must review a balance you imported.";
  if (/billing access denied/i.test(message)) return "Only billing staff of the matter can review opening balances.";
  return safeAccessError(message);
}

export function needsMigrationStepUp(message: string): boolean {
  return /firm owner step-up|step-up is required/i.test(message);
}
