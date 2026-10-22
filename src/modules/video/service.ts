import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { liveKitConfig } from "./env";
import { ADMITTED_PERMISSION, participantToken, roomService, ROOM_OPTIONS } from "./livekit";
import { parseJoinView, type JoinView } from "./present";

/**
 * In-app video calls (BUILD-SPEC §7). The database decides who may join and when
 * (public.video_join and friends, as the signed-in person under RLS); this module turns its answer
 * into a LiveKit token and makes the few room calls. A token is returned once and never logged.
 */

export type VideoFailure = { error: string; status: number };

const REF = /^[a-z2-7]{26}$/;

export function validCall(organizationId: unknown, ref: unknown): organizationId is string {
  return isUuid(organizationId as string) && typeof ref === "string" && REF.test(ref);
}

function failure(message: string): VideoFailure {
  if (/call access denied|only the host/.test(message)) return { error: message.includes("only the host") ? "Only the host can do that." : "You can’t join this call.", status: 403 };
  if (/too many join attempts/.test(message)) return { error: "Too many tries. Wait a minute and try again.", status: 429 };
  if (/not waiting|not open/.test(message)) return { error: "That person isn’t waiting for this call any more.", status: 409 };
  return { error: "Something went wrong. Try again.", status: 500 };
}

async function session(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

/** What the call page shows before anyone joins (no writes, no token). */
export async function readCall(organizationId: string, ref: string): Promise<JoinView | VideoFailure> {
  const supabase = await session(organizationId);
  if (!supabase) return { error: "Sign in first.", status: 401 };
  const { data, error } = await supabase.rpc("video_join", { p_org: organizationId, p_ref: ref, p_issue: false });
  if (error) return failure(error.message);
  return parseJoinView(data) ?? { error: "Something went wrong. Try again.", status: 500 };
}

export type JoinGrant = {
  serverUrl: string;
  token: string;
  identity: string;
  role: "host" | "client";
  admitted: boolean;
};

/** A join token for the signed-in person, inside the window. Creates the LiveKit room the first time. */
export async function joinCall(organizationId: string, ref: string): Promise<{ view: JoinView; grant: JoinGrant | null; configured: boolean } | VideoFailure> {
  const config = liveKitConfig();
  const supabase = await session(organizationId);
  if (!supabase) return { error: "Sign in first.", status: 401 };
  if (!config) {
    // Answer what the call is without counting a join, so the page can say video isn't set up.
    const view = await readCall(organizationId, ref);
    return "error" in view ? view : { view, grant: null, configured: false };
  }
  const { data, error } = await supabase.rpc("video_join", { p_org: organizationId, p_ref: ref, p_issue: true });
  if (error) return failure(error.message);
  const view = parseJoinView(data);
  if (!view) return { error: "Something went wrong. Try again.", status: 500 };
  if (view.state !== "open" || !view.grant) return { view, grant: null, configured: true };
  const api = roomService(config);
  if (!view.grant.roomCreated) {
    try {
      await api.createRoom(view.grant.roomName, { ...ROOM_OPTIONS });
    } catch {
      return { error: "The video service didn’t answer. Try again in a moment.", status: 502 };
    }
    await supabase.rpc("video_room_created", { p_org: organizationId, p_ref: ref });
  }
  const token = await participantToken(config, {
    identity: view.grant.identity,
    name: view.grant.name,
    role: view.role,
    admitted: view.grant.admitted,
    room: view.grant.roomName,
    ttlSeconds: view.grant.ttlSeconds,
  });
  return { view, grant: { serverUrl: config.url, token, identity: view.grant.identity, role: view.role, admitted: view.grant.admitted }, configured: true };
}

/** A host lets a waiting client in (their permissions change in the room) or sends them away. */
export async function admitToCall(organizationId: string, ref: string, identity: string, admit: boolean): Promise<{ ok: true } | VideoFailure> {
  if (!/^client:[0-9a-f-]{36}$/.test(identity)) return { error: "Choose who to let in.", status: 400 };
  const config = liveKitConfig();
  if (!config) return { error: "Video calls aren’t set up yet.", status: 503 };
  const supabase = await session(organizationId);
  if (!supabase) return { error: "Sign in first.", status: 401 };
  const { data, error } = await supabase.rpc("video_admit", { p_org: organizationId, p_ref: ref, p_identity: identity, p_admit: admit });
  if (error) return failure(error.message);
  const room = data && typeof data === "object" && !Array.isArray(data) ? String((data as { room_name?: unknown }).room_name ?? "") : "";
  if (!/^cv-[0-9a-f]{32}$/.test(room)) return { error: "Something went wrong. Try again.", status: 500 };
  const api = roomService(config);
  try {
    if (admit) await api.updateParticipant(room, identity, { permission: { ...ADMITTED_PERMISSION }, attributes: { admitted: "1" } });
    else await api.removeParticipant(room, identity);
  } catch {
    return { error: "The video service didn’t answer. Try again in a moment.", status: 502 };
  }
  return { ok: true };
}

/** A host ends the call for everyone: the room is recorded ended and deleted in LiveKit. */
export async function endCall(organizationId: string, ref: string): Promise<{ ok: true } | VideoFailure> {
  const supabase = await session(organizationId);
  if (!supabase) return { error: "Sign in first.", status: 401 };
  const { data, error } = await supabase.rpc("video_end", { p_org: organizationId, p_ref: ref });
  if (error) return failure(error.message);
  const room = data && typeof data === "object" && !Array.isArray(data) ? String((data as { room_name?: unknown }).room_name ?? "") : "";
  const config = liveKitConfig();
  if (config && /^cv-[0-9a-f]{32}$/.test(room)) {
    try {
      await roomService(config).deleteRoom(room);
    } catch {
      return { error: "The call was ended here, but the video service didn’t answer. People in it will drop off when it closes.", status: 502 };
    }
  }
  return { ok: true };
}

/**
 * After a booking is cancelled (the database already refuses new tokens), disconnect anyone still
 * in its room. Best effort: a missing room, missing settings or a LiveKit error changes nothing.
 */
export async function closeRoomForBooking(bookingId: string): Promise<void> {
  const config = liveKitConfig();
  if (!config || !isUuid(bookingId)) return;
  try {
    await roomService(config).deleteRoom(`cv-${bookingId.replaceAll("-", "")}`);
  } catch {
    // The room closes on its own 10 minutes after the last person leaves.
  }
}
