import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { letterFileName } from "@/modules/vo/letter";

/**
 * Release of one approved matter letter (AI-01) as a plain-text file. The database decides
 * (public.release_matter_letter): staff who can read the matter, only after a licensed member
 * approved it; the approved version, citation markers removed; audited letter.released. A draft is
 * refused here, so a letter can't leave Casevoya before its licensed review.
 */
export async function GET(request: Request, { params }: { params: Promise<{ letterId: string }> }) {
  const { letterId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(letterId) || !isUuid(organizationId)) return NextResponse.json({ error: "Choose the letter." }, { status: 400 });
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabase.rpc("release_matter_letter", { p_letter_id: letterId });
  if (error || !data || typeof data !== "object") {
    const draft = /must approve/i.test(error?.message ?? "");
    return NextResponse.json(
      { error: draft ? "A licensed member must approve this letter before it is released." : "That letter isn’t available." },
      { status: draft ? 409 : 404 },
    );
  }
  const letter = data as { title?: string; body?: string; version_number?: number };
  return new Response(`${letter.body ?? ""}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${letterFileName(letter.title ?? "letter", letter.version_number ?? 1)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
