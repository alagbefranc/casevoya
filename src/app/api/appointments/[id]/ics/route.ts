import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { locationLabel } from "@/modules/scheduling/format";
import { buildIcs } from "@/modules/scheduling/ics";

/**
 * "Add to calendar" for one booking, as an .ics file. Read as the signed-in person: RLS lets in the
 * firm's scheduling staff and the client the booking is for, nobody else. The UID never changes, so
 * a later download after a reschedule updates the same calendar entry (SEQUENCE).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(id) || !isUuid(organizationId)) return NextResponse.json({ error: "Choose the booking." }, { status: 400 });
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const [{ data: booking }, { data: org }] = await Promise.all([
    supabase
      .from("bookings")
      .select("public_ref, title, starts_at, ends_at, status, location_kind, location_detail, ics_sequence")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("organizations").select("display_name").eq("id", organizationId).maybeSingle(),
  ]);
  if (!booking) return NextResponse.json({ error: "That booking isn’t available." }, { status: 404 });
  const link = booking.status === "confirmed" && booking.location_kind === "meeting_link" ? booking.location_detail : null;
  const body = buildIcs({
    publicRef: booking.public_ref,
    sequence: booking.ics_sequence,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    title: booking.title,
    firmName: org?.display_name ?? "your firm",
    location: link ?? locationLabel(booking.location_kind, booking.status === "confirmed" ? booking.location_detail : null),
    url: link,
    cancelled: booking.status === "cancelled",
    stampedAt: Date.now(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="consultation.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
