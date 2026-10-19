"use server";

/**
 * The client portal's own appointment actions (CRM-03): free times for moving a booking, the move
 * itself and a cancellation. Each runs as the signed-in person; the database functions refuse
 * anyone but the booking's own person (portal_cancel_booking, portal_reschedule_booking,
 * portal_booking_availability). Errors come back as plain words, never the raw message.
 */
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { parseAvailability, slotsFromAvailability } from "./availability";
import { isTimeZone } from "./slots";

const DAY = 86_400_000;
/** How far ahead the reschedule picker looks (the type's own booking window still applies). */
const RANGE_DAYS = 28;

export type PortalActionResult = { ok: true; late?: boolean } | { error: string };

/** A database refusal as words a client can act on. */
function portalBookingError(message: string): { error: string } {
  if (/slot_unavailable/.test(message)) return { error: "That time is no longer free. Choose another." };
  if (/changed by someone else/.test(message)) return { error: "This booking changed since you opened it. Reload and try again." };
  if (/only an upcoming/.test(message)) return { error: "Only an upcoming, confirmed call can be changed." };
  if (/choose a time zone/.test(message)) return { error: "Choose a time zone." };
  if (/booking access denied|authentication required|sign in/i.test(message)) return { error: "You can’t change this booking." };
  return { error: "That couldn’t be saved. Try again." };
}

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return null;
  const supabase = await createClient({ organizationId });
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

/**
 * Free starts (epoch ms, ascending) for moving the client's own booking over the next four weeks:
 * the same type and host, the booking's own time excluded, the type's minimum notice and booking
 * window honoured (the database enforces them again on the move).
 */
export async function portalRescheduleStarts(input: { organizationId: string; bookingId: string }): Promise<{ starts: number[]; now: number } | { error: string }> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const now = Date.now();
  const { data, error } = await supabase.rpc("portal_booking_availability", {
    p_org: input.organizationId,
    p_booking_id: input.bookingId,
    p_from: new Date(now).toISOString(),
    p_to: new Date(now + RANGE_DAYS * DAY).toISOString(),
  });
  if (error) return portalBookingError(error.message);
  const payload = parseAvailability(data);
  if (!payload) return { error: "Times couldn’t be loaded." };
  const starts = slotsFromAvailability(payload, { fromUtc: now, toUtc: now + RANGE_DAYS * DAY, nowUtc: now }).slice(0, 400);
  return { starts, now };
}

/** Moves the client's own booking to `start` (ISO), shown to them in `timeZone`. */
export async function portalRescheduleBooking(input: { organizationId: string; bookingId: string; start: string; timeZone: string; version: number | null }): Promise<PortalActionResult> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const start = Date.parse(input.start);
  if (!Number.isFinite(start) || start % 60_000 !== 0) return { error: "Choose a time." };
  if (!isTimeZone(input.timeZone)) return { error: "Choose a time zone." };
  const version = input.version != null && Number.isInteger(input.version) ? input.version : null;
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("portal_reschedule_booking", {
    p_org: input.organizationId,
    p_booking_id: input.bookingId,
    p_start: new Date(start).toISOString(),
    p_time_zone: input.timeZone,
    p_expected_version: version,
  });
  return error ? portalBookingError(error.message) : { ok: true };
}

/** Cancels the client's own booking. `late` says it was inside the type's minimum notice. */
export async function portalCancelBooking(input: { organizationId: string; bookingId: string; version: number | null }): Promise<PortalActionResult> {
  if (!isUuid(input.bookingId)) return { error: "Reload and try again." };
  const version = input.version != null && Number.isInteger(input.version) ? input.version : null;
  const supabase = await session(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("portal_cancel_booking", {
    p_org: input.organizationId,
    p_booking_id: input.bookingId,
    p_expected_version: version,
    p_reason: null,
  });
  if (error) return portalBookingError(error.message);
  const late = Boolean(data && typeof data === "object" && !Array.isArray(data) && (data as { late?: unknown }).late === true);
  return { ok: true, late };
}
