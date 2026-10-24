/**
 * The matter's Intake tab (PRD INT-03 to INT-06): for each person's intake form, its state, how much
 * is answered, every answer with its provenance (who, which version, when, a correction's number),
 * its review state, and the review flags (gaps and overlaps, a date of birth or name that differs,
 * expired evidence). Pure; matter-intake-load reads the database as the signed-in member.
 */
import {
  answerText,
  fieldLabel,
  firstWord,
  formProgress,
  latestAnswers,
  reviewFlags,
  visibleFields,
  type AnswerVersion,
  type PersonRecord,
  type ReviewFlag,
} from "@/modules/intake/present";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";

export type IntakeBadge = { tone: "ok" | "rev" | "chg" | "unv" | "gr"; label: string };

export type IntakeReviewRow = {
  key: string;
  question: string;
  answer: string;
  /** "Priya · v2", then when and a correction's number when known. */
  source: string[];
  badge: IntakeBadge;
  /** The answer version Mark reviewed records; null: no review button (a document, a description). */
  answerId: string | null;
  reviewed: boolean;
  /** INT-04, live only: the answer's provenance in one place (the Provenance details). */
  provenance?: IntakeProvenance | null;
};

/** INT-04: where an answer came from: raw and normalised value, source, who and when, review, and what it replaced. */
export type IntakeProvenance = {
  raw: string;
  normalized: string;
  source: string;
  /** A correction's proof document, on the matter's Documents tab. */
  sourceHref: string | null;
  by: string;
  at: string;
  review: string;
  earlier: { value: string; by: string; at: string }[];
};

export type IntakePanel = {
  responseId: string;
  title: string[];
  badge: IntakeBadge;
  answered: number;
  total: number;
  percent: number;
  by: string[];
  sections: { label: string; badge: IntakeBadge }[];
  versions: string;
  rows: IntakeReviewRow[];
  submitted: boolean;
  frozen: boolean;
  /** INT-04: Reuse approved facts is offered on a draft whose person sent a form on another matter. */
  reuse?: boolean;
};

/** INT-04: an answer copied from the person's earlier matter, and whether they have reconfirmed it. */
export type IntakeReuse = {
  answerId: string;
  status: "needs_reconfirmation" | "confirmed" | "replaced";
  confirmedAt: string | null;
  /** The earlier matter's reference, or null when this member can't read it. */
  originRef: string | null;
};

export type IntakeResponseInput = {
  id: string;
  personName: string;
  title: string;
  versionNumber: number;
  status: "draft" | "submitted";
  submittedAt: string | null;
  frozenAt: string | null;
  fields: IntakeField[];
  answers: AnswerVersion[];
  reviewed: ReadonlySet<string>;
  corrections: { number: number; fieldKey: string | null; answerId: string | null; description: string | null; createdAt: string }[];
  record: PersonRecord | null;
  documents: { purpose: string; expiresOn: string | null }[];
  otherBirths: AnswerVersion[];
  /** INT-04: who reviewed each answer version, and when. */
  reviews?: ReadonlyMap<string, { by: string | null; at: string }>;
  /** INT-04: a correction's proof document link, by the answer version it made. */
  proofHref?: (answerId: string) => string | null;
  /** INT-04: answers copied from the person's earlier matter on this form. */
  reuses?: readonly IntakeReuse[];
  /** INT-04: the person sent a form on another matter, so earlier answers may be reused here. */
  earlierForms?: boolean;
};

/** "24 Oct 14:05" in the firm's zone. */
export function stampAt(iso: string, timeZone: string): string {
  try {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
    return `${shortDay(iso, timeZone)} ${time}`;
  } catch {
    return shortDay(iso, timeZone);
  }
}

/** The raw value as saved, readable: its text, else the stored JSON (short). */
export function rawText(raw: Record<string, unknown> | undefined): string {
  if (!raw || Object.keys(raw).length === 0) return "Nothing entered";
  if (typeof raw.text === "string") return raw.text;
  const json = JSON.stringify(raw);
  return json.length > 200 ? `${json.slice(0, 199)}…` : json;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const INTAKE_REVIEW_ROLES = ["firm_owner", "licensed_consultant", "case_manager"] as const;

export function mayHandleIntake(role: string): boolean {
  return (INTAKE_REVIEW_ROLES as readonly string[]).includes(role);
}

export function shortDay(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric", month: "short" }).formatToParts(new Date(iso));
    return `${parts.find((part) => part.type === "day")?.value ?? ""} ${(parts.find((part) => part.type === "month")?.value ?? "").replace(".", "")}`;
  } catch {
    const date = new Date(iso);
    return `${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`;
  }
}

export function correctionRef(n: number): string {
  return `CR-${String(n).padStart(4, "0")}`;
}

function partial(field: IntakeField, answer: AnswerVersion): string {
  const text = answerText(field, answer);
  if (field.type === "date" && answer.presence === "provided" && typeof answer.value.calendar_date !== "string") return `${text} (partial date)`;
  return text;
}

/**
 * One response as the Designer's questionnaire panel and its review table. `who(userId)` names the
 * person who saved an answer (the client by first name, a staff member by name).
 */
export function intakePanel(input: IntakeResponseInput, who: (userId: string | null) => string, timeZone: string, today: string): IntakePanel {
  const answers = latestAnswers(input.answers);
  const progress = formProgress(input.fields, answers);
  const flags = reviewFlags({ fields: input.fields, answers, record: input.record, otherBirths: input.otherBirths, documents: input.documents, today });
  const flagFor = new Map<string, ReviewFlag>();
  for (const flag of flags) if (flag.fieldKey && !flagFor.has(flag.fieldKey)) flagFor.set(flag.fieldKey, flag);
  const correctionFor = new Map(input.corrections.filter((row) => row.answerId).map((row) => [row.answerId as string, row]));
  const submitted = input.status === "submitted";
  const reuseFor = new Map((input.reuses ?? []).map((reuse) => [reuse.answerId, reuse]));

  const rows: IntakeReviewRow[] = [];
  for (const field of visibleFields(input.fields, answers)) {
    const entry = answers.get(field.key);
    if (!entry) continue;
    const latest = entry.latest;
    const reviewed = input.reviewed.has(latest.id);
    const flag = flagFor.get(field.key);
    const correction = correctionFor.get(latest.id);
    const source = [firstWord(who(latest.createdBy)) || "Someone", `v${entry.versionNumber}`, shortDay(latest.createdAt, timeZone)];
    if (correction) source.push(correctionRef(correction.number));
    const reuse = reuseFor.get(latest.id);
    const from = reuse ? `Reused from ${reuse.originRef ?? "an earlier matter"}` : null;
    if (from) source.push(from);
    const review = input.reviews?.get(latest.id);
    const provenance: IntakeProvenance | null = input.reviews
      ? {
          raw: rawText(latest.raw),
          normalized: answerText(field, latest),
          source: correction
            ? `Correction ${correctionRef(correction.number)} to ${input.title} v${input.versionNumber}`
            : reuse
              ? `${from}: an answer reviewed there. ${reuse.status === "confirmed" ? `The client confirmed it${reuse.confirmedAt ? ` ${stampAt(reuse.confirmedAt, timeZone)}` : ""}.` : "The client hasn’t confirmed it yet."}`
              : `Answer on ${input.title} v${input.versionNumber}`,
          sourceHref: input.proofHref?.(latest.id) ?? null,
          by: who(latest.createdBy),
          at: stampAt(latest.createdAt, timeZone),
          review: reviewed ? `Reviewed${review?.by ? ` by ${who(review.by)}` : ""}${review ? `, ${stampAt(review.at, timeZone)}` : ""}` : submitted ? "Not reviewed yet" : "Draft: not submitted",
          earlier: [...entry.history].reverse().map((old) => ({ value: answerText(field, old), by: who(old.createdBy), at: stampAt(old.createdAt, timeZone) })),
        }
      : null;
    rows.push({
      key: field.key,
      question: fieldLabel(field),
      answer: flag && flag.kind !== "birth" && flag.kind !== "name" ? `${partial(field, latest)}. ${flag.detail}` : partial(field, latest),
      source,
      badge:
        flag && !reviewed
          ? { tone: "chg", label: flag.label }
          : reviewed
            ? { tone: "ok", label: "Reviewed" }
            : submitted
              ? { tone: "rev", label: "Awaiting review" }
              : reuse?.status === "needs_reconfirmation"
                ? { tone: "rev", label: "Needs client reconfirmation" }
                : reuse?.status === "confirmed"
                  ? { tone: "ok", label: "Client confirmed" }
                  : { tone: "unv", label: "Draft" },
      answerId: submitted ? latest.id : null,
      reviewed,
      provenance,
    });
  }
  for (const flag of flags.filter((item) => item.kind === "expired")) {
    rows.push({ key: `doc:${flag.detail}`, question: flag.detail.replace(/ expired .*$/, ""), answer: flag.detail, source: ["Document"], badge: { tone: "chg", label: flag.label }, answerId: null, reviewed: false });
  }
  for (const correction of input.corrections.filter((row) => !row.fieldKey && row.description)) {
    rows.push({
      key: `cr:${correction.number}`,
      question: `Something else (${correctionRef(correction.number)})`,
      answer: correction.description as string,
      source: [firstWord(input.personName), shortDay(correction.createdAt, timeZone)],
      badge: { tone: "chg", label: "Correction asked" },
      answerId: null,
      reviewed: false,
    });
  }

  const answeredRows = rows.filter((row) => row.answerId);
  const reviewedCount = answeredRows.filter((row) => row.reviewed).length;
  const waiting = answeredRows.length - reviewedCount;
  const badge: IntakeBadge = !submitted
    ? progress.answered === 0
      ? { tone: "unv", label: "Sent, not started" }
      : { tone: "rev", label: `In progress, ${progress.answered} of ${progress.total}` }
    : input.frozenAt
      ? { tone: "ok", label: `Snapshot frozen ${shortDay(input.frozenAt, timeZone)}` }
      : waiting === 0 && flags.length === 0
        ? { tone: "ok", label: "Reviewed" }
        : { tone: "rev", label: `Submitted ${input.submittedAt ? shortDay(input.submittedAt, timeZone) : ""}, awaiting review`.replace(" ,", ",") };

  const sections: { label: string; badge: IntakeBadge }[] = submitted
    ? [
        { label: "Answers reviewed", badge: { tone: reviewedCount === answeredRows.length ? "ok" : "rev", label: `${reviewedCount} of ${answeredRows.length}` } },
        { label: "Review flags", badge: flags.length ? { tone: "chg", label: `${flags.length} to check` } : { tone: "ok", label: "None" } },
      ]
    : [
        { label: "Answered so far", badge: { tone: "rev", label: `${progress.answered} of ${progress.total}` } },
        { label: "Required, still missing", badge: progress.missing.length ? { tone: "chg", label: String(progress.missing.length) } : { tone: "ok", label: "None" } },
      ];
  if (input.corrections.length) sections.push({ label: "Corrections asked", badge: { tone: "chg", label: String(input.corrections.length) } });
  const waitingClient = rows.filter((row) => row.badge.label === "Needs client reconfirmation").length;
  if (!submitted && reuseFor.size) sections.push({ label: "Reused, client to confirm", badge: waitingClient ? { tone: "rev", label: String(waitingClient) } : { tone: "ok", label: "None" } });

  const by = [`answered by ${firstWord(input.personName)}`];
  if (progress.unknown) by.push(`${progress.unknown} marked “I don’t know”`);

  return {
    responseId: input.id,
    title: [input.personName, `${input.title} v${input.versionNumber}`],
    badge,
    answered: progress.answered,
    total: progress.total,
    percent: progress.percent,
    by,
    sections,
    versions: "Every change is a new version; earlier versions stay on record. An answer that changes after review needs reviewing again. Flags are things to check, never a finding of fraud.",
    rows,
    submitted,
    frozen: Boolean(input.frozenAt),
    reuse: !submitted && !input.frozenAt && input.earlierForms === true,
  };
}

/** The person options for Send a form: applicant first, with their role and whether they can sign in. */
export function sendPersonLabel(name: string, role: string, hasLogin: boolean): string {
  return `${name} · ${role}${hasLogin ? "" : " · not invited to the portal yet"}`;
}

/** The latest published version of each form, newest change first. */
export function publishedForms(rows: readonly { id: string; stable_key: string; title: string; version_number: number; status: string; effective_on: string | null }[], today: string) {
  return rows
    .filter((row) => row.status === "published" && (!row.effective_on || row.effective_on <= today))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((row) => ({ id: row.id, label: `${row.title} · v${row.version_number}` }));
}


