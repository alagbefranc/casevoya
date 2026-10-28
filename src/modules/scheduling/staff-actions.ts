"use server";

// Each change also refreshes the page from the action (next/cache refresh()), so Consultations
// shows it at once: router.refresh alone can land on the old render (as on #149).
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { parseAvailability, slotsFromAvailability } from "./availability";
import { shortWhen } from "./format";
import { isTimeZone } from "./slots";
import { closeRoomForBooking } from "@/modules/video/service";

type Result = { ok: true } | { error: string; stepUp?: boolean };

const DAY = 86_400_000;
const LOCATIONS = ["video", "phone", "in_person", "meeting_link"] as const;

/** A database refusal as words a person can act on. Never the raw message. */
function bookingError(message: string): { error: string; stepUp?: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm with your authenticator, then save again.", stepUp: true };
  if (/slot_unavailable/.test(message)) return { error: "That time is no longer free. Choose another." };
  if (/changed by someone else/.test(message)) return { error: "This booking changed since you opened it. Reload and try again." };
  if (/sample mode/.test(message)) return { error: message.charAt(0).toUpperCase() + message.slice(1) + "." };
  if (/staff access denied|sign in/i.test(message)) return { error: "You can’t change bookings in this firm." };
  if (/booking_event_types_organization_id_slug_key|duplicate key/.test(message)) return { error: "Another booking type already uses that link name." };
  if (/needs a host|meeting link|choose active staff|choose a time zone|time is not valid|end after its start|both times|choose a client|no email|cannot be cancelled|only an upcoming|after the meeting|attended or no-show|too many availability rows/.test(message)) {
    return { error: message.charAt(0).toUpperCase() + message.slice(1) + "." };
  }
  if (/check constraint|violates/.test(message)) return { error: "Some values are out of range. Check the form." };
  return { error: "That couldn’t be saved. Try again." };
}

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return null;
  const supabase = await createClient({ organizationId });
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export async function saveAvailability(input: {
  organizationId: string;
  membershipId: string;
  timeZone: string;
  rules: { weekday: number; start: string; end: string }[];
  daysOff: string[];
}): Promise<Result> {
  if (!isUuid(input.membershipId)) return { error: "Choose a staff member." };
  if (!isTimeZone(input.timeZone)) return { error: "Choose a time zone." };
  const rules = (Array.isArray(input.rules) ? input.rules : []).filter(
    (rule) => Number.isInteger(rule.weekday) && rule.weekday >= 1 && rule.weekday <= 7 && HHMM.test(rule.start) && HHMM.test(rule.end),
  );
  if (rules.some((rule) => rule.end <= rule.start)) return { error: "Each day’s end must be after its start." };
  const days = [...new Set((Array.isArray(input.daysOff) ? input.daysOff : []).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))];
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("save_availability", {
    p_org: input.organizationId,
    p_membership_id: input.membershipId,
    p_time_zone: input.timeZone,
    p_rules: rules,
    p_overrides: days.map((date) => ({ date, start: null, end: null })),
  });
  if (error) return bookingError(error.message);
  refresh();
  return { ok: true };
}

export async function saveBookingType(input: {
  organizationId: string;
  eventTypeId: string | null;
  version: number | null;
  title: string;
  slug: string;
  description: string;
  durationMin: number;
  stepMin: number | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  dailyCapacity: number | null;
  locationKind: string;
  locationDetail: string;
  hostMembershipIds: string[];
  publish: boolean;
  /** The consultation agreement sent with each booking from the booking page; null for none, undefined to leave it. */
  agreementTemplateId?: string | null;
}): Promise<{ ok: true; id: string | null; version: number | null } | { error: string; stepUp?: boolean }> {
  const slug = (input.slug || "").trim().toLowerCase();
  if (!input.title?.trim()) return { error: "Give the booking type a name." };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) return { error: "Use lowercase letters, numbers and dashes for the link name." };
  if (input.eventTypeId && !isUuid(input.eventTypeId)) return { error: "Reload and try again." };
  if (input.agreementTemplateId && !isUuid(input.agreementTemplateId)) return { error: "Reload and try again." };
  if (!(LOCATIONS as readonly string[]).includes(input.locationKind)) return { error: "Choose how you meet." };
  const hosts = (input.hostMembershipIds ?? []).filter(isUuid);
  const whole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
  if (!whole(input.durationMin, 5, 480) || !whole(input.bufferBeforeMin, 0, 240) || !whole(input.bufferAfterMin, 0, 240)) return { error: "Check the length and buffers." };
  if (input.stepMin != null && !whole(input.stepMin, 5, 240)) return { error: "Check how often start times repeat." };
  if (!whole(input.minNoticeHours, 0, 8760) || !whole(input.maxAdvanceDays, 1, 365)) return { error: "Check the notice and how far ahead clients can book." };
  if (input.dailyCapacity != null && !whole(input.dailyCapacity, 1, 48)) return { error: "The daily limit is 1 to 48." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("save_booking_event_type", {
    p_org: input.organizationId,
    p_event_type_id: input.eventTypeId,
    p_expected_version: input.version,
    p_title: input.title.trim(),
    p_slug: slug,
    p_description: input.description?.trim() || null,
    p_duration_min: input.durationMin,
    p_slot_step_min: input.stepMin,
    p_buffer_before_min: input.bufferBeforeMin,
    p_buffer_after_min: input.bufferAfterMin,
    p_min_notice_min: input.minNoticeHours * 60,
    p_max_advance_days: input.maxAdvanceDays,
    p_daily_capacity: input.dailyCapacity,
    p_location_kind: input.locationKind as (typeof LOCATIONS)[number],
    p_location_detail: input.locationDetail?.trim() || null,
    p_host_membership_ids: hosts,
    p_publish: Boolean(input.publish),
  });
  if (error) return bookingError(error.message);
  const typeId = input.eventTypeId ?? (typeof data === "string" ? data : null);
  if (input.agreementTemplateId !== undefined && typeId) {
    const set = await supabase.rpc("set_booking_type_agreement", { p_event_type_id: typeId, p_template_id: input.agreementTemplateId });
    if (set.error) {
      // The type itself was saved: show it.
      refresh();
      return /approved consultation/.test(set.error.message)
        ? { error: "The booking type was saved, but that agreement is no longer approved. Choose another one." }
        : bookingError(set.error.message);
    }
  }
  refresh();
  // #262 item 6: the saved type's version, so the Edit dialog can reopen with what was saved
  // before the page's refresh lands (and a second save still passes the version check).
  const saved = typeId ? await supabase.from("booking_event_types").select("version").eq("id", typeId).maybeSingle() : null;
  return { ok: true, id: typeId, version: saved?.data?.version ?? null };
}

/** The firm owner archives a booking type (step-up): it is unpublished and leaves the lists. Bookings already made stay. */
export async function archiveBookingType(input: { organizationId: string; eventTypeId: string; version: number | null }): Promise<Result> {
  if (!isUuid(input.eventTypeId) || input.version == null || !Number.isInteger(input.version)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("archive_booking_event_type", {
    p_org: input.organizationId,
    p_event_type_id: input.eventTypeId,
    p_expected_version: input.version,
  });
  if (error && /already archived/.test(error.message)) return { error: "This booking type is already archived." };
  if (error && /changed by someone else/.test(error.message)) return { error: "This booking type changed since you opened it. Reload and try again." };
  if (error) return bookingError(error.message);
  refresh();
  return { ok: true };
}

export async function bookForClient(input: {
  organizationId: string;
  eventTypeId: string;
  personId: string;
  start: string;
  timeZone: string;
  idempotencyKey: string;
  /** An approved consultation template to send for signing once booked, or none. */
  agreementTemplateId?: string | null;
}): Promise<Result & { agreement?: "sent" | "failed" | null }> {
  if (!isUuid(input.eventTypeId) || !isUuid(input.personId)) return { error: "Choose a client and a time." };
  if (!Number.isFinite(Date.parse(input.start))) return { error: "Choose a time." };
  if (!/^[A-Za-z0-9_:-]{8,180}$/.test(input.idempotencyKey)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data: bookingId, error } = await supabase.rpc("staff_book_consultation", {
    p_org: input.organizationId,
    p_event_type_id: input.eventTypeId,
    p_person_id: input.personId,
    p_start: new Date(input.start).toISOString(),
    p_time_zone: isTimeZone(input.timeZone) ? input.timeZone : "America/Toronto",
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return bookingError(error.message);
  refresh();
  if (!input.agreementTemplateId || !isUuid(input.agreementTemplateId) || typeof bookingId !== "string") return { ok: true, agreement: null };
  // The booking stands either way; a refused agreement can be sent again from the record.
  const sent = await supabase.rpc("send_booking_agreement", { p_booking_id: bookingId, p_template_id: input.agreementTemplateId });
  return { ok: true, agreement: sent.error && !/already has an agreement/.test(sent.error.message) ? "failed" : "sent" };
}

/** A consultation agreement refusal as words a person can act on. */
function agreementError(message: string): { error: string } {
  if (/approved consultation|already has an agreement|only an upcoming|no unsigned agreement|give a reason|no unsigned agreement to remind/.test(message)) {
    return { error: message.charAt(0).toUpperCase() + message.slice(1) + "." };
  }
  if (/staff access denied|booking denied/.test(message)) return { error: "You can’t change this consultation." };
  return { error: "That couldn’t be saved. Try again." };
}

/** Locks the firm's approved consultation template to an upcoming booking for the booker to sign. */
export async function sendBookingAgreement(input: { organizationId: string; bookingId: string; templateId: string }): Promise<Result> {
  if (!isUuid(input.bookingId) || !isUuid(input.templateId)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("send_booking_agreement", { p_booking_id: input.bookingId, p_template_id: input.templateId });
  if (error) return agreementError(error.message);
  refresh();
  return { ok: true };
}

/** Withdraws an unsigned consultation agreement; it stays on record as voided. */
export async function voidBookingAgreement(input: { organizationId: string; bookingId: string; reason: string }): Promise<Result> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Give a reason (3 to 500 characters)." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("void_booking_agreement", { p_booking_id: input.bookingId, p_reason: reason });
  if (error) return agreementError(error.message);
  refresh();
  return { ok: true };
}

/** Emails the booker the signing link again; the database allows one reminder an hour. */
export async function remindBookingAgreement(input: { organizationId: string; bookingId: string }): Promise<Result> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("remind_booking_agreement", { p_booking_id: input.bookingId });
  if (error && /once an hour/.test(error.message)) return { error: "A reminder already went out in the last hour. Try again later." };
  if (error && /email notices are off/.test(error.message)) return { error: "Email notices are off for this client" };
  if (error) return agreementError(error.message);
  refresh();
  return { ok: true };
}

export async function cancelBooking(input: { organizationId: string; bookingId: string; version: number | null }): Promise<Result> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("staff_cancel_booking", {
    p_org: input.organizationId,
    p_booking_id: input.bookingId,
    p_reason: null,
    p_expected_version: input.version,
  });
  if (error) return bookingError(error.message);
  // The database already refuses new call tokens; disconnect anyone still in the room.
  closeRoomForBooking(input.bookingId);
  refresh();
  return { ok: true };
}

export async function rescheduleBooking(input: { organizationId: string; bookingId: string; version: number | null; start: string }): Promise<Result> {
  if (!isUuid(input.bookingId) || !Number.isFinite(Date.parse(input.start))) return { error: "Choose a new time." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("staff_reschedule_booking", {
    p_org: input.organizationId,
    p_booking_id: input.bookingId,
    p_start: new Date(input.start).toISOString(),
    p_expected_version: input.version,
  });
  if (error) return bookingError(error.message);
  refresh();
  return { ok: true };
}

export async function recordBookingOutcome(input: { organizationId: string; bookingId: string; outcome: string }): Promise<Result> {
  if (!isUuid(input.bookingId) || (input.outcome !== "completed" && input.outcome !== "no_show")) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("staff_record_booking_outcome", { p_org: input.organizationId, p_booking_id: input.bookingId, p_outcome: input.outcome });
  if (error) return bookingError(error.message);
  refresh();
  return { ok: true };
}

/** A summary refusal as words a person can act on. */
function summaryError(message: string): { error: string } {
  if (/changed by someone else/.test(message)) return { error: "Someone else changed this summary. Reload to see the latest, then try again." };
  if (/mark the consultation attended|write the summary/.test(message)) return { error: message.charAt(0).toUpperCase() + message.slice(1) + "." };
  if (/staff access denied/.test(message)) return { error: "Only a licensed consultant can approve and share a summary." };
  if (/sign in/i.test(message)) return { error: "Sign in first." };
  return { error: "That couldn’t be saved. Try again." };
}

/** Writes or edits an attended consultation's outcome summary. It then waits for a licensed reviewer (CRM-04). */
export async function saveConsultationSummary(input: { organizationId: string; bookingId: string; body: string; version: number }): Promise<Result> {
  if (!isUuid(input.bookingId) || !Number.isInteger(input.version) || input.version < 0) return { error: "Reload and try again." };
  const body = input.body.trim();
  if (body.length < 3 || body.length > 4000) return { error: "Write the summary (3 to 4,000 characters)." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("save_consultation_summary", { p_booking_id: input.bookingId, p_body: body, p_expected_version: input.version });
  if (error) return summaryError(error.message);
  refresh();
  return { ok: true };
}

/** A licensed consultant approves the summary; the client sees it in their portal. */
export async function shareConsultationSummary(input: { organizationId: string; bookingId: string; version: number }): Promise<Result> {
  if (!isUuid(input.bookingId) || !Number.isInteger(input.version) || input.version < 1) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("share_consultation_summary", { p_booking_id: input.bookingId, p_expected_version: input.version });
  if (error) return summaryError(error.message);
  refresh();
  return { ok: true };
}

/** Free starts for moving a booking: the same host and type, the next 28 days, in the staff zone. */
export async function rescheduleOptions(input: { organizationId: string; bookingId: string; timeZone: string }): Promise<{ options: { value: string; label: string }[] } | { error: string }> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, event_type_id, host_membership_id, starts_at")
    .eq("organization_id", input.organizationId)
    .eq("id", input.bookingId)
    .maybeSingle();
  if (!booking) return { error: "That booking isn’t available." };
  const now = Date.now();
  const { data, error } = await supabase.rpc("staff_booking_availability", {
    p_org: input.organizationId,
    p_event_type_id: booking.event_type_id,
    p_from: new Date(now).toISOString(),
    p_to: new Date(now + 28 * DAY).toISOString(),
    p_exclude_booking: booking.id,
  });
  const payload = error ? null : parseAvailability(data);
  if (!payload) return { error: "Times couldn’t be loaded." };
  const zone = isTimeZone(input.timeZone) ? input.timeZone : "America/Toronto";
  const current = Date.parse(booking.starts_at);
  const starts = slotsFromAvailability(payload, { fromUtc: now, toUtc: now + 28 * DAY, nowUtc: now, ignoreNotice: true, membershipId: booking.host_membership_id })
    .filter((start) => start !== current)
    .slice(0, 80);
  return { options: starts.map((start) => ({ value: new Date(start).toISOString(), label: shortWhen(start, zone) })) };
}
