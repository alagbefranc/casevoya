import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { composioConfigured, executeAs } from "./composio";
import { createClient } from "@/lib/supabase/server";
import { cancelPlan, fulfillProviderMeeting, isMeetingProvider, parseBegin, reschedulePlan, type MeetingSummary, type ProviderState } from "./meeting-links";

/**
 * After a Meet or Teams booking is held: create one link in the host's connected account, store
 * it, and confirm. Service role only talks to the booking row. The provider call uses the host
 * membership id the database returns, never an id from the browser.
 */
export async function attachProviderMeeting(bookingId: string): Promise<{ ok: true; summary: MeetingSummary } | { ok: false; error: string; retry: boolean }> {
  const supabase = createServiceClient();
  if (!composioConfigured()) {
    await supabase.rpc("release_provider_booking", { p_booking_id: bookingId });
    return { ok: false, error: "Meeting links aren’t available on this server. Nothing was confirmed.", retry: false };
  }
  return fulfillProviderMeeting(bookingId, {
    async begin(id) {
      const { data, error } = await supabase.rpc("begin_booking_meeting", { p_booking_id: id });
      if (error) return { action: "unavailable", message: "The meeting account couldn’t be used." };
      return parseBegin(data);
    },
    async store(id, joinUrl, meta) {
      const { error } = await supabase.rpc("attach_booking_meeting", {
        p_booking_id: id,
        p_join_url: joinUrl,
        p_provider_ref: meta.providerRef,
        p_organizer_ref: meta.organizerRef,
      });
      if (error) throw new Error("store refused");
    },
    async confirm(id) {
      const { data, error } = await supabase.rpc("confirm_provider_booking", { p_booking_id: id });
      if (error || !data || typeof data !== "object") throw new Error("confirm refused");
      const row = data as Record<string, unknown>;
      return {
        publicRef: String(row.public_ref ?? ""),
        status: String(row.status ?? ""),
        locationKind: String(row.location_kind ?? ""),
        locationDetail: typeof row.location_detail === "string" ? row.location_detail : null,
      };
    },
    async release(id) {
      await supabase.rpc("release_provider_booking", { p_booking_id: id });
    },
    async create(input) {
      const out = await executeAs(input.hostMembershipId, input.slug, input.args);
      if (!out.successful) throw new Error("provider refused");
      return out.data;
    },
  });
}

type Access = { bookingId: string | null; organizationId: string | null; ref: string | null; sha256: string | null };

function readState(data: unknown): (ProviderState & { startsAt: string; endsAt: string; bookingId: string }) | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const kind = String(row.location_kind ?? "");
  if (!isMeetingProvider(kind)) return null;
  return {
    locationKind: kind,
    providerRef: typeof row.provider_ref === "string" ? row.provider_ref : null,
    organizerRef: typeof row.organizer_ref === "string" ? row.organizer_ref : null,
    hostMembershipId: String(row.host_membership_id ?? ""),
    startsAt: String(row.starts_at ?? ""),
    endsAt: String(row.ends_at ?? ""),
    bookingId: typeof row.booking_id === "string" ? row.booking_id : "",
  };
}

async function providerState(access: Access): Promise<{ error: string } | { state: ReturnType<typeof readState> }> {
  const supabase = await createClient(access.organizationId ? { organizationId: access.organizationId } : {});
  const { data, error } = await supabase.rpc("booking_provider_state", {
    p_booking_id: access.bookingId,
    p_organization_id: access.organizationId,
    p_ref: access.ref,
    p_sha256: access.sha256,
  });
  if (error) return { error: "You can’t change this booking." };
  return { state: readState(data) };
}

async function remember(bookingId: string | null, note: string | null) {
  if (!bookingId || !note) return;
  await createServiceClient().rpc("note_booking_meeting", { p_booking_id: bookingId, p_note: note });
}

/** Move the provider meeting before Casevoya changes the time. A failed Teams update leaves the booking where it was. */
export async function alignProviderReschedule(access: Access, startIso: string): Promise<{ ok: true } | { error: string }> {
  const loaded = await providerState(access);
  if ("error" in loaded) return loaded;
  const state = loaded.state;
  if (!state) return { ok: true };
  const span = Date.parse(state.endsAt) - Date.parse(state.startsAt);
  if (!Number.isFinite(span) || span <= 0) return { error: "The booking has no length." };
  const plan = reschedulePlan(state, startIso, new Date(Date.parse(startIso) + span).toISOString());
  if (plan.error) return { error: plan.error };
  if (plan.call) {
    if (!composioConfigured()) return { error: "Meeting links aren’t available on this server. The time was not changed." };
    try {
      const out = await executeAs(plan.call.hostMembershipId, plan.call.slug, plan.call.args);
      if (!out.successful) return { error: "Microsoft didn’t move the Teams meeting. The time was not changed." };
    } catch {
      return { error: "Microsoft didn’t move the Teams meeting. The time was not changed." };
    }
  }
  await remember(state.bookingId || access.bookingId, plan.note);
  return { ok: true };
}

/** End or delete the provider meeting before Casevoya cancels. A failed Teams delete leaves the booking in place. */
export async function alignProviderCancel(access: Access): Promise<{ ok: true } | { error: string }> {
  const loaded = await providerState(access);
  if ("error" in loaded) return loaded;
  const state = loaded.state;
  if (!state) return { ok: true };
  const plan = cancelPlan(state);
  if (plan.call) {
    if (!composioConfigured()) return { error: "Meeting links aren’t available on this server. The booking was not cancelled." };
    try {
      const out = await executeAs(plan.call.hostMembershipId, plan.call.slug, plan.call.args);
      if (!out.successful && plan.call.slug === "MICROSOFT_TEAMS_DELETE_USER_ONLINE_MEETING") {
        return { error: "Microsoft didn’t delete the Teams meeting, so the booking was not cancelled." };
      }
    } catch {
      if (plan.call.slug === "MICROSOFT_TEAMS_DELETE_USER_ONLINE_MEETING") {
        return { error: "Microsoft didn’t delete the Teams meeting, so the booking was not cancelled." };
      }
    }
  }
  await remember(state.bookingId || access.bookingId, plan.note);
  return { ok: true };
}
