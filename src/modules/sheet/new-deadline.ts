/**
 * Pure helpers for the matter page's "Record a deadline" dialog: its options, what it sends to
 * public.record_deadline, and how the database's refusals read. The database decides every save:
 * app.assert_deadline_source checks the official source, and a legal or letter date stays
 * tentative until a licensed consultant confirms it (public.confirm_deadline).
 */
import { safeAccessError } from "@/lib/auth/step-up";

export type DeadlineKind = "legal" | "correspondence" | "internal";

/** The staff roles app.record_deadline accepts. A finance user is not offered the dialog. */
export const DEADLINE_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant"] as const;

/** The dialog's kinds, in the database's words. A legal or letter date is an immigration deadline. */
export const DEADLINE_KINDS: readonly { value: DeadlineKind; label: string }[] = [
  { value: "correspondence", label: "Set in a government letter" },
  { value: "legal", label: "Set by law or regulation" },
  { value: "internal", label: "Internal target (firm only)" },
];

export type NewDeadlineInput = {
  kind: DeadlineKind;
  label: string;
  dueOn: string;
  dueAt: string | null;
  timezone: string;
  evidenceLocator: string | null;
  sourceUrl: string | null;
  sourceRetrievedOn: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function realDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Minutes the zone is ahead of UTC at `ms`. Throws a RangeError for a zone Intl does not know. */
function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return Math.round((wall - ms) / 60000);
}

/**
 * The instant a wall-clock time on a date has in a timezone ("2026-10-30", "17:00",
 * "America/Toronto" → "2026-10-30T21:00:00.000Z"), or null when the zone is not usable.
 */
export function zonedInstant(date: string, time: string, timeZone: string): string | null {
  if (!realDate(date) || !TIME.test(time) || !timeZone) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  try {
    let instant = wall - zoneOffsetMinutes(wall, timeZone) * 60000;
    instant = wall - zoneOffsetMinutes(instant, timeZone) * 60000;
    return new Date(instant).toISOString();
  } catch {
    return null;
  }
}

/** True when the URL can pass app.official_url_host: https, a plain host, no credentials or port. */
export function looksOfficialUrl(value: string): boolean {
  if (!/^https:\/\//.test(value) || /[@\\\s]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && /\.[a-z]/i.test(url.hostname) && !/^[\d.]+$/.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * What the dialog sends, or the first thing to fix. A legal or letter deadline must cite its
 * official source (URL and the date it was retrieved); the database checks that URL against the
 * allowlist and checks everything else again.
 */
export function readDeadline(fields: {
  kind?: string | null;
  label?: string | null;
  dueOn?: string | null;
  dueTime?: string | null;
  timezone?: string | null;
  evidence?: string | null;
  sourceUrl?: string | null;
  retrievedOn?: string | null;
  /** The firm's today (`YYYY-MM-DD`). Given, a due date before it is refused. */
  today?: string | null;
}): { input: NewDeadlineInput } | { error: string } {
  const kind = DEADLINE_KINDS.find((option) => option.value === clean(fields.kind))?.value;
  const label = clean(fields.label);
  const dueOn = clean(fields.dueOn);
  const dueTime = clean(fields.dueTime);
  const timezone = clean(fields.timezone);
  const evidence = clean(fields.evidence);
  const sourceUrl = clean(fields.sourceUrl);
  const retrievedOn = clean(fields.retrievedOn);
  if (!kind) return { error: "Choose what kind of deadline this is." };
  if (!label) return { error: "Say what is due." };
  if (label.length > 200) return { error: "Keep what is due to 200 characters." };
  if (!realDate(dueOn)) return { error: "Pick the due date." };
  if (fields.today && realDate(fields.today) && dueOn < fields.today) return { error: "The due date can’t be in the past." };
  if (dueTime && !TIME.test(dueTime)) return { error: "Enter the due time as HH:MM, or leave it blank." };
  if (!timezone) return { error: "Enter the official timezone, like America/Toronto." };
  const dueAt = dueTime ? zonedInstant(dueOn, dueTime, timezone) : null;
  if (dueTime && !dueAt) return { error: "Enter the official timezone, like America/Toronto." };
  if (dueAt === null && !zonedInstant(dueOn, "00:00", timezone)) return { error: "Enter the official timezone, like America/Toronto." };
  if (evidence.length > 300) return { error: "Keep where it’s written to 300 characters." };
  const official = kind !== "internal";
  if (official && !sourceUrl) return { error: "A legal or letter deadline needs its official source URL." };
  if (sourceUrl && !looksOfficialUrl(sourceUrl)) return { error: "Use the official https:// page the deadline comes from." };
  if (sourceUrl && !retrievedOn) return { error: "Add the date you retrieved the official source." };
  if (retrievedOn && !realDate(retrievedOn)) return { error: "Pick the date you retrieved the official source." };
  if (retrievedOn && !sourceUrl) return { error: "Add the official source URL, or clear the retrieval date." };
  return {
    input: {
      kind,
      label,
      dueOn,
      dueAt,
      timezone,
      evidenceLocator: evidence || null,
      sourceUrl: sourceUrl || null,
      sourceRetrievedOn: retrievedOn || null,
    },
  };
}

/** The deadline panel's "Source evidence" line: where it is written, the official host, when it was retrieved. */
export function deadlineSource(evidence: string | null, sourceUrl: string | null, retrieved: string | null): string[] {
  let host: string | null = null;
  try {
    host = sourceUrl ? new URL(sourceUrl).hostname : null;
  } catch {
    host = null;
  }
  const parts = [...(evidence ? [evidence] : []), ...(host ? [host] : [])];
  if (parts.length === 0) return ["No source recorded"];
  return retrieved ? [...parts, `retrieved ${retrieved}`] : parts;
}

/** User-facing copy for a refused deadline. Never passes a database message through. */
export function deadlineError(message: string): string {
  if (/sample mode/i.test(message)) {
    return "This firm is still in sample mode, so only sample matters accept new deadlines. Turn sample mode off to record a real one.";
  }
  if (/allowlisted official url/i.test(message)) {
    return "That source isn’t on the official government allowlist. Use the IRCC or government page the deadline comes from, with its retrieval date.";
  }
  if (/published rule version/i.test(message)) return "A derived deadline must cite a published rule version.";
  if (/timezone is not usable/i.test(message)) return "Enter the official timezone, like America/Toronto.";
  if (/needs a date or an instant/i.test(message)) return "Pick the due date.";
  if (/label is required/i.test(message)) return "Say what is due.";
  if (/task is not on this matter/i.test(message)) return "That task isn’t on this matter.";
  if (/deadline denied|staff access denied|active staff/i.test(message)) return "Your role can’t record deadlines on this matter.";
  return safeAccessError(message);
}
