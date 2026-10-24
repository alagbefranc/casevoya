/**
 * Pure helpers for intake delivery (PRD INT-03 to INT-06): which questions show, what counts as
 * answered, how an answer reads, how a partial date is stored (never as a full date), repeatable
 * histories, and the review flags staff see. Shared by the portal and the Sheet; the database
 * (app.save_intake_answer, app.intake_field_visible) stays the authority.
 */
import { allowsNotApplicable, allowsUnknown, fieldLabel, readSchema, type IntakeField } from "@/modules/sheet/intake-builder-present";

export type Presence = "provided" | "unknown" | "not_applicable" | "approximate";

/** One stored answer version (intake_answer_versions). */
export type AnswerVersion = {
  id: string;
  fieldKey: string;
  presence: Presence;
  /** normalized_value: { text } | { calendar_date } | { year, month? } | { declaration } | { entries } | approximate { year?, month?, approximate_note }. */
  value: Record<string, unknown>;
  /** raw_value, as saved (a file answer keeps its document id here). */
  raw?: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
};

/** The latest version of each answer, with its version number (1 = first) and the versions before it. */
export type LatestAnswer = { latest: AnswerVersion; versionNumber: number; history: AnswerVersion[] };

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The note stored with a date the client marks approximate (the database needs one). Never a guessed value. */
export const APPROXIMATE_NOTE = "Marked approximate by the person answering";

export function schemaFields(schema: unknown): IntakeField[] {
  return readSchema(schema).fields;
}

function byTime(a: AnswerVersion, b: AnswerVersion): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function latestAnswers(rows: readonly AnswerVersion[]): Map<string, LatestAnswer> {
  const grouped = new Map<string, AnswerVersion[]>();
  for (const row of [...rows].sort(byTime)) {
    const list = grouped.get(row.fieldKey) ?? [];
    list.push(row);
    grouped.set(row.fieldKey, list);
  }
  const out = new Map<string, LatestAnswer>();
  for (const [key, list] of grouped) out.set(key, { latest: list[list.length - 1], versionNumber: list.length, history: list.slice(0, -1) });
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

/** Whether an answer is the same as a saved version (key order ignored), as public.request_intake_correction checks. */
export function sameAnswer(answer: { presence: Presence; value: Record<string, unknown> }, saved: Pick<AnswerVersion, "presence" | "value"> | undefined): boolean {
  if (!saved) return false;
  return answer.presence === saved.presence && JSON.stringify(stable(answer.value)) === JSON.stringify(stable(saved.value ?? {}));
}

/** Mirrors app.intake_field_visible: a conditional question shows once the question it depends on has the answer it names. */
export function fieldVisible(field: IntakeField, answers: ReadonlyMap<string, LatestAnswer>): boolean {
  if (!field.show_when) return true;
  const depends = answers.get(field.show_when.field)?.latest;
  if (!depends || depends.presence !== "provided") return false;
  const expected = field.show_when.equals;
  const current = depends.value;
  return sameJson(current.declaration, expected) || (typeof current.text === "string" && sameJson(current.text, expected)) || sameJson(current, expected);
}

export function visibleFields(fields: readonly IntakeField[], answers: ReadonlyMap<string, LatestAnswer>): IntakeField[] {
  return fields.filter((field) => fieldVisible(field, answers));
}

/** An answer counts once it is saved; a declaration counts only when confirmed. */
export function isAnswered(field: IntakeField, answer: LatestAnswer | undefined): boolean {
  if (!answer) return false;
  if (field.type === "declaration") return answer.latest.presence === "provided" && answer.latest.value.declaration === true;
  return true;
}

export type FormProgress = { answered: number; total: number; percent: number; unknown: number; missing: IntakeField[] };

export function formProgress(fields: readonly IntakeField[], answers: ReadonlyMap<string, LatestAnswer>): FormProgress {
  const visible = visibleFields(fields, answers);
  const answered = visible.filter((field) => isAnswered(field, answers.get(field.key))).length;
  const unknown = visible.filter((field) => answers.get(field.key)?.latest.presence === "unknown").length;
  const missing = visible.filter((field) => field.required && !isAnswered(field, answers.get(field.key)));
  return { answered, total: visible.length, percent: visible.length ? Math.round((answered / visible.length) * 100) : 0, unknown, missing };
}

/* ------------------------------------------------------------------ dates */

export type PartialDate = { year: number; month?: number | null; day?: number | null };

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * What the client typed in a day / month / year control, as the answer to save. "Exact" keeps only
 * what was entered: a year alone is a year, a month and year a year and month, all three a day.
 * "Approximate" keeps the year and month and says so. Nothing is ever filled in.
 */
export function readDateInput(input: { day: string; month: string; year: string; sure: "exact" | "approximate" | "unknown" | "not_applicable" }):
  | { presence: Presence; value: Record<string, unknown> }
  | { error: string } {
  if (input.sure === "unknown") return { presence: "unknown", value: {} };
  if (input.sure === "not_applicable") return { presence: "not_applicable", value: {} };
  const yearText = input.year.trim();
  const dayText = input.day.trim();
  const month = input.month ? Number(input.month) : null;
  if (!yearText) return { error: input.sure === "approximate" ? "Add at least the year, even a rough one." : "Add at least the year." };
  if (!/^\d{4}$/.test(yearText) || Number(yearText) < 1800 || Number(yearText) > 2200) return { error: "Enter the year as four digits." };
  const year = Number(yearText);
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) return { error: "Choose a month from the list." };
  if (input.sure === "approximate") {
    return { presence: "approximate", value: month ? { year, month, approximate_note: APPROXIMATE_NOTE } : { year, approximate_note: APPROXIMATE_NOTE } };
  }
  if (dayText) {
    if (!/^\d{1,2}$/.test(dayText)) return { error: "Enter the day as a number." };
    if (month == null) return { error: "Choose the month too, or leave the day empty." };
    const day = Number(dayText);
    if (day < 1 || day > daysIn(year, month)) return { error: `${MONTHS[month - 1]} ${year} has no day ${day}.` };
    return { presence: "provided", value: { date_kind: "exact", calendar_date: `${year}-${pad(month)}-${pad(day)}` } };
  }
  if (month != null) return { presence: "provided", value: { date_kind: "year_month", year, month } };
  return { presence: "provided", value: { date_kind: "year", year } };
}

/** A stored date answer back into the control's day / month / year / sure. */
export function dateInputOf(answer: AnswerVersion | undefined): { day: string; month: string; year: string; sure: "exact" | "approximate" | "unknown" | "not_applicable" } {
  if (!answer) return { day: "", month: "", year: "", sure: "exact" };
  if (answer.presence === "unknown") return { day: "", month: "", year: "", sure: "unknown" };
  if (answer.presence === "not_applicable") return { day: "", month: "", year: "", sure: "not_applicable" };
  const value = answer.value;
  if (typeof value.calendar_date === "string") {
    const [y, m, d] = value.calendar_date.split("-");
    return { day: String(Number(d)), month: String(Number(m)), year: y, sure: "exact" };
  }
  return {
    day: "",
    month: typeof value.month === "number" ? String(value.month) : "",
    year: typeof value.year === "number" ? String(value.year) : "",
    sure: answer.presence === "approximate" ? "approximate" : "exact",
  };
}

/** "9 March 1984", "March 2021", "2021", "About March 2021". Only what was stored. */
export function dateText(answer: Pick<AnswerVersion, "presence" | "value">, short = false): string {
  const months = short ? MONTHS_SHORT : MONTHS;
  const value = answer.value;
  if (typeof value.calendar_date === "string") {
    const [y, m, d] = value.calendar_date.split("-").map(Number);
    return `${d} ${months[m - 1]} ${y}`;
  }
  const year = typeof value.year === "number" ? value.year : null;
  const month = typeof value.month === "number" ? months[value.month - 1] : null;
  const text = [month, year].filter(Boolean).join(" ") || "date unknown";
  return answer.presence === "approximate" ? `About ${text}` : text;
}

export function partialText(date: PartialDate | null | undefined): string {
  if (!date) return "";
  const month = date.month ? MONTHS_SHORT[date.month - 1] : null;
  if (date.day && month) return `${date.day} ${month} ${date.year}`;
  return [month, date.year].filter(Boolean).join(" ");
}

/* --------------------------------------------------------------- answers */

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en-CA"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function choiceLabel(option: string): string {
  if (option === "yes") return "Yes";
  if (option === "no") return "No";
  return option;
}

/** One repeatable history entry as the portal stores it. */
export type HistoryEntry = { details: string; from: PartialDate | null; to: PartialDate | null };

export function readEntries(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const date = (raw: unknown): PartialDate | null => {
      const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      return d && typeof d.year === "number" ? { year: d.year, month: typeof d.month === "number" ? d.month : null, day: typeof d.day === "number" ? d.day : null } : null;
    };
    return { details: typeof item.details === "string" ? item.details : "", from: date(item.from), to: date(item.to) };
  });
}

export function entryText(entry: HistoryEntry): string {
  const range = entry.from ? (entry.to ? `${partialText(entry.from)} to ${partialText(entry.to)}` : `from ${partialText(entry.from)}`) : "";
  return [entry.details, range].filter(Boolean).join(" · ");
}

export function entryMissing(entry: HistoryEntry): number {
  return (entry.details.trim() ? 0 : 1) + (entry.from ? 0 : 1);
}

/** The answer in words, as the client gave it. */
export function answerText(field: IntakeField, answer: Pick<AnswerVersion, "presence" | "value">): string {
  if (answer.presence === "unknown") return "“I don’t know”";
  if (answer.presence === "not_applicable") return "“Not applicable”";
  if (field.type === "date") return dateText(answer);
  const value = answer.value;
  if (field.type === "declaration") return value.declaration === true ? "Confirmed" : "Not confirmed";
  if (field.type === "country" && typeof value.text === "string") return countryName(value.text);
  if (field.type === "choice" && typeof value.text === "string") return choiceLabel(value.text);
  if (field.type === "repeatable" || field.type === "relationship") {
    const entries = readEntries(value.entries);
    if (entries.length === 0) return "None";
    if (entries.length === 1) return entryText(entries[0]);
    return `${entries.length} entries`;
  }
  return typeof value.text === "string" ? value.text : "";
}

export { allowsNotApplicable, allowsUnknown, fieldLabel };

/* ------------------------------------------------------------ review flags */

/**
 * INT-05 review items. A flag asks a person to look; it is never a finding of fraud.
 * `fieldKey` is the answer the flag is about (null for a document).
 */
export type ReviewFlag = { kind: "gap" | "overlap" | "birth" | "name" | "expired"; label: string; detail: string; fieldKey: string | null };

const FLAG_LABEL: Record<ReviewFlag["kind"], string> = {
  gap: "Gap",
  overlap: "Overlap",
  birth: "Differs from record",
  name: "Differs from record",
  expired: "Expired",
};

/** A month number for comparing periods; a year alone compares by year. */
function monthOf(date: PartialDate): { at: number; coarse: boolean } {
  return date.month ? { at: date.year * 12 + (date.month - 1), coarse: false } : { at: date.year * 12, coarse: true };
}

/** Overlapping or missing periods in one history (entries with a start date), oldest first. */
export function historyFlags(fieldKey: string, label: string, entries: readonly HistoryEntry[]): ReviewFlag[] {
  const dated = entries.filter((entry) => entry.from).sort((a, b) => monthOf(a.from as PartialDate).at - monthOf(b.from as PartialDate).at);
  const flags: ReviewFlag[] = [];
  for (let index = 1; index < dated.length; index++) {
    const previous = dated[index - 1];
    const current = dated[index];
    const start = monthOf(current.from as PartialDate);
    if (!previous.to) {
      flags.push({ kind: "overlap", label: FLAG_LABEL.overlap, detail: `${label}: “${previous.details || "an entry"}” has no end date and “${current.details || "the next entry"}” starts ${partialText(current.from)}`, fieldKey });
      continue;
    }
    const end = monthOf(previous.to);
    const coarse = start.coarse || end.coarse;
    if (coarse ? Math.floor(end.at / 12) > Math.floor(start.at / 12) : end.at > start.at) {
      flags.push({ kind: "overlap", label: FLAG_LABEL.overlap, detail: `${label}: ${partialText(previous.from)} to ${partialText(previous.to)} overlaps ${partialText(current.from)}`, fieldKey });
    } else if (coarse ? Math.floor(start.at / 12) - Math.floor(end.at / 12) > 1 : start.at - end.at > 1) {
      flags.push({ kind: "gap", label: FLAG_LABEL.gap, detail: `${label}: nothing between ${partialText(previous.to)} and ${partialText(current.from)}`, fieldKey });
    }
  }
  return flags;
}

const NAME_KEY = /^(full_|legal_)?name$/;
const BIRTH_KEY = /(^|_)(date_of_birth|birth_date|dob)$/;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export type PersonRecord = { displayName: string; dateOfBirth: string | null; birthPrecision: string | null };

/** The answers' date of birth at the precision both sides have, as YYYY, YYYY-MM or YYYY-MM-DD. */
function birthKey(answer: AnswerVersion): { year: number; month: number | null; day: number | null } | null {
  if (answer.presence !== "provided") return null;
  const value = answer.value;
  if (typeof value.calendar_date === "string") {
    const [y, m, d] = value.calendar_date.split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  if (typeof value.year === "number") return { year: value.year, month: typeof value.month === "number" ? value.month : null, day: null };
  return null;
}

function birthsDiffer(a: { year: number; month: number | null; day: number | null }, b: { year: number; month: number | null; day: number | null }): boolean {
  if (a.year !== b.year) return true;
  if (a.month != null && b.month != null && a.month !== b.month) return true;
  return a.day != null && b.day != null && a.day !== b.day;
}

function recordBirth(record: PersonRecord): { year: number; month: number | null; day: number | null } | null {
  if (!record.dateOfBirth) return null;
  const [y, m, d] = record.dateOfBirth.split("-").map(Number);
  if (record.birthPrecision === "year") return { year: y, month: null, day: null };
  if (record.birthPrecision === "month") return { year: y, month: m, day: null };
  return { year: y, month: m, day: d };
}

/**
 * Flags for one person's answers on a matter: periods in each history, a name or date of birth that
 * differs from the person's record or from another answer, and expired evidence.
 */
export function reviewFlags(input: {
  fields: readonly IntakeField[];
  answers: ReadonlyMap<string, LatestAnswer>;
  record: PersonRecord | null;
  /** Other responses' date-of-birth answers for the same person (conflicting birth dates across forms). */
  otherBirths?: readonly AnswerVersion[];
  documents?: readonly { purpose: string; expiresOn: string | null }[];
  today: string;
}): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  for (const field of input.fields) {
    const answer = input.answers.get(field.key)?.latest;
    if (!answer) continue;
    const label = fieldLabel(field);
    if ((field.type === "repeatable" || field.type === "relationship") && answer.presence === "provided") {
      flags.push(...historyFlags(field.key, label, readEntries(answer.value.entries)));
    }
    if (field.type === "date" && BIRTH_KEY.test(field.key)) {
      const mine = birthKey(answer);
      const record = input.record ? recordBirth(input.record) : null;
      if (mine && record && birthsDiffer(mine, record)) {
        flags.push({ kind: "birth", label: FLAG_LABEL.birth, detail: `${label} is ${dateText(answer)}; the person’s record says ${input.record?.dateOfBirth}`, fieldKey: field.key });
      } else if (mine) {
        const other = (input.otherBirths ?? []).map(birthKey).find((theirs) => theirs && birthsDiffer(mine, theirs));
        if (other) flags.push({ kind: "birth", label: "Conflicting answers", detail: `${label} differs from this person’s answer on another form`, fieldKey: field.key });
      }
    }
    if (field.type === "text" && NAME_KEY.test(field.key) && answer.presence === "provided" && input.record && typeof answer.value.text === "string") {
      if (normalizeName(answer.value.text) !== normalizeName(input.record.displayName)) {
        flags.push({ kind: "name", label: FLAG_LABEL.name, detail: `“${answer.value.text}” here; “${input.record.displayName}” on the person’s record`, fieldKey: field.key });
      }
    }
  }
  for (const doc of input.documents ?? []) {
    if (doc.expiresOn && doc.expiresOn < input.today) {
      flags.push({ kind: "expired", label: FLAG_LABEL.expired, detail: `${doc.purpose} expired ${dateText({ presence: "provided", value: { calendar_date: doc.expiresOn } }, true)}`, fieldKey: null });
    }
  }
  return flags;
}

/* ------------------------------------------------------------------ words */

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "One question", "Six short questions", "24 questions". */
export function questionCount(n: number): string {
  const word = n <= 10 ? NUMBER_WORDS[n] : String(n);
  return `${word} ${n === 1 ? "question" : "questions"}`;
}

export function firstWord(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** A person's portal error, in plain words, from the database's refusal. */
export function intakeError(message: string): string {
  if (/conflict/i.test(message)) return "These answers changed somewhere else.";
  if (/frozen/i.test(message)) return "Your firm has locked these answers. Ask for a correction instead.";
  if (/already submitted/i.test(message)) return "These answers were already sent.";
  if (/required intake answer is missing/i.test(message)) return "Answer every required question first.";
  if (/unknown is not allowed|not applicable is not allowed|needs an answer/i.test(message)) return "This question needs an answer.";
  if (/approximate/i.test(message)) return "Add at least the year, even a rough one.";
  if (/full date|calendar day|date precision/i.test(message)) return "Enter the date you know.";
  if (/two-letter|country/i.test(message)) return "Choose a country from the list.";
  if (/choice/i.test(message)) return "Choose one of the options.";
  if (/needs text/i.test(message)) return "Type an answer, or choose another option.";
  if (/sample mode/i.test(message)) return "This firm is still setting up. Answers can’t be saved yet.";
  if (/describe/i.test(message)) return "Describe what needs fixing.";
  if (/no answer to correct/i.test(message)) return "That question has no answer to correct yet.";
  if (/not one of your documents/i.test(message)) return "That file isn’t one of your documents.";
  if (/earlier matter first/i.test(message)) return "Confirm the answers from your earlier matter first.";
  if (/was changed/i.test(message)) return "That answer changed. Check the new one instead.";
  if (/already sent/i.test(message)) return "These answers were already sent.";
  if (/denied/i.test(message)) return "You can’t change these answers.";
  return "That didn’t save. Try again.";
}
