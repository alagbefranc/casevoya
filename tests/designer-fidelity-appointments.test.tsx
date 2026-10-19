import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppointmentsLive } from "@/components/portal/appointments-live";
import { AppointmentsMarkup } from "@/components/portal/markup/portal-appointments";
import type { PortalViewer } from "@/modules/portal/load";
import type { PortalAppointments } from "@/modules/scheduling/portal-load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
// The Designer's client is in Kolkata and the capture says "IST". Node names that zone "IST" or
// "GMT+5:30" depending on its ICU data, so the short zone name is pinned here, not left to the runner.
vi.mock("@/modules/scheduling/format", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/scheduling/format")>();
  return { ...real, zoneAbbr: (ms: number, tz: string) => (tz === "Asia/Kolkata" ? "IST" : real.zoneAbbr(ms, tz)) };
});

/**
 * Designer fidelity: the portal Appointments page's "Coming up" card with its Join video call /
 * Reschedule / Cancel row (portal-appointments.tsx line 19) and the Cancel dialog #cxd (line 25),
 * rendered live with the Designer's own sample data. Live-only additions, documented in
 * components/portal/appointments-live.tsx and stripped here: the "Add to calendar" link,
 * aria-disabled on the join button before the link opens, and the #rsd reschedule dialog (built
 * from the Designer's "Book a call" pieces; the Designer has no reschedule dialog).
 */

const DESIGNER_VIEWER = {
  organizationId: "00000000-0000-4000-8000-00000000000a",
  organizationName: "Northline",
  timezone: "Asia/Kolkata",
  role: "client",
  person: null,
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
} satisfies PortalViewer;

// Thu 22 Oct, 19:30–20:00 IST with Amara Osei, a video call whose link the firm stored; read on
// 21 Oct at 20:00 UTC, 18 hours before the call: inside the 24-hour notice (the dialog warns), and
// before the link opens (the Designer's toast).
const DESIGNER_DATA: PortalAppointments = {
  now: Date.parse("2026-10-21T20:00:00Z"),
  rows: [
    {
      id: "00000000-0000-4000-8000-0000000000c1",
      title: "Package review call",
      startsAt: "2026-10-22T14:00:00Z",
      endsAt: "2026-10-22T14:30:00Z",
      status: "confirmed",
      hostName: "Amara Osei",
      locationKind: "meeting_link",
      locationDetail: "https://meet.example.test/northline",
      timeZone: "Asia/Kolkata",
      version: 1,
      isSample: false,
      rules: { minNoticeMin: 1440, late: true },
    },
  ],
  bookable: [],
};

function region(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  expect(start, `missing ${open}`).toBeGreaterThanOrEqual(0);
  const end = html.indexOf(close, start + open.length);
  expect(end, `missing ${close}`).toBeGreaterThanOrEqual(0);
  return html.slice(start, end);
}

function liveOnly(html: string): string {
  return html
    .replace(/<a class="btn sm" href="\/api\/appointments\/[^"]*"><svg class="ic s" aria-hidden="true"><use href="[^"]*#i-calendar"><\/use><\/svg>Add to calendar<\/a>/g, "")
    .replace(/ aria-disabled="true"/g, "")
    .replace(/<dialog class="dlg" id="rsd"[\s\S]*?<\/dialog>/g, "");
}

function expectSame(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

describe("Designer fidelity: portal Appointments, Coming up and the Cancel dialog", () => {
  const captured = renderToStaticMarkup(createElement(AppointmentsMarkup));
  const live = liveOnly(renderToStaticMarkup(createElement(AppointmentsLive, { viewer: DESIGNER_VIEWER, data: DESIGNER_DATA })));

  it("renders the Coming up card with Join video call, Reschedule and Cancel exactly as captured", () => {
    const open = '<div class="panel rv" style="--i:1">';
    const close = '<div class="panel rv" style="--i:2">';
    expectSame(region(live, open, close), region(captured, open, close));
  });

  it("renders the Cancel dialog exactly as captured, late warning included", () => {
    const open = '<dialog class="dlg" id="cxd"';
    const close = "</dialog>";
    expectSame(region(live, open, close), region(captured, open, close));
  });

  it("the live page strips nothing else: the only live-only parts are the documented ones", () => {
    const raw = renderToStaticMarkup(createElement(AppointmentsLive, { viewer: DESIGNER_VIEWER, data: DESIGNER_DATA }));
    expect(raw).toContain("Add to calendar");
    expect(raw).toContain('aria-disabled="true"');
    expect(raw).toContain('id="rsd"');
    expect(liveOnly(raw)).not.toMatch(/Add to calendar|aria-disabled|id="rsd"/);
  });
});
