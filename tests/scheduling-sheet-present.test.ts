import { describe, expect, it } from "vitest";
import {
  BOOKING_PAGE_PILL,
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
  type StaffBooking,
} from "@/modules/scheduling/sheet-present";
import { longWhen, shortWhen, slotLabel } from "@/modules/scheduling/format";
import { parseAvailability, slotsFromAvailability } from "@/modules/scheduling/availability";

const NOW = Date.parse("2026-10-19T16:00:00Z");
const booking = (over: Partial<StaffBooking> = {}): StaffBooking => ({
  id: "b1",
  title: "Initial consultation",
  startsAt: "2026-10-22T14:30:00Z",
  endsAt: "2026-10-22T15:00:00Z",
  status: "confirmed",
  hostName: "Kim Host",
  locationKind: "phone",
  version: 4,
  attendee: "Sam Example",
  ...over,
});

describe("scheduling: staff presentation", () => {
  it("shows a time with its zone, in the staff member's zone", () => {
    expect(shortWhen(Date.parse("2026-10-22T14:30:00Z"), "America/Toronto")).toBe("Thu 22 Oct 10:30 EDT");
    expect(slotLabel(Date.parse("2026-10-22T14:30:00Z"), "America/Vancouver")).toBe("Thu 22 Oct · 07:30");
    expect(longWhen(Date.parse("2026-11-02T15:00:00Z"), "America/Toronto")).toBe("Monday 2 November 2026, 10:00 (America/Toronto)");
  });

  it("gives an upcoming booking Reschedule and Cancel, and a past one its outcome buttons", () => {
    const upcoming = consultationRow(booking(), "America/Toronto", NOW);
    expect(upcoming).toMatchObject({ client: "Sam Example", with: { left: "Kim Host", right: "phone" }, fee: "No fee", state: { tone: "blue", label: "Confirmed" } });
    expect(upcoming.actions.map((a) => a.data?.["data-booking-open"])).toEqual(["res", "can"]);
    expect(upcoming.actions[0].data).toMatchObject({ "data-booking": "b1", "data-version": "4" });
    const past = consultationRow(booking({ startsAt: "2026-10-15T14:30:00Z" }), "America/Toronto", NOW);
    expect(past.state.label).toBe("Record outcome");
    expect(past.actions.map((a) => a.data?.["data-booking-outcome"])).toEqual(["completed", "no_show"]);
    expect(consultationRow(booking({ status: "cancelled" }), "America/Toronto", NOW).actions).toEqual([]);
    expect(consultationRow(booking({ status: "no_show", startsAt: "2026-10-15T14:30:00Z" }), "America/Toronto", NOW).state).toEqual({ tone: "bad", label: "No-show" });
  });

  it("summarises working hours by identical ranges", () => {
    expect(
      daysSummary(
        [
          { weekday: 2, start: "09:00", end: "17:00" },
          { weekday: 4, start: "09:00", end: "17:00" },
          { weekday: 1, start: "10:00", end: "12:00" },
        ],
        "America/Toronto",
        NOW,
      ),
    ).toBe("Mon 10:00–12:00 EDT; Tue, Thu 09:00–17:00 EDT");
    expect(daysSummary([], "America/Toronto", NOW)).toBe("No hours set");
  });

  it("builds the week grid: Monday first, weekend only when used, hours widened, blocks offset in the hour", () => {
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(defaultWeekAnchor("2026-10-22")).toBe("2026-10-22");
    expect(defaultWeekAnchor("2026-10-24")).toBe("2026-10-26");
    expect(defaultWeekAnchor("2026-10-25")).toBe("2026-10-26");
    const week = buildWeek(
      "2026-10-19",
      "2026-10-20",
      [
        { start: Date.parse("2026-10-22T14:30:00Z"), end: Date.parse("2026-10-22T15:15:00Z"), block: { kind: "consultation", title: "A", note: "n" } },
        { start: Date.parse("2026-10-20T23:00:00Z"), end: Date.parse("2026-10-21T00:00:00Z"), block: { kind: "internal", title: "Late", note: "n" } },
      ],
      "America/Toronto",
    );
    expect(week.days.map((d) => d.label)).toEqual(["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23"]);
    expect(week.days[1].today).toBe(true);
    expect(week.hours[0].label).toBe("9:00");
    expect(week.hours[week.hours.length - 1].label).toBe("19:00");
    const ten = week.hours.find((h) => h.label === "10:00");
    expect(ten?.cells[3][0]).toMatchObject({ offsetMin: 30, height: 40 });
    const weekend = buildWeek("2026-10-19", "2026-10-20", [{ start: Date.parse("2026-10-24T14:00:00Z"), end: Date.parse("2026-10-24T15:00:00Z"), block: { kind: "consultation", title: "S", note: "n" } }], "America/Toronto");
    expect(weekend.days).toHaveLength(7);
  });

  it("labels deadlines as verified or tentative with their time and zone", () => {
    expect(deadlineNote("2026-10-30T21:00:00Z", "America/Toronto", true)).toEqual({ left: "Verified", right: "17:00 EDT" });
    expect(deadlineNote(null, "America/Toronto", false)).toEqual({ left: "Tentative, confirm", right: "end of day" });
  });

  it("merges hosts' starts, keeps one host for a reschedule, and lets staff skip the notice", () => {
    const payload = parseAvailability({
      event: { duration_min: 60, slot_step_min: null, buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 1440, max_advance_days: 30, daily_capacity: null },
      now: "2026-10-19T16:00:00Z",
      hosts: [
        { position: 1, membership_id: "m1", time_zone: "America/Toronto", rules: [{ weekday: 1, start: "13:00", end: "15:00" }], overrides: [], busy: [], day_counts: {} },
        { position: 2, membership_id: "m2", time_zone: "America/Vancouver", rules: [{ weekday: 1, start: "13:00", end: "14:00" }], overrides: [], busy: [], day_counts: {} },
        { position: 3, time_zone: 12, rules: [], overrides: [], busy: [] },
      ],
    });
    expect(payload?.hosts).toHaveLength(2);
    const range = { fromUtc: Date.parse("2026-10-19T00:00:00Z"), toUtc: Date.parse("2026-10-20T00:00:00Z"), nowUtc: NOW };
    expect(slotsFromAvailability(payload!, range)).toEqual([]);
    const staff = slotsFromAvailability(payload!, { ...range, ignoreNotice: true }).map((ms) => new Date(ms).toISOString());
    expect(staff).toEqual(["2026-10-19T17:00:00.000Z", "2026-10-19T18:00:00.000Z", "2026-10-19T20:00:00.000Z"]);
    expect(slotsFromAvailability(payload!, { ...range, ignoreNotice: true, membershipId: "m2" }).map((ms) => new Date(ms).toISOString())).toEqual(["2026-10-19T20:00:00.000Z"]);
    expect(parseAvailability({ hosts: "x" })).toBeNull();
  });
});

describe("scheduling: booking page tab in sample mode", () => {
  const real = { is_published: true, is_sample: false, slug: "real" };
  const practice = { is_published: true, is_sample: true, slug: "practice" };

  it("says whether the booking page is live, a practice page or not published", () => {
    expect(BOOKING_PAGE_PILL[bookingPageState([])]).toBe("Booking page not published");
    expect(BOOKING_PAGE_PILL[bookingPageState([practice])]).toBe("Practice booking page (team only)");
    expect(BOOKING_PAGE_PILL[bookingPageState([practice, real])]).toBe("Booking page live");
  });

  it("shares the real page first, and marks practice types", () => {
    expect(bookingPagesInOrder([practice, real]).map((t) => t.slug)).toEqual(["real", "practice"]);
    expect(bookingTypeState(practice)).toEqual({ tone: "chg", label: "Practice page" });
    expect(bookingTypeState(real)).toEqual({ tone: "ok", label: "Published" });
    expect(bookingTypeState({ is_published: false, is_sample: true })).toEqual({ tone: "gr", label: "Sample" });
    expect(bookingTypeState({ is_published: false, is_sample: false })).toEqual({ tone: "gr", label: "Not published" });
  });
});

describe("scheduling: connected calendars on the Calendar page", () => {
  const members = [
    { membershipId: "m-owner", name: "Kim Owner" },
    { membershipId: "m-cm", name: "Lee Case" },
    { membershipId: "m-new", name: "Ana New" },
  ];
  const connections = [
    { membership_id: "m-owner", toolkit: "googlecalendar", status: "active" },
    { membership_id: "m-cm", toolkit: "googlecalendar", status: "pending" },
    { membership_id: "m-new", toolkit: "gmail", status: "active" },
  ];

  it("shows each member's real Google Calendar connection to the firm owner", () => {
    expect(calendarConnections(members, connections, { membershipId: "m-owner", owner: true }).map((row) => [row.name, row.chip.label, row.logo !== null])).toEqual([
      ["Kim Owner", "Connected", true],
      ["Lee Case", "Finishing setup", true],
      ["Ana New", "Not connected", false],
    ]);
  });

  it("shows anyone else only their own row (RLS hides other people's connections)", () => {
    expect(calendarConnections(members, connections, { membershipId: "m-cm", owner: false })).toEqual([
      { name: "Lee Case", tool: "Google Calendar", logo: "/assets/logos/googlecalendar.svg", chip: { tone: "chg", label: "Finishing setup" } },
    ]);
  });
});
