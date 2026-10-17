import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";
import { hasPublicSupabaseEnv, getPublicSupabaseEnv } from "@/lib/env";
import { isGatedPath, signInLocation } from "@/lib/auth/redirect";
import { isStaffArea, staffMfaRedirectPath } from "@/lib/auth/staff-session";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/tenant/context";

function redirectKeepingSession(request: NextRequest, response: NextResponse, pathname: string, search: string) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = pathname;
  redirectUrl.search = search;
  const redirect = NextResponse.redirect(redirectUrl);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma", REQUEST_ID_HEADER]) {
    const value = response.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

/**
 * Refreshes the Supabase session cookie and attaches a request id.
 * This is an optimistic gate only; every server action / route handler must still
 * authorize with getClaims() and RLS.
 */
export async function updateSession(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  request.headers.set(REQUEST_ID_HEADER, requestId);

  let response = NextResponse.next({ request });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  const path = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  if (!hasPublicSupabaseEnv()) {
    if (isGatedPath(path)) {
      const destination = new URL(signInLocation(path, search), request.url);
      return redirectKeepingSession(request, response, destination.pathname, destination.search);
    }
    return response;
  }
  const { url, publishableKey } = getPublicSupabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    auth: { experimental: { passkey: true } },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        response.headers.set(REQUEST_ID_HEADER, requestId);
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (
    path === "/mfa" ||
    path.startsWith("/mfa/") ||
    path.startsWith("/invite/") ||
    path === "/recovery" ||
    path === "/start-trial" ||
    path === "/setup" ||
    path.startsWith("/accept/")
  ) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
  }

  if (!signedIn && isGatedPath(path)) {
    const destination = new URL(signInLocation(path, search), request.url);
    return redirectKeepingSession(request, response, destination.pathname, destination.search);
  }

  // Staff need an assured session before the firm workspace. Clients are not redirected.
  // aal2 covers TOTP and WebAuthn MFA. Passkey login and an app recovery code do not
  // raise aal, so the database function is the optimistic check. RLS remains the authority.
  if (signedIn && isStaffArea(path)) {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    let mfaSatisfied = level?.currentLevel === "aal2";
    if (!mfaSatisfied) {
      const { data: satisfied, error: rpcError } = await supabase.rpc("session_mfa_satisfied");
      if (!rpcError && satisfied === true) mfaSatisfied = true;
    }
    if (!mfaSatisfied) {
      const { data: memberships, error } = await supabase
        .from("memberships")
        .select("role")
        .eq("status", "active");
      if (!error) {
        const target = staffMfaRedirectPath({
          pathname: path,
          signedIn: true,
          currentAal: level?.currentLevel,
          activeRoles: (memberships ?? []).map((membership) => membership.role),
          mfaSatisfied: false,
        });
        if (target) {
          const destination = new URL(target, request.url);
          return redirectKeepingSession(request, response, destination.pathname, destination.search);
        }
      }
    }
  }

  return response;
}
