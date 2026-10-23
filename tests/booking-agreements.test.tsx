import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isBookingRef, readSigningView, signError } from "@/modules/scheduling/agreement-sign-present";
import { agreementLabel, recordAgreement, upcomingRows } from "@/modules/scheduling/sheet-present";
import { BookingVoidDialog } from "@/components/sheet/designer/consultations";

vi.mock("@/modules/scheduling/agreement-sign", () => ({
  signBookingAgreement: vi.fn(),
  sendSigningCode: vi.fn(),
  verifySigningCode: vi.fn(),
  declineBookingAgreement: vi.fn(),
  noteSigningRequest: vi.fn(),
}));
const { AgreementSign, AgreementSignError, AgreementSignLoading } = await import("@/components/sheet/agreement-sign");

const SHA = "9f3b" + "0".repeat(56) + "41aa";
const REF = "abcdefghijklmnopqrstuvwxyz";
const raw = {
  state: "open",
  firm: "Northline Immigration",
  firm_slug: "northline",
  attendee: "Tomás Duarte",
  email_mask: "toma•••@example.com",
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

function open(overrides: Record<string, unknown> = {}) {
  const view = readSigningView({ ...raw, ...overrides });
  if (view.state === "unavailable") throw new Error("unexpected");
  return view;
}
const render = (props: Parameters<typeof AgreementSign>[0]) => renderToStaticMarkup(createElement(AgreementSign, props));

describe("consultation agreement: the private link", () => {
  it("reads only a well-formed answer; anything else is unavailable", () => {
    expect(readSigningView(raw)).toMatchObject({ state: "open", firm: "Northline Immigration", firmSlug: "northline", emailMask: "toma•••@example.com", version: 3, sha256: SHA });
    expect(readSigningView({ state: "unavailable" })).toEqual({ state: "unavailable" });
    expect(readSigningView({ ...raw, sha256: "short" })).toEqual({ state: "unavailable" });
    expect(readSigningView(null)).toEqual({ state: "unavailable" });
    expect(readSigningView({ state: "withdrawn", firm: "Northline Immigration" })).toEqual({ state: "withdrawn", firm: "Northline Immigration", firmSlug: null });
    expect(readSigningView({ state: "withdrawn" })).toEqual({ state: "unavailable" });
    expect(readSigningView({ state: "declined", firm: "Northline Immigration", decline_reason: "Wrong fee" })).toMatchObject({ state: "declined", reason: "Wrong fee" });
    expect(readSigningView({ state: "declined", firm: "Northline Immigration" })).toEqual({ state: "unavailable" });
    // A stored signature becomes an image only when it is a PNG or JPEG.
    expect(open({ state: "signed", signature_kind: "drawn", signature_image: "iVBORw0KGgo=" })).toMatchObject({ signatureImage: "data:image/png;base64,iVBORw0KGgo=" });
    expect(open({ state: "signed", signature_kind: "drawn", signature_image: "PHN2Zz4=" })).toMatchObject({ signatureImage: null });
    expect(isBookingRef(REF)).toBe(true);
    expect(isBookingRef("ABC")).toBe(false);
  });

  it("landing: the firm asked, the steps with the masked address, Review and sign, Decline; secured by Casevoya", () => {
    const html = render({ view: open(), reference: REF });
    expect(html).toContain("Hello Tomás");
    expect(html).toContain("Northline Immigration asked you to sign your consultation agreement");
    expect(html).toContain("Confirm it’s you with a code we email to toma•••@example.com");
    expect(html).toContain("Review and sign");
    expect(html).toContain("Decline to sign");
    expect(html).toContain("Not Tomás Duarte?");
    expect(html).toContain("Signing secured by Casevoya");
    expect(html).toContain("Every step is recorded with the time and the document’s fingerprint.");
    expect(html).not.toMatch(/DocuSign/i);
  });

  it("verify, review, sign and confirm: live forms, the code boxes, the text with its fingerprint, three ways to sign", () => {
    const verify = render({ view: open(), reference: REF, step: "verify" });
    expect(verify).toContain("Check it’s you");
    expect(verify).toContain('autoComplete="one-time-code"');
    expect(verify.match(/aria-label="Digit \d of 6"/g)).toHaveLength(6);
    expect(verify).toContain('data-live="1"');
    const review = render({ view: open(), reference: REF, step: "review" });
    expect(review).toContain("The consultation is advice only.");
    expect(review).toContain(SHA);
    expect(review).toContain("9f3b…41aa");
    expect(review).toContain("Sign here · required");
    const sign = render({ view: open(), reference: REF, step: "sign" });
    expect(sign).toContain("Add your signature");
    for (const label of ["Type", "Draw", "Upload"]) expect(sign).toContain(`>${label}</button>`);
    expect(sign).toContain("I agree to sign this document electronically.");
    expect(sign).toContain('data-live="1"');
    const confirm = render({ view: open(), reference: REF, step: "confirm", mark: { kind: "typed", name: "Tomás Duarte", image: null, preview: null } });
    expect(confirm).toContain("Sign the document?");
    expect(confirm).toContain("You’re signing “C-02” as Tomás Duarte.");
    expect(confirm).toContain("Sign now");
  });

  it("end states: already signed shows the mark; declined, withdrawn and the dead link show no text or hash", () => {
    const signed = render({ view: open({ state: "signed", signed_name: "Tomás Duarte", signed_at: "2026-10-23T15:00:00Z", signature_kind: "typed" }), reference: REF });
    expect(signed).toContain("You’ve already signed this");
    expect(signed).toContain("Tomás Duarte");
    expect(signed).not.toContain("Review and sign");
    const declined = readSigningView({ state: "declined", firm: "Northline Immigration", decline_reason: "The fee is wrong.", attendee: "Tomás Duarte" });
    if (declined.state !== "declined") throw new Error("unexpected");
    const declinedHtml = render({ view: declined, reference: REF });
    expect(declinedHtml).toContain("You declined to sign");
    expect(declinedHtml).toContain("“The fee is wrong.”");
    expect(declinedHtml).toContain("Message Northline Immigration");
    const withdrawn = render({ view: { state: "withdrawn", firm: "Northline Immigration", firmSlug: null }, reference: REF });
    expect(withdrawn).toContain("This agreement was withdrawn.");
    expect(withdrawn).toContain("Northline Immigration withdrew this agreement. Nothing was signed.");
    const closed = render({ view: open({ state: "closed" }), reference: REF });
    expect(closed).toContain("This signing link no longer works.");
    expect(closed).toContain("Ask for a new link");
    for (const html of [declinedHtml, withdrawn]) expect(html).not.toContain(SHA);
    const error = renderToStaticMarkup(createElement(AgreementSignError, { firm: null }));
    expect(error).toContain("We couldn’t open this document");
    expect(error).toContain("Try again");
    const loading = renderToStaticMarkup(createElement(AgreementSignLoading));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Opening the document…");
  });

  it("says each refusal plainly", () => {
    expect(signError("electronic signature consent is required")).toContain("Tick the box");
    expect(signError("the agreement changed; reload it before signing")).toContain("Reload");
    expect(signError("agreement not available")).toContain("isn’t available");
    expect(signError("confirm it's you with the emailed code before signing")).toContain("emailed code");
    expect(signError("the signature image must be a PNG or JPEG")).toContain("PNG or JPEG");
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

describe("consultation agreement: declined on the record, and the client's requests", () => {
  const base = {
    status: "confirmed",
    startsAt: "2026-10-27T14:30:00Z",
    now: Date.parse("2026-10-23T12:00:00Z"),
    zone: "America/Toronto",
    template: { id: "t1", name: "C-02", version: 3 },
    signLink: "https://app.example/consultation/abc/agreement",
    wire: { "data-org": "o1", "data-booking": "b1" },
    client: "Tomás",
    recipient: "tomas@example.test",
    voidedBy: null,
  };
  const row = { booking_id: "b1", status: "declined", title: "C-02", template_version: 3, signed_name: null, signed_at: null, sent_at: "2026-10-21T19:00:00Z" };

  it("Declined is not None sent: the chip, when, their reason, the note and Send again", () => {
    const panel = recordAgreement({ ...base, row: { ...row, declined_at: "2026-10-22T13:00:00Z", decline_reason: "The fee is wrong." } });
    expect(panel.chip).toEqual({ tone: "bad", label: "Declined" });
    expect(panel.items[0]).toEqual({ term: "Agreement", value: "C-02 v3", struck: "sent 21 Oct" });
    expect(panel.items.find((i) => i.term === "Their reason")?.value).toBe("The fee is wrong.");
    expect(panel.note).toMatch(/^Tomás declined to sign/);
    expect(panel.actions.map((a) => [a.label, a.tone])).toEqual([["Send consultation agreement", "primary"]]);
    expect(agreementLabel({ ...row })).toBe("Declined");
  });

  it("shows what the client asked for from the link", () => {
    const panel = recordAgreement({ ...base, row: { ...row, status: "sent", last_request_kind: "code_help", last_request_at: "2026-10-22T13:00:00Z" } });
    expect(panel.items.find((i) => i.term === "Client asked")?.value).toMatch(/^To check their email address, /);
  });
});

describe("consultation agreement: the signing code email (EX16)", () => {
  it("carries the code only after the worker opened it; the subject never has it", async () => {
    const { renderEmail } = await import("@/modules/email/templates");
    const mail = renderEmail({ template: "signing_code", firm: "Northline Immigration", code: "482913" }, { origin: "https://app.casevoya.ca" });
    expect(mail.design).toBe("EX16");
    expect(mail.subject).toBe("Your signing code from Northline Immigration");
    expect(mail.subject).not.toContain("482913");
    expect(mail.preheader).not.toContain("482913");
    expect(mail.text).toContain("482913");
    expect(mail.text).toContain("It works for 10 minutes.");
    const missing = renderEmail({ template: "signing_code", firm: "Northline Immigration", code: "12ab56" }, { origin: "https://app.casevoya.ca" });
    expect(missing.text).toContain("ask for a new code");
  });

  it("seals a code to its id: it opens for that id only, and never for a tampered value", async () => {
    const { openSigningCode, sealSigningCode } = await import("@/modules/email/invite-link-seal");
    const secret = "s".repeat(32);
    const sealed = await sealSigningCode(secret, "482913", "11111111-1111-4111-8111-111111111111");
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain("482913");
    expect(await openSigningCode(secret, sealed!, "11111111-1111-4111-8111-111111111111")).toBe("482913");
    expect(await openSigningCode(secret, sealed!, "22222222-2222-4222-8222-222222222222")).toBeNull();
    expect(await openSigningCode("t".repeat(32), sealed!, "11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(await sealSigningCode(secret, "12345", "11111111-1111-4111-8111-111111111111")).toBeNull();
  });
});
