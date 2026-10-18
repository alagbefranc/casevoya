import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "@/modules/portal/load";

export type PortalAppointment = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string | null;
  locationKind: string;
  locationDetail: string | null;
  timeZone: string;
};

export type PortalAppointments = {
  rows: PortalAppointment[];
  /** When this was read (server clock), to split coming up from past. */
  now: number;
  /** The firm's published booking types, for "Book a call". */
  bookable: { title: string; href: string; durationMin: number }[];
};

/**
 * The signed-in client's own bookings (RLS: the booking's person is them) and the firm's published
 * booking types. Nobody else's booking is ever read here.
 */
export async function loadPortalAppointments(viewer: PortalViewer): Promise<PortalAppointments> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const [bookings, org] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, title, starts_at, ends_at, status, host_name, location_kind, location_detail, attendee_time_zone")
      .eq("organization_id", viewer.organizationId)
      .in("status", ["confirmed", "completed", "no_show", "cancelled"])
      .order("starts_at", { ascending: true })
      .limit(100),
    supabase.from("organizations").select("slug").eq("id", viewer.organizationId).maybeSingle(),
  ]);
  const slug = org.data?.slug ?? null;
  let bookable: PortalAppointments["bookable"] = [];
  if (slug) {
    const { data } = await supabase.rpc("booking_public_event_types", { p_firm_slug: slug });
    const types = data && typeof data === "object" && !Array.isArray(data) ? (data as { types?: unknown }).types : null;
    if (Array.isArray(types)) {
      bookable = types
        .filter((type): type is { slug: string; title: string; duration_min: number } => Boolean(type && typeof type === "object" && "slug" in type && "title" in type))
        // A practice page (sample mode) is for the firm's staff, never offered in a client portal.
        .filter((type) => (type as { practice?: unknown }).practice !== true)
        .map((type) => ({ title: type.title, href: `/book/${slug}/${type.slug}`, durationMin: type.duration_min }));
    }
  }
  return {
    rows: (bookings.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      hostName: row.host_name,
      locationKind: row.location_kind,
      locationDetail: row.status === "confirmed" ? row.location_detail : null,
      timeZone: row.attendee_time_zone,
    })),
    now: Date.now(),
    bookable,
  };
}
