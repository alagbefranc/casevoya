import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";
import { hasPublicSupabaseEnv, getPublicSupabaseEnv } from "@/lib/env";
import { isStaffArea, staffMfaRedirectPath } from "@/lib/auth/staff-session";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/tenant/context";

const PROTECTED_PREFIXES = ["/app"];

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

  if (!hasPublicSupabaseEnv()) return response;
  const { url, publishableKey } = getPublicSupabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
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

  const path = request.nextUrl.pathname;
  if (path === "/mfa" || path.startsWith("/mfa/") || path.startsWith("/invite/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
  }

  if (!signedIn && PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return redirectKeepingSession(request, response, "/sign-in", `?next=${encodeURIComponent(path)}`);
  }

  // Staff need aal2 before the firm workspace. Clients are not redirected.
  // This is optimistic: RLS still enforces aal2 on staff reads and writes.
  if (signedIn && isStaffArea(path)) {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.currentLevel !== "aal2") {
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
