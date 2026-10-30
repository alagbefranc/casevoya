/**
 * The output guard for Vo's letter drafts (PRD AI-01, AI-03, AI-05, SRC-09; RULES.md). Pure.
 * Whatever the model returns is untrusted. Like the message guard (guard.ts) it is reduced to plain
 * text and links, email addresses and phone numbers are removed. Then, sentence by sentence:
 *
 *  - a citation marker the run never handed out ([F9] when there is no F9) is removed;
 *  - a sentence that states a fee or other money amount, a program requirement (a fee, a
 *    deadline, a processing time, a requirement, eligibility, a regulation) or a duration must
 *    cite approved official content ([S#]); a duration or a calendar date may instead come from an
 *    approved fact ([F#]);
 *  - a sentence that doesn't meet that, or that holds Vo's own "[needs ...]" markers, is LEFT OUT,
 *    and the draft says so: each removal adds a line to `leftOut`.
 *
 * The letter must still cite at least one approved fact. The database checks the citations again
 * (public.save_vo_letter_draft). React escapes the text when it is shown.
 */
import { allowedVoLink } from "./guard";
import { LETTER_MAX_CHARS } from "./letter";
import { NEEDS_CONSULTANT, NEEDS_RULE } from "./prompt";

export type LetterGuardResult =
  | { kind: "draft"; text: string; facts: string[]; official: string[]; leftOut: string[] }
  | { kind: "abstain" }
  | { kind: "empty"; reason: "empty" | "no_fact" };

const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const TAG = /<\/?[a-z][^>]{0,300}>/gi;
export const MONEY = /(?:(?:CA?\$|C\$|\$|CAD|USD|EUR|€|£)\s?\d|\b\d[\d,\s]*(?:[.,]\d+)?\s?(?:\$|CAD|USD|dollars?)(?![a-z]))/i;
/** Every money amount in full, as guard.ts matches it, for the left-out notes. */
export const MONEY_ALL = /(?:(?:CA?\$|C\$|\$|CAD|USD|EUR|€|£)\s?\d[\d,\s]*(?:[.,]\d+)?(?:\s?\$)?|\b\d[\d,\s]*(?:[.,]\d+)?\s?(?:\$|CAD|USD|dollars?)(?![a-z]))/gi;
/** Where a link, email address or phone number was removed: the sentence is left out. */
export const REMOVED = "⟦removed⟧";
export const DURATION =
  /\b\d+(?:[.,]\d+)?(?:\s*(?:-|–|to|à)\s*\d+(?:[.,]\d+)?)?\s*(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|years?|jours?|semaines?|mois|ans?|années?)\b/i;
export const REQUIREMENT =
  /\b(?:fees?|frais|processing\s+times?|délais?|deadlines?|requirements?|required|requires?|exigences?|eligib\w*|admissib\w*|regulations?|règlements?|IRPA|IRPR|LIPR|RIPR|subsection|paragraph\s+\d)\b/i;
export const DATE = /\b(?:\d{4}-\d{2}(?:-\d{2})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;

/** A letter carries no firm booking link: only the client portal survives (guard.ts). */
function allowed(url: string): boolean {
  return allowedVoLink(url);
}

const MONTH_NUMBER: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function moneyKey(match: string): string {
  const digits = match.replace(/[^\d.,]/g, "");
  const decimal = /[.,](\d{1,2})$/.exec(digits);
  const whole = (decimal ? digits.slice(0, decimal.index) : digits).replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  const cents = decimal && !/^0+$/.test(decimal[1]) ? `.${decimal[1].padEnd(2, "0")}` : "";
  return `${whole}${cents}`;
}

function durationKey(match: string): string {
  const numbers = (match.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")).join("-");
  const unit = /day|jour/i.test(match) ? "day" : /week|semaine/i.test(match) ? "week" : /month|mois/i.test(match) ? "month" : "year";
  return `${numbers} ${unit}`;
}

function dateKey(match: string): string {
  const value = match.trim();
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (iso) return iso[3] ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[1]}-${iso[2]}`;
  const dmy = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(value);
  if (dmy) return `${dmy[3]}-${MONTH_NUMBER[dmy[2].toLowerCase()]}-${dmy[1].padStart(2, "0")}`;
  const mdy = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value);
  if (mdy) return `${mdy[3]}-${MONTH_NUMBER[mdy[1].toLowerCase()]}-${mdy[2].padStart(2, "0")}`;
  return value.toLowerCase();
}

/** The money amounts, durations and calendar dates in a text, each in a comparable form. */
export function claimTokens(text: string): { money: string[]; durations: string[]; dates: string[] } {
  const plain = text.replace(/\[[RFS]\d{1,3}\]/g, " ");
  return {
    money: [...plain.matchAll(MONEY_ALL)].map((m) => moneyKey(m[0])).filter(Boolean),
    durations: [...plain.matchAll(new RegExp(DURATION.source, "gi"))].map((m) => durationKey(m[0])),
    dates: [...plain.matchAll(new RegExp(DATE.source, "gi"))].map((m) => dateKey(m[0])),
  };
}

/**
 * Whether every money amount in `sentence` appears in `support.money` (the cited official content),
 * and every duration and date in `support.other` (official content or approved facts it cites).
 * `support.dates` false skips the date check (a sentence that also cites a matter record).
 */
export function claimsSupported(sentence: string, support: { money: readonly string[]; other: readonly string[]; dates?: boolean }): boolean {
  const said = claimTokens(sentence);
  if (!said.money.length && !said.durations.length && !said.dates.length) return true;
  const money = new Set(claimTokens(support.money.join("\n")).money);
  const other = claimTokens(support.other.join("\n"));
  const durations = new Set(other.durations);
  const dates = new Set(other.dates);
  return (
    said.money.every((key) => money.has(key)) &&
    said.durations.every((key) => durations.has(key)) &&
    (support.dates === false || said.dates.every((key) => dates.has(key)))
  );
}

/** Plain text, as guard.ts makes it, without its money and duration placeholders. */
export function clean(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/<<<[^>]*>>>/g, "")
    .replace(TAG, "")
    .replace(MARKDOWN_LINK, (_, label: string, href: string) => (allowed(href) ? `${label} (${href})` : label))
    .replace(/(\*\*|__|`{1,3})/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(URL, (url) => (allowed(url) ? url : REMOVED))
    .replace(EMAIL, REMOVED)
    .replace(PHONE, (match) => (/\d{4}-\d{2}-\d{2}/.test(match) ? match : REMOVED))
    .trim();
}

/** A short, plain reason line for what was left out (no amounts, durations or contact details). */
function noteLine(text: string): string {
  return text
    .replace(/\[[FS]\d{1,3}\]/g, "")
    .replaceAll(REMOVED, "")
    .replace(MONEY_ALL, " an amount ")
    .replace(new RegExp(DURATION.source, "gi"), "a period")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])/g, "$1")
    .trim()
    .slice(0, 160);
}

/** Splits a paragraph into sentences, keeping each sentence's own punctuation. */
export function sentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+(?=\S)/).filter((part) => part.trim());
}

/**
 * Guards one letter draft. `facts` and `official` are the markers this run handed out ("F1",
 * "S2"...); `notes` are what the model itself said it left out. `contents` (marker to the text the
 * run handed out with it): a sentence citing [S#] keeps a money amount only if the cited official
 * content states it, and a duration or date only if the cited official content or fact states it.
 */
export function guardLetter(
  raw: unknown,
  refs: { facts: Iterable<string>; official: Iterable<string> },
  notes: unknown = [],
  contents?: ReadonlyMap<string, string>,
): LetterGuardResult {
  if (typeof raw !== "string") return { kind: "empty", reason: "empty" };
  const text = clean(raw);
  if (!text) return { kind: "empty", reason: "empty" };
  const bare = text.replace(/^["“”«»\s]+|["“”«»\s.]+$/g, "").toLowerCase();
  if (bare === NEEDS_CONSULTANT.toLowerCase() || bare.startsWith(NEEDS_CONSULTANT.toLowerCase())) return { kind: "abstain" };

  const factRefs = new Set(refs.facts);
  const officialRefs = new Set(refs.official);
  const leftOut: string[] = [];
  const usedFacts: string[] = [];
  const usedOfficial: string[] = [];

  const paragraphs = text.split(/\n{2,}/).map((paragraph) =>
    paragraph
      .split("\n")
      .map((line) =>
        sentences(line)
          .map((sentence) => {
            // Markers this run never handed out are removed first.
            const kept = sentence.replace(/\[([FS])(\d{1,3})\]/g, (marker, kind: string, n: string) => {
              const ref = `${kind}${n}`;
              return (kind === "F" ? factRefs : officialRefs).has(ref) ? marker : "";
            });
            const cites = [...kept.matchAll(/\[([FS])(\d{1,3})\]/g)].map((match) => `${match[1]}${match[2]}`);
            const hasOfficial = cites.some((ref) => ref.startsWith("S"));
            const hasFact = cites.some((ref) => ref.startsWith("F"));
            const lower = kept.toLowerCase();
            if (kept.includes(REMOVED)) {
              leftOut.push("Left out: a sentence with a link, email address or phone number (Vo doesn’t add contact details; add them yourself if needed).");
              return "";
            }
            const placeholder = lower.includes(NEEDS_RULE.toLowerCase()) || lower.includes(NEEDS_CONSULTANT.toLowerCase());
            const regulated = MONEY.test(kept) || REQUIREMENT.test(kept);
            const dated = DURATION.test(kept) || DATE.test(kept);
            if (placeholder || (regulated && !hasOfficial) || (dated && !hasOfficial && !hasFact)) {
              leftOut.push(`Left out (no approved official source or approved fact covers it): “${noteLine(kept) || "a statement"}”`);
              return "";
            }
            if (contents && hasOfficial) {
              const text = (prefix: string) => cites.filter((ref) => ref.startsWith(prefix)).map((ref) => contents.get(ref) ?? "");
              if (!claimsSupported(kept, { money: text("S"), other: [...text("S"), ...text("F")] })) {
                leftOut.push(`Left out (the cited source doesn’t state it): “${noteLine(kept) || "a statement"}”`);
                return "";
              }
            }
            for (const ref of cites) {
              const list = ref.startsWith("F") ? usedFacts : usedOfficial;
              if (!list.includes(ref)) list.push(ref);
            }
            return kept
              .replace(/[ \t]{2,}/g, " ")
              .replace(/[ \t]+([.,;:!?])/g, "$1")
              .trim();
          })
          .filter(Boolean)
          .join(" "),
      )
      .filter((line) => line.trim())
      .join("\n"),
  );
  let out = paragraphs.filter((paragraph) => paragraph.trim()).join("\n\n").trim();
  if (out.length > LETTER_MAX_CHARS) out = out.slice(0, LETTER_MAX_CHARS).trimEnd();
  if (!out) return { kind: "empty", reason: "empty" };
  // Markers cut off by the length limit are no longer cited.
  const facts = usedFacts.filter((ref) => out.includes(`[${ref}]`));
  const official = usedOfficial.filter((ref) => out.includes(`[${ref}]`));
  if (!facts.length) return { kind: "empty", reason: "no_fact" };

  for (const note of Array.isArray(notes) ? notes.slice(0, 10) : []) {
    if (typeof note !== "string") continue;
    const line = noteLine(clean(note));
    if (line) leftOut.push(`Left out: ${line}`);
  }
  return { kind: "draft", text: out, facts, official, leftOut: [...new Set(leftOut)].slice(0, 20).map((line) => line.slice(0, 300)) };
}
