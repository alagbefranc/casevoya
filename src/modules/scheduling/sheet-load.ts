import "server-only";
import type { CalendarData, CalendarNav, CalendarRbar, CalendarTab } from "@/components/sheet/designer/calendar";
import type {
  BookDialogData,
  BookingTypeRow,
  CancelDialogData,
  ConsultationRecordData,
  ConsultationRecordJoin,
  ConsultationsData,
  ConsultationsTab,
  HostPanel,
  Option,
  RescheduleDialogData,
  SummaryDialogData,
} from "@/components/sheet/designer/consultations";
import type { HostOption } from "@/components/sheet/designer/scheduling-dialogs";
import { appOrigin } from "@/lib/email/env";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome, matterNames, memberNames, type SheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";
import { parseAvailability, slotsFromAvailability } from "./availability";
import { isUuid } from "@/lib/tenant/context";
import { CALL_WAIT_TOAST, callHref, callIsOpen } from "@/modules/video/present";
import { COMMON_ZONES, PRACTICE_NOTICE, locationLabel, locationShort, longWhen, safeZone, shortWhen, slotLabel } from "./format";
import {
  BOOKING_PAGE_PILL,
  agreementLabel,
  bookingEventLabel,
  bookingPageState,
  bookingPagesInOrder,
  bookingTypeState,
  buildWeek,
  calendarConnections,
  consultationRow,
  daysSummary,
  deadlineNote,
  defaultWeekAnchor,
  mondayOf,
  monthBox,
  recordAgreement,
  recordHref,
  recordOutcome,
  shiftMonth,
  summaryView,
  upcomingRows,
  type BookingAgreementRow,
  type StaffBooking,
  type WeekItem,
} from "./sheet-present";
import { addDays, isTimeZone, localToUtc, utcToLocal } from "./slots";

type Client = Awaited<ReturnType<typeof createClient>>;

const DAY = 86_400_000;
const SCHEDULING_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ConsultationsPage = {
  chrome: SheetChrome;
  tab: ConsultationsTab | "record";
  /** The Consultation record tab (`?tab=record&id=<booking>`): a real booking's notes and outcome. */
  record: ConsultationRecordData | null;
  /** Write or edit the outcome summary (#dlgSum), when the record offers it. */
  summaryDialog: SummaryDialogData | null;
  pills: string[];
  book: Record<string, string> | null;
  page: ConsultationsData;
  dialogs: { book: BookDialogData; reschedule: RescheduleDialogData; cancel: CancelDialogData };
  /** practice: sample mode, so the booking type dialog publishes practice pages. */
  /** agreements: the approved consultation agreements a booking type can send (booking page). */
  settings: { organizationId: string; zones: string[]; hosts: HostOption[]; owner: boolean; practice: boolean; agreements: Option[] };
};

type EventTypeRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_min: number;
  slot_step_min: number | null;
  buffer_before_min: number;
  buffer_after_min: number;
  min_notice_min: number;
  max_advance_days: number;
  daily_capacity: number | null;
  location_kind: string;
  location_detail: string | null;
  is_published: boolean;
  is_sample: boolean;
  version: number;
  agreement_template_id: string | null;
};

async function loadBookings(supabase: Client, org: string, from: number, to: number, statuses: string[]): Promise<StaffBooking[]> {
  const { data } = await supabase
    .from("bookings")
    .select("id, title, starts_at, ends_at, status, host_name, location_kind, version")
    .eq("organization_id", org)
    .gte("starts_at", new Date(from).toISOString())
    .lt("starts_at", new Date(to).toISOString())
    .in("status", statuses as ("confirmed" | "held" | "cancelled" | "no_show" | "completed" | "pending_payment" | "expired")[])
    .order("starts_at", { ascending: true })
    .limit(300);
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const attendees = ids.length
    ? await supabase.from("booking_attendees").select("booking_id, display_name").eq("organization_id", org).eq("role", "primary").in("booking_id", ids)
    : null;
  const name = new Map((attendees?.data ?? []).map((row) => [row.booking_id, row.display_name]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    hostName: row.host_name,
    locationKind: row.location_kind,
    version: row.version,
    attendee: name.get(row.id) ?? "Client",
  }));
}

async function staffMembers(supabase: Client, org: string) {
  const [{ data }, names] = await Promise.all([
    supabase.from("memberships").select("id, role, user_id").eq("organization_id", org).eq("status", "active"),
    memberNames(supabase, org),
  ]);
  return (data ?? [])
    .filter((row) => SCHEDULING_ROLES.includes(row.role))
    .map((row) => ({ membershipId: row.id, userId: row.user_id, role: row.role, name: names.get(row.id) ?? "Staff member" }));
}

type Member = Awaited<ReturnType<typeof staffMembers>>[number];

/**
 * The Consultation record tab: the firm's recent and coming consultations to choose from, and the
 * chosen one's notes (the notes on the lead it belongs to), outcome, details and history. Read as
 * the signed-in staff member (RLS decides). Nothing is invented: what isn't recorded says so.
 */
async function loadRecord(
  supabase: Client,
  staff: SheetStaff,
  query: SheetQuery,
  zone: string,
  now: number,
  members: Member[],
  template: AgreementTemplate | null,
): Promise<ConsultationRecordData & { summaryDialog: SummaryDialogData | null }> {
  const org = staff.organizationId;
  const list = await loadBookings(supabase, org, now - 90 * DAY, now + 120 * DAY, ["confirmed", "held", "cancelled", "no_show", "completed"]);
  const chosen = query.id && isUuid(query.id) ? query.id : null;
  const picker = [...list]
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((b) => ({ label: `${shortWhen(Date.parse(b.startsAt), zone)} · ${b.attendee} · ${b.title}`, value: recordHref(b.id), selected: b.id === chosen }));
  const empty = list.length
    ? { title: "Choose a consultation", copy: "Pick one above to see its notes, outcome and details." }
    : { title: "No consultations yet", copy: "Bookings from your booking page, and ones you make for clients, have a record here." };
  if (!chosen) return { picker, record: null, empty, summaryDialog: null };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, public_ref, title, starts_at, ends_at, status, host_name, host_membership_id, location_kind, location_detail, source, person_id, matter_id, cancelled_at, cancelled_by, cancel_reason, outcome_at, attendee_time_zone, event_type_id, is_sample, version")
    .eq("organization_id", org)
    .eq("id", chosen)
    .maybeSingle();
  if (!booking) return { picker, record: null, empty: { title: "This consultation isn’t available", copy: "It may belong to another firm, or your role can’t open it. Choose another one above." }, summaryDialog: null };
  if (!picker.some((option) => option.selected)) {
    picker.unshift({ label: `${shortWhen(Date.parse(booking.starts_at), zone)} · ${booking.title}`, value: recordHref(booking.id), selected: true });
  }

  const [attendee, type, events, link, summaryRow, agreementRow] = await Promise.all([
    supabase.from("booking_attendees").select("display_name, time_zone, email").eq("organization_id", org).eq("booking_id", booking.id).eq("role", "primary").maybeSingle(),
    supabase.from("booking_event_types").select("title").eq("organization_id", org).eq("id", booking.event_type_id).maybeSingle(),
    supabase.from("booking_events").select("kind, actor, actor_user_id, created_at").eq("organization_id", org).eq("booking_id", booking.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("lead_booking_links").select("lead_id").eq("organization_id", org).eq("booking_id", booking.id).maybeSingle(),
    supabase.from("consultation_summaries").select("body, status, shared_body, shared_at, version").eq("organization_id", org).eq("booking_id", booking.id).maybeSingle(),
    supabase
      .from("booking_agreements")
      .select(AGREEMENT_COLUMNS)
      .eq("organization_id", org)
      .eq("booking_id", booking.id)
      // The latest one, voided included (the panel shows a voided agreement until a new one is sent).
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const leadId = link.data?.lead_id ?? null;
  const [lead, notes] = leadId
    ? await Promise.all([
        supabase.from("leads").select("id, display_name").eq("organization_id", org).eq("id", leadId).maybeSingle(),
        supabase.from("lead_notes").select("body, created_at, created_by").eq("organization_id", org).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(5),
      ])
    : [null, null];
  const byUser = new Map(members.map((member) => [member.userId, member.name]));
  const name = attendee.data?.display_name ?? "Client";
  const start = Date.parse(booking.starts_at);
  const outcome = recordOutcome(
    { status: booking.status, startsAt: booking.starts_at, outcomeAt: booking.outcome_at, cancelledAt: booking.cancelled_at, cancelledBy: booking.cancelled_by, cancelReason: booking.cancel_reason },
    zone,
    now,
  );
  const actions = consultationRow(
    { id: booking.id, title: booking.title, startsAt: booking.starts_at, endsAt: booking.ends_at, status: booking.status, hostName: booking.host_name, locationKind: booking.location_kind, version: booking.version, attendee: name },
    zone,
    now,
  ).actions;
  const clientZone = attendee.data?.time_zone ?? booking.attendee_time_zone;
  const noteItems = (notes?.data ?? []).map((note) => ({
    who: note.created_by ? byUser.get(note.created_by) ?? "Staff" : "The enquiry form",
    when: shortWhen(Date.parse(note.created_at), zone),
    body: note.body,
  }));
  const notesCopy = lead?.data
    ? noteItems.length
      ? `The latest notes on the lead ${lead.data.display_name}. Add notes there.`
      : `No notes yet. Notes are kept on the lead ${lead.data.display_name}.`
    : booking.matter_id
      ? "This consultation is with an existing client. Keep notes on their matter."
      : "No notes yet. Notes are kept on a lead: make this booking a lead from the Pipeline, or link it from a lead.";
  const notesLink = lead?.data
    ? { href: `/sheet/lead?id=${lead.data.id}`, label: "Open the lead" }
    : booking.matter_id
      ? { href: `/sheet/matters/${booking.matter_id}`, label: "Open the matter" }
      : booking.source === "public" && !booking.person_id
        ? { href: "/sheet/pipeline", label: "Open the pipeline" }
        : null;
  const summary = summaryView({
    first: name.trim().split(/\s+/)[0] || "the client",
    attended: booking.status === "completed",
    reviewer: staff.role === "firm_owner" || staff.role === "licensed_consultant",
    row: summaryRow.data,
    wire: { "data-org": org, "data-booking": booking.id },
  });
  const agreement = recordAgreement({
    row: agreementRow.data,
    status: booking.status,
    startsAt: booking.starts_at,
    now,
    zone,
    template,
    signLink: `${appOrigin()}/consultation/${booking.public_ref}/agreement`,
    wire: { "data-org": org, "data-booking": booking.id },
    client: name.trim().split(/\s+/)[0] || "the client",
    recipient: attendee.data?.email ?? null,
    voidedBy: agreementRow.data?.voided_by ? byUser.get(agreementRow.data.voided_by) ?? "Staff" : null,
  });
  const live = agreementRow.data?.status === "sent";
  return {
    picker,
    empty,
    summaryDialog: summary.dialog,
    record: {
      summary: summary.panel,
      agreement,
      voidDialog: live ? { organizationId: org, bookingId: booking.id, client: name } : null,
      attendee: name,
      notes: { items: noteItems, copy: notesCopy, lead: notesLink },
      outcome: { chip: outcome.chip, copy: outcome.copy, actions },
      join: videoJoin(booking, staff, now),
      details: [
        { term: "Booking type", value: type.data?.title ?? booking.title },
        { term: "When (your time)", value: shortWhen(start, zone) },
        ...(clientZone && clientZone !== zone ? [{ term: "Client’s time", value: longWhen(start, clientZone) }] : []),
        { term: "With", value: booking.host_name ?? "—" },
        { term: "Where", value: locationLabel(booking.location_kind, booking.location_kind === "in_person" ? booking.location_detail : null) },
        { term: "Booked", value: booking.source === "public" ? "On the booking page" : "By the firm" },
        { term: "Lead", value: lead?.data ? lead.data.display_name : "Not linked" },
        ...(booking.is_sample ? [{ term: "Record", value: "Sample (practice)" }] : []),
      ],
      history: (events.data ?? []).map((event) => ({
        what: bookingEventLabel(event.kind),
        who: event.actor === "staff" ? (event.actor_user_id ? byUser.get(event.actor_user_id) ?? "Staff" : "Staff") : event.actor === "client" ? "Client" : "Casevoya",
        when: shortWhen(Date.parse(event.created_at), zone),
      })),
    },
  };
}

type AgreementTemplate = { id: string; name: string; version: number };

const AGREEMENT_COLUMNS =
  "booking_id, status, title, template_version, signed_name, signed_at, sent_at, opened_at, reminded_at, voided_at, voided_by, void_reason, declined_at, decline_reason, last_request_kind, last_request_at";

/**
 * The record's "Join video call" for a Casevoya video call: the booking's host and firm owners
 * (the database checks again on the call page). Open from 15 minutes before until 30 minutes after.
 */
function videoJoin(
  booking: { public_ref: string; status: string; location_kind: string; starts_at: string; ends_at: string; host_membership_id: string },
  staff: SheetStaff,
  now: number,
): ConsultationRecordJoin | null {
  // Completed (marked Attended) stays joinable inside the window, as video_join allows.
  if (booking.location_kind !== "video" || (booking.status !== "confirmed" && booking.status !== "completed")) return null;
  if (booking.host_membership_id !== staff.membershipId && staff.role !== "firm_owner") return null;
  if (callIsOpen(booking.starts_at, booking.ends_at, now)) return { href: callHref(booking.public_ref), toast: null };
  if (booking.status !== "confirmed" || Date.parse(booking.starts_at) <= now) return null;
  return { href: null, toast: CALL_WAIT_TOAST };
}

export async function loadSheetConsultations(staff: SheetStaff, query: SheetQuery): Promise<ConsultationsPage> {
  const org = staff.organizationId;
  const zone = safeZone(staff.timezone);
  const supabase = await createClient({ organizationId: org });
  const chrome = await loadSheetChrome(staff, "/sheet/consultations");
  const tab: ConsultationsTab | "record" = query.tab === "availability" || query.tab === "booking" || query.tab === "record" ? query.tab : "upcoming";
  const now = Date.now();
  const owner = staff.role === "firm_owner";
  const { data: userData } = await supabase.auth.getClaims();
  const me = userData?.claims?.sub ?? null;

  const [typesResult, hostsResult, members, upcoming, orgRow, templatesResult] = await Promise.all([
    supabase
      .from("booking_event_types")
      .select("id, slug, title, description, duration_min, slot_step_min, buffer_before_min, buffer_after_min, min_notice_min, max_advance_days, daily_capacity, location_kind, location_detail, is_published, is_sample, version, agreement_template_id")
      .eq("organization_id", org)
      .is("archived_at", null)
      .order("title"),
    supabase.from("booking_event_type_hosts").select("event_type_id, membership_id, position").eq("organization_id", org),
    staffMembers(supabase, org),
    loadBookings(supabase, org, now - 14 * DAY, now + 120 * DAY, ["confirmed", "held", "cancelled", "no_show", "completed"]),
    supabase.from("organizations").select("slug").eq("id", org).maybeSingle(),
    // Approved consultation agreement templates (owners, licensed consultants and case managers can read them).
    supabase
      .from("agreement_templates")
      .select("id, name, version")
      .eq("organization_id", org)
      .eq("kind", "consultation")
      .eq("status", "approved")
      .order("approved_at", { ascending: false }),
  ]);
  const agreementTemplates: AgreementTemplate[] = templatesResult.data ?? [];
  const agreementRows = upcoming.length
    ? ((await supabase
        .from("booking_agreements")
        .select(AGREEMENT_COLUMNS)
        .eq("organization_id", org)
        .in("booking_id", upcoming.map((b) => b.id))
        .order("sent_at", { ascending: true })).data ?? []) as BookingAgreementRow[]
    : [];
  // Each booking's latest agreement (the rows come oldest first).
  const agreementOf = new Map(agreementRows.map((row) => [row.booking_id, row]));
  const firmSlug = orgRow.data?.slug ?? "";
  const types = (typesResult.data ?? []) as EventTypeRow[];
  const hostRows = hostsResult.data ?? [];
  const hostsOf = (typeId: string) => hostRows.filter((row) => row.event_type_id === typeId).sort((a, b) => a.position - b.position).map((row) => row.membership_id);
  const myMembership = members.find((member) => member.userId === me) ?? null;

  // Upcoming: what's ahead first, then the last two weeks (outcomes to record, no-shows). Cancelled
  // bookings are left out (each one's record still shows on the Consultation record tab).
  const rows = upcomingRows(upcoming.map((b) => ({ ...b, agreement: agreementLabel(agreementOf.get(b.id)) })), zone, now);
  const thisWeek = upcoming.filter((b) => b.status === "confirmed" && Date.parse(b.startsAt) > now && Date.parse(b.startsAt) < now + 7 * DAY).length;
  // A published sample type is a practice page (only the firm's staff can open it). The share link
  // and preview use a real page when there is one, otherwise the practice page.
  const published = bookingPagesInOrder(types.filter((type) => type.is_published));
  const pageState = bookingPageState(published);

  // Availability: everyone who hosts a type or has hours, and the viewer.
  const [schedules, calendarRows] = await Promise.all([
    supabase.from("availability_schedules").select("id, membership_id, time_zone").eq("organization_id", org).eq("is_default", true),
    supabase.from("staff_connections").select("membership_id, toolkit, status").eq("organization_id", org).eq("toolkit", "googlecalendar"),
  ]);
  // A connected Google Calendar's busy times block slots once synced (Settings → Integrations).
  const calendarOf = new Map((calendarRows.data ?? []).map((row) => [row.membership_id, row.status]));
  const scheduleIds = (schedules.data ?? []).map((row) => row.id);
  const [rulesResult, overridesResult] = await Promise.all([
    scheduleIds.length ? supabase.from("availability_rules").select("schedule_id, weekday, start_local, end_local").in("schedule_id", scheduleIds) : null,
    scheduleIds.length
      ? supabase.from("availability_overrides").select("schedule_id, on_date, start_local").in("schedule_id", scheduleIds).gte("on_date", utcToLocal(now, zone).date)
      : null,
  ]);
  const hhmm = (value: string) => value.slice(0, 5);
  const hostIds = new Set(hostRows.map((row) => row.membership_id));
  const shownMembers = members.filter(
    (member) => hostIds.has(member.membershipId) || (schedules.data ?? []).some((s) => s.membership_id === member.membershipId) || member.userId === me,
  );
  const hostPanels: HostPanel[] = shownMembers.map((member) => {
    const schedule = (schedules.data ?? []).find((s) => s.membership_id === member.membershipId);
    const rules = (rulesResult?.data ?? []).filter((r) => r.schedule_id === schedule?.id).map((r) => ({ weekday: r.weekday, start: hhmm(r.start_local), end: hhmm(r.end_local) }));
    const off = (overridesResult?.data ?? []).filter((o) => o.schedule_id === schedule?.id && o.start_local == null).map((o) => o.on_date);
    const hosted = types.filter((type) => hostsOf(type.id).includes(member.membershipId));
    const tz = schedule?.time_zone ?? zone;
    const canEdit = member.userId === me || owner;
    return {
      name: member.name,
      items: [
        { term: "Days", value: schedule ? daysSummary(rules, tz, now) : "No hours set" },
        { term: "Length", value: hosted.length ? [...new Set(hosted.map((t) => `${t.duration_min} minutes`))].join(", ") : "Not taking a booking type" },
        {
          term: "Buffer",
          value: hosted.length ? `${hosted[0].buffer_before_min} minutes before and ${hosted[0].buffer_after_min} after` : "—",
        },
        { term: "Capacity", value: hosted.some((t) => t.daily_capacity) ? `${Math.min(...hosted.filter((t) => t.daily_capacity).map((t) => t.daily_capacity as number))} a day` : "No daily limit" },
        { term: "Timezone", value: { left: tz, right: "clients see their own" } },
        { term: "Days off", value: off.length ? off.slice(0, 4).join(", ") + (off.length > 4 ? ` and ${off.length - 4} more` : "") : "None ahead" },
        {
          term: "Calendars read",
          value:
            calendarOf.get(member.membershipId) === "active"
              ? { left: "Google Calendar", right: "busy times, synced from Settings" }
              : calendarOf.get(member.membershipId) === "pending"
                ? "Google Calendar (finishing setup)"
                : "None connected",
        },
        { term: "Video meetings", value: "In Casevoya: the host lets the client in from the call page" },
      ],
      edit: canEdit
        ? {
            "data-avail-open": member.membershipId,
            "data-avail-name": member.name,
            "data-avail-tz": tz,
            "data-avail-rules": JSON.stringify(rules),
            "data-avail-off": off.join(", "),
          }
        : null,
    };
  });

  // Booking page: the first published type, its next three times, and the share link.
  const origin = appOrigin();
  const first = published[0] ?? null;
  const payloads = new Map(
    await Promise.all(
      types.map(async (type) => {
        const { data } = await supabase.rpc("staff_booking_availability", {
          p_org: org,
          p_event_type_id: type.id,
          p_from: new Date(now).toISOString(),
          p_to: new Date(now + 21 * DAY).toISOString(),
        });
        return [type.id, parseAvailability(data)] as const;
      }),
    ),
  );
  const range = { fromUtc: now, toUtc: now + 21 * DAY, nowUtc: now };
  // Staff may book inside the minimum notice; the public preview shows what clients see.
  const timesByType = new Map(types.map((type) => {
    const payload = payloads.get(type.id);
    return [type.id, payload ? slotsFromAvailability(payload, { ...range, ignoreNotice: true }).slice(0, 60) : []] as const;
  }));
  const firstPayload = first ? payloads.get(first.id) : null;
  const chips = firstPayload ? slotsFromAvailability(firstPayload, range).slice(0, 3).map((ms) => slotLabel(ms, zone).replace(" · ", " ")) : [];
  const link = first ? `${origin}/book/${firmSlug}/${first.slug}` : null;
  const typeRows: BookingTypeRow[] = types.map((type) => ({
    title: type.title,
    detail: `${type.duration_min} min · ${hostsOf(type.id).length} ${hostsOf(type.id).length === 1 ? "host" : "hosts"} · ${locationShort(type.location_kind)} · /book/${firmSlug}/${type.slug}`,
    state: bookingTypeState(type),
    edit: owner
      ? {
          "data-type-open": type.id,
          "data-type": JSON.stringify({
            id: type.id,
            version: type.version,
            title: type.title,
            slug: type.slug,
            description: type.description ?? "",
            duration: type.duration_min,
            step: type.slot_step_min,
            before: type.buffer_before_min,
            after: type.buffer_after_min,
            noticeHours: Math.round(type.min_notice_min / 60),
            advance: type.max_advance_days,
            capacity: type.daily_capacity,
            kind: type.location_kind,
            detail: type.location_detail ?? "",
            hosts: hostsOf(type.id),
            published: type.is_published,
            agreement: type.agreement_template_id ?? "",
          }),
        }
      : null,
    archive: owner ? { "data-type-archive": type.id, "data-version": String(type.version), "data-org": org, "data-title": type.title } : null,
  }));

  // Availability's month box: the month asked for (?month=), with its booked days marked.
  const today = utcToLocal(now, zone).date;
  const shownMonth = query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : today.slice(0, 7);
  const monthStart = localToUtc(`${shownMonth}-01`, "00:00", zone);
  const monthEnd = localToUtc(`${shiftMonth(shownMonth, 1)}-01`, "00:00", zone);
  const monthBooked = tab === "availability" ? await loadBookings(supabase, org, monthStart, monthEnd, ["confirmed", "completed", "no_show"]) : [];
  const availabilityMonth = monthBox({
    month: shownMonth,
    today,
    marked: monthBooked.map((b) => utcToLocal(Date.parse(b.startsAt), zone).date),
    nav: (month) => `/sheet/consultations?tab=availability&month=${month}`,
    day: (date) => `/sheet/calendar?week=${date}`,
  });

  const record = tab === "record" ? await loadRecord(supabase, staff, query, zone, now, members, agreementTemplates[0] ?? null) : null;

  // Book for a client: people this staff member can see, with an email; sample people in sample mode.
  const people = await supabase.from("persons").select("id, display_name, email, is_sample").eq("organization_id", org).not("email", "is", null).order("display_name").limit(300);
  const clients: Option[] = (people.data ?? [])
    .filter((person) => !staff.sampleMode || person.is_sample)
    .map((person) => ({ label: person.display_name, value: person.id }));
  const typeOptions: Option[] = types.filter((type) => hostsOf(type.id).length).map((type) => ({ label: type.title, value: type.id }));
  const times: Option[] = typeOptions.flatMap((type) =>
    (timesByType.get(type.value as string) ?? []).map((ms) => ({ label: shortWhen(ms, zone), value: new Date(ms).toISOString(), data: { "data-type": type.value as string } })),
  );
  const canBook = clients.length > 0 && times.length > 0;

  const zones = [...new Set([zone, ...COMMON_ZONES])].filter(isTimeZone);
  return {
    chrome,
    tab,
    record,
    summaryDialog: record?.summaryDialog ?? null,
    pills: [`${thisWeek} this week`, BOOKING_PAGE_PILL[pageState]],
    book: {},
    page: {
      tab: tab === "record" ? "upcoming" : tab,
      upcoming: { rows, empty: { title: "No consultations yet", copy: "Bookings from your booking page, and ones you make for clients, appear here." } },
      availability: {
        hosts: hostPanels,
        calendar: availabilityMonth,
        calendarTitle: "Booked days",
        empty: {
          title: "No working hours yet",
          copy: "Set the hours you take consultations. Clients only see free times inside them.",
          action: myMembership ? { "data-avail-open": myMembership.membershipId, "data-avail-name": myMembership.name, "data-avail-tz": zone, "data-avail-rules": "[]", "data-avail-off": "" } : null,
        },
      },
      booking: {
        preview: first
          ? {
              logo: null,
              firm: staff.organizationName,
              title: first.title,
              note: `${first.duration_min} minutes. Times are in your client’s timezone.`,
              chips,
              href: `/book/${firmSlug}/${first.slug}`,
              chipHref: `/book/${firmSlug}/${first.slug}`,
            }
          : null,
        share: link ? { url: link, copy: link, embedNote: false, note: first?.is_sample ? PRACTICE_NOTICE.note : null } : null,
        types: { rows: typeRows, create: owner ? { "data-type-open": "new" } : null },
        empty: {
          title: "No booking page yet",
          copy: owner
            ? staff.sampleMode
              ? "Create a booking type and publish it as a practice page. Only your team can open it until your firm is verified."
              : "Create a booking type and publish it to share a booking page."
            : "The firm owner creates and publishes booking types.",
        },
      },
    },
    dialogs: {
      book: {
        clients: clients.length ? clients : [{ label: staff.sampleMode ? "No sample client with an email yet" : "No client with an email yet", value: "" }],
        types: typeOptions,
        times: times.length ? times : [{ label: types.length ? "No free times in the next 3 weeks" : "No booking types yet", value: "" }],
        hint: canBook ? "Only free times with buffers are shown, in your timezone" : "Set working hours and a booking type first",
        // The client signs it from a private link; without an approved template the choice is left out.
        agreements: agreementTemplates.length
          ? [
              ...agreementTemplates.map((t) => ({ label: `Send consultation agreement ${t.name} v${t.version}`, value: t.id })),
              { label: "Don’t send one", value: "" },
            ]
          : null,
        submit: { data: { "data-booking-submit": "book", "data-org": org, "data-tz": zone } },
      },
      reschedule: {
        title: "Reschedule this consultation",
        times: [],
        note: "They get an email with the new time, in their own timezone.",
        submit: { data: { "data-booking-submit": "res", "data-org": org, "data-tz": zone } },
      },
      cancel: {
        body: "The client is told by email. No fee was taken, so there’s nothing to refund.",
        submit: { data: { "data-booking-submit": "can", "data-org": org } },
      },
    },
    settings: { organizationId: org, zones, hosts: members.map((m) => ({ membershipId: m.membershipId, name: m.name })), owner, practice: staff.sampleMode, agreements: agreementTemplates.map((t) => ({ label: `${t.name} v${t.version}`, value: t.id })) },
  };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type CalendarPage = {
  chrome: SheetChrome;
  tab: CalendarTab;
  pills: string[];
  page: CalendarData;
  rbar: CalendarRbar;
  /** The header's previous, this and next week buttons. */
  nav: CalendarNav;
};

type DeadlineRow = { id: string; label: string; matter_id: string; due_on: string | null; due_at: string | null; verification: string };
const DEADLINE_COLUMNS = "id, label, matter_id, due_on, due_at, verification";
const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function uniqueDeadlines(...lists: (DeadlineRow[] | null | undefined)[]): DeadlineRow[] {
  const seen = new Set<string>();
  return lists
    .flatMap((list) => list ?? [])
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .sort((a, b) => (a.due_at ?? `${a.due_on}T23:59:59Z`).localeCompare(b.due_at ?? `${b.due_on}T23:59:59Z`));
}

export async function loadSheetCalendar(staff: SheetStaff, query: SheetQuery): Promise<CalendarPage> {
  const org = staff.organizationId;
  const zone = safeZone(staff.timezone);
  const supabase = await createClient({ organizationId: org });
  const chrome = await loadSheetChrome(staff, "/sheet/calendar");
  const tab: CalendarTab = query.tab === "deadlines" ? "deadlines" : "week";
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const today = utcToLocal(now, zone).date;
  const realDay = (value: string | undefined): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const ms = Date.parse(`${value}T12:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  };
  const anchor = realDay(query.week) ? query.week : defaultWeekAnchor(today);
  const monday = mondayOf(anchor);
  const sunday = addDays(monday, 6);
  // The week in the firm's zone, from Monday 00:00 to the next Monday 00:00.
  const weekStart = localToUtc(monday, "00:00", zone);
  const weekEnd = localToUtc(addDays(monday, 7), "00:00", zone);
  // The month box follows the week shown, unless its arrows chose another month (?month=).
  const shownMonth = query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : monday.slice(0, 7);
  const monthFirst = `${shownMonth}-01`;
  const nextMonthFirst = `${shiftMonth(shownMonth, 1)}-01`;
  const monthStart = localToUtc(monthFirst, "00:00", zone);
  const monthEnd = localToUtc(nextMonthFirst, "00:00", zone);
  const deadlines = () => supabase.from("deadlines").select(DEADLINE_COLUMNS).eq("organization_id", org);

  const [bookings, weekDeadlines, upcomingDeadlines, members, monthBookings, monthDeadlines, connections] = await Promise.all([
    tab === "week" ? loadBookings(supabase, org, weekStart, weekEnd, ["confirmed", "held", "completed", "no_show"]) : Promise.resolve([]),
    Promise.all([
      deadlines().gte("due_on", monday).lte("due_on", sunday).order("due_on", { ascending: true }).limit(200),
      deadlines().gte("due_at", new Date(weekStart).toISOString()).lt("due_at", new Date(weekEnd).toISOString()).order("due_at", { ascending: true }).limit(200),
    ]),
    // Upcoming deadlines don't depend on the week shown: tentative ones already past their date
    // first (they still need confirming), then the next ones from today.
    Promise.all([
      deadlines().eq("verification", "tentative").lt("due_on", today).order("due_on", { ascending: false }).limit(10),
      deadlines().eq("verification", "tentative").lt("due_at", nowIso).order("due_at", { ascending: false }).limit(10),
      deadlines().gte("due_on", today).order("due_on", { ascending: true }).limit(10),
      deadlines().gte("due_at", nowIso).order("due_at", { ascending: true }).limit(10),
    ]),
    staffMembers(supabase, org),
    loadBookings(supabase, org, monthStart, monthEnd, ["confirmed", "completed", "no_show"]),
    Promise.all([
      deadlines().gte("due_on", monthFirst).lt("due_on", nextMonthFirst).limit(300),
      deadlines().gte("due_at", new Date(monthStart).toISOString()).lt("due_at", new Date(monthEnd).toISOString()).limit(300),
    ]),
    supabase.from("staff_connections").select("membership_id, toolkit, status").eq("organization_id", org).eq("toolkit", "googlecalendar"),
  ]);
  const inWeek = uniqueDeadlines(weekDeadlines[0].data as DeadlineRow[] | null, weekDeadlines[1].data as DeadlineRow[] | null);
  const overdue = uniqueDeadlines(upcomingDeadlines[0].data as DeadlineRow[] | null, upcomingDeadlines[1].data as DeadlineRow[] | null).filter((row) =>
    row.due_at ? Date.parse(row.due_at) < now : (row.due_on as string) < today,
  );
  const ahead = uniqueDeadlines(upcomingDeadlines[2].data as DeadlineRow[] | null, upcomingDeadlines[3].data as DeadlineRow[] | null).filter((row) =>
    row.due_at ? Date.parse(row.due_at) >= now : (row.due_on as string) >= today,
  );
  const sideDeadlines = [...overdue.slice(0, 3), ...ahead].slice(0, 5);
  const names = await matterNames(supabase, org, [...inWeek, ...sideDeadlines].map((row) => row.matter_id));

  const localDate = (row: DeadlineRow) => (row.due_at ? utcToLocal(Date.parse(row.due_at), zone).date : (row.due_on as string));
  const matterHref = (row: DeadlineRow) => `/sheet/matters/${row.matter_id}?tab=tasks`;
  const items: WeekItem[] = [];
  for (const booking of bookings) {
    items.push({
      start: Date.parse(booking.startsAt),
      end: Date.parse(booking.endsAt),
      block: {
        kind: "consultation",
        title: { left: booking.title, right: booking.attendee },
        note: { left: booking.hostName ?? "Host", right: locationShort(booking.locationKind) },
        href: recordHref(booking.id),
      },
    });
  }
  for (const row of inWeek) {
    const date = localDate(row);
    if (date < monday || date > sunday) continue;
    const verified = row.verification === "confirmed";
    const start = row.due_at ? Date.parse(row.due_at) : localToUtc(date, "12:00", zone);
    items.push({
      start,
      end: start + 30 * 60_000,
      allDay: !row.due_at,
      block: {
        kind: verified ? "deadline" : "tentative",
        title: { left: `Deadline: ${row.label}`, right: names(row.matter_id) },
        note: deadlineNote(row.due_at, zone, verified),
        href: matterHref(row),
      },
    });
  }
  // Date-only deadlines sit in the All day row; items that share an hour sit side by side.
  const shown = tab === "week" ? items : items.filter((item) => item.block.kind !== "consultation");
  const week = buildWeek(monday, today, shown, zone, { live: true });

  const dateLabel = (date: string) => `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay() || 7]} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  const overdueIds = new Set(overdue.map((row) => row.id));
  const upcoming = sideDeadlines.map((row) => {
    const date = localDate(row);
    const verified = row.verification === "confirmed";
    return {
      date: dateLabel(date),
      title: row.label,
      who: names(row.matter_id),
      chip: overdueIds.has(row.id)
        ? { tone: "bad", label: "Past, not confirmed" }
        : date === today
          ? { tone: "bad", label: "Today" }
          : verified
            ? { tone: "ok", label: "Verified" }
            : { tone: "chg", label: "Tentative" },
      href: matterHref(row),
    };
  });

  const marked = [
    ...monthBookings.map((b) => utcToLocal(Date.parse(b.startsAt), zone).date),
    ...uniqueDeadlines(monthDeadlines[0].data as DeadlineRow[] | null, monthDeadlines[1].data as DeadlineRow[] | null).map(localDate),
  ];
  const href = (params: Record<string, string>) => {
    const search = new URLSearchParams(tab === "deadlines" ? { tab, ...params } : params);
    return `/sheet/calendar?${search.toString()}`;
  };
  const thisMonday = mondayOf(defaultWeekAnchor(today));
  const [d, m, y] = [Number(monday.slice(8)), MONTHS[Number(monday.slice(5, 7)) - 1], monday.slice(0, 4)];
  const empty =
    tab === "deadlines" && !shown.length
      ? { title: "No deadlines this week", copy: "Deadlines on your matters appear here; ones with a date but no time are in the All day row. Use the week buttons to look ahead." }
      : null;
  return {
    chrome,
    tab,
    pills: [`Week of ${d} ${m} ${y}`, `Times in ${zone}`],
    nav: {
      prev: href({ week: addDays(monday, -7) }),
      next: href({ week: addDays(monday, 7) }),
      today: monday === thisMonday ? null : href({}),
    },
    page: {
      tab,
      heading: {
        title: monday === thisMonday ? "This week" : `Week of ${d} ${m}`,
        copy: tab === "week" ? "Appointments and deadlines together. Each deadline shows whether it is verified." : "Deadlines on your matters this week, with whether each is verified.",
      },
      week,
      empty,
      note: "Clients see consultation times in their own timezone. Open a deadline’s matter for its source and official timezone.",
    },
    rbar: {
      calendar: monthBox({
        month: shownMonth,
        today,
        marked,
        nav: (month) => href({ week: monday, month }),
        day: (date) => href({ week: date }),
      }),
      deadlines: upcoming,
      calendars: calendarConnections(members, connections.data ?? [], { membershipId: staff.membershipId, owner: staff.role === "firm_owner" }),
      live: { emptyTitle: "No upcoming deadlines", emptyCopy: "Deadlines recorded on a matter appear here, with whether each is verified." },
    },
  };
}
