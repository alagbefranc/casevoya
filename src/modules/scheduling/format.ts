/** Display of booking times. Every time is shown with its zone (PRD API: confirm timezone). */
import { isTimeZone, utcToLocal } from "./slots";

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function safeZone(tz: unknown, fallback = "America/Toronto"): string {
  return isTimeZone(tz) ? tz : fallback;
}

function parts(ms: number, tz: string) {
  const local = utcToLocal(ms, safeZone(tz));
  const [, month, day] = local.date.split("-").map(Number);
  return { local, month, day, year: Number(local.date.slice(0, 4)) };
}

/** "Tue 20 Oct · 11:00" (the Designer's slot button). */
export function slotLabel(ms: number, tz: string): string {
  const { local, month, day } = parts(ms, tz);
  return `${WEEKDAY[local.weekday]} ${day} ${MONTH[month - 1]} · ${local.time}`;
}

/** "EDT", "PST", "GMT+5:30": the zone's short name at that instant. */
export function zoneAbbr(ms: number, tz: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(tz), timeZoneName: "short" })
      .formatToParts(new Date(ms))
      .find((part) => part.type === "timeZoneName")?.value;
    return name ?? safeZone(tz);
  } catch {
    return safeZone(tz);
  }
}

/** "Thu 22 Oct 10:30 EDT" (the Designer's table cell, with the zone at that date). */
export function shortWhen(ms: number, tz: string): string {
  const { local, month, day } = parts(ms, tz);
  return `${WEEKDAY[local.weekday]} ${day} ${MONTH[month - 1]} ${local.time} ${zoneAbbr(ms, tz)}`;
}

/** "Thursday 22 October 2026, 10:30 (America/Vancouver)" */
export function longWhen(ms: number, tz: string): string {
  const zone = safeZone(tz);
  const { local, month, day, year } = parts(ms, zone);
  return `${WEEKDAY_LONG[local.weekday]} ${day} ${MONTH_LONG[month - 1]} ${year}, ${local.time} (${zone})`;
}

/** "10:30" */
export function clock(ms: number, tz: string): string {
  return parts(ms, tz).local.time;
}

export type LocationKind = "video" | "phone" | "in_person" | "meeting_link";

export function locationLabel(kind: string, detail?: string | null): string {
  switch (kind) {
    case "phone":
      return "Phone";
    case "in_person":
      return detail ? `In person, ${detail}` : "In person";
    case "meeting_link":
      return "Online meeting (link from the firm)";
    default:
      return "Video call";
  }
}

/** Short form for tables: "video", "phone", "office", "meeting link". */
export function locationShort(kind: string): string {
  switch (kind) {
    case "phone":
      return "phone";
    case "in_person":
      return "office";
    case "meeting_link":
      return "meeting link";
    default:
      return "video (link to follow)";
  }
}

/** Common zones offered in the booker's zone picker, plus whatever their browser reports. */
export const COMMON_ZONES = [
  "America/St_Johns",
  "America/Halifax",
  "America/Toronto",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Whitehorse",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Manila",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;
