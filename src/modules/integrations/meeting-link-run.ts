import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { composioConfigured, executeAs } from "./composio";
import { fulfillProviderMeeting, parseBegin, type MeetingSummary } from "./meeting-links";

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
    async store(id, joinUrl) {
      const { error } = await supabase.rpc("store_booking_meeting", { p_booking_id: id, p_join_url: joinUrl });
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
