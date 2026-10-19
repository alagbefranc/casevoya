import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { applyFraming } from "@/lib/security/framing";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  // Only a firm's embedded enquiry form may be framed by another site.
  applyFraming(response.headers, request.nextUrl.pathname);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
