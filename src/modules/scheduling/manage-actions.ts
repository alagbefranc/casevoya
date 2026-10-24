"use server";

/**
 * "Manage your booking" (CRM-03) for a booker without a portal: free times, the move and the
 * cancellation, each proved by the link's token (hashed here; the database compares hashes and
 * applies the booking type's rules). No sign-in.
 */
import { createClient } from "@/lib/supabase/server";
import { closeRoomForBooking } from "@/modules/video/service";
import { parseAvailability, slotsFromAvailability } from "./availability";
import { isBookingRef, isManageToken, manageError, manageTokenHash } from "./manage-present";
import { isTimeZone } from "./slots";

const DAY = 86_400_000;
const RANGE_DAYS = 28;

export type ManageResult = { ok: true; late?: boolean } | { error: string };

async function proof(ref: string, token: string): Promise<string | null> {
  if (!isBookingRef(ref) || !isManageToken(token)) return null;
  return manageTokenHash(token);
}

export async function manageRescheduleStarts(input: { ref: string; token: string }): Promise<{ starts: number[] } | { error: string }> {
  const hash = await proof(input.ref, input.token);
  if (!hash) return { error: manageError("access denied") };
  const supabase = await createClient();
  const now = Date.now();
  const { data, error } = await supabase.rpc("booking_manage_availability", {
    p_ref: input.ref,
    p_sha256: hash,
    p_from: new Date(now).toISOString(),
    p_to: new Date(now + RANGE_DAYS * DAY).toISOString(),
  });
  if (error) return { error: manageError(error.message) };
  const payload = parseAvailability(data);
  if (!payload) return { error: "Times couldn’t be loaded." };
  return { starts: slotsFromAvailability(payload, { fromUtc: now, toUtc: now + RANGE_DAYS * DAY, nowUtc: now }).slice(0, 400) };
}

export async function manageReschedule(input: { ref: string; token: string; start: string; timeZone: string; version: number }): Promise<ManageResult> {
  const hash = await proof(input.ref, input.token);
  if (!hash) return { error: manageError("access denied") };
  const start = Date.parse(input.start);
  if (!Number.isFinite(start) || start % 60_000 !== 0) return { error: "Choose a time." };
  if (!isTimeZone(input.timeZone)) return { error: "Choose a time zone." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("booking_manage_reschedule", {
    p_ref: input.ref,
    p_sha256: hash,
    p_start: new Date(start).toISOString(),
    p_time_zone: input.timeZone,
    p_expected_version: Number.isInteger(input.version) ? input.version : 0,
  });
  return error ? { error: manageError(error.message) } : { ok: true };
}

export async function manageCancel(input: { ref: string; token: string; reason: string; version: number; bookingId?: string }): Promise<ManageResult> {
  const hash = await proof(input.ref, input.token);
  if (!hash) return { error: manageError("access denied") };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) return { error: manageError("say why") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_manage_cancel", {
    p_ref: input.ref,
    p_sha256: hash,
    p_expected_version: Number.isInteger(input.version) ? input.version : null,
    p_reason: reason.slice(0, 500),
  });
  if (error) return { error: manageError(error.message) };
  if (input.bookingId) closeRoomForBooking(input.bookingId);
  const late = Boolean(data && typeof data === "object" && !Array.isArray(data) && (data as { late?: unknown }).late === true);
  return { ok: true, late };
}
