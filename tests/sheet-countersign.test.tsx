import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountersignDialog, SheetAgreements } from "@/components/sheet/designer/agreements";
import { MatterAgreements } from "@/components/sheet/designer/matter";
import { dispatchOutbound, type DispatchDeps } from "@/modules/email/dispatch";
import { renderEmail } from "@/modules/email/templates";
import {
  agreementStaffError,
  agreementStepUpLocation,
  COUNTERSIGN_BADGE,
  COUNTERSIGN_DIALOG,
  countersignDialogData,
  countersignDialogId,
  countersignerFor,
  countersignHref,
  countersignTarget,
  countersignTurn,
  DEFAULT_ESIGN_CONSENT,
  esignConsent,
  firmCountersigns,
  needsStepUp,
  readCountersign,
  signersFor,
} from "@/modules/sheet/agreements-present";

const ENVELOPE = "55555555-5555-4555-8555-555555555555";
const ORG = "33333333-3333-4333-8333-333333333333";
const CONSENT = { text: "I agree to sign this document electronically.", version: "esign-consent-2026-10-17" };

describe("countersign signing order", () => {
  const names = new Map([
    ["p1", "Dana Lee"],
    ["p2", "Sam Lee"],
  ]);
  const parties = [
    { person_id: "p2", role: "sponsor" },
    { person_id: "p1", role: "applicant" },
  ];

  it("puts the clients first and the responsible consultant last", () => {
    expect(signersFor(parties, names, { membershipId: "m1", name: "Ada Consultant" })).toEqual([
      { role: "client", person_id: "p1", display_name: "Dana Lee" },
      { role: "sponsor", person_id: "p2", display_name: "Sam Lee" },
      { role: "consultant", membership_id: "m1", display_name: "Ada Consultant" },
    ]);
    // Without a countersigner the order is unchanged; without an applicant nobody is asked.
    expect(signersFor(parties, names).map((signer) => signer.role)).toEqual(["client", "sponsor"]);
    expect(signersFor([{ person_id: "p2", role: "sponsor" }], names, { membershipId: "m1", name: "Ada" })).toEqual([]);
    expect(signersFor(parties, names, { membershipId: "m1", name: "  " }).at(-1)).toMatchObject({ display_name: "Consultant" });
  });

  it("countersigns service and consultation agreements, with a licensed responsible consultant only", () => {
    expect(firmCountersigns("service")).toBe(true);
    expect(firmCountersigns("consultation")).toBe(true);
    expect(firmCountersigns("consent")).toBe(false);
    expect(countersignerFor("consent", null)).toBeNull();
    expect(countersignerFor("service", { membershipId: "m1", licensed: true, name: "Ada" })).toEqual({ membershipId: "m1", name: "Ada" });
    expect(countersignerFor("service", { membershipId: "m1", licensed: true, name: null })).toEqual({ membershipId: "m1", name: "Consultant" });
    expect(countersignerFor("service", null)).toEqual({ error: expect.stringMatching(/no responsible consultant/) });
    expect(countersignerFor("service", { membershipId: null, licensed: false, name: null })).toEqual({ error: expect.stringMatching(/no responsible consultant/) });
    expect(countersignerFor("consultation", { membershipId: "m1", licensed: false, name: "Cal" })).toEqual({ error: expect.stringMatching(/isn’t licensed/) });
  });
});

describe("countersign turn and dialog", () => {
  it("is the staff member's turn only when they are the current signer", () => {
    const rows = [
      { envelope_id: ENVELOPE, membership_id: null, status: "signed" },
      { envelope_id: ENVELOPE, membership_id: "m1", status: "current" },
      { envelope_id: "other", membership_id: "m2", status: "current" },
    ];
    expect(countersignTurn(rows, ENVELOPE, "m1")).toBe(true);
    expect(countersignTurn(rows, ENVELOPE, "m2")).toBe(false);
    expect(countersignTurn([{ envelope_id: ENVELOPE, membership_id: "m1", status: "waiting" }], ENVELOPE, "m1")).toBe(false);
    expect(COUNTERSIGN_BADGE).toEqual({ tone: "blue", label: "Countersign", detail: "your turn" });
  });

  it("reopens the envelope's dialog from ?dlg=countersign&envelope=, after a step-up too", () => {
    expect(countersignDialogId(ENVELOPE)).toBe(`dlgSign-${ENVELOPE}`);
    expect(countersignHref(ENVELOPE)).toBe(`/sheet/agreements?dlg=countersign&envelope=${ENVELOPE}`);
    expect(countersignTarget(`?dlg=countersign&envelope=${ENVELOPE}`)).toBe(ENVELOPE);
    expect(countersignTarget(`?dlg=agreement&envelope=${ENVELOPE}`)).toBeNull();
    expect(countersignTarget("?dlg=countersign&envelope=nope")).toBeNull();
    const location = agreementStepUpLocation("/sheet/matters/m", "?tab=agreements", COUNTERSIGN_DIALOG, { envelope: ENVELOPE });
    expect(location).toBe(`/mfa?step=6&next=${encodeURIComponent(`/sheet/matters/m?tab=agreements&dlg=countersign&envelope=${ENVELOPE}`)}`);
  });

  it("needs the consent box and a real envelope before anything is sent", () => {
    expect(readCountersign({ envelopeId: ENVELOPE, consent: true })).toEqual({ input: { envelopeId: ENVELOPE } });
    expect(readCountersign({ envelopeId: ENVELOPE, consent: false })).toEqual({ error: "Confirm that you agree to sign electronically." });
    expect(readCountersign({ envelopeId: "x", consent: true })).toEqual({ error: "Choose the agreement to sign." });
  });

  it("shows the portal's consent text and version", () => {
    expect(esignConsent({ version: "v2", text: "Custom consent." })).toEqual({ version: "v2", text: "Custom consent." });
    expect(esignConsent(null)).toEqual({ version: "esign-consent-2026-10-17", text: DEFAULT_ESIGN_CONSENT });
  });

  it("maps refusals to short copy, and a step-up refusal to the step-up round trip", () => {
    expect(agreementStaffError("the consultant signer must be licensed")).toMatch(/licensed consultant countersigns/);
    expect(agreementStaffError("signer identity does not match")).toBe("This signature is waiting for someone else.");
    expect(agreementStaffError("it is not your turn to sign")).toBe("Someone else signs before you.");
    expect(agreementStaffError("electronic signature consent is required")).toBe("Confirm that you agree to sign electronically.");
    expect(agreementStaffError("this envelope is no longer open")).toBe("This agreement is no longer open for signature.");
    expect(needsStepUp(agreementStaffError("step-up is required"))).toBe(true);
    expect(agreementStaffError("raw database text 0xdeadbeef")).not.toContain("0xdeadbeef");
  });

  it("renders the Designer's confirm-dialog anatomy with the consent checkbox and the sign button", () => {
    const data = countersignDialogData({
      organizationId: ORG,
      envelopeId: ENVELOPE,
      title: "Service agreement",
      versionNumber: 2,
      client: "Dana Lee",
      matter: "CV-2026-0001",
      contentSha: "a".repeat(60) + "1234",
      signed: 2,
      total: 3,
      consent: CONSENT,
    });
    expect(data.facts).toEqual([
      { label: "Client", value: "Dana Lee" },
      { label: "Matter", value: "CV-2026-0001" },
      { label: "Document", value: "Service agreement v2" },
      { label: "Hash", value: "aaaa…1234 (SHA-256)" },
      { label: "Signed so far", value: "2 of 3" },
    ]);
    const html = renderToStaticMarkup(createElement(CountersignDialog, { data }));
    expect(html).toContain(`<dialog class="dlg" id="dlgSign-${ENVELOPE}" aria-labelledby="dlgSign-${ENVELOPE}H" data-sign-envelope="${ENVELOPE}">`);
    expect(html).toContain('<div class="dh"><h2');
    expect(html).toContain('<dl class="fp-dl"><div><dt>Client</dt><dd>Dana Lee</dd></div>');
    expect(html).toContain(`<label class="check" style="margin-top:12px"><input type="checkbox" id="dlgSign-${ENVELOPE}-ok" data-consent="esign-consent-2026-10-17"/><span>${CONSENT.text}<small>Consent esign-consent-2026-10-17</small></span></label>`);
    expect(html).toContain(`<button class="btn p" data-countersign="${ENVELOPE}" data-org="${ORG}">Sign for the firm</button>`);
    expect(html).toContain(`data-close="dlgSign-${ENVELOPE}"`);
  });

  it("puts the Countersign action on the agreement row and the matter's Agreements tab", () => {
    const row = {
      key: "a1",
      flags: ["waiting"],
      client: { name: "Dana Lee" },
      matter: "CV-2026-0001",
      record: { href: "/sheet/matters/m?tab=agreements", left: "Service agreement", right: "v1" },
      state: COUNTERSIGN_BADGE,
      signed: "2 of 3",
      date: "Expires 30 Oct",
      action: { label: "Countersign", dialog: countersignDialogId(ENVELOPE) },
    };
    const list = renderToStaticMarkup(createElement(SheetAgreements, { data: { kpis: [], rows: [row], empty: null } }));
    expect(list).toContain(`<span class="bd blue"><i></i><span>Countersign <span class="sep" aria-hidden="true"></span> your turn</span></span> <button class="btn s sm" data-dlg="dlgSign-${ENVELOPE}">Countersign</button>`);
    const matter = renderToStaticMarkup(
      createElement(MatterAgreements, {
        rows: [
          {
            title: "Service agreement",
            version: ["v1"],
            parties: "Dana, Sam, Ada",
            signatures: "2 of 3",
            state: COUNTERSIGN_BADGE,
            href: countersignHref(ENVELOPE),
            action: "Countersign",
            dialog: countersignDialogId(ENVELOPE),
          },
        ],
        signing: null,
      }),
    );
    expect(matter).toContain(`<a class="btn s sm" href="/sheet/agreements?dlg=countersign&amp;envelope=${ENVELOPE}" data-dlg="dlgSign-${ENVELOPE}">Countersign</a>`);
  });
});

describe("the consultant's turn email", () => {
  it("is the staff copy of the agreement email, linking to the Sheet's Agreements page", () => {
    const staff = renderEmail({ template: "agreement", firm: "Northline", audience: "staff", link: "https://app.casevoya.ca/sheet/agreements" });
    expect(staff.subject).toBe("Your countersignature is needed — Northline");
    expect(staff.text).toContain("It is your turn to countersign it for the firm.");
    expect(staff.html).toContain('<a href="https://app.casevoya.ca/sheet/agreements">');
    expect(staff.text).not.toContain("portal");
    const client = renderEmail({ template: "agreement", firm: "Northline" });
    expect(client.text).toContain("in the portal");
    expect(client.html).not.toContain("<a ");
  });

  it("gets its link from the worker's app origin, never from the database", async () => {
    const sent: { to: string; text: string }[] = [];
    const deps: DispatchDeps = {
      claim: async () => [{ id: "event-1" }],
      prepare: async () => ({
        action: "send",
        messages: [
          {
            delivery_id: "d-staff",
            to: "ada@example.test",
            from_address: "notices@casevoya.ca",
            from_name: "Northline",
            reply_to_address: "northline@docs.casevoya.ca",
            reply_to_name: "Northline",
            template: "agreement",
            context: { firm: "Northline", template: "agreement", audience: "staff", link: "https://evil.example/phish" },
          },
          {
            delivery_id: "d-client",
            to: "dana@example.test",
            from_address: "notices@casevoya.ca",
            from_name: "Northline",
            reply_to_address: "northline@docs.casevoya.ca",
            reply_to_name: "Northline",
            template: "agreement",
            context: { firm: "Northline", template: "agreement", link: "https://evil.example/phish" },
          },
        ],
      }),
      send: async (message) => {
        sent.push({ to: message.to, text: message.text });
        return { ok: true, messageId: "m", delivered: [message.to], queued: [], permanentBounces: [], suppressed: [] };
      },
      finish: async () => {},
    };
    await dispatchOutbound(deps, {
      worker: "test",
      limit: 10,
      inboundDomain: "docs.casevoya.ca",
      fromAddress: "notices@casevoya.ca",
      appOrigin: "https://app.casevoya.ca",
    });
    expect(sent[0].text).toContain("https://app.casevoya.ca/sheet/agreements");
    expect(sent.map((item) => item.text).join(" ")).not.toContain("evil.example");
    expect(sent[1].text).not.toContain("https://");
  });
});
