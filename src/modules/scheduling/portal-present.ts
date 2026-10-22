/**
 * Pure helpers for the portal Appointments page (join window, the cancel dialog's words, the
 * reschedule picker's days and times). No I/O, no clock: time is passed in.
 */
import { locationLabel, safeZone } from "./format";
import type { PortalAppointment } from "./portal-load";
import { utcToLocal } from "./slots";
import { CALL_WAIT_TOAST, callHref, callIsOpen } from "@/modules/video/present";

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The firm's meeting link opens this long before the call (DECISIONS 2026-10-19). */
export const JOIN_OPENS_BEFORE_MS = 10 * 60_000;

/** The Designer's toast on the join button before the link opens. */
export const JOIN_WAIT_TOAST = "The link opens 10 minutes before the call";

/** The same toast for a Casevoya video call, which opens 15 minutes before (20261022100000). */
export { CALL_WAIT_TOAST };

export type JoinState =
  /** The firm's meeting link, inside the window: the button is a link. */
  | { kind: "open"; href: string }
  /** The firm's meeting link, before the window: the Designer's button and toast. */
  | { kind: "wait"; toast: string }
  /** A video call without its booking reference (never from the portal loader): the firm sends it. */
  | { kind: "firm"; toast: string }
  /** Phone or in person: no join button, the location copy says how they meet. */
  | { kind: "none" };

/** How the join button renders for an upcoming call at `now`. */
export function joinState(row: Pick<PortalAppointment, "locationKind" | "locationDetail" | "startsAt" | "endsAt"> & { publicRef?: string | null }, now: number, firmName: string): JoinState {
  if (row.locationKind === "meeting_link" && row.locationDetail && /^https:\/\/\S+$/.test(row.locationDetail)) {
    const start = Date.parse(row.startsAt);
    const end = Date.parse(row.endsAt);
    if (now >= start - JOIN_OPENS_BEFORE_MS && now < end) return { kind: "open", href: row.locationDetail };
    return { kind: "wait", toast: JOIN_WAIT_TOAST };
  }
  if (row.locationKind === "video") {
    // A Casevoya video call: the call page, from 15 minutes before until 30 minutes after.
    if (!row.publicRef) return { kind: "firm", toast: `${firmName} will send you the meeting link` };
    return callIsOpen(row.startsAt, row.endsAt, now) ? { kind: "open", href: callHref(row.publicRef) } : { kind: "wait", toast: CALL_WAIT_TOAST };
  }
  return { kind: "none" };
}

/** The location line: a stored meeting link is simply a video call to the client. */
export function whereLabel(row: Pick<PortalAppointment, "locationKind" | "locationDetail">): string {
  if (row.locationKind === "meeting_link" && row.locationDetail) return "Video call";
  return locationLabel(row.locationKind, row.locationDetail);
}

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

/** "24 hours", "48 hours", "90 minutes". */
export function noticeLabel(minNoticeMin: number): string {
  if (minNoticeMin >= 60 && minNoticeMin % 60 === 0) {
    const hours = minNoticeMin / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minNoticeMin} ${minNoticeMin === 1 ? "minute" : "minutes"}`;
}

/** The cancel dialog's title: the Designer's "Cancel the package review call?". */
export function cancelTitle(row: Pick<PortalAppointment, "title">): string {
  return `Cancel the ${row.title.trim().toLowerCase()}?`;
}

/**
 * The cancel dialog's body: who is told, the late warning only when cancelling now is inside the
 * type's minimum notice, and what happens next.
 */
export function cancelBody(row: Pick<PortalAppointment, "hostName" | "rules" | "isSample">, firmName: string): string {
  const who = firstName(row.hostName) || firmName;
  const late = row.rules?.late ? ` Cancelling less than ${noticeLabel(row.rules.minNoticeMin)} before may count as a missed call under your agreement.` : "";
  const sample = row.isSample ? " This is a sample booking, so no email is sent." : "";
  return `${who} will be told.${late} You can book another time straight away.${sample}`;
}

export type PickerDay = { date: string; weekday: string; day: number; starts: number[] };

/** Free starts grouped by the client's local day, in order. */
export function pickerDays(starts: readonly number[], zone: string): PickerDay[] {
  const tz = safeZone(zone);
  const days: PickerDay[] = [];
  for (const start of starts) {
    const local = utcToLocal(start, tz);
    const last = days[days.length - 1];
    if (last && last.date === local.date) last.starts.push(start);
    else days.push({ date: local.date, weekday: WEEKDAY[local.weekday], day: Number(local.date.slice(8)), starts: [start] });
  }
  return days;
}

/** "Tue 20 Oct, 19:30" in the client's zone (the Designer's "Book Tue 20 Oct, 19:30"). */
export function pickLabel(start: number, zone: string): string {
  const local = utcToLocal(start, safeZone(zone));
  return `${WEEKDAY[local.weekday]} ${Number(local.date.slice(8))} ${MONTH[Number(local.date.slice(5, 7)) - 1]}, ${local.time}`;
}

/** "19:30" in the client's zone. */
export function slotTime(start: number, zone: string): string {
  return utcToLocal(start, safeZone(zone)).time;
}
