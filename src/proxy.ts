import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { applyContentSecurityPolicy } from "@/lib/security/csp";
import { applyFraming } from "@/lib/security/framing";
import { applySecurityHeaders } from "@/lib/security/headers";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  const pathname = request.nextUrl.pathname;
  // Only a firm's embedded enquiry form may be framed by another site.
  applyFraming(response.headers, pathname);
  // Full CSP is report-only unless CSP_ENFORCE=1. frame-ancestors stays enforced.
  applyContentSecurityPolicy(response.headers, pathname);
  applySecurityHeaders(response.headers, pathname);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
