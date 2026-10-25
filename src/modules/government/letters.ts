/**
 * GOV-04 government letters: the tasks a letter creates, the firm's issuer list and its official
 * source, and the database's refusals in the Sheet's words. Pure: shared by the loaders, the server
 * actions, the Sheet acts and tests. No issuer name is defined here; every name comes from the
 * firm's reviewed list (public.government_issuers) or is typed by staff for one letter.
 */

import { attestationError, attestationNote } from "@/modules/government/page-attestation";
import { longDate } from "@/modules/sheet/matter-present";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most this many tasks from one letter (app.record_government_letter allows 10). */
export const LETTER_TASK_ROWS = 6;

export type LetterTaskInput = { title: string; owner: string; due: string };
export type LetterTask = { title: string; owner: "staff" | "client"; owner_id: string; due_on: string };

/** An owner option's value: "staff:<membership id>" or "client:<person id>". */
export function ownerValue(kind: "staff" | "client", id: string): string {
  return `${kind}:${id}`;
}

function readOwner(value: string): { owner: "staff" | "client"; id: string } | null {
  const [kind, id] = value.split(":");
  if ((kind !== "staff" && kind !== "client") || !id || !UUID.test(id)) return null;
  return { owner: kind, id };
}

/**
 * The dialog's task rows as app.record_government_letter's p_tasks. A row left completely empty is
 * skipped; a row with anything in it needs all three: a description, an owner and a due date that
 * is today or later in the firm's timezone.
 */
export function readLetterTasks(rows: readonly LetterTaskInput[], today: string): { tasks: LetterTask[] } | { error: string } {
  const tasks: LetterTask[] = [];
  for (const row of rows) {
    const title = row.title.trim();
    const due = row.due.trim();
    if (!title && !due) continue;
    if (!title) return { error: "Describe each task, or clear its row." };
    if (title.length > 200) return { error: "Keep each task’s description to 200 characters." };
    const owner = readOwner(row.owner);
    if (!owner) return { error: "Choose who owns each task." };
    if (!DATE.test(due)) return { error: "Give each task a due date." };
    if (due < today) return { error: "A task’s due date can’t be in the past." };
    tasks.push({ title, owner: owner.owner, owner_id: owner.id, due_on: due });
  }
  if (tasks.length > 10) return { error: "One letter creates at most 10 tasks." };
  return { tasks };
}

/** What the server read from an issuer's official page (all null when it couldn't read it). */
export type IssuerSource = {
  source_url: string;
  checked_on: string;
  retrieved_at: string | null;
  snapshot_sha256: string | null;
  page_modified_on: string | null;
  name_on_page: boolean | null;
  /** Approved without a page read: the licensed reviewer's attestation (decided 2026-10-24). */
  page_attested_by_membership_id?: string | null;
  page_attested_on?: string | null;
};

export type IssuerRow = IssuerSource & {
  id: string;
  name: string;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  version: number;
};

/** "canada.ca/en/…/offices.html#visa" without the scheme, for a source line. */
export function sourceLabel(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/^www\./, "");
}

/**
 * The issuer's source, shown next to its name: the URL, the date checked, and what the server read;
 * or, approved without a page read, "page not captured by Casevoya, checked by <reviewer> on <date>".
 */
export function issuerSourceParts(source: IssuerSource, memberName?: (membershipId: string | null) => string): string[] {
  const parts = [`Source ${sourceLabel(source.source_url)}`, `checked ${longDate(source.checked_on)}`];
  if (source.snapshot_sha256 && source.retrieved_at) {
    parts.push(`page read ${longDate(source.retrieved_at.slice(0, 10))}, sha256 ${source.snapshot_sha256.slice(0, 4)}…${source.snapshot_sha256.slice(-4)}`);
    parts.push(source.page_modified_on ? `page’s Date modified ${source.page_modified_on}` : "page shows no Date modified");
    if (source.name_on_page === false) parts.push("name not found in the page’s text");
  } else {
    parts.push(attestationNote(source, memberName, longDate) ?? "page not read by the server");
  }
  return parts;
}

export function issuerState(status: string): { tone: string; label: string } {
  if (status === "approved") return { tone: "ok", label: "Approved" };
  if (status === "pending_review") return { tone: "chg", label: "Waiting for review" };
  if (status === "retired") return { tone: "gr", label: "Retired" };
  return { tone: "gr", label: "Rejected" };
}

/** Is this an official Government of Canada page the issuer list accepts (the database checks its allowlist too)? */
export function officialIssuerUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.port && !url.username && (host === "canada.ca" || host.endsWith(".canada.ca") || host.endsWith(".gc.ca"));
  } catch {
    return false;
  }
}

/** The database's refusals for letters and issuers, in the Sheet's words; null when it isn't one of these. */
const LETTER_ERRORS: [RegExp, string][] = [
  [/name who sent the letter/, "Choose who sent the letter, or type it under Other."],
  [/approved list/, "That issuer isn’t on the firm’s approved list. Choose another, or type it under Other."],
  [/at most 10 tasks/, "One letter creates at most 10 tasks."],
  [/description/, "Describe each task in up to 200 characters."],
  [/needs an owner|active staff owner/, "Choose an active staff member, or a client on this matter, for each task."],
  [/client task needs a person/, "A client task goes to a person on this matter."],
  [/due date cannot be in the past/, "A task’s due date can’t be in the past."],
  [/needs a due date/, "Give each task a due date."],
  [/official Government of Canada page/, "Use the issuer’s official Government of Canada page (canada.ca or a gc.ca site)."],
  [/date checked/, "Add the date you checked the page. It can’t be in the future or over a year ago."],
  [/as the official page writes it/, "Type the issuer’s name as the official page writes it."],
  [/already on the list/, "That issuer is already on the list."],
  [/not waiting for review/, "That issuer was already reviewed."],
  [/only an approved issuer/, "Only an approved issuer can be retired."],
  [/say why/, "Say why, in a few words."],
  [/issuer version conflict/, "Someone else changed this issuer. Reload and try again."],
  [/issuer review denied/, "Your role can’t review issuers."],
];

export function letterError(message: string): string | null {
  const attestation = attestationError(message);
  if (attestation) return attestation;
  for (const [pattern, copy] of LETTER_ERRORS) if (pattern.test(message)) return copy;
  return null;
}

/** "<b>Date modified:</b> <time property="dateModified">2025-01-31</time>" on a canada.ca page. */
export function pageModifiedOn(html: string): string | null {
  const match = /<time[^>]*property=["']dateModified["'][^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/time>/i.exec(html) ?? /Date modified:\s*(?:<[^>]+>\s*)*(\d{4}-\d{2}-\d{2})/i.exec(html);
  return match ? match[1] : null;
}
