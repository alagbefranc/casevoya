import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPipeline, historyItems, inSentence, leadSummary, nextFollowUp, reopenStage, type LeadRow, type StageRow } from "@/modules/leads/present";
import { CLOSED_STAGE_MESSAGE, arrowTarget, suggestedSource } from "@/components/sheet/pipeline-acts";
import { chooseCrumbLinks } from "@/components/sheet/crumb-menu";
import { slugFor } from "@/components/sheet/booking-acts";
import { buildWeek, consultationRow, monthBox, recordHref, recordOutcome, shiftMonth, upcomingRows, type StaffBooking } from "@/modules/scheduling/sheet-present";
import { leadFunnel, localMidnightIso, monthLabel } from "@/modules/sheet/reports-present";
import { staffPerson } from "@/modules/sheet/avatar";
import { CalendarRbarView, SheetCalendar } from "@/components/sheet/designer/calendar";
import { SheetConsultationRecord, MonthCalendar } from "@/components/sheet/designer/consultations";
import { SheetQueue } from "@/components/sheet/designer/queue";
import { BookPage } from "@/components/sheet/designer/book";
import { EditLeadDialog } from "@/components/sheet/designer/lead";
import { bookingPagePath, isBookablePublicEvent } from "@/modules/scheduling/public-api";

// Presentation for the production-audit fixes on branch fix-leads-calendar (pipeline, lead page,
// consultations, calendar, Team queue, reports, the header crumb menu).

const TZ = "America/Toronto";
const NOW = new Date("2026-10-19T16:00:00Z");

const STAGES: StageRow[] = [
  { id: "s-new", key: "new", label: "New", kind: "open", position: 1 },
  { id: "s-con", key: "contacted", label: "Contacted", kind: "open", position: 2 },
  { id: "s-sch", key: "consultation_scheduled", label: "Consultation scheduled", kind: "open", position: 3 },
  { id: "s-cv", key: "converted", label: "Converted", kind: "converted", position: 4 },
  { id: "s-lost", key: "lost", label: "Lost", kind: "lost", position: 5 },
  { id: "s-arc", key: "archived", label: "Archived", kind: "archived", position: 6 },
];

function lead(overrides: Partial<LeadRow>): LeadRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    display_name: "Sam Example",
    email: null,
    phone: null,
    date_of_birth: null,
    service_interest: null,
    source: "phone",
    source_detail: null,
    stage_id: "s-new",
    owner_membership_id: null,
    proposed_fee_cents: null,
    same_person_lead_id: null,
    converted_at: null,
    lost_at: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    version: 1,
    is_sample: false,
    ...overrides,
  };
}

const pipeline = (overrides: Partial<Parameters<typeof buildPipeline>[0]> = {}) =>
  buildPipeline({
    tab: "board",
    stages: STAGES,
    leads: [lead({}), lead({ id: "00000000-0000-4000-8000-000000000002", stage_id: "s-lost", display_name: "Lou Lost" })],
    followUps: [],
    bookings: [],
    decisions: [],
    owners: new Map(),
    filter: { stage: null, owner: null },
    organizationId: "org",
    timeZone: TZ,
    now: NOW,
    ...overrides,
  });

describe("Pipeline board, list and timeline", () => {
  it("hides the other columns under a Stage filter instead of showing them empty", () => {
    const filtered = pipeline({ filter: { stage: "contacted", owner: null } });
    expect(filtered.data.columns.map((column) => column.hidden)).toEqual([true, false, true, true, true]);
    expect(pipeline().data.columns.every((column) => !column.hidden)).toBe(true);
  });

  it("disables the arrows that can't move a card: New back, Converted both, Lost forward", () => {
    const { columns } = pipeline().data;
    expect(columns[0].cards[0].moves).toEqual({ back: false, forward: true });
    const lost = columns[4].cards[0];
    expect(lost.moves).toEqual({ back: true, forward: false });
    // Back from Lost skips Converted and lands on the last open stage.
    const kinds = columns.map((column) => ({ kind: (column.data?.["data-kind"] as string) ?? "open" }));
    expect(arrowTarget(kinds, 4, -1)).toBe(kinds[2]);
    expect(arrowTarget(kinds, 0, -1)).toBeNull();
    expect(arrowTarget(kinds, 2, 1)).toBe(kinds[3]);
    expect(CLOSED_STAGE_MESSAGE.converted).toMatch(/Convert to matter/);
    expect(CLOSED_STAGE_MESSAGE.lost).toMatch(/with a reason/);
  });

  it("shows real follow-ups with dates in the List, never consultation times", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const follow = (due_on: string | null, completed_at: string | null = null) => ({ id: `f${due_on}`, lead_id: id, title: "Call", due_on, completed_at, owner_membership_id: null });
    expect(nextFollowUp(id, [follow("2026-10-21"), follow("2026-11-02")], NOW, TZ)).toBe("Wed 21 Oct");
    expect(nextFollowUp(id, [follow("2026-10-12")], NOW, TZ)).toBe("Mon 12 Oct, 7 days overdue");
    expect(nextFollowUp(id, [follow("2026-10-19")], NOW, TZ)).toBe("Today, Mon 19 Oct");
    expect(nextFollowUp(id, [follow(null)], NOW, TZ)).toBe("No date");
    expect(nextFollowUp(id, [follow("2026-10-20", "2026-10-19T10:00:00Z")], NOW, TZ)).toBe("—");
    const built = pipeline({
      tab: "list",
      bookings: [{ lead_id: id, starts_at: "2026-10-20T14:00:00Z", status: "confirmed", title: "Initial consultation" }],
    });
    expect(built.data.rows.find((row) => row.name === "Sam Example")?.next).toBe("—");
  });

  it("links each Timeline item to its lead", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const built = pipeline({ tab: "timeline", followUps: [{ id: "f1", lead_id: id, title: "Call back", due_on: "2026-10-22", completed_at: null, owner_membership_id: null }] });
    expect(built.data.timeline[0]).toMatchObject({ who: "Sam Example", href: `/sheet/lead?id=${id}` });
  });

  it("keeps acronyms in sentences: from CSV import", () => {
    expect(inSentence("CSV import")).toBe("CSV import");
    expect(inSentence("Website form")).toBe("website form");
    expect(leadSummary({ service_interest: null, source: "csv_import" }).right).toMatch(/^from CSV import\./);
    const items = historyItems(
      [{ kind: "updated", from_stage_id: null, to_stage_id: null, reason: null, payload: { source_from: "phone", source_to: "referral" }, actor_user_id: null, created_at: "2026-10-19T12:00:00Z" }],
      new Map(),
      new Map(),
      TZ,
    );
    expect(items[0].what).toBe("Source changed to referral");
  });

  it("suggests the New lead source from the contact given", () => {
    expect(suggestedSource("ana@example.test", "")).toBe("email");
    expect(suggestedSource("", "+1 416 555 0100")).toBe("phone");
    expect(suggestedSource("", "")).toBeNull();
  });

  it("reopens a lost lead to the stage it was closed from, else Contacted", () => {
    const events = [{ kind: "lost", from_stage_id: "s-sch", created_at: "2026-10-10T00:00:00Z" }];
    expect(reopenStage(STAGES, events, "s-lost")?.id).toBe("s-sch");
    expect(reopenStage(STAGES, [], "s-lost")?.id).toBe("s-con");
  });

  it("Edit lead has Source (fixed for system sources) and reply consent", () => {
    const base = {
      data: { "data-lead-act": "edit" },
      owners: [],
      values: { name: "Sam", email: "", phone: "", preferred: "", service: "", country: "", language: "", dateOfBirth: "", sourceDetail: "", owner: "", fee: "", tags: "" },
      maxBirthDate: "2026-10-19",
      marketing: { granted: false, data: {} },
    };
    const editable = renderToStaticMarkup(createElement(EditLeadDialog, { data: { ...base, source: { value: "phone", label: "Phone", editable: true }, reply: { granted: false, data: { "data-reply-was": "0" } } } }));
    expect(editable).toContain('id="edSrc"');
    expect(editable).toContain('value="referral"');
    expect(editable).toContain('id="edR" data-reply-was="0"');
    const fixed = renderToStaticMarkup(createElement(EditLeadDialog, { data: { ...base, source: { value: "web_form", label: "Website form", editable: false }, reply: null } }));
    expect(fixed).toMatch(/<select class="sel" id="edSrc" disabled=""/);
    expect(fixed).toContain("Recorded when the lead came in.");
  });
});

const booking = (over: Partial<StaffBooking> = {}): StaffBooking => ({
  id: "b1",
  title: "Initial consultation",
  startsAt: "2026-10-22T14:30:00Z",
  endsAt: "2026-10-22T15:00:00Z",
  status: "confirmed",
  hostName: "Kim Host",
  locationKind: "video",
  version: 2,
  attendee: "Ana Ferreira",
  ...over,
});

describe("Consultations", () => {
  it("lists upcoming without cancelled bookings, names the type, and opens the record", () => {
    const rows = upcomingRows([booking(), booking({ id: "b2", status: "cancelled" }), booking({ id: "b3", startsAt: "2026-10-15T14:00:00Z", status: "completed" })], TZ, NOW.getTime());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ client: { left: "Ana Ferreira", right: "Initial consultation" }, href: recordHref("b1") });
    expect(consultationRow(booking(), TZ, NOW.getTime()).client).toBe("Ana Ferreira");
  });

  it("says what was recorded as the outcome", () => {
    const base = { startsAt: "2026-10-15T14:00:00Z", outcomeAt: null, cancelledAt: null, cancelledBy: null, cancelReason: null };
    expect(recordOutcome({ ...base, status: "completed", outcomeAt: "2026-10-15T15:00:00Z" }, TZ, NOW.getTime()).copy).toMatch(/^Attended\. Recorded Thu 15 Oct 11:00/);
    expect(recordOutcome({ ...base, status: "confirmed" }, TZ, NOW.getTime()).copy).toMatch(/Record whether they attended/);
    expect(recordOutcome({ ...base, status: "cancelled", cancelledAt: "2026-10-14T12:00:00Z", cancelledBy: "staff", cancelReason: "Client asked" }, TZ, NOW.getTime()).copy).toMatch(/^Cancelled by the firm on .*: Client asked$/);
  });

  it("renders the record tab from a real booking, with no demo firm", () => {
    const html = renderToStaticMarkup(
      createElement(SheetConsultationRecord, {
        data: {
          picker: [{ label: "Thu 22 Oct 10:30 EDT · Ana Ferreira · Initial consultation", value: recordHref("b1"), selected: true }],
          empty: { title: "Choose a consultation", copy: "Pick one." },
          record: {
            attendee: "Ana Ferreira",
            notes: { items: [], copy: "No notes yet.", lead: { href: "/sheet/pipeline", label: "Open the pipeline" } },
            outcome: { chip: { tone: "blue", label: "Confirmed" }, copy: "Booked.", actions: [] },
            details: [{ term: "Booking type", value: "Initial consultation" }],
            history: [{ what: "Booking confirmed", who: "Client", when: "Mon 19 Oct 10:00 EDT" }],
          },
        },
      }),
    );
    expect(html).toContain("Consultation record <span class=\"sep\" aria-hidden=\"true\"></span> Ana Ferreira");
    expect(html).toContain('data-nav-select="1"');
    expect(html).not.toMatch(/Tomás|Northline|CRM-04|C-02|INV-0211|Approve and share/);
    const empty = renderToStaticMarkup(createElement(SheetConsultationRecord, { data: { picker: [], record: null, empty: { title: "No consultations yet", copy: "Bookings appear here." } } }));
    expect(empty).toContain("No consultations yet");
  });

  it("makes new booking type link names from the name", () => {
    expect(slugFor("Initial consultation (French)")).toBe("initial-consultation-french");
    expect(slugFor("Évaluation  rapide!")).toBe("evaluation-rapide");
  });
});

describe("Calendar", () => {
  it("navigates months and days from the month box", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    const box = monthBox({ month: "2026-11", today: "2026-10-19", marked: ["2026-11-03", "2026-10-30"], nav: (m) => `/sheet/calendar?month=${m}`, day: (d) => `/sheet/calendar?week=${d}` });
    expect(box.month).toBe("November 2026");
    expect(box.nav).toMatchObject({ prev: "/sheet/calendar?month=2026-10", next: "/sheet/calendar?month=2026-12" });
    expect(box.days.find((day) => day.day === 3)).toMatchObject({ marked: true, href: "/sheet/calendar?week=2026-11-03" });
    expect(box.days.some((day) => day.today)).toBe(false);
    const html = renderToStaticMarkup(createElement(MonthCalendar, { data: box }));
    expect(html).toContain('data-nav="/sheet/calendar?month=2026-10" aria-label="Show October 2026"');
    expect(html).toContain('data-nav="/sheet/calendar?week=2026-11-03" role="link" tabindex="0"');
  });

  it("puts date-only deadlines in an All day row and sets the live flag", () => {
    const week = buildWeek(
      "2026-10-19",
      "2026-10-19",
      [
        { start: Date.parse("2026-10-21T16:00:00Z"), end: Date.parse("2026-10-21T16:30:00Z"), allDay: true, block: { kind: "tentative", title: "Deadline: biometrics", note: "n", href: "/sheet/matters/m1?tab=tasks" } },
        { start: Date.parse("2026-10-21T14:00:00Z"), end: Date.parse("2026-10-21T15:00:00Z"), block: { kind: "consultation", title: "A", note: "n" } },
        { start: Date.parse("2026-10-21T14:15:00Z"), end: Date.parse("2026-10-21T14:45:00Z"), block: { kind: "consultation", title: "B", note: "n" } },
      ],
      TZ,
      { live: true },
    );
    expect(week.live).toBe(true);
    expect(week.hours[0]).toMatchObject({ label: "All day", allDay: true });
    expect(week.hours[0].cells[2]).toHaveLength(1);
    expect(week.hours[1].label).toBe("9:00");
    const ten = week.hours.find((hour) => hour.label === "10:00");
    expect(ten?.cells[2]).toHaveLength(2);
    const html = renderToStaticMarkup(createElement(SheetCalendar, { data: { tab: "week", heading: { title: "This week", copy: "c" }, week, note: "n" } }));
    // Two items in one hour sit side by side, and text is clipped inside its block.
    expect(html).toContain("left:calc(0% + 4px);width:calc(50% - 8px)");
    expect(html).toContain("left:calc(50% + 4px)");
    expect(html).toContain("text-overflow:ellipsis");
    expect(html).toContain('data-href="/sheet/matters/m1?tab=tasks" role="link" tabindex="0"');
  });

  it("shows the Deadlines tab's empty state, and one Connected calendars heading live", () => {
    const empty = renderToStaticMarkup(
      createElement(SheetCalendar, { data: { tab: "deadlines", heading: { title: "This week", copy: "c" }, week: { days: [], hours: [], live: true }, note: "n", empty: { title: "No deadlines this week", copy: "Look ahead." } } }),
    );
    expect(empty).toContain("No deadlines this week");
    const rbar = renderToStaticMarkup(
      createElement(CalendarRbarView, {
        data: {
          calendar: { month: "October 2026", leading: 3, days: [{ day: 1 }] },
          deadlines: [{ date: "Mon 12 Oct", title: "Biometrics", who: "Sam", chip: { tone: "bad", label: "Past, not confirmed" }, href: "/sheet/matters/m1?tab=tasks" }],
          calendars: [],
          live: { emptyTitle: "No upcoming deadlines", emptyCopy: "c" },
        },
      }),
    );
    expect(rbar.match(/Connected calendars/g)).toHaveLength(1);
    expect(rbar).toContain('data-href="/sheet/matters/m1?tab=tasks" role="link"');
    // Live: no "planned" Google card (the rows say who is connected) and Casevoya video is built in.
    expect(rbar).not.toContain("planned integration");
    expect(rbar).toContain("Casevoya video");
    expect(rbar).toContain("Built in");
  });
});

describe("Team queue, header menu, avatars", () => {
  it("wires the checkbox to Reassign and has a no-match message", () => {
    const html = renderToStaticMarkup(
      createElement(SheetQueue, {
        data: {
          counts: { open: 1, overdue: 0, people: 2 },
          load: [],
          items: [{ id: "rbl0000001", title: "Call client", who: "Sam", kind: "Task", owner: staffPerson("Kim Host"), due: { tone: "gr", label: "No date" }, flags: [], task: { id: "t1", version: 3 } }],
          reassign: { organizationId: "org", people: [{ value: "m1", label: "Kim Host" }] },
        },
      }),
    );
    expect(html).toContain('data-task="t1" data-version="3"');
    expect(html).toContain('class="ck" role="checkbox" aria-checked="false"');
    expect(html).toContain('data-queue-reassign="org"');
    expect(html).toContain('<div class="fp-fe panel" hidden="">');
    expect(html).not.toContain("av-amara-consultant");
    expect(staffPerson("Walk Tester")).toEqual({ name: "Walk Tester", avatarUrl: null });
  });

  it("opens the crumb's own section, the page's group, or the top links", () => {
    const groups = [
      { name: "Leads", links: [{ label: "Pipeline", href: "/sheet/pipeline", current: false }, { label: "Calendar", href: "/sheet/calendar", current: true }] },
      { name: "Practice", links: [{ label: "Reports", href: "/sheet/reports", current: false }] },
    ];
    const top = [{ label: "Home", href: "/sheet", current: false }];
    expect(chooseCrumbLinks(groups, top, "Leads").map((link) => link.href)).toEqual(["/sheet/pipeline", "/sheet/calendar"]);
    expect(chooseCrumbLinks(groups, top, "Reports")[0].href).toBe("/sheet/reports");
    expect(chooseCrumbLinks(groups, top, "Calendar")[1].current).toBe(true);
    expect(chooseCrumbLinks(groups, top, "Synthetic Firm")[0].href).toBe("/sheet/pipeline");
    expect(chooseCrumbLinks([], top, "Synthetic Firm")).toEqual(top);
  });
});

describe("Public booking page", () => {
  it("knows which paths are booking pages and which lookups can be shown (else the proxy answers 404)", () => {
    expect(bookingPagePath("/book/maple/initial")).toEqual({ firm: "maple", event: "initial" });
    expect(bookingPagePath("/book/Maple/Initial/")).toEqual({ firm: "maple", event: "initial" });
    expect(bookingPagePath("/book/maple")).toBeNull();
    expect(bookingPagePath("/book/ma_ple/x")).toEqual({ firm: "", event: "" });
    expect(isBookablePublicEvent(null)).toBe(false);
    expect(isBookablePublicEvent({ event_type_id: "t", title: "Initial", duration_min: 30, price_cents: 0 })).toBe(true);
    expect(isBookablePublicEvent({ event_type_id: "t", title: "Paid", duration_min: 30, price_cents: 5000 })).toBe(false);
  });

  it("offers Earlier times after Later times", () => {
    const html = renderToStaticMarkup(
      createElement(BookPage, {
        data: {
          header: { name: "Maple Immigration" },
          title: "Initial consultation",
          lead: "30 minutes.",
          fee: null,
          slots: [],
          meet: ["Video call"],
          note: "Free.",
          submit: { label: "Book this time" },
          footer: { firm: "Maple Immigration" },
          live: { zone: { value: TZ, options: [TZ] }, phone: false, more: true, earlier: true },
        },
      }),
    );
    expect(html.indexOf("Earlier times")).toBeGreaterThan(-1);
    expect(html.indexOf("Earlier times")).toBeLessThan(html.indexOf("Later times"));
  });
});

describe("Reports periods", () => {
  it("starts a period at the firm's midnight and labels a part month", () => {
    expect(localMidnightIso("2026-10-01", TZ)).toBe("2026-10-01T04:00:00.000Z");
    expect(localMidnightIso("2026-01-15", TZ)).toBe("2026-01-15T05:00:00.000Z");
    expect(monthLabel("2026-07", "2026-10-16", "2026-07-19")).toBe("July from 19 Jul");
    expect(monthLabel("2026-08", "2026-10-16", "2026-07-19")).toBe("August");
    expect(monthLabel("2026-10", "2026-10-16", "2026-10-01")).toBe("October to date");
    expect(leadFunnel([], new Set(), new Set()).bars[0].label).toBe("Booked for dates so far");
  });
});
