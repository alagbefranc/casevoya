import "server-only";
import type { CalendarData, CalendarRbar, CalendarTab } from "@/components/sheet/designer/calendar";
import type {
  BookDialogData,
  BookingTypeRow,
  CancelDialogData,
  ConsultationsData,
  ConsultationsTab,
  HostPanel,
  MonthCal,
  Option,
  RescheduleDialogData,
} from "@/components/sheet/designer/consultations";
import type { HostOption } from "@/components/sheet/designer/scheduling-dialogs";
import { appOrigin } from "@/lib/email/env";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome, matterNames, memberNames, type SheetChrome } from "@/modules/sheet/chrome-load";
import { monthGrid } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";
import { parseAvailability, slotsFromAvailability } from "./availability";
import { COMMON_ZONES, locationShort, safeZone, shortWhen, slotLabel } from "./format";
import { buildWeek, consultationRow, daysSummary, deadlineNote, defaultWeekAnchor, mondayOf, type StaffBooking, type WeekItem } from "./sheet-present";
import { addDays, isTimeZone, localToUtc, utcToLocal } from "./slots";

type Client = Awaited<ReturnType<typeof createClient>>;

const DAY = 86_400_000;
const SCHEDULING_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ConsultationsPage = {
  chrome: SheetChrome;
  tab: ConsultationsTab;
  pills: string[];
  book: Record<string, string> | null;
  page: ConsultationsData;
  dialogs: { book: BookDialogData; reschedule: RescheduleDialogData; cancel: CancelDialogData };
  settings: { organizationId: string; zones: string[]; hosts: HostOption[]; owner: boolean };
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

function monthCal(zone: string, now: number, marked: number[]): MonthCal {
  const today = utcToLocal(now, zone).date;
  const [year, month, day] = today.split("-").map(Number);
  const days = new Set(
    marked
      .map((ms) => utcToLocal(ms, zone).date)
      .filter((date) => date.startsWith(today.slice(0, 7)))
      .map((date) => Number(date.slice(8, 10))),
  );
  const grid = monthGrid(year, month, day, days);
  return { month: grid.month, leading: grid.leading, days: grid.days };
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

export async function loadSheetConsultations(staff: SheetStaff, query: SheetQuery): Promise<ConsultationsPage> {
  const org = staff.organizationId;
  const zone = safeZone(staff.timezone);
  const supabase = await createClient({ organizationId: org });
  const chrome = await loadSheetChrome(staff, "/sheet/consultations");
  const tab: ConsultationsTab = query.tab === "availability" || query.tab === "booking" ? query.tab : "upcoming";
  const now = Date.now();
  const owner = staff.role === "firm_owner";
  const { data: userData } = await supabase.auth.getClaims();
  const me = userData?.claims?.sub ?? null;

  const [typesResult, hostsResult, members, upcoming, orgRow] = await Promise.all([
    supabase
      .from("booking_event_types")
      .select("id, slug, title, description, duration_min, slot_step_min, buffer_before_min, buffer_after_min, min_notice_min, max_advance_days, daily_capacity, location_kind, location_detail, is_published, is_sample, version")
      .eq("organization_id", org)
      .is("archived_at", null)
      .order("title"),
    supabase.from("booking_event_type_hosts").select("event_type_id, membership_id, position").eq("organization_id", org),
    staffMembers(supabase, org),
    loadBookings(supabase, org, now - 14 * DAY, now + 120 * DAY, ["confirmed", "held", "cancelled", "no_show", "completed"]),
    supabase.from("organizations").select("slug").eq("id", org).maybeSingle(),
  ]);
  const firmSlug = orgRow.data?.slug ?? "";
  const types = (typesResult.data ?? []) as EventTypeRow[];
  const hostRows = hostsResult.data ?? [];
  const hostsOf = (typeId: string) => hostRows.filter((row) => row.event_type_id === typeId).sort((a, b) => a.position - b.position).map((row) => row.membership_id);
  const myMembership = members.find((member) => member.userId === me) ?? null;

  // Upcoming: what's ahead first, then the last two weeks (outcomes to record, no-shows).
  const ahead = upcoming.filter((b) => Date.parse(b.startsAt) > now && b.status !== "cancelled");
  const past = upcoming.filter((b) => Date.parse(b.startsAt) <= now).reverse();
  const cancelledAhead = upcoming.filter((b) => Date.parse(b.startsAt) > now && b.status === "cancelled");
  const rows = [...ahead, ...past, ...cancelledAhead].map((booking) => consultationRow(booking, zone, now));
  const thisWeek = ahead.filter((b) => b.status === "confirmed" && Date.parse(b.startsAt) < now + 7 * DAY).length;
  const published = types.filter((type) => type.is_published);

  // Availability: everyone who hosts a type or has hours, and the viewer.
  const schedules = await supabase.from("availability_schedules").select("id, membership_id, time_zone").eq("organization_id", org).eq("is_default", true);
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
        { term: "Calendars read", value: "None connected (calendar sync is planned)" },
        { term: "Video meetings", value: "The firm sends the link (in-app video is planned)" },
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
    state: type.is_published ? { tone: "ok", label: "Published" } : type.is_sample ? { tone: "gr", label: "Sample" } : { tone: "gr", label: "Not published" },
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
          }),
        }
      : null,
  }));

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
    pills: [`${thisWeek} this week`, published.length ? "Booking page live" : "Booking page not published"],
    book: {},
    page: {
      tab,
      upcoming: { rows, empty: { title: "No consultations yet", copy: "Bookings from your booking page, and ones you make for clients, appear here." } },
      availability: {
        hosts: hostPanels,
        calendar: monthCal(zone, now, upcoming.filter((b) => b.status === "confirmed").map((b) => Date.parse(b.startsAt))),
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
            }
          : null,
        share: link ? { url: link, copy: link, embedNote: false } : null,
        types: { rows: typeRows, create: owner ? { "data-type-open": "new" } : null },
        empty: {
          title: "No booking page yet",
          copy: owner ? "Create a booking type and publish it to share a booking page." : "The firm owner creates and publishes booking types.",
        },
      },
    },
    dialogs: {
      book: {
        clients: clients.length ? clients : [{ label: staff.sampleMode ? "No sample client with an email yet" : "No client with an email yet", value: "" }],
        types: typeOptions,
        times: times.length ? times : [{ label: types.length ? "No free times in the next 3 weeks" : "No booking types yet", value: "" }],
        hint: canBook ? "Only free times with buffers are shown, in your timezone" : "Set working hours and a booking type first",
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
    settings: { organizationId: org, zones, hosts: members.map((m) => ({ membershipId: m.membershipId, name: m.name })), owner },
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
};

export async function loadSheetCalendar(staff: SheetStaff, query: SheetQuery): Promise<CalendarPage> {
  const org = staff.organizationId;
  const zone = safeZone(staff.timezone);
  const supabase = await createClient({ organizationId: org });
  const chrome = await loadSheetChrome(staff, "/sheet/calendar");
  const tab: CalendarTab = query.tab === "deadlines" ? "deadlines" : "week";
  const now = Date.now();
  const today = utcToLocal(now, zone).date;
  const anchor = query.week && /^\d{4}-\d{2}-\d{2}$/.test(query.week) ? query.week : defaultWeekAnchor(today);
  const monday = mondayOf(anchor);
  const weekStart = Date.parse(`${addDays(monday, -1)}T00:00:00Z`);
  const weekEnd = Date.parse(`${addDays(monday, 8)}T00:00:00Z`);

  const [bookings, deadlinesResult, members, monthBookings] = await Promise.all([
    tab === "week" ? loadBookings(supabase, org, weekStart, weekEnd, ["confirmed", "held", "completed", "no_show"]) : Promise.resolve([]),
    Promise.all([
      supabase
        .from("deadlines")
        .select("id, label, matter_id, due_on, due_at, verification")
        .eq("organization_id", org)
        .gte("due_on", addDays(monday, -1))
        .order("due_on", { ascending: true })
        .limit(200),
      supabase
        .from("deadlines")
        .select("id, label, matter_id, due_on, due_at, verification")
        .eq("organization_id", org)
        .gte("due_at", new Date(weekStart).toISOString())
        .order("due_at", { ascending: true })
        .limit(200),
    ]),
    staffMembers(supabase, org),
    loadBookings(supabase, org, now - 31 * DAY, now + 62 * DAY, ["confirmed"]),
  ]);
  const seen = new Set<string>();
  const deadlines = [...(deadlinesResult[0].data ?? []), ...(deadlinesResult[1].data ?? [])]
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .sort((a, b) => (a.due_at ?? `${a.due_on}T23:59:59Z`).localeCompare(b.due_at ?? `${b.due_on}T23:59:59Z`));
  const names = await matterNames(supabase, org, deadlines.map((row) => row.matter_id));

  const deadlineInstant = (row: { due_on: string | null; due_at: string | null }) =>
    row.due_at ? Date.parse(row.due_at) : row.due_on ? Date.parse(`${row.due_on}T12:00:00Z`) : NaN;
  const items: WeekItem[] = [];
  for (const booking of bookings) {
    items.push({
      start: Date.parse(booking.startsAt),
      end: Date.parse(booking.endsAt),
      block: {
        kind: "consultation",
        title: { left: booking.title, right: booking.attendee },
        note: { left: booking.hostName ?? "Host", right: locationShort(booking.locationKind) },
        href: "/sheet/consultations",
      },
    });
  }
  for (const row of deadlines) {
    const at = deadlineInstant(row);
    if (!Number.isFinite(at)) continue;
    const date = row.due_at ? utcToLocal(at, zone).date : (row.due_on as string);
    if (date < monday || date > addDays(monday, 6)) continue;
    const verified = row.verification === "confirmed";
    const start = row.due_at ? at : localToUtc(date, "12:00", zone);
    items.push({
      start,
      end: start + 30 * 60_000,
      allDay: !row.due_at,
      block: {
        kind: verified ? "deadline" : "tentative",
        title: { left: `Deadline: ${row.label}`, right: names(row.matter_id) },
        note: deadlineNote(row.due_at, zone, verified),
        href: `/sheet/matters/${row.matter_id}?tab=tasks`,
      },
    });
  }
  // A date-only deadline is placed on its own date, in the first hour row.
  const week = buildWeek(monday, today, items, zone);

  const upcomingDeadlines = deadlines
    .map((row) => ({ row, at: deadlineInstant(row) }))
    .filter(({ row, at }) => Number.isFinite(at) && (row.due_at ? at >= now : (row.due_on as string) >= today))
    .slice(0, 3)
    .map(({ row, at }) => {
      const date = row.due_at ? utcToLocal(at, zone).date : (row.due_on as string);
      const verified = row.verification === "confirmed";
      return {
        date: `${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][new Date(`${date}T12:00:00Z`).getUTCDay() || 7]} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`,
        title: row.label,
        who: names(row.matter_id),
        chip: date === today ? { tone: "bad", label: "Today" } : verified ? { tone: "ok", label: "Verified" } : { tone: "chg", label: "Tentative" },
      };
    });

  const marked = [
    ...monthBookings.map((b) => Date.parse(b.startsAt)),
    ...deadlines.map((row) => deadlineInstant(row)).filter(Number.isFinite),
  ];
  const [d, m, y] = [Number(monday.slice(8)), MONTHS[Number(monday.slice(5, 7)) - 1], monday.slice(0, 4)];
  return {
    chrome,
    tab,
    pills: [`Week of ${d} ${m} ${y}`, `Times in ${zone}`],
    page: {
      tab,
      heading: {
        title: anchor === today || mondayOf(today) === monday ? "This week" : `Week of ${d} ${m}`,
        copy: tab === "week" ? "Appointments and deadlines together. Each deadline shows whether it is verified." : "Deadlines on your matters this week, with whether each is verified.",
      },
      week: tab === "week" ? week : buildWeek(monday, today, items.filter((item) => item.block.kind !== "consultation"), zone),
      note: "Clients see consultation times in their own timezone. Open a deadline’s matter for its source and official timezone.",
    },
    rbar: {
      calendar: monthCal(zone, now, marked),
      deadlines: upcomingDeadlines,
      calendars: members.map((member) => ({ name: member.name, tool: "no calendar connected", logo: null, chip: { tone: "gr", label: "Not connected" } })),
    },
  };
}
