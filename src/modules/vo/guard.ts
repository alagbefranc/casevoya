/**
 * The output guard for Vo drafts (PRD AI-03, AI-05, SRC-09; RULES.md). Pure. Whatever the model
 * returns is untrusted: it is reduced to plain text, links and contact details it could have
 * invented or been told to plant are removed (only app.casevoya.ca links survive), and any money
 * amount or duration (a fee, deadline or processing time it could only know from memory) is
 * replaced with the "[needs a sourced rule]" placeholder, which blocks sending until a person
 * replaces it. React escapes the text when it is shown; nothing here is ever rendered as HTML.
 */
import { NEEDS_CONSULTANT, NEEDS_RULE } from "./prompt";

export const MAX_DRAFT_CHARS = 4000;

/** The only links a draft may keep: the firm's own Casevoya app. */
export const ALLOWED_LINK_ORIGINS = ["https://app.casevoya.ca"] as const;

export type GuardResult = { kind: "draft"; text: string; needsRule: boolean } | { kind: "abstain" } | { kind: "empty" };

const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const MONEY = /(?:(?:CA?\$|C\$|\$|CAD|USD|EUR|€|£)\s?\d[\d,\s]*(?:[.,]\d+)?(?:\s?\$)?|\b\d[\d,\s]*(?:[.,]\d+)?\s?(?:\$|CAD|USD|dollars?)(?![a-z]))/gi;
const DURATION =
  /\b\d+(?:[.,]\d+)?(?:\s*(?:-|–|to|à)\s*\d+(?:[.,]\d+)?)?\s*(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|years?|jours?|semaines?|mois|ans?|années?)\b/gi;
const TAG = /<\/?[a-z][^>]{0,300}>/gi;

function allowed(url: string): boolean {
  try {
    const parsed = new globalThis.URL(url.startsWith("www.") ? `https://${url}` : url);
    return parsed.protocol === "https:" && (ALLOWED_LINK_ORIGINS as readonly string[]).includes(parsed.origin) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** The model's answer as a reviewable draft, an abstention, or nothing usable. */
export function guardVoOutput(raw: unknown): GuardResult {
  if (typeof raw !== "string") return { kind: "empty" };
  let text = raw
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  // Anything that tries to look like a delimiter or a tag is dropped.
  text = text.replace(/<<<[^>]*>>>/g, "").replace(TAG, "");
  if (!text) return { kind: "empty" };
  const bare = text.replace(/^["“”«»\s]+|["“”«»\s.]+$/g, "").toLowerCase();
  if (bare === NEEDS_CONSULTANT.toLowerCase() || bare.startsWith(NEEDS_CONSULTANT.toLowerCase())) return { kind: "abstain" };

  text = text
    // Markdown: links become their text (the URL is judged below), emphasis and headings go.
    .replace(MARKDOWN_LINK, (_, label: string, href: string) => (allowed(href) ? `${label} (${href})` : label))
    .replace(/(\*\*|__|`{1,3})/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(URL, (url) => (allowed(url) ? url : "[link removed]"))
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, (match) => (/\d{4}-\d{2}-\d{2}/.test(match) ? match : "[phone removed]"))
    .replace(MONEY, NEEDS_RULE)
    .replace(DURATION, NEEDS_RULE)
    // The model's own consultant marker inside a longer text also needs a person.
    .replaceAll(NEEDS_CONSULTANT, NEEDS_RULE)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  // A leading quote pair the model sometimes adds.
  if (/^["“].*["”]$/s.test(text)) text = text.slice(1, -1).trim();
  if (!text) return { kind: "empty" };
  if (text.length > MAX_DRAFT_CHARS) text = text.slice(0, MAX_DRAFT_CHARS).trimEnd();
  return { kind: "draft", text, needsRule: text.includes(NEEDS_RULE) };
}
