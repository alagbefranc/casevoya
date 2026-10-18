/**
 * Pure helpers for the Sheet's Migration import page (T044, PRD §25): the Casevoya fields a column
 * can map to, suggestions the owner confirms, the words for each row's plan, and how a database
 * refusal reads. The database plans and decides every row (app.migration_evaluate).
 */
import { safeAccessError } from "@/lib/auth/step-up";

export type MigrationField =
  | "name"
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
  name: /^(full |legal |client |applicant |person )?name$|^client$|^applicant$|^person$/i,
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
  const order: MigrationField[] = ["email", "date_of_birth", "phone", "case_manager", "consultant", "reference", "title", "program", "stage", "role", "name"];
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
  for (const sample of samples) {
    const value = sample.trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value)) {
      iso++;
      continue;
    }
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}$/.exec(value);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { order: "dmy", certain: true };
  if (monthFirst && !dayFirst) return { order: "mdy", certain: true };
  if (iso && iso === samples.filter((sample) => sample.trim()).length) return { order: "ymd", certain: true };
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
  return safeAccessError(message);
}

export function needsMigrationStepUp(message: string): boolean {
  return /firm owner step-up|step-up is required/i.test(message);
}
