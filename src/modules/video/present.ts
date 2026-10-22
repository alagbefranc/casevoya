/**
 * Pure helpers for in-app video calls: the database's answer (public.video_join) as a typed view,
 * and the words the call page and the join buttons use.
 */

/** The call opens this long before the start and closes this long after the end (20261022100000). */
export const CALL_OPENS_BEFORE_MS = 15 * 60_000;
export const CALL_CLOSES_AFTER_MS = 30 * 60_000;

/** A booking reference (bookings.public_ref): 26 base32 characters. */
export const CALL_REF = /^[a-z2-7]{26}$/;

const ROOM_NAME = /^cv-[0-9a-f]{32}$/;

/** A LiveKit room name as the database makes it (app.video_room_name). */
export function isRoomName(value: unknown): value is string {
  return typeof value === "string" && ROOM_NAME.test(value);
}

/** The room name of a booking, the same as app.video_room_name: 'cv-' + the id without dashes. */
export function roomNameFor(bookingId: string): string {
  return `cv-${bookingId.replaceAll("-", "").toLowerCase()}`;
}

/** The join buttons' toast before the window opens. */
export const CALL_WAIT_TOAST = "The call opens 15 minutes before the start";

export type JoinView = {
  state: "open" | "early" | "closed" | "unavailable";
  reason: "cancelled" | "not_confirmed" | "not_video" | "ended" | null;
  role: "host" | "client";
  title: string;
  startsAt: string;
  endsAt: string;
  opensAt: string;
  closesAt: string;
  hostName: string | null;
  firmName: string;
  isSample: boolean;
  /** Only with an issued join (p_issue): what the token needs. */
  grant: { roomName: string; roomCreated: boolean; identity: string; name: string; admitted: boolean; ttlSeconds: number } | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The jsonb from public.video_join, or null when it isn't one. */
export function parseJoinView(raw: unknown): JoinView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const state = row.state;
  const role = row.role;
  if (state !== "open" && state !== "early" && state !== "closed" && state !== "unavailable") return null;
  if (role !== "host" && role !== "client") return null;
  const title = str(row.title);
  const startsAt = str(row.starts_at);
  const endsAt = str(row.ends_at);
  const opensAt = str(row.opens_at);
  const closesAt = str(row.closes_at);
  if (!title || !startsAt || !endsAt || !opensAt || !closesAt) return null;
  const reason = row.reason === "cancelled" || row.reason === "not_confirmed" || row.reason === "not_video" || row.reason === "ended" ? row.reason : null;
  const roomName = str(row.room_name);
  const identity = str(row.identity);
  const name = str(row.name);
  const ttl = typeof row.ttl_seconds === "number" && Number.isFinite(row.ttl_seconds) ? Math.floor(row.ttl_seconds) : null;
  const grant =
    state === "open" && isRoomName(roomName) && identity && name && ttl
      ? { roomName, roomCreated: row.room_created === true, identity, name, admitted: row.admitted === true, ttlSeconds: ttl }
      : null;
  return {
    state,
    reason,
    role,
    title,
    startsAt,
    endsAt,
    opensAt,
    closesAt,
    hostName: str(row.host_name),
    firmName: str(row.firm_name) ?? "Your firm",
    isSample: row.is_sample === true,
    grant,
  };
}

/** The page's message when the call can't be joined now. Null when it can. */
export function callNotice(view: Pick<JoinView, "state" | "reason" | "firmName">): { title: string; copy: string } | null {
  switch (view.state) {
    case "open":
      return null;
    case "early":
      return { title: "The call hasn’t opened yet", copy: "You can join from 15 minutes before the start. This page opens it for you." };
    case "closed":
      return { title: "This call has ended", copy: `To talk again, book another time or message ${view.firmName}.` };
    default:
      if (view.reason === "ended") return { title: "The call was ended", copy: `Your host ended the call for everyone. If they start it again, reload this page to join. You can also message ${view.firmName}.` };
      if (view.reason === "cancelled") return { title: "This consultation was cancelled", copy: `To book another time, message ${view.firmName}.` };
      if (view.reason === "not_video") return { title: "This isn’t a Casevoya video call", copy: `${view.firmName} meets you another way for this consultation. Check your booking.` };
      return { title: "This call isn’t confirmed", copy: `Check the booking with ${view.firmName}.` };
  }
}

/** The call page's URL for a booking reference. */
export function callHref(publicRef: string): string {
  return `/call/${publicRef}`;
}

/** Whether a video booking's call is open at `now` (the join buttons' rule; the database decides). */
export function callIsOpen(startsAt: string, endsAt: string, now: number): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start - CALL_OPENS_BEFORE_MS && now < end + CALL_CLOSES_AFTER_MS;
}
