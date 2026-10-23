import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isBookingRef, readSigningView, signError } from "@/modules/scheduling/agreement-sign-present";
import { agreementLabel, recordAgreement, upcomingRows } from "@/modules/scheduling/sheet-present";

vi.mock("@/modules/scheduling/agreement-sign", () => ({ signBookingAgreement: vi.fn() }));
const { AgreementSign } = await import("@/components/sheet/agreement-sign");

const SHA = "a".repeat(64);
const raw = {
  state: "open",
  firm: "Northline Immigration",
  attendee: "Tomás Duarte",
  meeting: "Initial consultation",
  starts_at: "2026-10-27T14:30:00Z",
  time_zone: "America/Toronto",
  title: "C-02",
  version: 3,
  body: "The consultation is advice only.",
  sha256: SHA,
  consent_version: "esign-consent-2026-10-17",
  consent_text: "I agree to sign this document electronically.",
  signed_name: null,
  signed_at: null,
  sample: false,
};

describe("consultation agreement: the private link", () => {
  it("reads only a well-formed answer; anything else is unavailable", () => {
    expect(readSigningView(raw)).toMatchObject({ state: "open", firm: "Northline Immigration", version: 3, sha256: SHA });
    expect(readSigningView({ state: "unavailable" })).toEqual({ state: "unavailable" });
    expect(readSigningView({ ...raw, sha256: "short" })).toEqual({ state: "unavailable" });
    expect(readSigningView(null)).toEqual({ state: "unavailable" });
    expect(isBookingRef("abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isBookingRef("ABC")).toBe(false);
  });

  it("shows the locked text, its hash, the consent and Sign; signed shows the record instead", () => {
    const view = readSigningView(raw);
    if (view.state === "unavailable") throw new Error("unexpected");
    const open = renderToStaticMarkup(createElement(AgreementSign, { view, reference: "abcdefghijklmnopqrstuvwxyz" }));
    expect(open).toContain("The consultation is advice only.");
    expect(open).toContain(`Version 3 · SHA-256 ${SHA}`);
    expect(open).toContain("I agree to sign this document electronically.");
    expect(open).toContain('value="Tomás Duarte"');
    expect(open).toContain("Sign the agreement");
    // A live form: the Sheet's "This form isn’t connected yet" stub never fires on it.
    expect(open).toContain('data-live="1"');
    const signedView = readSigningView({ ...raw, state: "signed", signed_name: "Tomás Duarte", signed_at: "2026-10-23T15:00:00Z" });
    if (signedView.state === "unavailable") throw new Error("unexpected");
    const signed = renderToStaticMarkup(createElement(AgreementSign, { view: signedView, reference: "abcdefghijklmnopqrstuvwxyz" }));
    expect(signed).toContain("Signed by Tomás Duarte");
    expect(signed).not.toContain("Sign the agreement");
  });

  it("says each refusal plainly", () => {
    expect(signError("electronic signature consent is required")).toContain("Tick the box");
    expect(signError("the agreement changed; reload it before signing")).toContain("Reload");
    expect(signError("agreement not available")).toContain("isn’t available");
  });
});

describe("consultation agreement: staff screens", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const row = { booking_id: "b1", status: "sent", title: "C-02", template_version: 3, signed_name: null, signed_at: null };
  const base = {
    status: "confirmed",
    startsAt: "2026-10-27T14:30:00Z",
    now,
    zone: "America/Toronto",
    template: { id: "t1", name: "C-02", version: 3 },
    signLink: "https://app.example/consultation/abc/agreement",
    wire: { "data-org": "o1", "data-booking": "b1" },
  };

  it("labels the Upcoming column", () => {
    expect(agreementLabel(null)).toBe("—");
    expect(agreementLabel(row)).toBe("Sent, not signed");
    expect(agreementLabel({ ...row, status: "signed", signed_name: "Tomás Duarte", signed_at: "2026-10-24T10:00:00Z" })).toBe("C-02 v3 signed");
    const upcoming = upcomingRows(
      [{ id: "b1", title: "Initial consultation", startsAt: base.startsAt, endsAt: "2026-10-27T15:00:00Z", status: "confirmed", hostName: "Ana", locationKind: "video", version: 1, attendee: "Tomás Duarte", agreement: "Sent, not signed" }],
      base.zone,
      now,
    );
    expect(upcoming[0].agreement).toBe("Sent, not signed");
  });

  it("offers Send, then Copy signing link and Void, then the signed copy", () => {
    const none = recordAgreement({ ...base, row: null });
    expect(none.detail).toBe("None sent");
    expect(none.actions[0]).toMatchObject({ label: "Send consultation agreement", data: { "data-agreement-send-booking": "1", "data-template": "t1", "data-booking": "b1" } });

    const sent = recordAgreement({ ...base, row });
    expect(sent.detail).toBe("C-02 v3, sent, not signed");
    expect(sent.actions.map((a) => a.label)).toEqual(["Copy signing link", "Void"]);
    expect(sent.actions[0].data?.["data-copy"]).toBe(base.signLink);

    const signed = recordAgreement({ ...base, row: { ...row, status: "signed", signed_name: "Tomás Duarte", signed_at: "2026-10-24T10:00:00Z" } });
    expect(signed.detail).toMatch(/^C-02 v3, signed by Tomás Duarte on /);
    expect(signed.actions).toEqual([]);
    expect(signed.link).toEqual({ href: base.signLink, label: "Open the signed agreement" });
  });

  it("offers nothing to send for a past booking or without an approved template", () => {
    expect(recordAgreement({ ...base, row: null, startsAt: "2026-10-20T14:30:00Z" }).actions).toEqual([]);
    expect(recordAgreement({ ...base, row: null, status: "completed" }).actions).toEqual([]);
    expect(recordAgreement({ ...base, row: null, template: null })).toEqual({ detail: "None sent", actions: [], link: null });
  });
});

describe("consultation agreement: the email", () => {
  const ref = "abcdefghijklmnopqrstuvwxyz";
  it("links the attendee to the private signing page, not the portal", async () => {
    const { renderEmail } = await import("@/modules/email/templates");
    const mail = renderEmail({ template: "agreement", firm: "Northline Immigration", agreement_kind: "consultation", signing_ref: ref }, { origin: "https://app.casevoya.ca" });
    expect(mail.design).toBe("EM08");
    expect(mail.subject).toBe("An agreement from Northline Immigration is ready to sign");
    expect(mail.text).toContain("Review it and sign it before your consultation.");
    expect(mail.html).toContain(`https://app.casevoya.ca/consultation/${ref}/agreement`);
    expect(mail.html).not.toContain("/portal/agreements");
  });

  it("a malformed reference falls back to the portal wording and link", async () => {
    const { renderEmail } = await import("@/modules/email/templates");
    const mail = renderEmail({ template: "agreement", firm: "Northline Immigration", agreement_kind: "consultation", signing_ref: "../../evil" }, { origin: "https://app.casevoya.ca" });
    expect(mail.html).toContain("/portal/agreements");
    expect(mail.html).not.toContain("/consultation/");
  });
});
