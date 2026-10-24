"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { uploadOwnFile } from "./own-upload";
import { confirmReusedFact, requestIntakeCorrection, saveIntakeAnswerLive, submitIntakeLive } from "@/modules/intake/delivery-actions";
import type { PortalIntake, PortalIntakeForm } from "@/modules/intake/portal-load";
import {
  allowsNotApplicable,
  allowsUnknown,
  answerText,
  choiceLabel,
  countryName,
  dateInputOf,
  entryMissing,
  fieldLabel,
  formProgress,
  latestAnswers,
  MONTHS,
  partialText,
  questionCount,
  readDateInput,
  readEntries,
  sameAnswer,
  visibleFields,
  type AnswerVersion,
  type HistoryEntry,
  type LatestAnswer,
  type PartialDate,
  type Presence,
} from "@/modules/intake/present";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";
import type { PortalViewer } from "@/modules/portal/load";
import { ISO_COUNTRY_CODES } from "@/lib/iso-country";
import type { Json } from "@/types/database.types";

/**
 * The Designer's portal "Background questions" page (`markup/portal-intake.tsx`) and "Request a
 * correction" page (`markup/portal-correction.tsx`), from the person's own intake forms (PRD INT-03,
 * INT-06). Same DOM and classes as the capture: heading, progress with the saved time, the sections
 * nav, the form (partial dates with Exact / Approximate / I don’t know, repeatable entries, radio
 * choices), Review and send with the missing-answer lock, and the four-step correction.
 *
 * Live-only additions (built from the Designer's own parts and documented in the fidelity tests):
 * the list of forms (the Designer's Tasks card), a month select with every month, a field's
 * "Answer / I don’t know / Not applicable" switch for questions that accept them (the Designer's
 * `.seg`), text, address, country, declaration and file fields (`.fld`, `.inp`, `.ta`, `.sel`,
 * `label.check`, `.drop`), and the offline and conflict alerts (`.alert warn`).
 */

const SPRITE = "/assets/icons-coreui/sprite.svg";

function Icon({ name, cls = "ic s" }: { name: string; cls?: string }) {
  return (
    <svg className={cls} aria-hidden="true">
      <use href={`${SPRITE}#i-${name}`}></use>
    </svg>
  );
}

function Sep() {
  return <span className="sep" aria-hidden="true"></span>;
}

const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;

/** "A · B · C" with the Designer's separators. */
function Joined({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <> <Sep /> </> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/** The Designer's display heading, one `.rbw` span per word. */
export function Display({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  return (
    <h1 className="display" data-rb-done="1" aria-label={text}>
      {words.map((word, index) => (
        <Fragment key={index}>
          {index > 0 ? " " : null}
          <span aria-hidden="true" className="rbw" style={{ display: "inline-block" }}>
            {word}
          </span>
        </Fragment>
      ))}
    </h1>
  );
}

export function clockIn(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayMonth(iso: string, timeZone: string): string {
  const date = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric", month: "short" }).formatToParts(date);
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value.replace(".", "") ?? "";
    return `${day} ${month}`;
  } catch {
    return `${date.getUTCDate()} ${SHORT_MONTH[date.getUTCMonth()]}`;
  }
}

/** "Fri 23 Oct" for a date-only due date. */
function dueLabel(dueOn: string): string {
  const [y, m, d] = dueOn.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return `${WEEKDAY[date.getUTCDay()]} ${d} ${SHORT_MONTH[m - 1]}`;
}

export function formHref(responseId: string): string {
  return `/portal/intake?response=${responseId}`;
}

export function correctionHref(responseId: string): string {
  return `/portal/correction?response=${responseId}`;
}

/* ================================================================ list */

export type IntakeCard = { responseId: string; title: string; line: string; percent: number; dueOn: string | null; status: "draft" | "submitted" };

export function intakeCards(forms: readonly PortalIntakeForm[], timeZone: string): IntakeCard[] {
  return forms.map((form) => {
    const answers = latestAnswers(form.answers);
    const progress = formProgress(form.fields, answers);
    const line =
      form.status === "submitted"
        ? `Sent ${form.submittedAt ? dayMonth(form.submittedAt, timeZone) : ""}. Your firm has your answers.`.replace("Sent .", "Sent.")
        : progress.answered === 0
          ? `${questionCount(progress.total)}. Your answers save as you go.`
          : `${progress.answered} of ${progress.total} answered. Your answers save as you go.`;
    return { responseId: form.responseId, title: form.title, line, percent: progress.percent, dueOn: form.dueOn, status: form.status };
  });
}

/** The person's forms as the Designer's Tasks cards: to do first, then sent. */
export function IntakeList({ viewer, data }: { viewer: PortalViewer; data: PortalIntake }) {
  const cards = intakeCards(data.forms, viewer.timezone);
  const open = cards.filter((card) => card.status === "draft");
  const sent = cards.filter((card) => card.status === "submitted");
  let n = 1;
  const card = (row: IntakeCard) => (
    <div key={row.responseId} className={`task${row.status === "submitted" ? " done" : ""} rv`} style={i(n++)}>
      <span className={row.status === "submitted" ? "ck on" : "ck "} role="checkbox" aria-checked={row.status === "submitted" ? "true" : "false"} aria-label={row.title} tabIndex={0}></span>
      <div>
        <h3>{row.title}</h3>
        <p>{row.line}</p>
        <div className="meta">
          {row.status === "draft" ? <span className="lbl num">{`${row.percent}% done`}</span> : null}
          {row.status === "draft" && row.dueOn ? (
            <span className="chip dt">
              <Icon name="clock" />
              {`Due ${dueLabel(row.dueOn)}`}
            </span>
          ) : null}
        </div>
      </div>
      <span className="r">
        <a className={row.status === "draft" ? "btn p sm" : "btn sm"} href={formHref(row.responseId)}>
          {row.status === "submitted" ? "View" : row.percent > 0 ? "Resume" : "Start"}
        </a>
      </span>
    </div>
  );
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={i(0)}>
        <div>
          <Display text="Your questions" />
          <p>{`Forms ${viewer.organizationName} asked you to fill in. Your answers save as you type, so you can stop any time and come back.`}</p>
        </div>
      </div>
      {cards.length === 0 ? (
        <div className="panel rv" style={i(1)}>
          <div className="emp">
            <b>No questions yet</b>
            <small>When your firm sends you a form to fill in, it appears here.</small>
          </div>
        </div>
      ) : null}
      {open.length ? <h2 className="sub">To do</h2> : null}
      {open.map(card)}
      {sent.length ? <h2 className="sub">Sent</h2> : null}
      {sent.map(card)}
    </div>
  );
}

/* ============================================================ controls */

type Sure = "exact" | "approximate" | "unknown" | "not_applicable";

/** Designer-captured thumb positions for a three-option `.seg` (corrected by measuring after mount). */
const THUMB: [number, number][] = [
  [3, 207],
  [104, 105],
  [206, 3],
];

/** The Designer's rubber-band radio group (`.seg.k2-rs`), with its thumb under the chosen option. */
export function Seg({
  label,
  options,
  value,
  onChange,
  style,
}: {
  label: string;
  options: { key: string; text: string }[];
  value: string;
  onChange?: (key: string) => void;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const at = Math.max(0, options.findIndex((option) => option.key === value));
  const [left, right] = THUMB[Math.min(at, THUMB.length - 1)];
  useLayoutEffect(() => {
    const group = ref.current;
    const thumb = group?.querySelector<HTMLElement>(".k2-rs-th");
    const button = group?.querySelectorAll<HTMLElement>("button")[at];
    if (!group || !thumb || !button) return;
    const box = group.getBoundingClientRect();
    const own = button.getBoundingClientRect();
    if (box.width === 0) return;
    thumb.style.left = `${own.left - box.left}px`;
    thumb.style.right = `${box.right - own.right}px`;
  }, [at, options.length]);
  return (
    <div ref={ref} className="seg k2-rs" style={style} role="radiogroup" aria-label={label} data-rubber="1">
      <span className="k2-rs-th" aria-hidden="true" style={{ transition: "none", left: `${left}px`, right: `${right}px` }}></span>
      {options.map((option, index) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={index === at ? "true" : "false"}
          tabIndex={index === at ? 0 : -1}
          onClick={onChange ? () => onChange(option.key) : undefined}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <span className="emsg">
      <Icon name="alert" />
      {text}
    </span>
  );
}

function Req({ on }: { on: boolean }) {
  return on ? (
    <span className="req" aria-hidden="true">
      *
    </span>
  ) : null;
}

export type DateDraft = { day: string; month: string; year: string; sure: Sure };

/**
 * The Designer's partial date (`fieldset.fld` with `.pdate`: day, month, year) and, for a question,
 * its "How sure are you" switch. Only what is typed is kept.
 */
export function DateField({
  id,
  legend,
  required,
  hint,
  value,
  error,
  sure,
  onChange,
  onBlur,
}: {
  id?: string;
  legend: string;
  required: boolean;
  hint?: string | null;
  value: DateDraft;
  error?: string | null;
  /** The switch's options; absent, no switch (a period inside a history entry). */
  sure?: { key: Sure; text: string }[] | null;
  onChange?: (next: DateDraft) => void;
  onBlur?: () => void;
}) {
  const set = (patch: Partial<DateDraft>) => onChange?.({ ...value, ...patch });
  const blank = value.sure === "unknown" || value.sure === "not_applicable";
  return (
    <fieldset className={error ? "fld err" : "fld"} id={id} onBlur={onBlur}>
      <legend>
        {legend}
        <Req on={required} />
      </legend>
      {hint ? <span className="hint">{hint}</span> : null}
      <div className="pdate">
        <input className="inp num" aria-label="Day" placeholder="DD" inputMode="numeric" maxLength={2} value={value.day} disabled={blank} onChange={(event) => set({ day: event.target.value })} />
        <select className="sel" aria-label="Month" value={value.month} disabled={blank} onChange={(event) => set({ month: event.target.value })}>
          <option value="">Month</option>
          {MONTHS.map((month, index) => (
            <option key={month} value={String(index + 1)}>
              {month}
            </option>
          ))}
        </select>
        <input
          className="inp num"
          aria-label="Year"
          {...(value.year ? {} : { placeholder: "YYYY" })}
          inputMode="numeric"
          maxLength={4}
          value={value.year}
          disabled={blank}
          {...(error ? { "aria-invalid": "true" as const } : {})}
          onChange={(event) => set({ year: event.target.value })}
        />
      </div>
      {error ? <ErrorLine text={error} /> : null}
      {sure ? <Seg label="How sure are you" options={sure} value={value.sure} style={{ marginTop: "8px" }} onChange={(key) => set({ sure: key as Sure })} /> : null}
    </fieldset>
  );
}

/** The Designer's radio question (`.fld[role=radiogroup]` of `label.radio`). */
export function ChoiceField({
  id,
  label,
  aria,
  name,
  options,
  value,
  error,
  onChange,
}: {
  id?: string;
  label: string;
  /** The group's accessible name, when it differs from the question (the Designer's "Purpose"). */
  aria?: string;
  name: string;
  options: { key: string; text: string }[];
  value: string;
  error?: string | null;
  onChange?: (key: string) => void;
}) {
  return (
    <div className={error ? "fld err" : "fld"} id={id} role="radiogroup" aria-label={aria ?? label}>
      <span style={{ fontSize: "14px", fontWeight: "500" }}>{label}</span>
      {options.map((option) => (
        <label key={option.key} className="radio">
          <input type="radio" name={name} checked={value === option.key} onChange={() => onChange?.(option.key)} />
          <span>{option.text}</span>
        </label>
      ))}
      {error ? <ErrorLine text={error} /> : null}
    </div>
  );
}

/** A finished history entry, folded: the Designer's "Trip 1 · Complete" panel. */
export function CollapsedEntry({ title, parts, onOpen }: { title: string; parts: string[]; onOpen?: () => void }) {
  return (
    <div className="panel">
      <h2>
        {title}
        <span className="r">
          <span className="bd ok">
            <i></i>Complete
          </span>
        </span>
      </h2>
      <div
        className="pad"
        style={{ fontSize: "14.5px" }}
        {...(onOpen
          ? {
              role: "button",
              tabIndex: 0,
              "aria-label": `Change ${title}`,
              onClick: onOpen,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen();
                }
              },
            }
          : {})}
      >
        <Joined parts={parts} />
      </div>
    </div>
  );
}

/* =============================================================== drafts */

type Mode = "answer" | "unknown" | "not_applicable";
type EntryDraft = { details: string; from: DateDraft; to: DateDraft };
type Draft = {
  text: string;
  mode: Mode;
  date: DateDraft;
  choice: string;
  checked: boolean;
  entries: EntryDraft[];
  open: number | null;
  file: string;
};

const EMPTY_DATE: DateDraft = { day: "", month: "", year: "", sure: "exact" };

function partialToDraft(date: PartialDate | null): DateDraft {
  if (!date) return EMPTY_DATE;
  return { day: date.day ? String(date.day) : "", month: date.month ? String(date.month) : "", year: String(date.year), sure: "exact" };
}

function draftToPartial(draft: DateDraft): PartialDate | null | { error: string } {
  if (!draft.year.trim() && !draft.month && !draft.day.trim()) return null;
  const read = readDateInput({ ...draft, sure: "exact" });
  if ("error" in read) return read;
  const value = read.value;
  if (typeof value.calendar_date === "string") {
    const [y, m, d] = value.calendar_date.split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  return { year: value.year as number, month: (value.month as number | undefined) ?? null };
}

function draftOf(field: IntakeField, answer: AnswerVersion | undefined): Draft {
  const mode: Mode = answer?.presence === "unknown" ? "unknown" : answer?.presence === "not_applicable" ? "not_applicable" : "answer";
  const value = answer?.value ?? {};
  const entries = readEntries(value.entries).map((entry) => ({ details: entry.details, from: partialToDraft(entry.from), to: partialToDraft(entry.to) }));
  return {
    text: typeof value.text === "string" ? value.text : "",
    mode,
    date: dateInputOf(answer),
    choice: answer ? (mode === "answer" ? (typeof value.text === "string" ? value.text : "") : mode) : "",
    checked: value.declaration === true,
    entries,
    open: null,
    file: field.type === "file_request" && typeof value.text === "string" ? value.text : "",
  };
}

/** What to save for a field's draft, or why it can't be saved yet (null: nothing to save). */
export function draftAnswer(field: IntakeField, draft: Draft): { presence: Presence; value: Record<string, unknown> } | { error: string } | null {
  if (draft.mode === "unknown") return { presence: "unknown", value: {} };
  if (draft.mode === "not_applicable") return { presence: "not_applicable", value: {} };
  switch (field.type) {
    case "date": {
      if (!draft.date.year.trim() && !draft.date.month && !draft.date.day.trim() && draft.date.sure !== "unknown" && draft.date.sure !== "not_applicable") return null;
      return readDateInput(draft.date);
    }
    case "choice":
      if (!draft.choice) return null;
      if (draft.choice === "unknown") return { presence: "unknown", value: {} };
      if (draft.choice === "not_applicable") return { presence: "not_applicable", value: {} };
      return { presence: "provided", value: { text: draft.choice } };
    case "declaration":
      return { presence: "provided", value: { declaration: draft.checked } };
    case "country":
      return draft.text ? { presence: "provided", value: { text: draft.text } } : null;
    case "repeatable":
    case "relationship": {
      const entries: HistoryEntry[] = [];
      for (const entry of draft.entries) {
        const from = draftToPartial(entry.from);
        const to = draftToPartial(entry.to);
        if (from && "error" in from) return { error: from.error };
        if (to && "error" in to) return { error: to.error };
        entries.push({ details: entry.details.trim(), from: from as PartialDate | null, to: to as PartialDate | null });
      }
      return { presence: "provided", value: { entries } };
    }
    case "file_request":
      return draft.file ? { presence: "provided", value: { text: draft.file } } : null;
    default:
      return draft.text.trim() ? { presence: "provided", value: { text: draft.text } } : null;
  }
}

function modeOptions(field: IntakeField): { key: string; text: string }[] | null {
  const unknown = allowsUnknown(field) && field.allow_unknown === true;
  const na = allowsNotApplicable(field) && field.allow_not_applicable === true;
  if (!unknown && !na) return null;
  return [{ key: "answer", text: "Answer" }, ...(unknown ? [{ key: "unknown", text: "I don’t know" }] : []), ...(na ? [{ key: "not_applicable", text: "Not applicable" }] : [])];
}

function sureOptions(field: IntakeField): { key: Sure; text: string }[] {
  return [
    { key: "exact", text: "Exact" },
    { key: "approximate", text: "Approximate" },
    ...(allowsUnknown(field) ? [{ key: "unknown" as Sure, text: "I don’t know" }] : []),
    ...(allowsNotApplicable(field) && field.allow_not_applicable === true ? [{ key: "not_applicable" as Sure, text: "Not applicable" }] : []),
  ];
}

const COUNTRIES = [...ISO_COUNTRY_CODES].map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

/* ============================================================== the form */

type Pending = Record<string, { presence: Presence; value: Record<string, unknown> }>;
type Conflict = { fieldKey: string; theirs: { presence: string; value: Json } | null };

function storeKey(responseId: string) {
  return `casevoya.intake.${responseId}`;
}

function readPending(responseId: string): Pending {
  try {
    const raw = window.localStorage.getItem(storeKey(responseId));
    const parsed = raw ? (JSON.parse(raw) as Pending) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePending(responseId: string, pending: Pending) {
  try {
    if (Object.keys(pending).length) window.localStorage.setItem(storeKey(responseId), JSON.stringify(pending));
    else window.localStorage.removeItem(storeKey(responseId));
  } catch {
    // Without storage an unsaved answer stays only on this page until it saves.
  }
}

export type ReviewRow = {
  key: string;
  label: string;
  text: string;
  missing: boolean;
  href: string;
  link: string;
  num?: boolean;
  /** INT-04, live only: an answer copied from the person's earlier matter, waiting for them to confirm it. */
  reuse?: { label: string; busy: boolean; onConfirm: () => void };
};

export function reviewRows(fields: readonly IntakeField[], answers: ReadonlyMap<string, LatestAnswer>, hrefFor: (key: string) => string, linkText: string): ReviewRow[] {
  return visibleFields(fields, answers).map((field) => {
    const answer = answers.get(field.key)?.latest;
    const answered = field.type === "declaration" ? answer?.value.declaration === true : Boolean(answer);
    const missing = Boolean(field.required) && !answered;
    let text = answer ? answerText(field, answer) : "Not answered yet";
    if (answer && (answer.presence === "unknown" || answer.presence === "not_applicable")) text = `Answer: ${text}`;
    const num = field.type === "date" && answer?.presence === "provided";
    return { key: field.key, label: fieldLabel(field), text, missing, href: hrefFor(field.key), link: missing ? "Fix" : linkText, num };
  });
}

/** The Designer's "Review and send" panel. `send` absent: the answers were sent (a correction link instead). */
export function ReviewPanel({
  firm,
  rows,
  rightLabel,
  send,
  after,
}: {
  firm: string;
  rows: ReviewRow[];
  rightLabel: string;
  /** `waiting`: answers from an earlier matter still to confirm (INT-04). */
  send?: { missing: number; busy: boolean; onSend: () => void; waiting?: number } | null;
  after?: ReactNode;
}) {
  return (
    <section id="rv" className="review panel" style={{ marginTop: "32px" }}>
      <h2>
        <Icon name="eye" />
        {send ? "Review and send" : "Your answers"}
        <span className="r lbl">{rightLabel}</span>
      </h2>
      <div className="pad">
        <dl>
          {rows.map((row) => (
            <Fragment key={row.key}>
              <dt>{row.label}</dt>
              <dd {...(row.num ? { className: "num" } : {})}>
                {row.missing ? (
                  <>
                    <span className="bd chg">
                      <i></i>Missing
                    </span>{" "}
                  </>
                ) : null}
                {row.reuse ? (
                  <>
                    <span className="bd rev">
                      <i></i>
                      {row.reuse.label}
                    </span>{" "}
                  </>
                ) : null}
                {row.text}
              </dd>
              <dd>
                {row.reuse ? (
                  <>
                    <button className={row.reuse.busy ? "btn sm is-loading" : "btn sm"} type="button" {...(row.reuse.busy ? { "aria-busy": "true" as const } : {})} onClick={row.reuse.onConfirm}>
                      Confirm
                    </button>{" "}
                  </>
                ) : null}
                <a href={row.href}>{row.link}</a>
              </dd>
            </Fragment>
          ))}
        </dl>
        <div className="alert info" style={{ marginTop: "16px" }}>
          <Icon name="info" cls="ic " />
          <div>
            <b>Where your answers go</b>
            {`${firm} reads them and checks them against your documents. Answers you mark “I don’t know” stay unknown, they’re never guessed.`}
          </div>
        </div>
        {send ? (
          <>
            <button
              className={send.busy ? "btn p is-loading" : "btn p"}
              {...(send.missing > 0 || send.waiting ? { "aria-disabled": "true" as const, "aria-describedby": "w2" } : {})}
              {...(send.busy ? { "aria-busy": "true" as const } : {})}
              onClick={send.onSend}
            >
              {`Send answers to ${firm}`}
            </button>
            {send.missing > 0 ? (
              <div className="why" id="w2">
                <Icon name="lock" />
                {`Fix ${send.missing} missing answer${send.missing === 1 ? "" : "s"} first`}
              </div>
            ) : send.waiting ? (
              <div className="why" id="w2">
                <Icon name="lock" />
                {`Confirm or change ${send.waiting} answer${send.waiting === 1 ? "" : "s"} from your earlier matter first`}
              </div>
            ) : null}
          </>
        ) : null}
        {after}
      </div>
    </section>
  );
}

/** The heading, progress and saved time at the top of a form. */
export function IntakeTop({ title, lead, step, percent, saved }: { title: string; lead: string; step: string; percent: number; saved: string | null }) {
  return (
    <>
      <div className="ph pp-h rv" style={i(0)}>
        <div>
          <Display text={title} />
          <p>{lead}</p>
        </div>
      </div>
      <div className="kd-row rv" style={{ ...i(1), marginBottom: "20px", gap: "14px" }}>
        <div style={{ flex: "1", maxWidth: "420px" }}>
          <div className="pmeta">
            <b>{step}</b>
            <span className="num">{`${percent}% done`}</span>
          </div>
          <div className="prog">
            <i style={{ "--v": `${percent}%` } as CSSProperties}></i>
          </div>
        </div>
        {saved ? (
          <span className="saved lbl" id="sv" style={{ display: "flex", gap: "6px", alignItems: "center", color: "var(--ok)" }}>
            <Icon name="check-circle" />
            {"Saved "}
            <time className="num" id="svt">
              {saved}
            </time>
          </span>
        ) : null}
      </div>
    </>
  );
}

export type NavItem = { label: string; href: string; state: "done" | "on" | "todo" | "review" | "fix" };

/** The Designer's section list beside the form. */
export function SectionNav({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Sections">
      {items.map((item) =>
        item.state === "review" ? (
          <a key={item.label} href={item.href} className="">
            <Icon name="eye" />
            {item.label}
          </a>
        ) : item.state === "fix" ? (
          <a key={item.label} href={item.href}>
            <Icon name="edit" />
            {item.label}
          </a>
        ) : (
          <a key={item.label} href={item.href} className={item.state === "on" ? "on " : item.state === "done" ? " dn" : " "} {...(item.state === "on" ? { "aria-current": "step" as const } : {})}>
            <Icon name={item.state === "done" ? "check-circle" : item.state === "on" ? "edit" : "minus"} />
            {item.label}
          </a>
        ),
      )}
    </nav>
  );
}

export function IntakeForm({ viewer, form }: { viewer: PortalViewer; form: PortalIntakeForm }) {
  const router = useRouter();
  const firm = viewer.organizationName;
  const personId = viewer.person?.id ?? "";
  const versionRef = useRef(form.version);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timers = useRef(new Map<string, number>());
  // What this page last knew was saved for each answer: a conflict caused only by another answer's save is retried quietly.
  const known = useRef(new Map<string, string>(form.answers.map((row) => [row.fieldKey, JSON.stringify([row.presence, row.value])])));
  const [answers, setAnswers] = useState<Map<string, LatestAnswer>>(() => latestAnswers(form.answers));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const latest = latestAnswers(form.answers);
    return Object.fromEntries(form.fields.map((field) => [field.key, draftOf(field, latest.get(field.key)?.latest)]));
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string>(form.updatedAt);
  const [pending, setPending] = useState<Pending>({});
  const pendingRef = useRef<Pending>({});
  const [offline, setOffline] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // INT-04: answers your firm copied from your earlier matter; each is confirmed here or changed.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set((form.reuses ?? []).filter((reuse) => reuse.status === "confirmed").map((reuse) => reuse.id)));
  const [confirming, setConfirming] = useState<string | null>(null);

  const submitted = form.status === "submitted";
  const fields = form.fields;
  const progress = formProgress(fields, answers);
  const visible = visibleFields(fields, answers);
  const waiting = (form.reuses ?? []).filter((reuse) => reuse.status === "needs_reconfirmation" && !confirmed.has(reuse.id) && answers.get(reuse.fieldKey)?.latest.id === reuse.answerId);

  const confirmReuse = (reuseId: string) => {
    if (confirming) return;
    setConfirming(reuseId);
    void confirmReusedFact({ organizationId: viewer.organizationId, reuseId }).then((result) => {
      setConfirming(null);
      if ("error" in result) {
        toast2(result.error, { kind: "bad", sub: "Check the answer, then confirm it again or change it." });
        return;
      }
      setConfirmed((current) => new Set(current).add(reuseId));
    });
  };

  const updatePending = useCallback(
    (next: Pending) => {
      pendingRef.current = next;
      setPending(next);
      writePending(form.responseId, next);
    },
    [form.responseId],
  );

  const flush = useCallback(
    (key: string) => {
      chain.current = chain.current.then(async () => {
        const item = pendingRef.current[key];
        if (!item) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setOffline(true);
          return;
        }
        let result: Awaited<ReturnType<typeof saveIntakeAnswerLive>> | null = null;
        // A second try only when the conflict came from another answer's save (this one is unchanged elsewhere).
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            result = await saveIntakeAnswerLive({
              organizationId: viewer.organizationId,
              responseId: form.responseId,
              expectedVersion: versionRef.current,
              fieldKey: key,
              presence: item.presence,
              value: item.value as Json,
            });
          } catch {
            setOffline(true);
            return;
          }
          if (!("conflict" in result)) break;
          versionRef.current = result.version;
          const theirs = result.latest ? JSON.stringify([result.latest.presence, result.latest.value]) : undefined;
          if (theirs !== known.current.get(key)) break;
        }
        if (!result) return;
        setOffline(false);
        if ("conflict" in result) {
          setConflict({ fieldKey: key, theirs: result.latest });
          return;
        }
        if ("error" in result) {
          setErrors((current) => ({ ...current, [key]: result.error }));
          return;
        }
        versionRef.current = result.version;
        const stored = (result.value && typeof result.value === "object" && !Array.isArray(result.value) ? result.value : {}) as Record<string, unknown>;
        known.current.set(key, JSON.stringify([item.presence, stored]));
        setSavedAt(result.savedAt);
        setErrors((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setAnswers((current) => {
          const next = new Map(current);
          const previous = current.get(key);
          const version: AnswerVersion = { id: result.answerId, fieldKey: key, presence: item.presence, value: stored, createdAt: result.savedAt, createdBy: null };
          next.set(key, { latest: version, versionNumber: (previous?.versionNumber ?? 0) + 1, history: previous ? [...previous.history, previous.latest] : [] });
          return next;
        });
        const rest = { ...pendingRef.current };
        if (rest[key] === item) delete rest[key];
        updatePending(rest);
      });
      return chain.current;
    },
    [form.responseId, updatePending, viewer.organizationId],
  );

  // Answers typed while offline (or before a reload) are saved when the page is back online.
  useEffect(() => {
    if (submitted) return;
    const stored = readPending(form.responseId);
    if (Object.keys(stored).length) {
      pendingRef.current = stored;
      queueMicrotask(() => setPending(stored));
      for (const key of Object.keys(stored)) void flush(key);
    }
    const online = () => {
      setOffline(false);
      for (const key of Object.keys(pendingRef.current)) void flush(key);
    };
    const gone = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", gone);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", gone);
    };
  }, [flush, form.responseId, submitted, updatePending]);

  const schedule = (field: IntakeField, draft: Draft, now = false) => {
    const read = draftAnswer(field, draft);
    const timer = timers.current.get(field.key);
    if (timer) window.clearTimeout(timer);
    if (read == null) {
      if (pendingRef.current[field.key]) {
        const rest = { ...pendingRef.current };
        delete rest[field.key];
        updatePending(rest);
      }
      return;
    }
    if ("error" in read) {
      setErrors((current) => ({ ...current, [field.key]: read.error }));
      return;
    }
    setErrors((current) => {
      if (!current[field.key]) return current;
      const next = { ...current };
      delete next[field.key];
      return next;
    });
    updatePending({ ...pendingRef.current, [field.key]: read });
    if (now) void flush(field.key);
    else timers.current.set(field.key, window.setTimeout(() => void flush(field.key), 800));
  };

  const change = (field: IntakeField, patch: Partial<Draft>, now = false) => {
    const next = { ...drafts[field.key], ...patch };
    setDrafts((current) => ({ ...current, [field.key]: next }));
    // Opening or folding a history entry changes nothing to save.
    if (Object.keys(patch).every((key) => key === "open")) return;
    schedule(field, next, now);
  };

  const keepMine = () => {
    if (!conflict) return;
    const key = conflict.fieldKey;
    setConflict(null);
    void flush(key);
  };
  const useSaved = () => {
    if (!conflict) return;
    const key = conflict.fieldKey;
    const field = fields.find((item) => item.key === key);
    const rest = { ...pendingRef.current };
    delete rest[key];
    updatePending(rest);
    setConflict(null);
    if (!field) return;
    // Show what is saved now; what this page typed is dropped only because the person chose so.
    const theirs = conflict.theirs;
    const saved: AnswerVersion | undefined = theirs
      ? { id: `saved-${key}`, fieldKey: key, presence: theirs.presence as Presence, value: (theirs.value ?? {}) as Record<string, unknown>, createdAt: new Date().toISOString(), createdBy: null }
      : undefined;
    if (theirs) known.current.set(key, JSON.stringify([theirs.presence, theirs.value]));
    setDrafts((current) => ({ ...current, [key]: draftOf(field, saved) }));
    setAnswers((current) => {
      const next = new Map(current);
      if (saved) {
        const previous = current.get(key);
        next.set(key, { latest: saved, versionNumber: (previous?.versionNumber ?? 0) + 1, history: previous ? [...previous.history, previous.latest] : [] });
      } else next.delete(key);
      return next;
    });
  };

  const send = () => {
    if (sending) return;
    if (progress.missing.length > 0) {
      const first = progress.missing[0];
      setErrors((current) => ({ ...current, ...Object.fromEntries(progress.missing.map((field) => [field.key, current[field.key] ?? "This question needs an answer."])) }));
      document.getElementById(`q-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (waiting.length > 0) {
      toast2("Confirm the answers from your earlier matter first", { kind: "warn", sub: "Each one is marked in Review and send. Confirm it if it’s still right, or change it." });
      document.getElementById("rv")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setSending(true);
    void (async () => {
      for (const key of Object.keys(pendingRef.current)) await flush(key);
      await chain.current;
      if (Object.keys(pendingRef.current).length) {
        setSending(false);
        toast2("Some answers aren’t saved yet", { kind: "warn", sub: "They’re kept on this device. Send again once they save." });
        return;
      }
      const result = await submitIntakeLive({ organizationId: viewer.organizationId, responseId: form.responseId, expectedVersion: versionRef.current });
      setSending(false);
      if ("error" in result) {
        toast2(result.error, { kind: "bad", sub: result.conflict ? "Your answers changed somewhere else. The page shows the latest now." : "Nothing was sent." });
        if (result.conflict) router.refresh();
        return;
      }
      toast2(`Sent to ${firm}`, { kind: "ok", sub: form.isSample ? "Sample file: your firm sees it in the app. No email is sent." : `${firm} reads your answers next. You can ask for a correction any time.` });
      router.refresh();
    })();
  };

  const upload = (field: IntakeField, file: File | undefined) => {
    if (!file || !personId) return;
    setUploading(field.key);
    void (async () => {
      const done = await uploadOwnFile({ organizationId: viewer.organizationId, matterId: form.matterId, personId, purpose: `${fieldLabel(field)} (${form.title})`, file });
      setUploading(null);
      if ("error" in done) {
        setErrors((current) => ({ ...current, [field.key]: done.error }));
        return;
      }
      const text = `Uploaded ${file.name}`;
      const next = { ...drafts[field.key], file: text, mode: "answer" as Mode };
      setDrafts((current) => ({ ...current, [field.key]: next }));
      updatePending({ ...pendingRef.current, [field.key]: { presence: "provided", value: { text, document_id: done.documentId } } });
      void flush(field.key);
    })();
  };

  const saved = clockIn(savedAt, viewer.timezone);
  const lead = submitted
    ? `You sent these answers${form.submittedAt ? ` on ${dayMonth(form.submittedAt, viewer.timezone)}` : ""}. ${firm} reviews them. If something is wrong, ask for a correction: the answer you sent stays on record.`
    : `${questionCount(progress.total)}. Your answers save as you type, so you can stop any time and come back.`;

  if (submitted) {
    const rows = reviewRows(fields, answers, (key) => `${correctionHref(form.responseId)}&field=${key}`, "Correct");
    return (
      <div id="pc">
        <IntakeTop title={form.title} lead={lead} step="Sent" percent={progress.percent} saved={null} />
        <ReviewPanel
          firm={firm}
          rows={rows.map((row) => ({ ...row, missing: false, link: "Correct" }))}
          rightLabel={form.frozen ? `${firm} has locked these answers` : `Sent to ${firm}`}
          after={
            <a className="btn p" href={correctionHref(form.responseId)}>
              Ask for a correction
            </a>
          }
        />
      </div>
    );
  }

  const nav: NavItem[] = [
    { label: `1. ${form.title}`, href: "#f", state: "on" },
    { label: "Review and send", href: "#rv", state: "review" },
  ];

  return (
    <div id="pc">
      <IntakeTop title={form.title} lead={lead} step="Section 1 of 1" percent={progress.percent} saved={saved} />
      {offline ? (
        <div className="alert warn" role="status" style={{ marginBottom: "16px" }}>
          <Icon name="info" cls="ic " />
          <div>
            <b>You’re offline</b>
            {`Your answers are kept on this device and saved when you’re back online${Object.keys(pending).length ? ` (${Object.keys(pending).length} waiting)` : ""}. The saved time shows the last answer that reached your firm.`}
          </div>
        </div>
      ) : null}
      {waiting.length ? (
        <div className="alert info" role="status" style={{ marginBottom: "16px" }}>
          <Icon name="info" cls="ic " />
          <div>
            <b>Answers from your earlier matter</b>
            {`${firm} filled ${waiting.length} answer${waiting.length === 1 ? "" : "s"} from what you told them before${waiting[0].originRef ? ` (${waiting[0].originRef})` : ""}. Check each one in Review and send: confirm it if it’s still right, or change it.`}
          </div>
        </div>
      ) : null}
      {conflict ? (
        <div className="alert warn" role="alert" style={{ marginBottom: "16px" }}>
          <Icon name="alert" cls="ic " />
          <div>
            <b>{`“${fieldLabel(fields.find((field) => field.key === conflict.fieldKey) ?? { key: conflict.fieldKey, type: "text", labels: {} })}” changed somewhere else`}</b>
            {conflict.theirs
              ? `Another window, or your firm, saved a different answer. What you typed here is kept until you choose.`
              : "Another window, or your firm, changed this form. What you typed here is kept until you choose."}
            <div className="kd-row" style={{ marginTop: "10px", gap: "8px" }}>
              <button className="btn p sm" type="button" onClick={keepMine}>
                Keep my answer
              </button>
              <button className="btn sm" type="button" onClick={useSaved}>
                Use the saved answer
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="secs">
        <SectionNav items={nav} />
        <form id="f" noValidate data-live="1" onSubmit={(event) => event.preventDefault()}>
          <h2 style={{ fontSize: "26px", fontWeight: "300", marginBottom: "4px" }}>{form.title}</h2>
          <p className="lbl" style={{ marginBottom: "22px" }}>
            {form.message ?? "If you don’t remember an exact date, enter what you know. We never fill in the rest for you."}
          </p>
          {visible.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              draft={drafts[field.key]}
              error={errors[field.key] ?? null}
              uploading={uploading === field.key}
              onChange={(patch, now) => change(field, patch, now)}
              onBlur={() => {
                const timer = timers.current.get(field.key);
                if (timer && pendingRef.current[field.key]) {
                  window.clearTimeout(timer);
                  void flush(field.key);
                }
              }}
              onFile={(file) => upload(field, file)}
            />
          ))}
          <div className="fnav">
            <a className="btn" href="/portal/intake">
              All your questions
            </a>
            <button className="btn p" type="button" id="nx" onClick={() => document.getElementById("rv")?.scrollIntoView({ behavior: "smooth" })}>
              Next: Review and send
            </button>
          </div>
        </form>
      </div>
      <ReviewPanel
        firm={firm}
        rows={reviewRows(fields, answers, (key) => `#q-${key}`, "Change").map((row) => {
          const reuse = waiting.find((item) => item.fieldKey === row.key);
          return reuse ? { ...row, reuse: { label: "From your earlier matter", busy: confirming === reuse.id, onConfirm: () => confirmReuse(reuse.id) } } : row;
        })}
        rightLabel={`Nothing goes to ${firm} until you send`}
        send={{ missing: progress.missing.length, busy: sending, onSend: send, waiting: waiting.length }}
      />
    </div>
  );
}

function FieldControl({
  field,
  draft,
  error,
  uploading,
  onChange,
  onBlur,
  onFile,
}: {
  field: IntakeField;
  draft: Draft;
  error: string | null;
  uploading: boolean;
  onChange: (patch: Partial<Draft>, now?: boolean) => void;
  onBlur: () => void;
  onFile: (file: File | undefined) => void;
}) {
  const id = `q-${field.key}`;
  const label = fieldLabel(field);
  const required = Boolean(field.required);
  const modes = modeOptions(field);
  const modeSwitch = modes ? (
    <Seg label={`How to answer ${label}`} options={modes} value={draft.mode} style={{ marginTop: "8px" }} onChange={(key) => onChange({ mode: key as Mode }, true)} />
  ) : null;
  const answering = draft.mode === "answer";

  if (field.type === "date") {
    return (
      <DateField
        id={id}
        legend={label}
        required={required}
        hint="Day is optional. Choose “approximate” if you’re not sure."
        value={draft.date}
        error={error}
        sure={sureOptions(field)}
        onChange={(next) => onChange({ date: next, mode: next.sure === "unknown" ? "unknown" : next.sure === "not_applicable" ? "not_applicable" : "answer" }, next.sure !== draft.date.sure)}
        onBlur={onBlur}
      />
    );
  }
  if (field.type === "choice") {
    const options = [
      ...(field.options ?? []).map((option) => ({ key: option, text: choiceLabel(option) })),
      ...(allowsUnknown(field) && field.allow_unknown === true ? [{ key: "unknown", text: "I don’t know" }] : []),
      ...(allowsNotApplicable(field) && field.allow_not_applicable === true ? [{ key: "not_applicable", text: "Not applicable" }] : []),
    ];
    return <ChoiceField id={id} label={label} name={id} options={options} value={draft.choice} error={error} onChange={(key) => onChange({ choice: key, mode: "answer" }, true)} />;
  }
  if (field.type === "declaration") {
    return (
      <div className={error ? "fld err" : "fld"} id={id}>
        <label className="check">
          <input type="checkbox" checked={draft.checked} onChange={(event) => onChange({ checked: event.target.checked, mode: "answer" }, true)} />
          <span>
            {label}
            <Req on={required} />
          </span>
        </label>
        {error ? <ErrorLine text={error} /> : null}
      </div>
    );
  }
  if (field.type === "repeatable" || field.type === "relationship") {
    return <HistoryControl field={field} draft={draft} error={error} onChange={onChange} onBlur={onBlur} modeSwitch={modeSwitch} />;
  }
  if (field.type === "file_request") {
    return (
      <div className={error ? "fld err" : "fld"} id={id}>
        <label htmlFor={`${id}-i`}>
          {label}
          <Req on={required} />
        </label>
        <span className="hint">The file goes to your documents. Your firm reviews it before accepting it.</span>
        {answering ? (
          <div className="drop">
            <Icon name="cloud-upload" cls="ic l" />
            <b style={{ fontWeight: "500" }}>{draft.file || (uploading ? "Uploading…" : "Choose a file")}</b>
            <label className="btn">
              <Icon name="paperclip" />
              {draft.file ? "Choose another file" : "Choose a file"}
              <input type="file" className="sr" id={`${id}-i`} accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic" disabled={uploading} onChange={(event) => onFile(event.target.files?.[0])} />
            </label>
            <small className="lbl">
              PDF, JPG, PNG or HEIC <Sep /> up to 25 MB
            </small>
          </div>
        ) : null}
        {error ? <ErrorLine text={error} /> : null}
        {modeSwitch}
      </div>
    );
  }
  if (field.type === "country") {
    return (
      <div className={error ? "fld err" : "fld"} id={id}>
        <label htmlFor={`${id}-i`}>
          {label}
          <Req on={required} />
        </label>
        <select className="sel" id={`${id}-i`} value={answering ? draft.text : ""} disabled={!answering} onChange={(event) => onChange({ text: event.target.value, mode: "answer" }, true)}>
          <option value="">Choose a country</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        {error ? <ErrorLine text={error} /> : null}
        {modeSwitch}
      </div>
    );
  }
  const long = field.type === "address" || field.ui === "long";
  return (
    <div className={error ? "fld err" : "fld"} id={id}>
      <label htmlFor={`${id}-i`}>
        {label}
        <Req on={required} />
      </label>
      {long ? (
        <textarea className="ta" id={`${id}-i`} value={answering ? draft.text : ""} disabled={!answering} maxLength={4000} {...(error ? { "aria-invalid": "true" as const } : {})} onChange={(event) => onChange({ text: event.target.value, mode: "answer" })} onBlur={onBlur} placeholder={field.type === "address" ? "Street, city, province or state, postal code, country" : undefined}></textarea>
      ) : (
        <input className="inp" id={`${id}-i`} value={answering ? draft.text : ""} disabled={!answering} maxLength={1000} {...(error ? { "aria-invalid": "true" as const } : {})} onChange={(event) => onChange({ text: event.target.value, mode: "answer" })} onBlur={onBlur} />
      )}
      {error ? <ErrorLine text={error} /> : null}
      {modeSwitch}
    </div>
  );
}

function HistoryControl({
  field,
  draft,
  error,
  onChange,
  onBlur,
  modeSwitch,
}: {
  field: IntakeField;
  draft: Draft;
  error: string | null;
  onChange: (patch: Partial<Draft>, now?: boolean) => void;
  onBlur: () => void;
  modeSwitch: ReactNode;
}) {
  const label = fieldLabel(field);
  const id = `q-${field.key}`;
  const entries = draft.entries;
  const setEntry = (index: number, patch: Partial<EntryDraft>) => {
    const next = entries.map((entry, at) => (at === index ? { ...entry, ...patch } : entry));
    onChange({ entries: next, mode: "answer" });
  };
  const complete = (entry: EntryDraft) => {
    const from = draftToPartial(entry.from);
    return entry.details.trim() && from && !("error" in from);
  };
  return (
    <div id={id} onBlur={onBlur}>
      <div className="fld">
        <span style={{ fontSize: "14px", fontWeight: "500" }}>
          {label}
          <Req on={Boolean(field.required)} />
        </span>
      </div>
      {draft.mode === "answer"
        ? entries.map((entry, index) => {
            const title = `Entry ${index + 1}`;
            if (draft.open !== index && complete(entry)) {
              const parsed: HistoryEntry = { details: entry.details, from: draftToPartial(entry.from) as PartialDate, to: (draftToPartial(entry.to) as PartialDate | null) ?? null };
              const range = parsed.to ? `${partialText(parsed.from)} to ${partialText(parsed.to)}` : `from ${partialText(parsed.from)}`;
              return <CollapsedEntry key={index} title={title} parts={[entry.details.trim(), range]} onOpen={() => onChange({ open: index })} />;
            }
            const missing = entryMissing({ details: entry.details, from: draftToPartial(entry.from) as PartialDate | null, to: null });
            return (
              <div className="panel" key={index}>
                <h2>
                  {title}
                  <span className="r">
                    {missing ? (
                      <span className="bd chg">
                        <i></i>
                        {`${missing} answer${missing === 1 ? "" : "s"} missing`}
                      </span>
                    ) : (
                      <span className="bd ok">
                        <i></i>Complete
                      </span>
                    )}
                  </span>
                </h2>
                <div className="pad">
                  <div className="fld">
                    <label htmlFor={`${id}-${index}-d`}>
                      Details
                      <span className="req" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <input className="inp" id={`${id}-${index}-d`} value={entry.details} maxLength={500} onChange={(event) => setEntry(index, { details: event.target.value })} />
                  </div>
                  <DateField legend="From" required hint="Day is optional." value={entry.from} onChange={(next) => setEntry(index, { from: next })} />
                  <DateField legend="To" required={false} hint="Leave it empty if it’s still the case." value={entry.to} onChange={(next) => setEntry(index, { to: next })} />
                  <div className="kd-row" style={{ gap: "8px" }}>
                    <button className="btn sm" type="button" onClick={() => onChange({ open: null })} disabled={!complete(entry)}>
                      Done
                    </button>
                    <button className="btn s sm" type="button" onClick={() => onChange({ entries: entries.filter((_, at) => at !== index), open: null, mode: "answer" }, true)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        : null}
      {error ? <ErrorLine text={error} /> : null}
      {draft.mode === "answer" ? (
        <button className="btn" type="button" onClick={() => onChange({ entries: [...entries, { details: "", from: EMPTY_DATE, to: EMPTY_DATE }], open: entries.length })}>
          <Icon name="plus" />
          {entries.length ? "Add another entry" : "Add an entry"}
        </button>
      ) : null}
      {modeSwitch}
    </div>
  );
}

/* ========================================================== correction */

const CORRECTABLE = new Set(["text", "address", "date", "country", "choice"]);

export type CorrectionOption = { key: string; label: string; answered: string; detail?: string | null };

export function correctionOptions(form: PortalIntakeForm): CorrectionOption[] {
  const answers = latestAnswers(form.answers);
  return visibleFields(form.fields, answers)
    .filter((field) => CORRECTABLE.has(field.type) && answers.has(field.key))
    .map((field) => ({ key: field.key, label: fieldLabel(field), answered: answerText(field, (answers.get(field.key) as LatestAnswer).latest) }));
}

const STEPS = ["1. What’s wrong", "2. The right answer", "3. Proof", "4. Send"];

/** The Designer's stepper (`ol.stepper#cst`): done steps, the current one, the rest. */
export function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" id="cst">
      {STEPS.map((label, index) => (
        <li key={label} className={index === step ? "c" : index < step ? "d" : ""}>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Step 1's list of answers (`.pick`), with "Something else". */
export function CorrectionPick({ options, picked, firm, onPick }: { options: CorrectionOption[]; picked: string; firm: string; onPick?: (key: string) => void }) {
  return (
    <div className="pick">
      {options.map((option) => (
        <label key={option.key}>
          <input type="radio" name="cq" checked={picked === option.key} onChange={() => onPick?.(option.key)} />
          <span>
            <b style={{ fontWeight: "500" }}>
              {option.detail ? (
                <>
                  {`${option.label} `}
                  <Sep />
                  {` ${option.detail}`}
                </>
              ) : (
                option.label
              )}
            </b>
            <small>{`You answered: ${option.answered}`}</small>
          </span>
        </label>
      ))}
      <label>
        <input type="radio" name="cq" checked={picked === ""} onChange={() => onPick?.("")} />
        <span>
          <b style={{ fontWeight: "500" }}>Something else</b>
          <small>{`Describe it and ${firm} will find it`}</small>
        </span>
      </label>
    </div>
  );
}

export function CorrectionFlow({ viewer, form, initialField }: { viewer: PortalViewer; form: PortalIntakeForm; initialField: string | null }) {
  const firm = viewer.organizationName;
  const options = useMemo(() => correctionOptions(form), [form]);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string>(initialField && options.some((option) => option.key === initialField) ? initialField : (options[0]?.key ?? ""));
  const field = form.fields.find((item) => item.key === picked) ?? null;
  const latest = useMemo(() => latestAnswers(form.answers), [form.answers]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = draft ?? (field ? draftOf(field, latest.get(field.key)?.latest) : null);
  const [describe, setDescribe] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const submitted = form.status === "submitted";
  const reviewedOn = form.submittedAt ? dayMonth(form.submittedAt, viewer.timezone) : null;

  const pick = (key: string) => {
    setPicked(key);
    setDraft(null);
    setError(null);
  };

  const next = () => {
    setError(null);
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!field && !describe.trim()) {
        setError("Describe what needs fixing.");
        return;
      }
      if (field && current) {
        const read = draftAnswer(field, current);
        if (!read) {
          setError("Give the right answer.");
          return;
        }
        if ("error" in read) {
          setError(read.error);
          return;
        }
        if (sameAnswer(read, latest.get(field.key)?.latest)) {
          setError("That’s the same as the answer you sent. Change it, or go back and describe the problem.");
          return;
        }
      }
      setStep(2);
      return;
    }
    if (step === 2 && !busy) {
      setBusy(true);
      void (async () => {
        let proof: string | null = null;
        if (file && viewer.person) {
          const done = await uploadOwnFile({ organizationId: viewer.organizationId, matterId: form.matterId, personId: viewer.person.id, purpose: `Proof for a correction (${form.title})`, file });
          if ("error" in done) {
            setBusy(false);
            setError(done.error);
            return;
          }
          proof = done.documentId;
        }
        const read = field && current ? draftAnswer(field, current) : null;
        const answer = read && !("error" in read) ? read : null;
        const result = await requestIntakeCorrection({
          organizationId: viewer.organizationId,
          responseId: form.responseId,
          fieldKey: field && answer ? field.key : null,
          presence: answer?.presence ?? null,
          value: (answer?.value as Json) ?? null,
          reason,
          description: field ? "" : describe,
          proofDocumentId: proof,
        });
        setBusy(false);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setReference(result.reference);
        setStep(3);
      })();
    }
  };

  return (
    <div id="pc">
      <div className="flow">
        <a className="lbl" href={formHref(form.responseId)} style={{ display: "inline-flex", gap: "6px", alignItems: "center", marginBottom: "12px" }}>
          <Icon name="chevron-left" />
          {form.title}
        </a>
        <div className="ph pp-h rv" style={i(0)}>
          <div>
            <Display text="Request a correction" />
            <p>
              {submitted
                ? `You sent these answers${reviewedOn ? ` on ${reviewedOn}` : ""}, so they’re locked. Tell us what needs fixing. ${firm} checks it; your correction becomes a new version and the old one stays on record.`
                : "These answers aren’t sent yet, so you can still change them in the form."}
            </p>
          </div>
        </div>
        {submitted ? (
          <>
            <Stepper step={step} />
            <section className={step === 0 ? "fstep on" : "fstep"} data-c="0">
              <h2 style={{ fontSize: "22px", fontWeight: "400", marginBottom: "12px" }}>Which answer is wrong?</h2>
              <CorrectionPick options={options} picked={picked} firm={firm} onPick={pick} />
            </section>
            <section className={step === 1 ? "fstep on" : "fstep"} data-c="1">
              <h2 style={{ fontSize: "22px", fontWeight: "400", marginBottom: "12px" }}>{field ? "What should it say?" : "What needs fixing?"}</h2>
              {field && current ? (
                <CorrectValue field={field} draft={current} onChange={(patch) => setDraft({ ...current, ...patch })} />
              ) : (
                <div className="fld">
                  <label htmlFor="cv">What needs fixing</label>
                  <textarea className="ta" id="cv" value={describe} maxLength={2000} onChange={(event) => setDescribe(event.target.value)}></textarea>
                </div>
              )}
              <div className="fld">
                <label htmlFor="cr">
                  Why it changed
                  <span className="opt k2-spot" data-spot="1">
                    optional
                  </span>
                </label>
                <textarea className="ta" id="cr" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)}></textarea>
              </div>
            </section>
            <section className={step === 2 ? "fstep on" : "fstep"} data-c="2">
              <h2 style={{ fontSize: "22px", fontWeight: "400", marginBottom: "6px" }}>Add proof, if you have it</h2>
              <p className="lbl" style={{ marginBottom: "12px" }}>{`A document helps ${firm} accept the change faster. You can skip this.`}</p>
              <div className="drop">
                <Icon name="cloud-upload" cls="ic l" />
                <b style={{ fontWeight: "500" }}>{file ? file.name : "Drop a file, or"}</b>
                <label className="btn">
                  <Icon name="paperclip" />
                  Choose a file
                  <input type="file" className="sr" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                </label>
                <small className="lbl">
                  PDF, JPG, PNG or HEIC <Sep /> up to 25 MB
                </small>
              </div>
            </section>
            <section className={step === 3 ? "fstep on" : "fstep"} data-c="3">
              <div className="panel">
                <div className="pad" style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  <img src="/assets/vo/vo-cheer-96.png" srcSet="/assets/vo/vo-cheer-192.png 2x" width="56" height="56" alt="" />
                  <div>
                    <h2 style={{ fontSize: "22px", fontWeight: "400" }}>
                      Correction sent <Sep /> {reference ?? ""}
                    </h2>
                    <p style={{ marginTop: "6px" }}>
                      {field
                        ? `${firm} reviews it. Your corrected answer is saved as a new version; the answer you sent first stays on record.`
                        : `${firm} reads what you wrote and fixes the answer with you. Your earlier answers stay on record.`}
                      {form.isSample ? " Sample file: no email is sent." : ""}
                    </p>
                    <div className="kd-row" style={{ marginTop: "12px" }}>
                      <a className="btn p" href="/portal">
                        Back to home
                      </a>
                      <a className="btn" href="/portal/messages">{`Message ${firm}`}</a>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            {error ? (
              <p className="emsg" role="alert" style={{ marginTop: "12px" }}>
                <Icon name="alert" />
                {error}
              </p>
            ) : null}
            <div className="fnav" id="cnav" hidden={step === 3}>
              <button className="btn" id="cb" disabled={step === 0 || busy} onClick={() => setStep((at) => Math.max(0, at - 1))}>
                Back
              </button>
              <button className={busy ? "btn p is-loading" : "btn p"} id="cn" onClick={next} {...(busy ? { "aria-busy": "true" as const } : {})}>
                {step === 2 ? "Send correction" : "Continue"}
              </button>
            </div>
          </>
        ) : (
          <a className="btn p" href={formHref(form.responseId)}>
            Back to the form
          </a>
        )}
      </div>
    </div>
  );
}

function CorrectValue({ field, draft, onChange }: { field: IntakeField; draft: Draft; onChange: (patch: Partial<Draft>) => void }) {
  if (field.type === "date") {
    return <DateField id="cv" legend="Correct answer" required={false} hint="Day is optional." value={draft.date} sure={sureOptions(field)} onChange={(next) => onChange({ date: next, mode: next.sure === "unknown" ? "unknown" : next.sure === "not_applicable" ? "not_applicable" : "answer" })} />;
  }
  if (field.type === "choice") {
    const options = [
      ...(field.options ?? []).map((option) => ({ key: option, text: choiceLabel(option) })),
      ...(allowsUnknown(field) && field.allow_unknown === true ? [{ key: "unknown", text: "I don’t know" }] : []),
      ...(allowsNotApplicable(field) && field.allow_not_applicable === true ? [{ key: "not_applicable", text: "Not applicable" }] : []),
    ];
    return <ChoiceField id="cv" label="Correct answer" name="cvq" options={options} value={draft.choice} onChange={(key) => onChange({ choice: key, mode: "answer" })} />;
  }
  if (field.type === "country") {
    return (
      <div className="fld">
        <label htmlFor="cv">Correct answer</label>
        <select className="sel" id="cv" value={draft.text} onChange={(event) => onChange({ text: event.target.value, mode: "answer" })}>
          <option value="">Choose a country</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="fld">
      <label htmlFor="cv">Correct answer</label>
      <input className="in" id="cv" value={draft.mode === "answer" ? draft.text : ""} maxLength={1000} onChange={(event) => onChange({ text: event.target.value, mode: "answer" })} />
    </div>
  );
}

/** /portal/intake and /portal/correction: the chosen form, or the list. */
export function IntakeLive({ viewer, data, correction, field }: { viewer: PortalViewer; data: PortalIntake; correction: boolean; field?: string | null }) {
  const form = data.forms.find((item) => item.responseId === data.selected) ?? null;
  if (correction) {
    const target = form ?? data.forms.find((item) => item.status === "submitted") ?? null;
    if (!target) {
      return (
        <div id="pc">
          <div className="ph pp-h rv" style={i(0)}>
            <div>
              <Display text="Request a correction" />
              <p>A correction is for answers you already sent.</p>
            </div>
          </div>
          <div className="panel">
            <div className="emp">
              <b>Nothing to correct yet</b>
              <small>Once you send a form to your firm, you can ask for a correction here.</small>
            </div>
          </div>
        </div>
      );
    }
    return <CorrectionFlow key={target.responseId} viewer={viewer} form={target} initialField={field ?? null} />;
  }
  if (!form) return <IntakeList viewer={viewer} data={data} />;
  return <IntakeForm key={form.responseId} viewer={viewer} form={form} />;
}

