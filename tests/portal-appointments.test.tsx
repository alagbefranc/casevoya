import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppointmentsLive } from "@/components/portal/appointments-live";
import type { PortalViewer } from "@/modules/portal/load";
import type { PortalAppointment } from "@/modules/scheduling/portal-load";
import { CALL_WAIT_TOAST, JOIN_WAIT_TOAST, cancelBody, cancelTitle, joinState, noticeLabel, pickLabel, pickerDays, slotTime, whereLabel } from "@/modules/scheduling/portal-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const viewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Maple Example Immigration",
  organizationSlug: "example-firm",
  timezone: "America/Toronto",
  role: "client",
  person: null,
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
} satisfies PortalViewer;

const call: PortalAppointment = {
  id: "00000000-0000-4000-8000-0000000000b1",
  publicRef: "abcdefghijklmnopqrstuvwxyz",
  title: "Initial consultation",
  startsAt: "2026-10-22T14:30:00Z",
  endsAt: "2026-10-22T15:00:00Z",
  status: "confirmed",
  hostName: "Kim Host",
  locationKind: "meeting_link",
  locationDetail: "https://meet.example.test/room",
  timeZone: "America/Vancouver",
  version: 3,
  isSample: false,
  rules: { minNoticeMin: 1440, late: false },
};

const T = (iso: string) => Date.parse(iso);

describe("portal appointments: join window", () => {
  it("opens the firm's meeting link 10 minutes before the call until it ends, and waits before that", () => {
    expect(joinState(call, T("2026-10-22T14:19:59Z"), "Maple")).toEqual({ kind: "wait", toast: JOIN_WAIT_TOAST });
    expect(joinState(call, T("2026-10-22T14:20:00Z"), "Maple")).toEqual({ kind: "open", href: "https://meet.example.test/room" });
    expect(joinState(call, T("2026-10-22T14:59:59Z"), "Maple")).toEqual({ kind: "open", href: "https://meet.example.test/room" });
    expect(joinState(call, T("2026-10-22T15:00:00Z"), "Maple")).toEqual({ kind: "wait", toast: JOIN_WAIT_TOAST });
  });

  it("a Casevoya video call opens its call page 15 minutes before until 30 minutes after; phone and in person have no join button", () => {
    const video = { ...call, locationKind: "video", locationDetail: null };
    expect(joinState(video, T("2026-10-22T14:14:59Z"), "Maple")).toEqual({ kind: "wait", toast: CALL_WAIT_TOAST });
    expect(joinState(video, T("2026-10-22T14:15:00Z"), "Maple")).toEqual({ kind: "open", href: "/call/abcdefghijklmnopqrstuvwxyz" });
    expect(joinState(video, T("2026-10-22T15:29:59Z"), "Maple")).toEqual({ kind: "open", href: "/call/abcdefghijklmnopqrstuvwxyz" });
    expect(joinState(video, T("2026-10-22T15:30:00Z"), "Maple")).toEqual({ kind: "wait", toast: CALL_WAIT_TOAST });
    expect(joinState({ ...video, publicRef: null }, T("2026-10-22T14:25:00Z"), "Maple")).toEqual({ kind: "firm", toast: "Maple will send you the meeting link" });
    expect(joinState({ ...call, locationKind: "phone", locationDetail: null }, T("2026-10-22T14:25:00Z"), "Maple")).toEqual({ kind: "none" });
    expect(joinState({ ...call, locationKind: "in_person", locationDetail: "1 Example Street" }, T("2026-10-22T14:25:00Z"), "Maple")).toEqual({ kind: "none" });
    // Never a link that is not https: no join button at all.
    expect(joinState({ ...call, locationDetail: "javascript:alert(1)" }, T("2026-10-22T14:25:00Z"), "Maple")).toEqual({ kind: "none" });
  });

  it("names where they meet: a stored link is a video call; otherwise the shared location copy", () => {
    expect(whereLabel(call)).toBe("Video call");
    expect(whereLabel({ locationKind: "video", locationDetail: null })).toBe("Video call");
    expect(whereLabel({ locationKind: "phone", locationDetail: null })).toBe("Phone");
    expect(whereLabel({ locationKind: "in_person", locationDetail: "1 Example Street" })).toBe("In person, 1 Example Street");
  });
});

describe("portal appointments: cancel dialog words", () => {
  it("names the call and who is told; the late warning only inside the notice", () => {
    expect(cancelTitle(call)).toBe("Cancel the initial consultation?");
    expect(cancelBody(call, "Maple")).toBe("Kim will be told. You can book another time straight away.");
    expect(cancelBody({ ...call, rules: { minNoticeMin: 1440, late: true } }, "Maple")).toBe(
      "Kim will be told. Cancelling less than 24 hours before may count as a missed call under your agreement. You can book another time straight away.",
    );
    expect(cancelBody({ ...call, hostName: null, rules: { minNoticeMin: 90, late: true } }, "Maple")).toBe(
      "Maple will be told. Cancelling less than 90 minutes before may count as a missed call under your agreement. You can book another time straight away.",
    );
    expect(cancelBody({ ...call, isSample: true, rules: null }, "Maple")).toBe("Kim will be told. You can book another time straight away. This is a sample booking, so no email is sent.");
    expect(noticeLabel(60)).toBe("1 hour");
    expect(noticeLabel(2880)).toBe("48 hours");
  });
});

describe("portal appointments: reschedule picker", () => {
  it("groups free starts by the client's local day and labels the chosen time in their zone", () => {
    const starts = [T("2026-10-20T14:00:00Z"), T("2026-10-20T14:30:00Z"), T("2026-10-21T03:30:00Z"), T("2026-10-21T15:00:00Z")];
    const days = pickerDays(starts, "Asia/Kolkata");
    expect(days.map((day) => [day.date, day.weekday, day.day, day.starts.length])).toEqual([
      ["2026-10-20", "Tue", 20, 2],
      ["2026-10-21", "Wed", 21, 2],
    ]);
    expect(slotTime(starts[0], "Asia/Kolkata")).toBe("19:30");
    expect(pickLabel(starts[0], "Asia/Kolkata")).toBe("Tue 20 Oct, 19:30");
    // The same instants in Vancouver fall on other days.
    expect(pickerDays(starts, "America/Vancouver").map((day) => [day.date, day.starts.length])).toEqual([
      ["2026-10-20", 3],
      ["2026-10-21", 1],
    ]);
    expect(pickerDays([], "America/Vancouver")).toEqual([]);
  });
});

describe("portal appointments: the live page", () => {
  const render = (rows: PortalAppointment[], now: number) => renderToStaticMarkup(createElement(AppointmentsLive, { viewer, data: { now, rows, bookable: [] } }));

  it("renders the join link inside the window, and the Designer's waiting button before it", () => {
    const open = render([call], T("2026-10-22T14:25:00Z"));
    expect(open).toContain('<a class="btn p sm" href="https://meet.example.test/room" rel="noopener noreferrer" target="_blank">');
    expect(open).toContain("Join video call");
    expect(open).not.toContain("aria-disabled");
    const wait = render([call], T("2026-10-21T14:25:00Z"));
    expect(wait).toContain(`<button class="btn p sm" data-toast="${JOIN_WAIT_TOAST}" data-fpb="1" aria-disabled="true">`);
    expect(wait).not.toContain("https://meet.example.test/room");
    // Phone: the location copy instead of a join button; Add to calendar stays.
    const phone = render([{ ...call, locationKind: "phone", locationDetail: null }], T("2026-10-21T14:25:00Z"));
    expect(phone).not.toContain("Join video call");
    expect(phone).toContain("Phone");
    expect(phone).toContain("/api/appointments/00000000-0000-4000-8000-0000000000b1/ics?organizationId=00000000-0000-4000-8000-000000000001");
  });

  it("a Casevoya video call that ran past its end keeps a Rejoin link in Past until the call closes", () => {
    const video = { ...call, locationKind: "video", locationDetail: null };
    // Ends 15:00; the call stays open until 15:30.
    const running = render([video], T("2026-10-22T15:10:00Z"));
    expect(running).toContain('href="/call/abcdefghijklmnopqrstuvwxyz"');
    expect(running).toContain("Rejoin call");
    expect(render([video], T("2026-10-22T15:30:00Z"))).not.toContain("Rejoin call");
    expect(render([{ ...video, status: "cancelled" }], T("2026-10-22T15:10:00Z"))).not.toContain("Rejoin call");
    expect(render([call], T("2026-10-22T15:10:00Z"))).not.toContain("Rejoin call");
  });

  it("carries the Reschedule and Cancel buttons and both dialogs for an upcoming call, with the Designer ids on the first row only", () => {
    const second = { ...call, id: "00000000-0000-4000-8000-0000000000b2", startsAt: "2026-10-23T14:30:00Z", endsAt: "2026-10-23T15:00:00Z" };
    const html = render([call, second], T("2026-10-21T14:25:00Z"));
    expect(html.match(/id="rs"/g)).toHaveLength(1);
    expect(html.match(/id="cx"/g)).toHaveLength(1);
    expect(html.match(/>Reschedule</g)).toHaveLength(2);
    expect(html).toContain('<dialog class="dlg" id="cxd" aria-labelledby="cxt">');
    expect(html).toContain('<h2 id="cxt">Cancel the initial consultation?</h2>');
    expect(html).toContain('<div class="db">Kim will be told. You can book another time straight away.</div>');
    expect(html).toContain('<dialog class="dlg" id="rsd" aria-labelledby="rst">');
    expect(html).toContain('<h2 id="rst">Move the initial consultation</h2>');
    expect(html).toContain('<div class="days" role="group" aria-label="Day" style="margin-top:6px"></div>');
    expect(html).toContain("Times in America/Vancouver");
    expect(html).toContain('<button class="btn p" id="rsy" disabled=""><span class="lab">Choose a time</span><span class="spin"></span></button>');
    // Nothing from the Designer's sample firm.
    expect(html).not.toMatch(/Northline|Amara|Priya|IST/);
  });

  it("shows the late warning only when cancelling now is inside the notice, and no dialogs without an upcoming call", () => {
    const late = render([{ ...call, rules: { minNoticeMin: 1440, late: true } }], T("2026-10-21T20:00:00Z"));
    expect(late).toContain("Cancelling less than 24 hours before may count as a missed call under your agreement.");
    const none = render([{ ...call, status: "cancelled" }], T("2026-10-21T20:00:00Z"));
    expect(none).toContain("No calls booked");
    expect(none).not.toContain("<dialog");
    expect(none).toContain("Cancelled");
  });
});
