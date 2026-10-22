import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppointmentsLive } from "@/components/portal/appointments-live";
import { renderEmail } from "@/modules/email/templates";
import type { PortalViewer } from "@/modules/portal/load";

const viewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Maple Example Immigration",
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

describe("consultation emails (EM16a–c) through the mail worker's renderer", () => {
  it("renders the booking time in the attendee's own zone, with the zone named, and no time in the subject", () => {
    const booked = renderEmail({ template: "consultation_booked", firm: "Maple Example Immigration", starts_at: "2026-10-22T14:30:00Z", time_zone: "America/Vancouver", consultant_name: "Kim Host", portal: true });
    expect(booked.design).toBe("EM16a");
    expect(booked.subject).toBe("Your consultation with Maple Example Immigration is booked");
    expect(booked.text).toContain("Thursday 22 October 2026, 07:30 (Vancouver time) with Kim Host");
    expect(booked.html).toContain("/portal/appointments");
    const moved = renderEmail({ template: "consultation_rescheduled", firm: "Maple", starts_at: "2026-10-27T14:30:00Z", time_zone: "America/Toronto" });
    expect(moved.design).toBe("EM16b");
    expect(moved.text).toContain("Tuesday 27 October 2026, 10:30 (Toronto time)");
    const cancelled = renderEmail({ template: "consultation_cancelled", firm: "Maple", starts_at: "2026-10-27T14:30:00Z", time_zone: "America/Toronto" });
    expect(cancelled.design).toBe("EM16c");
    expect(cancelled.subject).toBe("Maple cancelled your consultation");
  });

  it("never puts a link from the database into the email", () => {
    const email = renderEmail({ template: "consultation_booked", firm: "Maple", starts_at: "2026-10-22T14:30:00Z", time_zone: "UTC", link: "https://evil.example/x" });
    expect(email.html).not.toContain("evil.example");
    // Not the meeting link either: the firm sends it.
    const linked = renderEmail({ template: "consultation_booked", firm: "Maple", starts_at: "2026-10-22T14:30:00Z", time_zone: "UTC", location_kind: "meeting_link", address: "https://meet.example.test/x" });
    expect(linked.text).toContain("Maple will send you the meeting link.");
    expect(linked.html).not.toContain("meet.example.test");
    // A booking page slug that is not a slug is never linked.
    const odd = renderEmail({ template: "consultation_cancelled", firm: "Maple", starts_at: "2026-10-27T14:30:00Z", time_zone: "UTC", portal: false, booking_page: "../evil.example" });
    expect(odd.html).not.toContain("evil.example");
    expect(odd.text).toContain("To book another time, contact Maple.");
  });

  const at = { starts_at: "2026-10-22T14:30:00Z", time_zone: "America/Toronto", firm: "Maple" };
  const links = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

  it("EM16a: the portal button only for a portal login, and how they meet instead of a joining link", () => {
    const portal = renderEmail({ template: "consultation_booked", ...at, portal: true, location_kind: "video" });
    expect(links(portal.html)).toEqual(["https://app.casevoya.ca/portal/appointments"]);
    expect(portal.text).toContain("Maple will send you the meeting link.");
    expect(portal.text).not.toContain("To change or cancel");

    const lines: [string, string | null, string][] = [
      ["phone", null, "Maple will call you at the number you gave."],
      ["video", null, "Maple will send you the meeting link."],
      ["meeting_link", null, "Maple will send you the meeting link."],
      ["in_person", "1 Example Street, Toronto", "At 1 Example Street, Toronto."],
      ["in_person", null, "Maple will confirm the address."],
    ];
    for (const [kind, address, line] of lines) {
      const email = renderEmail({ template: "consultation_booked", ...at, portal: false, location_kind: kind, address });
      expect(links(email.html), kind).toEqual([]);
      expect(email.text, kind).toContain(`${line} To change or cancel, contact Maple.`);
      expect(`${email.text} ${email.preheader}`, kind).not.toMatch(/joining link|portal/i);
    }
  });

  it("EM16b: the portal button only for a portal login; otherwise who to contact", () => {
    const portal = renderEmail({ template: "consultation_rescheduled", ...at, portal: true });
    expect(links(portal.html)).toEqual(["https://app.casevoya.ca/portal/appointments"]);
    const visitor = renderEmail({ template: "consultation_rescheduled", ...at, portal: false });
    expect(links(visitor.html)).toEqual([]);
    expect(visitor.text).toContain("Your consultation is now Thursday 22 October 2026, 10:30 (Toronto time). To change or cancel, contact Maple.");
    expect(`${visitor.text} ${visitor.preheader}`).not.toMatch(/portal/i);
  });

  it("EM16c: no fee sentence; the portal, else the firm's booking page, else who to contact", () => {
    const portal = renderEmail({ template: "consultation_cancelled", ...at, portal: true });
    expect(links(portal.html)).toEqual(["https://app.casevoya.ca/portal/appointments"]);
    const page = renderEmail({ template: "consultation_cancelled", ...at, portal: false, booking_page: "maple-example" });
    expect(links(page.html)).toEqual(["https://app.casevoya.ca/book/maple-example"]);
    expect(page.text).toContain("Book another time");
    const none = renderEmail({ template: "consultation_cancelled", ...at, portal: false });
    expect(links(none.html)).toEqual([]);
    expect(none.text).toContain("was cancelled by Maple. To book another time, contact Maple.");
    for (const email of [portal, page, none]) expect(email.text).not.toMatch(/fee|refund|credit/i);
  });
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

describe("portal Appointments", () => {
  const base = { publicRef: "abcdefghijklmnopqrstuvwxyz", hostName: "Kim Host", locationKind: "phone", locationDetail: null, timeZone: "America/Vancouver", version: 1, isSample: false, rules: null };
  it("lists the client's coming and past calls with their zone, and the firm's booking pages", () => {
    const html = renderToStaticMarkup(
      createElement(AppointmentsLive, {
        viewer,
        data: {
          now: Date.parse("2026-10-20T12:00:00Z"),
          rows: [
            { ...base, id: "00000000-0000-4000-8000-0000000000a1", title: "Initial consultation", startsAt: "2026-10-12T15:00:00Z", endsAt: "2026-10-12T15:30:00Z", status: "completed" },
            { ...base, id: "00000000-0000-4000-8000-0000000000a2", title: "Initial consultation", startsAt: "2026-10-22T14:30:00Z", endsAt: "2026-10-22T15:00:00Z", status: "confirmed" },
          ],
          bookable: [{ title: "Initial consultation", href: "/book/maple/initial", durationMin: 30 }],
        },
      }),
    );
    expect(html).toContain("07:30–08:00 PDT");
    expect(html).toContain("/api/appointments/00000000-0000-4000-8000-0000000000a2/ics?organizationId=");
    expect(html).toContain("Attended");
    expect(html).toContain('href="/book/maple/initial"');
    // A phone call has no join button; the client can move or cancel it.
    expect(html).not.toMatch(/Northline|Amara|Priya|IST|Join video call/);
    expect(html).toContain('<button class="btn sm" id="rs">Reschedule</button><button class="btn sm" id="cx">Cancel</button>');
    // A call with the firm's meeting link has the join button (the link itself only once it opens).
    const linked = renderToStaticMarkup(
      createElement(AppointmentsLive, {
        viewer,
        data: {
          now: Date.parse("2026-10-20T12:00:00Z"),
          rows: [{ ...base, id: "00000000-0000-4000-8000-0000000000a3", title: "Initial consultation", startsAt: "2026-10-22T14:30:00Z", endsAt: "2026-10-22T15:00:00Z", status: "confirmed", locationKind: "meeting_link", locationDetail: "https://meet.example.test/x" }],
          bookable: [],
        },
      }),
    );
    expect(linked).toContain("Join video call");
    expect(linked).not.toContain("https://meet.example.test/x");
  });

  it("shows honest empty states", () => {
    const html = renderToStaticMarkup(createElement(AppointmentsLive, { viewer, data: { now: 0, rows: [], bookable: [] } }));
    expect(html).toContain("No calls booked");
    expect(html).toContain("hasn’t published a booking page");
  });
});
