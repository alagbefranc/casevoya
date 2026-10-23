import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "@/modules/portal/load";

export type PortalAppointment = {
  id: string;
  /** The booking reference: a Casevoya video call's page is /call/<reference>. */
  publicRef: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string | null;
  locationKind: string;
  locationDetail: string | null;
  timeZone: string;
  /** bookings.version, for the client's move and cancel (optimistic concurrency). */
  version: number;
  /** A sample booking: it can be moved or cancelled, but no email goes out. */
  isSample: boolean;
  /**
   * The rules for an upcoming confirmed booking (portal_booking_rules): the type's minimum notice
   * in minutes and whether cancelling now is inside it. Null for past or cancelled rows.
   */
  rules: { minNoticeMin: number; late: boolean } | null;
  /** The outcome summary the firm shared after this consultation (CRM-04), if any. */
  summary?: string | null;
};

export type PortalAppointments = {
  rows: PortalAppointment[];
  /** When this was read (server clock), to split coming up from past. */
  now: number;
  /** The firm's published booking types, for "Book a call". */
  bookable: { title: string; href: string; durationMin: number }[];
};

function rulesFrom(raw: unknown): Map<string, { minNoticeMin: number; late: boolean }> {
  const out = new Map<string, { minNoticeMin: number; late: boolean }>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const row = value && typeof value === "object" ? (value as { min_notice_min?: unknown; late?: unknown }) : null;
    if (!row) continue;
    const minNoticeMin = typeof row.min_notice_min === "number" && Number.isInteger(row.min_notice_min) ? row.min_notice_min : 1440;
    out.set(id, { minNoticeMin, late: row.late === true });
  }
  return out;
}

/**
 * The signed-in client's own bookings (RLS: the booking's person is them), the rules for moving
 * or cancelling the upcoming ones, and the firm's published booking types. Nobody else's booking
 * is ever read here.
 */
export async function loadPortalAppointments(viewer: PortalViewer): Promise<PortalAppointments> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const [bookings, org, rules, summaries] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, public_ref, title, starts_at, ends_at, status, host_name, location_kind, location_detail, attendee_time_zone, version, is_sample")
      .eq("organization_id", viewer.organizationId)
      .in("status", ["confirmed", "completed", "no_show", "cancelled"])
      .order("starts_at", { ascending: true })
      .limit(100),
    supabase.from("organizations").select("slug").eq("id", viewer.organizationId).maybeSingle(),
    supabase.rpc("portal_booking_rules", { p_org: viewer.organizationId }),
    // Only summaries a licensed consultant shared, and only the viewer's own (never a draft).
    supabase.rpc("portal_consultation_summaries", { p_org: viewer.organizationId }),
  ]);
  const summaryOf = new Map((summaries.error ? [] : (summaries.data ?? [])).map((row) => [row.booking_id, row.summary]));
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
  const byBooking = rulesFrom(rules.error ? null : rules.data);
  return {
    rows: (bookings.data ?? []).map((row) => ({
      id: row.id,
      publicRef: row.public_ref,
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      hostName: row.host_name,
      locationKind: row.location_kind,
      locationDetail: row.status === "confirmed" ? row.location_detail : null,
      timeZone: row.attendee_time_zone,
      version: row.version,
      isSample: row.is_sample,
      rules: byBooking.get(row.id) ?? null,
      summary: summaryOf.get(row.id) ?? null,
    })),
    now: Date.now(),
    bookable,
  };
}
