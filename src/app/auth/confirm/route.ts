import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/redirect";
import { escapeHtml } from "@/lib/html";
import { createClient } from "@/lib/supabase/server";

/** An invitation screen the confirmation link was sent from. */
function isInvitationReturn(next: string): boolean {
  return next.startsWith("/invite/") || /^\/accept\/(client|family|sponsor)\?token=/.test(next);
}

/** The email link types Supabase Auth sends; anything else is refused. */
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

function readOtpType(value: FormDataEntryValue | string | null): EmailOtpType | null {
  return typeof value === "string" && (EMAIL_OTP_TYPES as readonly string[]).includes(value) ? (value as EmailOtpType) : null;
}

function readTokenHash(value: FormDataEntryValue | string | null): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : null;
}

function failed(next: string, request: NextRequest, status?: number) {
  // A sign-up link opened on another device or browser confirms the email but can't start a
  // session there (no PKCE verifier). An invitee goes back to the invitation (staff: /invite/…,
  // portal: /accept/<role>?token=…), where signing in with the password they chose finishes
  // joining; anyone else signs in as usual.
  if (isInvitationReturn(next)) return NextResponse.redirect(new URL(next, request.url), status);
  return NextResponse.redirect(new URL("/sign-in?error=link_invalid", request.url), status);
}

/**
 * The confirmation step for an email link with a token_hash: a same-origin form that posts the
 * token back, so the session only starts when the person presses Continue on this site.
 */
function confirmPage(tokenHash: string, type: EmailOtpType, next: string) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Continue to Casevoya</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f7f6f3;color:#111;display:grid;place-items:center;min-height:100vh}main{background:#fff;border-radius:14px;padding:32px;max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:22px;margin:0 0 8px}p{color:#3b3935;line-height:1.5;margin:0 0 20px}button{background:#0075DE;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:inherit;font-weight:500;cursor:pointer}</style>
</head><body><main><h1>Continue to Casevoya</h1><p>You opened a link from a Casevoya email. Continue only if you asked for it.</p>
<form method="post" action="/auth/confirm"><input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}"><input type="hidden" name="type" value="${escapeHtml(type)}"><input type="hidden" name="next" value="${escapeHtml(next)}"><button type="submit">Continue</button></form>
</main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

// Email links: a token_hash link shows a Continue step (POST below); a PKCE ?code= link exchanges
// the code for a session (it needs the verifier stored in this browser).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = readTokenHash(searchParams.get("token_hash"));
  const type = readOtpType(searchParams.get("type"));
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type) return confirmPage(tokenHash, type, next);

  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return failed(next, request);
}

/** The Continue step: only this site's own page may post here (Origin check). */
export async function POST(request: NextRequest) {
  const here = new URL(request.url);
  if (request.headers.get("origin") !== here.origin) return NextResponse.json({ error: "This must come from Casevoya." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next") ?? null);
  const tokenHash = readTokenHash(form?.get("token_hash") ?? null);
  const type = readOtpType(form?.get("type") ?? null);
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url), 303);
  }
  return failed(next, request, 303);
}
