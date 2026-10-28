/**
 * Letters on a matter (AI-01): the letter types, the citation markers and the plain-language
 * messages. Pure, shared by the app and the Vo agent service.
 *
 * A letter cites each approved fact it uses as [F1], [F2]... and each piece of approved official
 * content as [S1], [S2]... The citations are kept with the version (matter_letter_versions); the
 * released text has the markers removed (public.release_matter_letter).
 */

export const LETTER_TYPES = {
  cover_letter: "Submission cover letter",
  explanation: "Letter of explanation",
  other: "Other letter",
} as const;

export type LetterType = keyof typeof LETTER_TYPES;

export function isLetterType(value: unknown): value is LetterType {
  return typeof value === "string" && Object.hasOwn(LETTER_TYPES, value);
}

export function letterTypeLabel(value: string): string {
  return isLetterType(value) ? LETTER_TYPES[value] : "Letter";
}

/** The longest letter version the database keeps. */
export const LETTER_MAX_CHARS = 12000;

/** One citation marker, e.g. [F2] or [S1]. */
export const CITATION = /\[([FS])(\d{1,3})\]/g;

/** The text with its citation markers removed, as the released letter reads. */
export function stripCitations(text: string): string {
  return text
    .replace(/[ \t]?\[[FS]\d{1,3}\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** The markers a text uses, in order of first use. */
export function citationsIn(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(CITATION)) {
    const ref = `${match[1]}${match[2]}`;
    if (!seen.includes(ref)) seen.push(ref);
  }
  return seen;
}

/** The released file's name: the title in plain characters, and the approved version. */
export function letterFileName(title: string, version: number): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "letter"}-v${version}.txt`;
}

let regions: Intl.DisplayNames | null = null;

/** How an approved fact reads: a country code as its name, yes/no as words (as intake shows them). */
export function factText(fieldType: string, value: string): string {
  if (fieldType === "country" && /^[A-Z]{2}$/.test(value)) {
    try {
      regions ??= new Intl.DisplayNames(["en-CA"], { type: "region" });
      return regions.of(value) ?? value;
    } catch {
      return value;
    }
  }
  if (fieldType === "choice" && (value === "yes" || value === "no")) return value === "yes" ? "Yes" : "No";
  return value;
}

const MESSAGES: Record<string, string> = {
  no_facts:
    "This matter has no approved facts Vo may use yet. Review the client’s intake answers first, or write the letter yourself.",
  capability_off: "The firm owner has turned off Vo’s letter drafts. Write the letter yourself; everything else works as usual.",
  letter_type: "Choose a letter type.",
  denied: "Only firm staff who can read this matter, signed in with two-step verification, can work on its letters.",
  approve_role: "Only a licensed member of the firm can approve a letter.",
  self: "You wrote this version yourself, so another licensed member of the firm approves it.",
  placeholder: "Replace “[needs a sourced rule]” with a checked, sourced fact (or remove it) before approving.",
  not_draft: "This letter was already approved or discarded.",
  stale: "This letter changed since you opened it. Reload the page and check it again.",
  unchanged: "Nothing changed, so no new version was saved.",
  release: "A licensed member must approve this letter before it is released.",
  size: "A letter needs a title and 1 to 12,000 characters.",
  sample: "This firm is in sample mode; only sample matters accept new work.",
  failed: "That didn’t work. Nothing was changed. Try again.",
};

export function letterError(code: string): string {
  return MESSAGES[code] ?? MESSAGES.failed;
}

/** A database refusal of a letter function, in plain words. */
export function letterDbError(message: string): string {
  if (/another licensed member/i.test(message)) return letterError("self");
  if (/placeholder/i.test(message)) return letterError("placeholder");
  if (/only a draft/i.test(message)) return letterError("not_draft");
  if (/changed since you opened it/i.test(message)) return letterError("stale");
  if (/nothing changed/i.test(message)) return letterError("unchanged");
  if (/must approve this letter/i.test(message)) return letterError("release");
  if (/title and 1 to 12000/i.test(message)) return letterError("size");
  if (/letter type/i.test(message)) return letterError("letter_type");
  if (/sample mode/i.test(message)) return letterError("sample");
  if (/denied/i.test(message)) return letterError("denied");
  return letterError("failed");
}
