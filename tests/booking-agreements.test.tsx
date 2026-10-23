import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isBookingRef, readSigningView, signError } from "@/modules/scheduling/agreement-sign-present";
import { agreementLabel, recordAgreement, upcomingRows } from "@/modules/scheduling/sheet-present";
import { BookingVoidDialog } from "@/components/sheet/designer/consultations";

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
    expect(readSigningView({ state: "withdrawn", firm: "Northline Immigration" })).toEqual({ state: "withdrawn", firm: "Northline Immigration" });
    expect(readSigningView({ state: "withdrawn" })).toEqual({ state: "unavailable" });
    expect(isBookingRef("abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isBookingRef("ABC")).toBe(false);
  });

  it("shows the locked text, its hash, the consent and Sign; signed shows the record instead", () => {
    const view = readSigningView(raw);
    if (view.state === "unavailable" || view.state === "withdrawn") throw new Error("unexpected");
    const open = renderToStaticMarkup(createElement(AgreementSign, { view, reference: "abcdefghijklmnopqrstuvwxyz" }));
    expect(open).toContain("The consultation is advice only.");
    expect(open).toContain(`Version 3 · SHA-256 ${SHA}`);
    expect(open).toContain("I agree to sign this document electronically.");
    expect(open).toContain('value="Tomás Duarte"');
    expect(open).toContain("Sign the agreement");
    // A live form: the Sheet's "This form isn’t connected yet" stub never fires on it.
    expect(open).toContain('data-live="1"');
    const signedView = readSigningView({ ...raw, state: "signed", signed_name: "Tomás Duarte", signed_at: "2026-10-23T15:00:00Z" });
    if (signedView.state === "unavailable" || signedView.state === "withdrawn") throw new Error("unexpected");
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
    client: "Tomás",
    recipient: "tomas@example.test",
    voidedBy: null as string | null,
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

  it("Sent, not signed: sent to whom, first opened, the private-link note, Copy, Remind and Void", () => {
    const sent = recordAgreement({ ...base, row: { ...row, sent_at: "2026-10-23T14:00:00Z", opened_at: null } });
    expect(sent.chip).toEqual({ tone: "rev", label: "Sent, not signed" });
    expect(sent.items.map((item) => item.term)).toEqual(["Agreement", "Sent", "Opened", "Fee"]);
    expect(sent.items[1].value).toMatch(/to tomas@example\.test$/);
    expect(sent.items[2].value).toBe("Not yet");
    expect(sent.note).toBe("The link is private to Tomás and works until they sign or you void it. Voiding keeps it on record.");
    expect(sent.actions.map((a) => a.label)).toEqual(["Copy signing link", "Remind", "Void"]);
    expect(sent.actions[0].data?.["data-copy"]).toBe(base.signLink);
    expect(sent.actions[1].data).toMatchObject({ "data-agreement-remind-booking": "1", "data-booking": "b1" });
    expect(sent.actions[2]).toMatchObject({ dlg: "dlgBkVoid", tone: "danger" });
    const opened = recordAgreement({ ...base, row: { ...row, sent_at: "2026-10-23T14:00:00Z", opened_at: "2026-10-23T15:00:00Z" } });
    expect(opened.items[2].value).not.toBe("Not yet");
  });

  it("Signed: who and when, and the signed copy; Voided: the struck send, who, why, and Send again", () => {
    const signed = recordAgreement({ ...base, row: { ...row, status: "signed", signed_name: "Tomás Duarte", signed_at: "2026-10-24T10:00:00Z" } });
    expect(signed.chip?.label).toBe("Signed");
    expect(signed.items[1].value).toMatch(/^Tomás Duarte, /);
    expect(signed.actions).toEqual([]);
    expect(signed.link).toEqual({ href: base.signLink, label: "Open the signed agreement" });

    const voided = recordAgreement({
      ...base,
      voidedBy: "Sam Host",
      row: { ...row, status: "voided", sent_at: "2026-10-23T14:00:00Z", voided_at: "2026-10-23T16:00:00Z", void_reason: "Wrong template sent" },
    });
    expect(voided.chip).toEqual({ tone: "bad", label: "Voided" });
    expect(voided.items[0]).toEqual({ term: "Agreement", value: "C-02 v3", struck: "sent 23 Oct" });
    expect(voided.items.find((i) => i.term === "Voided")?.value).toMatch(/ by Sam Host$/);
    expect(voided.items.find((i) => i.term === "Reason")?.value).toBe("Wrong template sent");
    expect(voided.note).toBe("The old link now tells Tomás this agreement was withdrawn. Send a fresh one when you’re ready.");
    expect(voided.actions.map((a) => [a.label, a.tone])).toEqual([["Send consultation agreement", "primary"]]);
    // Who voided it is unknown: "A staff member".
    const unknown = recordAgreement({ ...base, row: { ...row, status: "voided", voided_at: "2026-10-23T16:00:00Z" } });
    expect(unknown.items.find((i) => i.term === "Voided")?.value).toMatch(/ by A staff member$/);
    expect(agreementLabel({ ...row, status: "voided" })).toBe("Voided");
  });

  it("None: Send for an upcoming booking with an approved template; nothing otherwise", () => {
    const none = recordAgreement({ ...base, row: null });
    expect(none.items).toEqual([{ term: "Agreement", value: "None sent" }, { term: "Fee", value: "No fee" }]);
    expect(none.actions[0]).toMatchObject({ label: "Send consultation agreement", data: { "data-agreement-send-booking": "1", "data-template": "t1" } });
    expect(recordAgreement({ ...base, row: null, startsAt: "2026-10-20T14:30:00Z" }).actions).toEqual([]);
    expect(recordAgreement({ ...base, row: null, status: "completed" }).actions).toEqual([]);
    expect(recordAgreement({ ...base, row: null, template: null }).actions).toEqual([]);
  });

  it("the Void dialog asks for a reason, with Keep it and Void agreement", () => {
    const html = renderToStaticMarkup(createElement(BookingVoidDialog, { data: { organizationId: "o1", bookingId: "b1", client: "Tomás Duarte" } }));
    expect(html).toContain("Void this agreement?");
    expect(html).toContain("Tomás Duarte’s signing link stops working straight away.");
    expect(html).toContain("Reason (staff only)");
    expect(html).toContain('placeholder="e.g. Wrong template sent"');
    expect(html).toContain("Say why this agreement is voided. It stays on the record.");
    expect(html).toContain('id="bvR"');
    expect(html).toContain("Keep it");
    expect(html).toMatch(/data-agreement-void-booking="1"[^>]*data-booking="b1"|data-booking="b1"[^>]*data-agreement-void-booking="1"/);
    expect(html).toContain("Void agreement");
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
