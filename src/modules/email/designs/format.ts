/** Merge-value formatting for emails. Pure functions; no locale data beyond English month names. */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A calendar date from "YYYY-MM-DD" (the start of an ISO timestamp is accepted), or null. */
export function parseDate(value: unknown): { year: number; month: number; day: number; weekday: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, weekday: date.getUTCDay() };
}

/** "6 November 2026" */
export function longDate(value: unknown): string | null {
  const date = parseDate(value);
  return date ? `${date.day} ${MONTHS[date.month - 1]} ${date.year}` : null;
}

/** "Friday 30 October 2026" */
export function dayDate(value: unknown): string | null {
  const date = parseDate(value);
  return date ? `${WEEKDAYS[date.weekday]} ${date.day} ${MONTHS[date.month - 1]} ${date.year}` : null;
}

/** "30 Oct" */
export function shortDate(value: unknown): string | null {
  const date = parseDate(value);
  return date ? `${date.day} ${MONTHS[date.month - 1].slice(0, 3)}` : null;
}

/**
 * "Thursday 22 October 2026, 10:30" in the given IANA time zone (the firm's), from an ISO
 * timestamp. Null when the timestamp or zone is not valid.
 */
export function dateTimeIn(value: unknown, timeZone: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const zone = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "America/Toronto";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    const day = dayDate(`${part("year")}-${part("month")}-${part("day")}`);
    return day ? `${day}, ${part("hour")}:${part("minute")}` : null;
  } catch {
    return null;
  }
}

/*
 * fr-CA (OQLF) dates and times, composed from fixed month and day names so the output does not
 * depend on the runtime's ICU data: "1er mai 2026", "vendredi 30 octobre 2026", "30 oct.",
 * "jeudi 22 octobre 2026 à 10 h 30". Days and months are lowercase; the first day is "1er".
 */
const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MONTHS_FR_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."];
const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function dayFr(day: number): string {
  return day === 1 ? "1er" : String(day);
}

/** "6 novembre 2026" */
export function longDateFr(value: unknown): string | null {
  const date = parseDate(value);
  return date ? `${dayFr(date.day)} ${MONTHS_FR[date.month - 1]} ${date.year}` : null;
}

/** "vendredi 30 octobre 2026" */
export function dayDateFr(value: unknown): string | null {
  const date = parseDate(value);
  return date ? `${WEEKDAYS_FR[date.weekday]} ${dayFr(date.day)} ${MONTHS_FR[date.month - 1]} ${date.year}` : null;
}

/** "30 oct." */
export function shortDateFr(value: unknown): string | null {
  const date = parseDate(value);
  return date ? `${dayFr(date.day)} ${MONTHS_FR_SHORT[date.month - 1]}` : null;
}

/** The calendar day and 24-hour time of an instant in a zone, with dateTimeIn's zone rules, or null. */
function zonedParts(value: unknown, timeZone: unknown): { date: string; hour: string; minute: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const zone = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "America/Toronto";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: part("hour"), minute: part("minute") };
  } catch {
    return null;
  }
}

/**
 * "jeudi 22 octobre 2026 à 10 h 30" (on the hour: "à 10 h") in the given IANA zone, with the same
 * zone handling as dateTimeIn.
 */
export function dateTimeInFr(value: unknown, timeZone: unknown): string | null {
  const parts = zonedParts(value, timeZone);
  const day = parts ? dayDateFr(parts.date) : null;
  if (!parts || !day) return null;
  return `${day} à ${Number(parts.hour)} h${parts.minute === "00" ? "" : ` ${parts.minute}`}`;
}

const STAFF_ROLES: Record<string, string> = {
  firm_owner: "Firm owner",
  licensed_consultant: "Licensed consultant",
  case_manager: "Case manager",
  assistant: "Assistant",
  finance_user: "Finance user",
};

/** "a Case manager", "an Assistant"; a generic phrase for anything else. */
export function staffRolePhrase(role: unknown): string {
  const label = typeof role === "string" ? STAFF_ROLES[role] : undefined;
  if (!label) return "a member of the team";
  return /^[AEIOU]/.test(label) ? `an ${label}` : `a ${label}`;
}

const AGREEMENT_KINDS: Record<string, string> = {
  service: "service agreement",
  consultation: "consultation agreement",
  amendment: "agreement amendment",
  consent: "consent form",
  quote: "quote",
};

export function agreementNoun(kind: unknown): string {
  return (typeof kind === "string" && AGREEMENT_KINDS[kind]) || "agreement";
}

/** A firm-numbered reference such as INV-0218 or RC-0091; anything else is dropped. */
export function documentNumber(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return new RegExp(`^${prefix}-[0-9]{4,9}$`).test(text) ? text : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;
}

const BOOKING_REF = /^[a-z2-7]{26}$/;

/** A booking's private reference (its signing link), or null. */
export function bookingRefOrNull(value: unknown): string | null {
  return typeof value === "string" && BOOKING_REF.test(value.trim()) ? value.trim() : null;
}

/** A small positive whole number (minutes, hours, days), or null. */
export function countOrNull(value: unknown, max = 10000): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}

/**
 * EX20: whether Stripe's refund failure_reason means the card is no longer active (closed,
 * expired, lost or stolen), the one reason the client is told in plain words. Any other code,
 * or none, gives no reason. https://docs.stripe.com/refunds#failed-refunds
 */
export function refundCardInactive(reason: string | null | undefined): boolean {
  return reason === "expired_or_canceled_card" || reason === "lost_or_stolen_card";
}
