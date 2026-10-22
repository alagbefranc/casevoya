import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { liveKitConfig } from "@/modules/video/env";
import { verifyLiveKitWebhook } from "@/modules/video/livekit";

/**
 * LiveKit webhooks (BUILD-SPEC §7.6): room_started, room_finished, participant_joined,
 * participant_left. The Authorization JWT must be signed with our API secret and carry the raw
 * body's SHA-256, or nothing is read. Each event is applied once (webhook inbox, LiveKit's event
 * id); other event kinds and unknown rooms are recorded as ignored.
 */
export async function POST(request: Request) {
  const config = liveKitConfig();
  if (!config || !process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Video webhook is not configured." }, { status: 503 });
  }
  const raw = await request.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "Too large." }, { status: 413 });
  if (!(await verifyLiveKitWebhook(config, raw, request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!event || typeof event !== "object" || Array.isArray(event) || typeof (event as { id?: unknown }).id !== "string") {
    return NextResponse.json({ error: "Not an event." }, { status: 400 });
  }
  const { data, error } = await createServiceClient().rpc("apply_livekit_event", { p_event: event as Record<string, never> });
  if (error) return NextResponse.json({ error: "Not recorded." }, { status: 500 });
  return NextResponse.json({ ok: true, outcome: (data as { outcome?: string } | null)?.outcome ?? null });
}
