import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    const booked = renderEmail({ template: "consultation_booked", firm: "Maple Example Immigration", starts_at: "2026-10-22T14:30:00Z", time_zone: "America/Vancouver", consultant_name: "Kim Host" });
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
  });
});

describe("portal Appointments", () => {
  const base = { hostName: "Kim Host", locationKind: "phone", locationDetail: null, timeZone: "America/Vancouver" };
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
    expect(html).not.toMatch(/Northline|Amara|Priya|IST|Join video call/);
  });

  it("shows honest empty states", () => {
    const html = renderToStaticMarkup(createElement(AppointmentsLive, { viewer, data: { now: 0, rows: [], bookable: [] } }));
    expect(html).toContain("No calls booked");
    expect(html).toContain("hasn’t published a booking page");
  });
});
