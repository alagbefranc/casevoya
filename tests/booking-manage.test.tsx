import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/scheduling/manage-actions", () => ({ manageCancel: vi.fn(), manageReschedule: vi.fn(), manageRescheduleStarts: vi.fn() }));

import { ManageBooking } from "@/components/sheet/manage-booking";
import { manageLink } from "@/modules/email/designs/catalog";
import { dispatchOutbound, type DispatchDeps } from "@/modules/email/dispatch";
import { renderEmail } from "@/modules/email/templates";
import { isManageToken, manageError, managePath, manageTokenHash, newManageToken, parseManagedBooking } from "@/modules/scheduling/manage-present";
import { clientActorLabel } from "@/modules/scheduling/sheet-present";

// CRM-03 (#176): Manage your booking for a booker without a portal. Everything here is synthetic.

const ORIGIN = "https://app.casevoya.ca";
const REF = "abcdefghijklmnopqrstuvwxyz";

describe("the link", () => {
  it("is a random single-purpose token, hashed as the database stores it", async () => {
    const token = newManageToken();
    expect(isManageToken(token)).toBe(true);
    expect(newManageToken()).not.toBe(token);
    expect(await manageTokenHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(managePath(REF, "t0k")).toBe(`/booking/${REF}?t=t0k`);
  });

  it("is only ever this app's own /booking/<ref> link", () => {
    expect(manageLink(`${ORIGIN}/booking/${REF}?t=abc`, ORIGIN)).toBe(`${ORIGIN}/booking/${REF}?t=abc`);
    expect(manageLink(`https://evil.example/booking/${REF}?t=abc`, ORIGIN)).toBeNull();
    expect(manageLink(`${ORIGIN}/booking/${REF}`, ORIGIN)).toBeNull();
    expect(manageLink(`${ORIGIN}/portal`, ORIGIN)).toBeNull();
  });
});

describe("booking emails", () => {
  const link = `${ORIGIN}/booking/${REF}?t=abc`;

  it("EM16a and EM16b give a booker without a portal a Manage your booking button", () => {
    const booked = renderEmail({ template: "consultation_booked", firm: "Test Firm", starts_at: "2026-10-30T14:00:00Z", time_zone: "America/Toronto", portal: false, manage_link: link }, { origin: ORIGIN });
    expect(booked.text).toContain("To change the time or cancel, use Manage your booking.");
    expect(booked.html).toContain(`href="${link}"`);
    expect(booked.html).toContain(">Manage your booking</a>");
    const moved = renderEmail({ template: "consultation_rescheduled", firm: "Test Firm", starts_at: "2026-10-31T14:00:00Z", time_zone: "America/Toronto", portal: false, manage_link: link }, { origin: ORIGIN });
    expect(moved.html).toContain(">Manage your booking</a>");
  });

  it("keeps the portal button for a portal client, and the old line without a link", () => {
    const portal = renderEmail({ template: "consultation_booked", firm: "Test Firm", portal: true, manage_link: link }, { origin: ORIGIN });
    expect(portal.html).not.toContain("Manage your booking");
    const none = renderEmail({ template: "consultation_booked", firm: "Test Firm", portal: false }, { origin: ORIGIN });
    expect(none.text).toContain("To change or cancel, contact Test Firm.");
  });

  it("the mail worker makes the token, stores only its hash and drops any link from the context", async () => {
    const hashes: string[] = [];
    const html: string[] = [];
    const deps: DispatchDeps = {
      claim: async () => [{ id: "e1" }],
      prepare: async () => ({
        action: "send",
        messages: [
          {
            delivery_id: "d1",
            to: "sam@example.test",
            from_address: "notices@casevoya.ca",
            from_name: "Test Firm",
            reply_to_address: "t@docs.casevoya.ca",
            reply_to_name: "Test Firm",
            template: "consultation_booked",
            context: { firm: "Test Firm", template: "consultation_booked", portal: false, manage_link: "https://evil.example/x" },
          },
        ],
      }),
      manageToken: async (_delivery, sha256) => {
        hashes.push(sha256);
        return REF;
      },
      send: async (message) => {
        html.push(message.html);
        return { ok: true, messageId: "m", delivered: [message.to], queued: [], permanentBounces: [], suppressed: [] };
      },
      finish: async () => {},
    };
    await dispatchOutbound(deps, { worker: "w", limit: 1, inboundDomain: "docs.casevoya.ca", fromAddress: "notices@casevoya.ca", appOrigin: ORIGIN });
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    const token = /\/booking\/[a-z2-7]{26}\?t=([A-Za-z0-9_-]+)/.exec(html[0])?.[1];
    expect(token && (await manageTokenHash(token))).toBe(hashes[0]);
    expect(html[0]).not.toContain("evil.example");
  });
});

describe("the page", () => {
  const booking = parseManagedBooking({
    id: "b1",
    ref: REF,
    firm_name: "Test Firm",
    firm_slug: "test-firm",
    title: "Initial consultation",
    host_name: "Dana Host",
    starts_at: "2026-10-30T14:00:00Z",
    ends_at: "2026-10-30T14:30:00Z",
    time_zone: "America/Toronto",
    location_kind: "video",
    status: "confirmed",
    version: 3,
    upcoming: true,
    min_notice_min: 60,
    late: false,
  })!;

  it("shows the booking with Change the time and Cancel", () => {
    const html = renderToStaticMarkup(createElement(ManageBooking, { booking, token: "t" }));
    expect(html).toContain("Manage your booking");
    expect(html).toContain("Initial consultation");
    expect(html).toContain(" · with Dana Host");
    expect(html).toContain(">Change the time</button>");
    expect(html).toContain(">Cancel the consultation</button>");
  });

  it("says plainly when it can't be changed any more", () => {
    const html = renderToStaticMarkup(createElement(ManageBooking, { booking: { ...booking, upcoming: false, status: "cancelled", cancelledBy: "client" }, token: "t" }));
    expect(html).toContain("This consultation was cancelled by you.");
    expect(html).not.toContain("Change the time");
    expect(parseManagedBooking({ ref: "bad" })).toBeNull();
    expect(manageError("booking access denied")).toMatch(/link no longer works/);
  });

  it("the staff record says the booker used the Manage link", () => {
    expect(clientActorLabel(false)).toBe("Booker, from the Manage link");
    expect(clientActorLabel(true)).toBe("Client");
  });
});
