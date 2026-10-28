import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortalPoliciesAfter, PublicPagesAlert, SheetPortalPolicies } from "@/components/sheet/designer/portal-policies";
import { bookPageBase } from "@/components/sheet/book-live";
import { currentPolicies } from "@/modules/portal-policies/defaults";
import { NOTICE_REQUIRED, noticeRequiredError, publicPagesWarning } from "@/modules/portal-policies/public-pages";
import { policyCards } from "@/modules/portal-policies/present";
import { parsePublicEvent } from "@/modules/scheduling/public-api";

// #263-A: the firm's privacy notice and its public booking and enquiry pages (presentation and actions).

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = Date.parse("2026-10-28T15:00:00Z");
const TZ = "America/Toronto";

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  result: { data: null as unknown, error: null as null | { code?: string; message: string } },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.calls.push({ name, args });
      return rpc.result;
    },
  }),
}));

const { unpublishPrivacyNotice } = await import("@/modules/portal-invitations/actions");

const row = (published_at: string) => ({ id: "p1", kind: "privacy_notice", version_label: "1", title: "Privacy notice", body: "Text", published_at });

describe("the current privacy notice", () => {
  it("skips a version published at or before the firm's last unpublish, and counts a later one", () => {
    expect(currentPolicies([row("2026-10-01T10:00:00Z")]).privacy_notice).not.toBeNull();
    expect(currentPolicies([row("2026-10-01T10:00:00Z")], { privacyWithdrawnAt: "2026-10-02T10:00:00Z" }).privacy_notice).toBeNull();
    expect(currentPolicies([row("2026-10-03T10:00:00Z")], { privacyWithdrawnAt: "2026-10-02T10:00:00Z" }).privacy_notice).toMatchObject({ versionLabel: "1" });
    expect(currentPolicies([row("2026-10-01T10:00:00Z")], { privacyWithdrawnAt: null }).privacy_notice).not.toBeNull();
  });
});

describe("the public pages banner", () => {
  const base = { noticePublished: false, enquiryOn: false, liveBookingPages: 0, dueAt: null };

  it("says nothing once the notice is published or when no public page is on", () => {
    expect(publicPagesWarning({ ...base, noticePublished: true, enquiryOn: true, liveBookingPages: 2 }, NOW, TZ)).toBeNull();
    expect(publicPagesWarning(base, NOW, TZ)).toBeNull();
  });

  it("gives an existing firm with booking on and no notice the date its pages stop, and says nothing is switched off before it", () => {
    const warning = publicPagesWarning({ ...base, liveBookingPages: 2, enquiryOn: true, dueAt: "2026-11-27T15:00:00Z" }, NOW, TZ);
    expect(warning).toMatchObject({ tone: "warn", title: "Publish your privacy notice by 27 Nov 2026" });
    expect(warning?.copy).toContain("Your booking pages are live without a privacy notice.");
    expect(warning?.copy).toContain("From 27 Nov 2026, they stop taking new bookings until you publish one; nothing is switched off before then");
    expect(warning?.copy).toContain("Your enquiry page also needs it");
    expect(publicPagesWarning({ ...base, liveBookingPages: 1, dueAt: "2026-11-27T15:00:00Z" }, NOW, TZ)?.copy).toMatch(/^Your booking page is live/);
  });

  it("says the booking pages are closed once the date has passed (or there was none)", () => {
    for (const dueAt of ["2026-10-27T15:00:00Z", null]) {
      const warning = publicPagesWarning({ ...base, liveBookingPages: 1, dueAt }, NOW, TZ);
      expect(warning).toMatchObject({ tone: "bad", title: "Your booking pages are closed until you publish a privacy notice" });
      expect(warning?.copy).toContain("publishing a notice reopens the pages straight away");
    }
  });

  it("says an enquiry page that is on isn't taking enquiries", () => {
    expect(publicPagesWarning({ ...base, enquiryOn: true }, NOW, TZ)).toMatchObject({ tone: "warn", title: "Your enquiry page isn’t taking enquiries" });
  });

  it("renders with the Designer's alert and a link to publish", () => {
    const warning = publicPagesWarning({ ...base, liveBookingPages: 1, dueAt: null }, NOW, TZ);
    if (!warning) throw new Error("expected a warning");
    const html = renderToStaticMarkup(createElement(PublicPagesAlert, { warning, link: true }));
    expect(html).toContain('<div class="alert bad" role="status">');
    expect(html).toContain('href="/sheet/settings?tab=portal"');
    expect(renderToStaticMarkup(createElement(PublicPagesAlert, { warning }))).not.toContain("tab=portal");
  });
});

describe("Settings > Client portal", () => {
  const published = policyCards(currentPolicies([row("2026-10-01T10:00:00Z")]), TZ);
  const none = policyCards(currentPolicies([]), TZ);
  const data = { firmName: "Maple Immigration", canPublish: true, contactMissing: false, publicHref: "/privacy/maple" };

  it("links the public notice and offers the owner Unpublish with a confirm dialog", () => {
    const html = renderToStaticMarkup(createElement(SheetPortalPolicies, { data: { ...data, cards: published, canUnpublish: true } }));
    expect(html).toContain('href="/privacy/maple"');
    expect(html).toContain('data-dlg="dlgPrivacyOff"');
    expect(html).toContain("your booking and enquiry pages link to it");
    expect(html).not.toMatch(/PIPEDA|Privacy Commissioner/);
    const dialog = renderToStaticMarkup(createElement(PortalPoliciesAfter, { dialogs: [], unpublishOrg: ORG }));
    expect(dialog).toContain('<dialog class="dlg" id="dlgPrivacyOff"');
    expect(dialog).toContain(`data-privacy-unpublish="1" data-org="${ORG}"`);
    expect(dialog).toContain("Turn off your enquiry page and unpublish your booking pages first");
  });

  it("offers no Unpublish to other roles or before a notice is published, and shows the banner", () => {
    expect(renderToStaticMarkup(createElement(SheetPortalPolicies, { data: { ...data, cards: published, canUnpublish: false } }))).not.toContain("dlgPrivacyOff");
    const warning = publicPagesWarning({ noticePublished: false, enquiryOn: true, liveBookingPages: 0, dueAt: null }, NOW, TZ);
    const html = renderToStaticMarkup(createElement(SheetPortalPolicies, { data: { ...data, cards: none, canUnpublish: true, publicPages: warning } }));
    expect(html).not.toContain("dlgPrivacyOff");
    expect(html).toContain("Not shown until published");
    expect(html).toContain("Your enquiry page isn’t taking enquiries");
    expect(renderToStaticMarkup(createElement(PortalPoliciesAfter, { dialogs: [] }))).toBe("");
  });
});

describe("the public booking page", () => {
  const raw = { event_type_id: "e1", title: "Initial consultation", duration_min: 30, firm_name: "Maple", firm_slug: "maple", firm_time_zone: TZ };

  it("links the firm's privacy notice in its footer when one is published", () => {
    const withNotice = parsePublicEvent({ ...raw, privacy_notice: true });
    const without = parsePublicEvent(raw);
    if (!withNotice || !without) throw new Error("expected an event");
    expect(bookPageBase(withNotice, TZ).footer).toEqual({ firm: "Maple", privacyHref: "/privacy/maple" });
    expect(bookPageBase(without, TZ).footer).toEqual({ firm: "Maple", privacyHref: null });
  });
});

describe("refusals and Unpublish", () => {
  beforeEach(() => {
    rpc.calls.length = 0;
    rpc.result = { data: null, error: null };
  });

  it("maps the database's notice-required refusals to words a person can act on", () => {
    expect(noticeRequiredError("publish a privacy notice before you turn on the enquiry page")).toBe("enquiry");
    expect(noticeRequiredError("publish a privacy notice before you publish a booking page")).toBe("booking");
    expect(noticeRequiredError("turn off the enquiry page and booking pages before you unpublish the privacy notice")).toBe("unpublish");
    expect(noticeRequiredError("something else")).toBeNull();
    expect(NOTICE_REQUIRED.booking).toContain("You can save this type unpublished.");
  });

  it("calls the database, sends a step-up refusal to the step-up screen, and never passes a database message through", async () => {
    expect(await unpublishPrivacyNotice({ organizationId: ORG })).toEqual({ ok: true });
    expect(rpc.calls).toEqual([{ name: "unpublish_privacy_notice", args: { p_organization_id: ORG } }]);
    rpc.result = { data: null, error: { message: "firm owner step-up is required" } };
    expect(await unpublishPrivacyNotice({ organizationId: ORG })).toMatchObject({ stepUp: true });
    rpc.result = { data: null, error: { message: "turn off the enquiry page and booking pages before you unpublish the privacy notice" } };
    expect(await unpublishPrivacyNotice({ organizationId: ORG })).toEqual({ error: NOTICE_REQUIRED.unpublish });
    rpc.result = { data: null, error: { message: "no privacy notice is published" } };
    expect(await unpublishPrivacyNotice({ organizationId: ORG })).toEqual({ error: "There’s no published privacy notice to unpublish." });
    expect(await unpublishPrivacyNotice({ organizationId: "nope" })).toEqual({ error: "Choose a firm." });
  });
});
