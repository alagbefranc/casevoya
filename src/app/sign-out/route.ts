import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session from the Sheet sidebar or the portal's account page. A plain form post,
 * so it works before any script loads. Cookie-authenticated, so only this site's own pages
 * may post here; a cross-site form can't sign someone out.
 */
export async function POST(request: Request) {
  const here = new URL(request.url);
  if (request.headers.get("origin") !== here.origin) return NextResponse.json({ error: "This must come from Casevoya." }, { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-in", here), 303);
}
