/**
 * What a Vo lead follow-up or call summary may read, as the requesting staff member (PRD AI-05):
 * a Supabase client built from THEIR short-lived access token and the publishable key, so Postgres
 * RLS decides every row (leads for lead staff; consultations for scheduling staff; matters for
 * staff who read the matter). Every query is narrowed to the run's own lead, consultation or
 * matter. No service-role key exists here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.types";
import type { LeadFacts, VoCrmSettings } from "../../../src/modules/vo/crm";

export type BookingFacts = { id: string; title: string; startsAt: string; attendee: string; status: string; locationKind: string };

/** The narrow surface the task uses. Tests pass a fake; production uses supabaseVoCrmData. */
export interface VoCrmData {
  settings(): Promise<VoCrmSettings>;
  timeZone(): Promise<string>;
  /** The lead, its current consent answers, its latest notes and linked consultations. Dates as instants. */
  lead(leadId: string): Promise<(Omit<LeadFacts, "createdOn" | "notes" | "bookings"> & {
    reply: boolean;
    createdAt: string;
    notes: { id: string; body: string; createdAt: string; fromForm: boolean }[];
    bookings: { id: string; title: string; startsAt: string; status: string }[];
  }) | null>;
  booking(bookingId: string): Promise<BookingFacts | null>;
  leadName(leadId: string): Promise<string | null>;
  matterLabel(matterId: string): Promise<string | null>;
  rpc(name: "finish_vo_crm_run", args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

const NOTES = 10;

export function supabaseVoCrmData(input: { url: string; publishableKey: string; accessToken: string; organizationId: string }): VoCrmData {
  const db: SupabaseClient<Database> = createClient<Database>(input.url, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${input.accessToken}`, "x-casevoya-org": input.organizationId } },
  });
  const org = input.organizationId;
  return {
    async settings() {
      const { data } = await db.from("vo_settings").select("*").eq("organization_id", org).maybeSingle();
      return (data as VoCrmSettings) ?? null;
    },
    async timeZone() {
      const { data } = await db.from("organizations").select("timezone").eq("id", org).maybeSingle();
      return data?.timezone || "America/Toronto";
    },
    async lead(leadId) {
      const { data: row } = await db
        .from("leads")
        .select("id, display_name, service_interest, language, preferred_contact, stage_id, created_at")
        .eq("organization_id", org)
        .eq("id", leadId)
        .maybeSingle();
      if (!row) return null;
      const [stage, consents, notes, links] = await Promise.all([
        db.from("lead_stages").select("label").eq("organization_id", org).eq("id", row.stage_id).maybeSingle(),
        db.from("lead_consents").select("purpose, granted, recorded_at").eq("organization_id", org).eq("lead_id", row.id).order("recorded_at", { ascending: false }),
        db.from("lead_notes").select("id, body, created_at, created_by").eq("organization_id", org).eq("lead_id", row.id).order("created_at", { ascending: false }).limit(NOTES),
        db.from("lead_booking_links").select("booking_id").eq("organization_id", org).eq("lead_id", row.id).limit(5),
      ]);
      const latest = (purpose: string) => (consents.data ?? []).find((c) => c.purpose === purpose)?.granted === true;
      const bookingIds = (links.data ?? []).map((link) => link.booking_id);
      const bookings = bookingIds.length
        ? await db.from("bookings").select("id, title, starts_at, status").eq("organization_id", org).in("id", bookingIds).order("starts_at", { ascending: false })
        : null;
      return {
        id: row.id,
        name: row.display_name,
        serviceInterest: row.service_interest,
        language: row.language,
        preferredContact: row.preferred_contact,
        stage: stage.data?.label ?? null,
        createdAt: row.created_at,
        reply: latest("enquiry_reply"),
        marketing: latest("marketing"),
        notes: (notes.data ?? []).map((note) => ({ id: note.id, body: note.body, createdAt: note.created_at, fromForm: note.created_by === null })),
        bookings: (bookings?.data ?? []).map((b) => ({ id: b.id, title: b.title, startsAt: b.starts_at, status: String(b.status) })),
      };
    },
    async booking(bookingId) {
      const { data: row } = await db.from("bookings").select("id, title, starts_at, status, location_kind").eq("organization_id", org).eq("id", bookingId).maybeSingle();
      if (!row) return null;
      const { data: attendee } = await db
        .from("booking_attendees")
        .select("display_name")
        .eq("organization_id", org)
        .eq("booking_id", row.id)
        .eq("role", "primary")
        .maybeSingle();
      return { id: row.id, title: row.title, startsAt: row.starts_at, status: String(row.status), locationKind: String(row.location_kind), attendee: attendee?.display_name ?? "the client" };
    },
    async leadName(leadId) {
      const { data } = await db.from("leads").select("display_name").eq("organization_id", org).eq("id", leadId).maybeSingle();
      return data?.display_name ?? null;
    },
    async matterLabel(matterId) {
      const { data } = await db.from("matters").select("reference, title").eq("organization_id", org).eq("id", matterId).maybeSingle();
      return data ? data.reference || data.title : null;
    },
    async rpc(name, args) {
      const { data, error } = await db.rpc(name, args as never);
      return { data, error: error ? { message: error.message } : null };
    },
  };
}
