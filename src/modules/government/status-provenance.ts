/**
 * GOV-05 government status provenance. Pure: shared by the Government status page's loader, the
 * share preview, the client's portal Home, and tests.
 *
 * - Every status says where it came from (the channel), who recorded it, its evidence, when it
 *   was verified and when a staff member last checked the official channel.
 * - A shared status reads the same in the staff preview and on the portal: "Recorded by <firm>
 *   on <date>". It is a record kept by the firm, never a live government feed.
 * - An IRCC processing-time estimate is what a staff member read on IRCC's official
 *   processing-times page, with the date checked. It shows only once a licensed member approved
 *   it, and always as IRCC's estimate, "not a maximum or a guarantee" (IRCC's words).
 */
import { attestationError, attestationNote } from "@/modules/government/page-attestation";
import { channelLabel, correspondenceLabel } from "@/modules/government/present";

/** IRCC's processing-times page (docs/spec gaps GOV "Official sources"). The entry dialog starts here. */
export const PROCESSING_TIMES_URL = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html";

/** IRCC says its processing times are "not a maximum or a guarantee". */
export const ESTIMATE_NOTE = "IRCC’s estimate, not a maximum or a guarantee";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "24 Oct 2026" from a `YYYY-MM-DD` date (a calendar date, no time zone shift). */
export function fullDay(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The calendar date of an instant in a time zone, `YYYY-MM-DD`. */
export function dayIn(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export type StatusCheck = { checked_at: string; correspondence_id?: string | null };

/**
 * When a staff member last checked this status: a check of this status, or a check of the whole
 * matter ("Checked, no change"), whichever is later. Null when nobody has checked it.
 */
export function lastCheckedAt(checks: StatusCheck[], correspondenceId: string | null): string | null {
  let latest: string | null = null;
  for (const check of checks) {
    const about = check.correspondence_id ?? null;
    if (about !== null && about !== correspondenceId) continue;
    if (!latest || check.checked_at > latest) latest = check.checked_at;
  }
  return latest;
}

/** "Source: IRCC portal message": the channel the status came through. */
export function statusSource(channel: string): string {
  const label = channelLabel(channel);
  return `Source: ${channel === "portal_message" || channel === "online_portal" ? `IRCC ${label}` : label}`;
}

/* ------------------------------------------------------------- client view */

export type SharedLetter = {
  kind: string;
  received_on: string;
  action_requested: string | null;
  created_at: string;
};

export type ClientRecordView = { title: string; lines: string[]; recorded: string };

/** What the client's portal shows for a shared status, and exactly what the staff preview shows. */
export function clientRecordView(letter: SharedLetter, firmName: string, timeZone: string): ClientRecordView {
  const lines = [`Received ${fullDay(letter.received_on)}`];
  if (letter.action_requested) lines.push(`What it asks: ${letter.action_requested}`);
  return {
    title: correspondenceLabel(letter.kind),
    lines,
    recorded: `Recorded by ${firmName} on ${fullDay(dayIn(letter.created_at, timeZone))}`,
  };
}

/* ---------------------------------------------------------------- estimates */

export type EstimateRow = {
  id: string;
  source_url: string;
  application_type: string;
  estimate_text: string;
  checked_on: string;
  page_retrieved_at: string | null;
  snapshot_sha256: string | null;
  status: string;
  entered_by_membership_id: string;
  reviewed_by_membership_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  version: number;
  /** Approved without a page capture: the licensed reviewer's attestation (decided 2026-10-24). */
  page_attested_by_membership_id?: string | null;
  page_attested_on?: string | null;
};

/** The estimate shown next to the status (approved), and the one waiting for review, if any. */
export function currentEstimates(rows: EstimateRow[]): { approved: EstimateRow | null; pending: EstimateRow | null } {
  const newest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    approved: newest.find((row) => row.status === "approved") ?? null,
    pending: newest.find((row) => row.status === "pending_review") ?? null,
  };
}

/**
 * "canada.ca, checked 20 Oct 2026, page captured (sha256 9be2…11c4)"; approved without a capture,
 * "…, page not captured by Casevoya, checked by <reviewer> on <date>".
 */
export function estimateSource(row: EstimateRow, memberName?: (membershipId: string | null) => string): string {
  let host = "canada.ca";
  try {
    host = new URL(row.source_url).host.replace(/^www\./, "");
  } catch {
    // Stored URLs are checked by the database; keep the plain label if one ever isn't parseable.
  }
  const capture = row.snapshot_sha256
    ? `page captured (sha256 ${row.snapshot_sha256.slice(0, 4)}…${row.snapshot_sha256.slice(-4)})`
    : (attestationNote(row, memberName, fullDay) ?? "page not captured");
  return `Source: ${host}, checked ${fullDay(row.checked_on)}, ${capture}`;
}

/** Estimate entry: the URL must be an IRCC page on canada.ca, the same rule the database applies. */
export function isCanadaCaUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.port && !url.username && (url.hostname === "canada.ca" || url.hostname.endsWith(".canada.ca"));
  } catch {
    return false;
  }
}

/** Database refusals for GOV-05, as plain copy. */
const ERRORS: [RegExp, string][] = [
  [/official processing-times page/, "Use IRCC’s processing-times page on canada.ca."],
  [/application type/, "Name the application type as IRCC’s page does."],
  [/exactly as IRCC/, "Write the estimate exactly as IRCC’s page shows it."],
  [/date checked/, "Add the date you checked IRCC’s page. It can’t be in the future."],
  [/why it's rejected/, "Say why it’s rejected."],
  [/already reviewed/, "That estimate was already reviewed."],
  [/version conflict/, "Someone else changed this. Reload and try again."],
  [/not on this matter/, "That status isn’t on this matter."],
  [/verified letter|confirmed decision/, "Verify the status before sharing it."],
  [/sample mode/, "This firm is in sample mode. Only sample matters accept new records."],
  [/licence blocks/, "Your licence status blocks this consultant action."],
  [/licensed|credential/, "A licensed member of the firm reviews this."],
  [/denied|staff access/, "Your role can’t do this on this matter."],
];

export function provenanceError(message: string): string {
  const attestation = attestationError(message);
  if (attestation) return attestation;
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}

/**
 * Staff and client copy must never claim a live connection to, or tracking of, a government
 * application (PRD GOV-05). Used by a test over the Government status page and portal copy.
 */
export const SYNC_CLAIM = /\b(real[- ]?time|auto(matic(ally)?)?[- ]?sync(ed|s|ing)?|synced with (ircc|the government)|live (ircc )?(tracking|status|updates?) from|tracks? your application (live|automatically))\b/i;
