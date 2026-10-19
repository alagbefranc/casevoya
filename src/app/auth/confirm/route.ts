import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

// Exchanges the email link token for a session (Supabase Auth PKCE / token_hash flow).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  // A sign-up link opened on another device or browser confirms the email but can't start a
  // session there (no PKCE verifier). An invitee goes back to the invitation, where signing in
  // with the password they chose finishes joining; anyone else signs in as usual.
  if (next.startsWith("/invite/")) return NextResponse.redirect(new URL(next, request.url));
  return NextResponse.redirect(new URL("/sign-in?error=link_invalid", request.url));
}
