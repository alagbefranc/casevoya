import { NextResponse } from "next/server";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { readActivityState } from "@/modules/security/idle";

/**
 * SEC-01: the Sheet's idle guard reports activity here (`{ active: true }`, at most once a minute
 * while someone works) or asks for the current state (`{ active: false }`). public.record_staff_activity
 * decides: past the firm's idle time it ends this session on the server, and this route clears the
 * browser's session too. Cookie-authenticated, so only this site's own pages may post here.
 */
export async function POST(request: Request) {
  const here = new URL(request.url);
  if (request.headers.get("origin") !== here.origin) return NextResponse.json({ error: "This must come from Casevoya." }, { status: 403 });
  if (!hasPublicSupabaseEnv()) return NextResponse.json({ state: "none" });
  const body = (await request.json().catch(() => null)) as { active?: unknown } | null;
  const active = body?.active === true;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ state: "ended" }, { status: 401 });
  const { data, error } = await supabase.rpc("record_staff_activity", { p_active: active });
  if (error) return NextResponse.json({ state: "none" });
  const state = readActivityState(data);
  if (state.state === "expired" || state.state === "ended") {
    // The database already ended the session; this removes the browser's copy of it.
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
