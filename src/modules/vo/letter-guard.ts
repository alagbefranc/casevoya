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
import { ALLOWED_LINK_ORIGINS } from "./guard";
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
const MONEY = /(?:(?:CA?\$|C\$|\$|CAD|USD|EUR|€|£)\s?\d|\b\d[\d,\s]*(?:[.,]\d+)?\s?(?:\$|CAD|USD|dollars?)(?![a-z]))/i;
/** Every money amount in full, as guard.ts matches it, for the left-out notes. */
const MONEY_ALL = /(?:(?:CA?\$|C\$|\$|CAD|USD|EUR|€|£)\s?\d[\d,\s]*(?:[.,]\d+)?(?:\s?\$)?|\b\d[\d,\s]*(?:[.,]\d+)?\s?(?:\$|CAD|USD|dollars?)(?![a-z]))/gi;
/** Where a link, email address or phone number was removed: the sentence is left out. */
const REMOVED = "⟦removed⟧";
const DURATION =
  /\b\d+(?:[.,]\d+)?(?:\s*(?:-|–|to|à)\s*\d+(?:[.,]\d+)?)?\s*(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|years?|jours?|semaines?|mois|ans?|années?)\b/i;
const REQUIREMENT =
  /\b(?:fees?|frais|processing\s+times?|délais?|deadlines?|requirements?|required|requires?|exigences?|eligib\w*|admissib\w*|regulations?|règlements?|IRPA|IRPR|LIPR|RIPR|subsection|paragraph\s+\d)\b/i;
const DATE = /\b(?:\d{4}-\d{2}(?:-\d{2})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;

function allowed(url: string): boolean {
  try {
    const parsed = new globalThis.URL(url.startsWith("www.") ? `https://${url}` : url);
    return parsed.protocol === "https:" && (ALLOWED_LINK_ORIGINS as readonly string[]).includes(parsed.origin) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Plain text, as guard.ts makes it, without its money and duration placeholders. */
function clean(raw: string): string {
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
function sentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+(?=\S)/).filter((part) => part.trim());
}

/**
 * Guards one letter draft. `facts` and `official` are the markers this run handed out ("F1",
 * "S2"...); `notes` are what the model itself said it left out.
 */
export function guardLetter(raw: unknown, refs: { facts: Iterable<string>; official: Iterable<string> }, notes: unknown = []): LetterGuardResult {
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
