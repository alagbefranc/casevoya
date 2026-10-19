import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgreementsHeader, NewAgreementDialog, SheetAgreements } from "@/components/sheet/designer/agreements";
import { AuthorityDialog, SheetAgreementEnvelope, SheetAgreementsAuthority, SheetAgreementsPending } from "@/components/sheet/designer/agreements-live";
import { SheetDocuments } from "@/components/sheet/designer/documents";
import { SheetFinance } from "@/components/sheet/designer/finance";
import { ComposeDialog, SheetInbox } from "@/components/sheet/designer/inbox";
import { conversationHidden } from "@/components/sheet/records-acts";
import {
  agreementEnvelopeHref,
  agreementPdfHref,
  agreementsTab,
  authorityBadge,
  authorityError,
  authorityStillNeeded,
  readAuthority,
  readVoid,
  sentAgreementToast,
} from "@/modules/sheet/agreements-present";
import { cardOpenable, requestAnswered } from "@/modules/sheet/documents-present";
import { balanceLine, billedTo, cardReceived } from "@/modules/sheet/finance-present";
import { creditable, reconHistoryTitle } from "@/modules/finance/corrections-present";
import { invoiceRows, type InvoicePdf } from "@/modules/finance/invoice-pdf";
import { deliveryProblemsPill, DELIVERY_PROBLEM_STATUSES } from "@/modules/sheet/inbox-present";
import { canEmail, conversationChannels, messageMail, messageSendAttrs, messageSentToast, noteAttrs } from "@/modules/sheet/inbox-reply-present";
import { matterLabel, notificationGroups, SYSTEM_KINDS, unreadCount, type NotificationItem } from "@/modules/sheet/notifications-present";
import { draftsPage, draftStale, effectiveSettings, humaniseStages, type VoDraftRow, type VoReadingRow } from "@/modules/sheet/vo-present";

const ORG = "33333333-3333-4333-8333-333333333333";
const MATTER = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const ENVELOPE = "44444444-4444-4444-8444-444444444444";
const SAMPLE_PEOPLE = /Northline|Amara|Priya|Kofi|Tomás|Hamid|Ana Ferreira|NL-2026|S-05|Q-0044/;

describe("Agreements: every tab is the firm's own", () => {
  it("reads the tab, and links an agreement's own view and its signed copies", () => {
    expect(agreementsTab("authority")).toBe("authority");
    expect(agreementsTab("nope")).toBe("list");
    expect(agreementsTab(undefined)).toBe("list");
    expect(agreementEnvelopeHref(MATTER)).toBe(`/sheet/agreements?tab=envelope&view=${MATTER}`);
    expect(agreementPdfHref(ENVELOPE, ORG, "executed")).toBe(`/api/agreements/${ENVELOPE}/pdf?organizationId=${ORG}`);
    expect(agreementPdfHref(ENVELOPE, ORG, "certificate")).toContain("which=certificate");
  });

  it("never tells a sample client's sender that someone is emailed", () => {
    expect(sentAgreementToast(true).sub).toMatch(/nobody is emailed/);
    expect(sentAgreementToast(true).sub).not.toMatch(/They get an email/);
    expect(sentAgreementToast(false).sub).toMatch(/email/);
  });

  it("checks the authority and void dialogs before the database does", () => {
    expect(readAuthority({ client: `${MATTER}:${PERSON}`, scope: "Spousal sponsorship", evidence: "IMM 5476 on the matter", effective: "2026-10-19" })).toEqual({
      input: { matterId: MATTER, personId: PERSON, scope: "Spousal sponsorship", evidence: "IMM 5476 on the matter", effectiveOn: "2026-10-19" },
    });
    expect(readAuthority({ client: "x", scope: "abc", evidence: "e", effective: "2026-10-19" })).toEqual({ error: "Choose the client." });
    expect("error" in readAuthority({ client: `${MATTER}:${PERSON}`, scope: "ab", evidence: "e", effective: "2026-10-19" })).toBe(true);
    expect("error" in readAuthority({ client: `${MATTER}:${PERSON}`, scope: "abc", evidence: "", effective: "2026-10-19" })).toBe(true);
    expect("error" in readAuthority({ client: `${MATTER}:${PERSON}`, scope: "abc", evidence: "e", effective: "19/10/2026" })).toBe(true);
    expect(readVoid({ envelopeId: ENVELOPE, reason: "Fee changed" })).toEqual({ input: { envelopeId: ENVELOPE, reason: "Fee changed" } });
    expect("error" in readVoid({ envelopeId: ENVELOPE, reason: "" })).toBe(true);
    expect(authorityError("staff access denied")).toMatch(/firm owner or a licensed consultant/);
  });

  it("states authority as recorded: on file, not yet in effect, revoked, needed before submission", () => {
    expect(authorityBadge({ effective_on: "2026-10-01", revoked_at: null }, "2026-10-19")).toEqual({ tone: "ok", label: "On file" });
    expect(authorityBadge({ effective_on: "2026-11-01", revoked_at: null }, "2026-10-19").detail).toBe("not in effect yet");
    expect(authorityBadge({ effective_on: "2026-10-01", revoked_at: "2026-10-10T00:00:00Z" }, "2026-10-19").label).toBe("Revoked");
    expect(authorityStillNeeded("preparation")).toBe(true);
    expect(authorityStillNeeded("submitted")).toBe(false);
  });

  it("marks the open tab in the Designer's tab strip", () => {
    const html = renderToStaticMarkup(createElement(AgreementsHeader, { data: { records: 0, waiting: 0, create: "New agreement", tab: "authority" } }));
    expect(html).toContain('<button role="tab" data-t="authority" class="on">Representation authority</button>');
    expect(html).toContain('<i class="ul" style="left:560px;width:143px"></i>');
    expect(html).not.toContain('data-t="list" class="on"');
  });

  it("renders Representation authority from the firm's rows, and Record authority saves to the database", () => {
    const page = renderToStaticMarkup(
      createElement(SheetAgreementsAuthority, {
        data: {
          rows: [{ key: "a", client: { name: "Dana Lee" }, scope: "Study permit, CV-2026-0001", evidence: "IMM 5476", effective: "19 Oct 2026", state: { tone: "ok", label: "On file" } }],
          empty: null,
          record: { disabled: false, why: null },
        },
      }),
    );
    expect(page).toContain("Dana Lee");
    expect(page).toContain('data-dlg="dlgAuth"');
    expect(page).not.toMatch(SAMPLE_PEOPLE);
    const blocked = renderToStaticMarkup(createElement(SheetAgreementsAuthority, { data: { rows: [], empty: { title: "No representation authority yet", copy: "Record it." }, record: { disabled: true, why: "Only the firm owner" } } }));
    expect(blocked).toContain("disabled");
    expect(blocked).toContain('title="Only the firm owner"');
    expect(blocked).toContain('class="emp"');
    const dialog = renderToStaticMarkup(createElement(AuthorityDialog, { data: { organizationId: ORG, clients: [{ value: `${MATTER}:${PERSON}`, label: "Dana Lee · CV-2026-0001" }], today: "2026-10-19", blocked: null } }));
    expect(dialog).toContain(`data-authority-save="1" data-org="${ORG}"`);
    expect(dialog).not.toContain("data-toast");
    expect(dialog).not.toMatch(SAMPLE_PEOPLE);
  });

  it("shows one agreement's envelope with real download links, and honest panels for unbuilt tabs", () => {
    const html = renderToStaticMarkup(
      createElement(SheetAgreementEnvelope, {
        data: {
          title: "Service agreement v1 (Dana Lee)",
          intro: "Service agreement on CV-2026-0001. Executed.",
          signers: { badge: { tone: "ok", label: "Executed" }, steps: [{ state: "done", name: "Dana Lee", note: ["Signed 18 Oct 10:02", "in-house e-signature"] }], empty: null },
          events: [{ key: "e", when: "18 Oct 10:02", event: ["Dana Lee signed"], id: "abcd1234" }],
          integrity: [{ term: "Hash", value: "9f3b…41aa (SHA-256)" }],
          actions: [{ label: "Download signed PDF", primary: true, href: agreementPdfHref(ENVELOPE, ORG, "executed") }],
          note: "The executed original can’t be edited.",
        },
      }),
    );
    expect(html).toContain(`href="/api/agreements/${ENVELOPE}/pdf?organizationId=${ORG}"`);
    expect(html).toContain('<ol class="fp-steps"><li class="done">');
    expect(html).not.toMatch(SAMPLE_PEOPLE);
    const pending = renderToStaticMarkup(createElement(SheetAgreementsPending, { data: { title: "Quote builder", intro: "Quotes.", empty: { title: "The quote builder isn’t built yet", copy: "Not yet." }, action: null } }));
    expect(pending).toContain("isn’t built yet");
    expect(pending).not.toMatch(SAMPLE_PEOPLE);
  });

  it("offers Save as draft beside Create and send, and a hidden Nothing matches panel for the chips", () => {
    const dialog = renderToStaticMarkup(
      createElement(NewAgreementDialog, {
        data: {
          title: "New agreement",
          matterLabel: "Matter",
          templateLabel: "Approved template",
          matters: [{ value: MATTER, left: "Dana Lee" }],
          templates: [{ value: PERSON, left: "Service" }],
          submit: "Create and send",
          live: { organizationId: ORG, sampleMode: false, currencies: ["CAD"], defaults: { fee: "", currency: "CAD", exclusions: "", refund: "", government: "" }, blocked: null },
        },
      }),
    );
    expect(dialog).toContain(`data-new-agreement="draft" data-org="${ORG}"`);
    expect(dialog).toContain(`data-new-agreement="1" data-org="${ORG}"`);
    const list = renderToStaticMarkup(createElement(SheetAgreements, { data: { kpis: [], rows: [], empty: null, filterEmpty: true } }));
    expect(list).toContain('<div class="fp-fe rv" hidden=""');
    expect(list).not.toContain("AGR-04");
  });
});

describe("Inbox: every client conversation", () => {
  it("names a conversation's channels, and shows portal and WhatsApp messages in the thread", () => {
    expect(conversationChannels(["email", "portal", "portal"])).toEqual(["portal", "email"]);
    expect(conversationChannels(["whatsapp"])).toEqual(["whatsapp"]);
    expect(messageMail({ author: "Dana Lee", when: "18 Oct 09:12", body: " Here is my passport. ", channel: "portal", ack: false })).toEqual({
      meta: ["Dana", "18 Oct 09:12", "via portal"],
      body: "Here is my passport.",
      files: null,
    });
    expect(messageMail({ author: "Sam", when: "today 08:00", body: "x", channel: "whatsapp", ack: true }).meta).toEqual(["Sam", "today 08:00", "via WhatsApp", "acknowledgement asked"]);
  });

  it("replies on the portal thread, keeps staff-only notes on the matter, and never claims an email for a portal reply", () => {
    expect(messageSendAttrs({ organizationId: ORG, matterId: MATTER, threadId: PERSON, name: "Dana Lee" })).toEqual({
      "data-inbox-message": PERSON,
      "data-org": ORG,
      "data-matter": MATTER,
      "data-name": "Dana",
    });
    expect(noteAttrs(ORG, MATTER)).toEqual({ "data-inbox-note": MATTER, "data-org": ORG });
    expect(messageSentToast("Dana", true).sub).toMatch(/asked to acknowledge/);
    expect(messageSentToast("Dana", false).sub).not.toMatch(/email/i);
  });

  it("offers only people email can reach in New message", () => {
    const suppressed = new Set(["bounced@example.test"]);
    expect(canEmail({ email: "dana@example.test", emailOff: false }, suppressed)).toBe(true);
    expect(canEmail({ email: "dana@example.test", emailOff: true }, suppressed)).toBe(false);
    expect(canEmail({ email: "Bounced@Example.test", emailOff: false }, suppressed)).toBe(false);
    expect(canEmail({ email: null, emailOff: false }, suppressed)).toBe(false);
  });

  it("counts delivery problems one way: the tab's statuses", () => {
    expect([...DELIVERY_PROBLEM_STATUSES]).toEqual(["bounced", "suppressed", "failed"]);
    expect(deliveryProblemsPill(2)).toBe("2 delivery problems");
    expect(deliveryProblemsPill(1)).toBe("1 delivery problem");
  });

  it("filters conversations by search and channel chip", () => {
    const rows = [
      { text: "Dana Lee CV-1 passport", flags: "portal email" },
      { text: "Sam Roe CV-2 invoice", flags: "whatsapp" },
    ];
    expect(conversationHidden(rows, "", "All")).toEqual([false, false]);
    expect(conversationHidden(rows, "passport", "All")).toEqual([false, true]);
    expect(conversationHidden(rows, "", "WhatsApp")).toEqual([true, false]);
    expect(conversationHidden(rows, "", "Email")).toEqual([false, true]);
  });

  it("hides an empty template choice, and wires the acknowledgement box only when it applies", () => {
    const compose = renderToStaticMarkup(createElement(ComposeDialog, { data: { to: [["Dana Lee", "CV-1"]], toValues: [`${MATTER}:${PERSON}`], templates: [], send: { attrs: { "data-inbox-compose": "1" } } } }));
    expect(compose).not.toContain("Start from a template");
    const view = (ackAttrs: Record<string, string>) =>
      renderToStaticMarkup(
        createElement(SheetInbox, {
          data: {
            tab: "conv",
            conv: {
              filters: ["All", "Portal", "Email", "WhatsApp"],
              filterEmpty: true,
              threads: [{ href: "#", selected: true, person: { name: "Dana Lee" }, unread: false, line: ["CV-1", "Hello"], when: "09:12", flags: ["portal"] }],
              view: {
                title: ["Dana Lee", "CV-1"],
                role: null,
                mails: [messageMail({ author: "Dana Lee", when: "09:12", body: "Hello", channel: "portal", ack: false })],
                audience: { title: "Audience", copy: "" },
                reply: { send: { label: "Send to Dana", attrs: messageSendAttrs({ organizationId: ORG, matterId: MATTER, threadId: PERSON, name: "Dana" }) }, note: noteAttrs(ORG, MATTER), acknowledge: "Ask Dana to acknowledge", ackAttrs },
              },
            },
          },
        }),
      );
    const portal = view({ id: "rpAck" });
    expect(portal).toContain('<input type="checkbox" id="rpAck"/>');
    expect(portal).toContain('data-f="portal"');
    expect(portal).toContain(`data-inbox-note="${MATTER}"`);
    expect(portal).not.toContain("aren’t saved here yet");
    expect(portal).toContain('<div class="fp-fe" hidden="">');
    expect(view({ disabled: "disabled", title: "Only a portal message" })).toContain('<input type="checkbox" disabled="" title="Only a portal message"/>');
  });
});

describe("Finance: figures that add up", () => {
  it("counts only confirmed card payments, net of refunds, for Received by card", () => {
    // Two invoices: 350 paid by card (100 later refunded is not here), 200 paid from client funds
    // (no card payment row). invoices.paid_cents would add to 550; the card figure is 350.
    const payments = [
      { invoice_id: "a", status: "succeeded", currency: "CAD", amount_received_cents: 35_000, refunded_cents: 0 },
      { invoice_id: "b", status: "processing", currency: "CAD", amount_received_cents: 0, refunded_cents: 0 },
    ];
    expect(cardReceived(payments)).toEqual({ netCents: 35_000, refundedCents: 0, payments: 1 });
    expect(cardReceived([{ invoice_id: "a", status: "succeeded", currency: "CAD", amount_received_cents: 45_000, refunded_cents: 10_000 }])).toEqual({
      netCents: 35_000,
      refundedCents: 10_000,
      payments: 1,
    });
    expect(cardReceived([{ invoice_id: "a", status: "succeeded", currency: "USD", amount_received_cents: 1_000, refunded_cents: 0 }]).netCents).toBe(0);
  });

  it("bills the applicant, not the matter's title, and says when nothing is due", () => {
    expect(billedTo([{ role: "applicant", persons: { display_name: "Dana Lee" } }, { role: "sponsor", persons: { display_name: "Sam Lee" } }])).toBe("Dana Lee");
    expect(billedTo([])).toBe("Client");
    expect(balanceLine("paid", 0, "18 Oct")).toBe("Paid, nothing due");
    expect(balanceLine("issued", 5_000, "18 Oct")).toBe("Balance due 18 Oct");
    expect(balanceLine("voided", 0, "18 Oct")).toBe("Voided, nothing due");
    expect(balanceLine("credited", 0, "18 Oct")).toBe("Credited, nothing due");
  });

  it("caps a credit note at what is still creditable after a refund", () => {
    expect(creditable({ amountCents: 55_000, creditedCents: 0, refundedCents: 20_000 }, 0)).toBe(35_000);
    expect(creditable({ amountCents: 55_000, creditedCents: 10_000, refundedCents: 20_000 }, 5_000)).toBe(20_000);
    expect(creditable({ amountCents: 55_000, creditedCents: 0 }, 0)).toBe(55_000);
  });

  it("doesn't file this month's reconciliation under Earlier months", () => {
    expect(reconHistoryTitle(["2026-10-15"], "2026-10-19")).toBe("Signed reconciliations");
    expect(reconHistoryTitle(["2026-09-30"], "2026-10-19")).toBe("Earlier months");
  });

  it("draws the invoice PDF's rows from the invoice as it stands", () => {
    const invoice: InvoicePdf = {
      number: "INV-0001",
      description: "Study permit application",
      feeCategory: "professional_fee",
      status: "paid",
      amountCents: 55_000,
      paidCents: 55_000,
      creditedCents: 0,
      refundedCents: 20_000,
      currency: "CAD",
      issuedOn: "2026-10-01",
      dueOn: "2026-10-31",
      createdAt: "2026-10-01T12:00:00Z",
      clientName: "Dana Lee",
      matterLabel: "CV-2026-0001 · Study permit",
      firmLegalName: "Synthetic Legal",
      firmDisplayName: "Synthetic Firm",
      consultantName: null,
      consultantLicence: null,
      isSample: false,
    };
    const rows = new Map(invoiceRows(invoice));
    expect(rows.get("Billed to")).toBe("Dana Lee");
    expect(rows.get("Amount due")).toBe("CAD 0.00");
    expect(rows.get("Refunded")).toBe("CAD 200.00");
    expect(rows.has("Was due")).toBe(true);
  });

  it("drops the Draft chip when no invoice can be a draft, and keeps the Designer's chips otherwise", () => {
    const base = { intro: "x", kpis: [], rows: [], empty: null };
    expect(renderToStaticMarkup(createElement(SheetFinance, { data: { ...base, chips: ["Issued", "Paid"] } }))).not.toContain(">Draft<");
    expect(renderToStaticMarkup(createElement(SheetFinance, { data: base }))).toContain(">Draft<");
  });
});

describe("Documents: accepted files open, answered requests aren't repeated", () => {
  it("opens only clean, accepted versions", () => {
    expect(cardOpenable({ uploadState: "clean", reviewState: "accepted" })).toBe(true);
    expect(cardOpenable({ uploadState: "clean", reviewState: "pending" })).toBe(false);
    expect(cardOpenable({ uploadState: "quarantined", reviewState: "accepted" })).toBe(false);
  });

  it("treats a request as answered by its upload, or by the same person's same document on the matter", () => {
    const shown = [{ id: "d1", person_id: PERSON, purpose: "Passport bio page", matterId: MATTER }];
    expect(requestAnswered({ document_id: "d1", person_id: "other", matter_id: "other", purpose: "x" }, shown)).toBe(true);
    expect(requestAnswered({ document_id: null, person_id: PERSON, matter_id: MATTER, purpose: "passport bio page " }, shown)).toBe(true);
    expect(requestAnswered({ document_id: null, person_id: PERSON, matter_id: "other", purpose: "Passport bio page" }, shown)).toBe(false);
  });

  it("makes an openable card a button, and shows Nothing matches when the chips leave nothing", () => {
    const all = renderToStaticMarkup(
      createElement(SheetDocuments, {
        data: {
          tab: "all",
          pills: [],
          firmName: "Synthetic Firm",
          all: { cards: [{ title: "Passport bio page", thumb: { icon: "file" }, states: [], open: { "data-doc-open": ENVELOPE, "data-org": ORG } }] },
        },
      }),
    );
    expect(all).toContain(`data-doc-open="${ENVELOPE}"`);
    expect(all).toContain('role="button"');
    expect(all).toContain('aria-label="Open Passport bio page"');
    const review = renderToStaticMarkup(
      createElement(SheetDocuments, {
        data: {
          tab: "review",
          pills: [],
          firmName: "Synthetic Firm",
          review: { filterEmpty: true, rows: [{ title: "Passport", person: "Dana", matter: "CV-1", uploaded: "Today", scan: { tone: "ok", label: "Clean" }, review: "Waiting" }] },
        },
      }),
    );
    expect(review).toContain('<div class="fp-fe rv" hidden=""');
  });
});

describe("Notifications", () => {
  const item = (id: string, kind: NotificationItem["kind"], read = false): NotificationItem => ({
    id,
    kind,
    occurred_at: "2026-10-18T13:40:00Z",
    matter_id: MATTER,
    actor_name: "Dana Lee",
    subject: "INV-0001",
    detail: null,
    href: "/sheet/finance?tab=payments",
    read,
  });

  it("counts unread for the sidebar on every page, and puts card payments under System", () => {
    expect(unreadCount([item("1", "message"), item("2", "payment", true), item("3", "deadline")])).toBe(2);
    expect(SYSTEM_KINDS.has("payment")).toBe(true);
    const groups = notificationGroups({ items: [item("1", "message"), item("2", "payment")], tab: "system", now: "2026-10-18T15:00:00Z", timezone: "America/Toronto", matterName: () => "CV-1 (Study permit)" });
    expect(groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual(["2"]);
  });

  it("names the matter a message is on", () => {
    expect(matterLabel({ reference: "CV-2026-0001", title: "Study permit" })).toBe("CV-2026-0001 (Study permit)");
    expect(matterLabel({ reference: null, title: "Study permit" })).toBe("Study permit");
    expect(matterLabel(undefined)).toBe("a matter");
  });
});

describe("Vo drafts", () => {
  const viewer = { organizationId: ORG, firmName: "Synthetic Firm", isOwner: true, sampleMode: false, agentReady: true, timeZone: "America/Toronto" };
  const names = { matter: () => "Dana Lee", reference: () => "CV-1", person: () => "Sam" };
  const draft = (over: Partial<VoDraftRow> = {}): VoDraftRow => ({
    id: "55555555-5555-4555-8555-555555555555",
    runId: "r",
    kind: "message_reply",
    title: "Reply about evidence_collection",
    body: "Your matter is in evidence_collection.",
    sources: [{ kind: "matter", id: MATTER, label: "The matter" }],
    matterId: MATTER,
    threadId: PERSON,
    status: "draft",
    edited: null,
    needsRule: false,
    isSample: false,
    createdAt: "2026-10-18T10:00:00Z",
    reviewedAt: null,
    reviewedBy: null,
    latencyMs: 400,
    ...over,
  });
  const reading: VoReadingRow = {
    id: "66666666-6666-4666-8666-666666666666",
    runId: "r2",
    title: "Passport",
    body: "Two fields",
    matterId: MATTER,
    versionId: ENVELOPE,
    sources: [{ kind: "document", id: ENVELOPE, label: "Passport v1" }],
    needsRule: false,
    isSample: false,
    createdAt: "2026-10-18T09:00:00Z",
    latencyMs: 900,
    waiting: 2,
  };
  const page = (waiting: VoDraftRow[], extra: Partial<Parameters<typeof draftsPage>[0]> = {}) =>
    draftsPage({ viewer, settings: effectiveSettings(null, false), waiting, week: [], running: null, abstained: null, names, readings: [reading], ...extra });

  it("humanises stage keys and flags drafts the matter has moved past", () => {
    expect(humaniseStages("Now in evidence_collection, next ready_to_submit.")).toBe("Now in Evidence collection, next Ready to submit.");
    expect(draftStale("2026-10-18T10:00:00Z", { threadLastMessageAt: "2026-10-18T11:00:00Z" })).toBe(true);
    expect(draftStale("2026-10-18T10:00:00Z", { threadLastMessageAt: "2026-10-18T09:00:00Z", matterUpdatedAt: "2026-10-18T09:30:00Z" })).toBe(false);
    expect(draftStale("2026-10-18T10:00:00Z", { matterUpdatedAt: "2026-10-19T09:30:00Z" })).toBe(true);
  });

  it("makes Accept send the draft, unless it needs a person first; Edit opens it", () => {
    const [card] = page([draft()]).cards.filter((item) => item.id.startsWith("5555"));
    expect(card.accept).toMatchObject({ "data-vo-accept": draft().id, "data-org": ORG });
    expect(card.edit).toHaveProperty("data-nav");
    expect(card.title).toBe("Reply about Evidence collection");
    expect(card.body).toContain("Evidence collection");
    const stale = page([draft({ stale: true })]).cards.find((item) => item.id.startsWith("5555"))!;
    expect(stale.accept).toMatchObject({ disabled: true });
    expect(stale.meta.join(" ")).toMatch(/out of date/);
    const rule = page([draft({ needsRule: true })]).cards.find((item) => item.id.startsWith("5555"))!;
    expect(rule.accept).toMatchObject({ disabled: true });
    const readingCard = page([]).cards.find((item) => item.id.startsWith("6666"))!;
    expect(readingCard.accept).toMatchObject({ disabled: true });
    expect(readingCard.accept).not.toHaveProperty("data-nav");
  });

  it("counts This week the way the waiting count does: reply drafts and readings", () => {
    const data = page([], { week: [draft({ status: "sent", edited: false })], weekReadings: [{ status: "reviewed" }, { status: "draft" }] });
    expect(data.week[0]).toBe("3 drafts");
    expect(data.week[1]).toBe("2 accepted");
  });
});
