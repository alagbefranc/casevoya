import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { LivePortal } from "@/components/portal/live";
import { PayFailed } from "@/components/portal/pay-live";
import { UploadFailed } from "@/components/portal/upload-failed";
import type { PortalDocuments } from "@/modules/documents/load";
import type { PortalInvoice, PortalInvoices } from "@/modules/finance/portal-load";
import { homeView } from "@/modules/portal/home-present";
import type { PortalViewer } from "@/modules/portal/load";
import { payFailure, redirectPayFailure } from "@/modules/portal/pay-failure";
import { deniedFor, partList } from "@/modules/portal/states";
import { checkUploadFile, formatList, uploadFailure } from "@/modules/portal/upload-failure";
import { portalRenewals, renewalStaleReasons } from "@/modules/renewals/present";

// DES-04 for the client portal and public pages: failed uploads and payments with a next step,
// permission-denied records said plainly, partial pages named, and official content that may be
// out of date flagged. Everything here is synthetic: no IRCC value, no real person or card.

const person = { id: "p1", displayName: "Casey Nguyen", email: "casey@example.test", phone: null, isMinor: false, role: "applicant" };
const M1 = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000ff";

const viewer: PortalViewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Example Firm",
  organizationSlug: "example-firm",
  timezone: "America/Toronto",
  role: "client",
  person,
  matters: [{ id: M1, title: "Spousal sponsorship", stage: "evidence collection", onHold: false, reference: "EX-2026-0142" }],
  people: [person],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(LivePortal, { viewer, taskCount: 0, unread: 0, logo: null, ...props } as never));

const MB = 1024 * 1024;

describe("failed upload: the check before sending", () => {
  it("refuses a wrong file type with the accepted types and nothing uploaded", () => {
    const refused = checkUploadFile({ name: "photo.gif", size: 2 * MB });
    expect(refused).toMatchObject({ kind: "wrong_type", retry: "choose", title: "That file type isn’t accepted" });
    expect(refused?.copy).toBe(".gif files can’t be sent here. Send a PDF, JPG, PNG, HEIC or DOCX file instead. Nothing was uploaded.");
    expect(checkUploadFile({ name: "no-extension", size: 10 })?.kind).toBe("wrong_type");
  });

  it("follows the request's own formats", () => {
    const refused = checkUploadFile({ name: "letter.docx", size: MB }, { formats: ["pdf", "jpeg"] });
    expect(refused?.copy).toBe(".docx files aren’t accepted for this request. Send a PDF or JPG file instead. Nothing was uploaded.");
    expect(checkUploadFile({ name: "SCAN.PDF", size: MB }, { formats: ["pdf"] })).toBeNull();
    expect(formatList(["pdf", "jpeg", "png"])).toBe("PDF, JPG or PNG");
  });

  it("refuses a file over the firm's limit, and an empty one", () => {
    expect(checkUploadFile({ name: "scan.pdf", size: 30 * MB }, { maxBytes: 25 * MB })?.copy).toBe(
      "It’s 30 MB; your firm’s limit is 25 MB per file. Choose a smaller copy, or scan fewer pages at a time. Nothing was uploaded.",
    );
    expect(checkUploadFile({ name: "scan.pdf", size: 30 * MB })?.kind).toBe("too_large");
    expect(checkUploadFile({ name: "scan.pdf", size: 0 })?.kind).toBe("wrong_type");
  });
});

describe("failed upload: what the upload calls reported", () => {
  it("names the file check's outcomes", () => {
    expect(uploadFailure({ stage: "check", state: "quarantined" })).toMatchObject({ kind: "verification", retry: "choose", title: "We couldn’t accept this file" });
    expect(uploadFailure({ stage: "check", state: "failed" })).toMatchObject({ kind: "verification", retry: "resend" });
    expect(uploadFailure({ stage: "check", message: "The file could not be checked." })).toMatchObject({ kind: "verification", retry: "resend" });
  });

  it("starts over with a new link when the upload authorisation expired", () => {
    expect(uploadFailure({ stage: "check", message: "That upload authorization expired. Start again." })).toMatchObject({ kind: "expired", retry: "resend" });
    expect(uploadFailure({ stage: "transfer", message: "jwt expired" })).toMatchObject({ kind: "expired", title: "The upload link expired" });
  });

  it("says the connection dropped, and never repeats storage's technical words", () => {
    expect(uploadFailure({ stage: "transfer", thrown: true })).toMatchObject({ kind: "network", retry: "resend", title: "The connection dropped" });
    const storage = uploadFailure({ stage: "transfer", message: "new row violates policy for bucket objects (42501)" });
    expect(storage.kind).toBe("network");
    expect(storage.copy).not.toMatch(/policy|bucket|42501/);
    expect(uploadFailure({ stage: "transfer", message: "The object exceeded the maximum allowed size" }).kind).toBe("too_large");
  });

  it("keeps the server's own plain refusal for type and size", () => {
    expect(uploadFailure({ stage: "intent", message: "Use a PDF, JPEG, PNG, HEIC, or DOCX file name." })).toMatchObject({ kind: "wrong_type", retry: "choose" });
    expect(uploadFailure({ stage: "intent", message: "That file is above your firm’s limit of 10 MB per file." })).toMatchObject({ kind: "too_large", retry: "choose" });
    expect(uploadFailure({ stage: "intent", message: "Sign in first." })).toMatchObject({ kind: "refused", copy: "Sign in first. Nothing was uploaded." });
  });

  it("renders as the Designer's failed send, with the retry and Ask your firm", () => {
    const wrong = renderToStaticMarkup(createElement(UploadFailed, { failure: checkUploadFile({ name: "photo.gif", size: 1 })!, onRetry() {} }));
    expect(wrong).toContain('role="alert"');
    expect(wrong).toContain('<b style="font-weight:500;font-size:18px">That file type isn’t accepted</b>');
    expect(wrong).toContain('<button class="btn sm p" type="button">Choose another file</button>');
    expect(wrong).toContain('<a class="btn sm" href="/portal/messages">Ask your firm</a>');
    const again = renderToStaticMarkup(createElement(UploadFailed, { failure: uploadFailure({ stage: "transfer", thrown: true }), onRetry() {} }));
    expect(again).toContain(">Try again</button>");
  });

  it("lists the request's own formats on the Add the file step", () => {
    const documents: PortalDocuments = {
      cards: [],
      requests: [{ id: "q1", matterId: M1, personId: "p1", personName: "Casey Nguyen", purpose: "Passport", explanation: "", documentId: null, formats: ["pdf", "png"], sensitivity: "ordinary", audience: "subject" }],
      progressLine: "",
      canReview: false,
      people: [],
    };
    expect(html({ page: "upload", documents })).toContain("PDF or PNG <span class=\"sep\" aria-hidden=\"true\"></span> up to 25 MB");
  });
});

describe("failed payment (Stripe test mode)", () => {
  it("names the test cards' outcomes with a next step, and that nothing was charged", () => {
    const declined = payFailure({ type: "card_error", code: "card_declined", decline_code: "generic_decline" }, "Example Firm");
    expect(declined).toEqual({ kind: "declined", message: "Your card was declined. You haven’t been charged.", next: "Try another card, or ask Example Firm for bank transfer details." });
    expect(payFailure({ type: "card_error", code: "card_declined", decline_code: "insufficient_funds" }, "Example Firm").kind).toBe("insufficient_funds");
    expect(payFailure({ type: "card_error", code: "expired_card" }, "Example Firm").message).toBe("This card has expired. You haven’t been charged.");
    expect(payFailure({ type: "card_error", code: "incorrect_cvc" }, "Example Firm").kind).toBe("card_details");
    expect(payFailure({ type: "invalid_request_error", code: "payment_intent_authentication_failure" }, "Example Firm")).toMatchObject({
      kind: "authentication_failed",
      next: "Try again and finish your bank’s check, use another card, or ask Example Firm for bank transfer details.",
    });
    expect(payFailure({ type: "api_error", code: "processing_error" }, "Example Firm").kind).toBe("processing_error");
    for (const failure of [declined, payFailure({}, "Example Firm"), payFailure(null, "Example Firm")]) expect(failure.message).toContain("You haven’t been charged.");
  });

  it("reads a failed bank check that came back by redirect", () => {
    expect(redirectPayFailure("?invoice=x&redirect_status=failed", "Example Firm")?.kind).toBe("authentication_failed");
    expect(redirectPayFailure("?invoice=x&redirect_status=succeeded", "Example Firm")).toBeNull();
  });

  it("renders as the Designer's declined message: Vo worried and the bank-transfer link", () => {
    const page = renderToStaticMarkup(createElement(PayFailed, { failure: payFailure({ code: "card_declined" }, "Example Firm"), firmName: "Example Firm" }));
    expect(page).toContain('<p class="err" role="alert" data-failure="declined">');
    expect(page).toContain('src="/assets/vo/vo-worried-96.png"');
    expect(page).toContain('Your card was declined. You haven’t been charged. Try another card, or <a href="/portal/messages" style="text-decoration:underline">ask Example Firm for bank transfer details</a>.');
  });
});

const invoice: PortalInvoice = {
  id: "00000000-0000-4000-8000-0000000000b1",
  number: "INV-0001",
  description: "Synthetic professional fees",
  matterTitle: "Spousal sponsorship",
  amountCents: 10_000,
  paidCents: 0,
  refundedCents: 0,
  creditedCents: 0,
  currency: "CAD",
  status: "issued",
  issuedOn: "2026-10-01",
  dueOn: "2026-11-01",
  open: true,
  processing: false,
  state: { tone: "rev", label: "Due" },
  receipts: [],
  creditNotes: [],
};
const invoices: PortalInvoices = { invoices: [invoice], clientFunds: null, today: "2026-10-25", payable: false, publishableKey: null };

describe("permission-denied", () => {
  it("resolves which record the address named that isn't the person's own", () => {
    const base = { matterIds: [M1] };
    expect(deniedFor({ ...base, page: "home", matter: OTHER })).toBe("matter");
    expect(deniedFor({ ...base, page: "home", matter: M1 })).toBeNull();
    expect(deniedFor({ ...base, page: "home", matter: "not-a-uuid" })).toBeNull();
    expect(deniedFor({ ...base, page: "pay", invoice: OTHER, invoiceIds: [invoice.id] })).toBe("invoice");
    expect(deniedFor({ ...base, page: "pay", invoice: invoice.id, invoiceIds: [invoice.id] })).toBeNull();
    expect(deniedFor({ ...base, page: "pay", invoice: OTHER, invoiceIds: null })).toBeNull();
    expect(deniedFor({ ...base, page: "receipt", receipt: OTHER, receiptFound: false })).toBe("receipt");
    expect(deniedFor({ ...base, page: "messages", thread: OTHER, threadOpened: false })).toBe("thread");
    expect(deniedFor({ ...base, page: "intake", response: OTHER, responseSelected: null, responseLoaded: true })).toBe("form");
    expect(deniedFor({ ...base, page: "intake", response: OTHER, responseSelected: null, responseLoaded: false })).toBeNull();
  });

  it("says plainly that an invoice isn't theirs, instead of another invoice or a blank page", () => {
    const page = html({ page: "pay", payments: { data: invoices, invoiceId: OTHER }, denied: "invoice" });
    expect(page).toContain("This invoice isn’t available to you");
    expect(page).toContain("Nothing was charged.");
    expect(page).toContain('<a class="btn p sm" href="/portal/payments">Payments</a>');
    expect(page).not.toContain("INV-0001");
  });

  it("says a receipt isn't available, and keeps the page for a matter link that isn't theirs", () => {
    expect(html({ page: "receipt", receipt: null, denied: "receipt" })).toContain("This receipt isn’t available to you");
    const home = html({ page: "home", denied: "matter", home: null });
    expect(home).toContain('class="alert warn" role="alert" data-state="denied"');
    expect(home).toContain("That matter isn’t on your file");
    expect(home).toContain("Hi Casey.");
  });
});

describe("couldn't load and partial", () => {
  it("shows a page whose records couldn't be read as that, never as empty", () => {
    for (const [page, title] of [["documents", "Documents"], ["payments", "Payments"], ["appointments", "Appointments"], ["agreements", "Agreements"], ["tasks", "Tasks"]] as const) {
      const out = html({ page, failed: true });
      expect(out).toContain(`<h1 class="display">${title}</h1>`);
      expect(out).toContain("couldn’t be shown just now");
      expect(out).toContain("nothing here means there are none");
      expect(out).not.toMatch(/No documents requested yet|Nothing to pay|No appointments yet/);
    }
  });

  it("names the parts of Home that didn't load, where they would be", () => {
    const view = {
      ...homeView({ firmName: "Example Firm", personName: "Casey Nguyen", timezone: "America/Toronto", now: new Date("2026-10-25T12:00:00Z"), matter: null, consultant: null, tasks: [], documents: [], invoices: [], messages: null }),
      unavailable: ["payments", "messages", "documents"] as const,
    };
    const page = html({ page: "home", home: { ...view, unavailable: [...view.unavailable] } });
    expect(page).toContain("Part of this page couldn’t be loaded");
    expect(page).toContain("Payments, messages and documents couldn’t be shown just now");
    expect(page).toContain("Payments couldn’t be shown just now.");
    expect(page).not.toContain("Nothing to pay");
    expect(page).not.toContain("No messages yet");
    expect(page).not.toContain("Nothing accepted yet.");
  });

  it("names a payment page's missing parts above it", () => {
    const page = html({ page: "payments", payments: { data: { ...invoices, unavailable: ["payment status", "receipts"] }, invoiceId: null } });
    expect(page).toContain("Payment status and receipts couldn’t be shown just now");
    expect(partList(["tasks"])).toBe("Tasks");
  });
});

describe("stale-source on the client's renewal reminder", () => {
  const PAGE = "https://www.canada.ca/en/synthetic-page.html#synthetic";
  const now = new Date("2026-10-25T12:00:00Z");
  const timing = { text: "Synthetic timing words", source_url: PAGE, checked_on: "2026-10-20", current_to: null, snapshot_sha256: "a".repeat(64) };

  it("is quiet while the timing and its page are current", () => {
    expect(renewalStaleReasons({ timing: { ...timing, status: "approved", source_review: "verified", source_change: "unchanged", source_attempt: "unchanged" }, fee: null }, "Example Firm", now)).toEqual([]);
  });

  it("says why when the timing was withdrawn, the page is due for review, changed, failed its check, or is over a year old", () => {
    const reasons = (extra: Record<string, unknown>) => renewalStaleReasons({ timing: { ...timing, ...extra }, fee: null }, "Example Firm", now);
    expect(reasons({ status: "retired" })).toEqual(["Example Firm withdrew this IRCC timing after the reminder was set."]);
    expect(reasons({ status: "approved", source_review: "review_due" })).toEqual(["The official page for this timing is due for review."]);
    expect(reasons({ status: "approved", source_next_review: "2026-10-01T00:00:00Z" })).toEqual(["The official page for this timing is due for review."]);
    expect(reasons({ source_change: "change_detected" })).toEqual(["The official page has changed since this timing was checked."]);
    expect(reasons({ source_attempt: "failed" })).toEqual(["The last check of the official page didn’t complete."]);
    expect(reasons({ checked_on: "2025-09-01" })).toEqual(["This timing was last checked on 1 Sep 2025, more than a year ago."]);
    const fee = { name: "Synthetic fee", amount_cents: 100, currency: "CAD", source_url: "https://ircc.canada.ca/english/information/fees/fees.asp", retrieved_at: "2025-08-01T12:00:00Z", snapshot_sha256: "b".repeat(64) };
    expect(renewalStaleReasons({ timing: null, fee }, "Example Firm", now)).toEqual(["The fee was taken from the IRCC fee list more than a year ago."]);
  });

  it("shows the reasons next to the official content on Home", () => {
    const renewals = portalRenewals(
      [{ id: "r1", document_label: "Synthetic permit", expires_on: "2027-03-12", remind_on: "2027-01-12", service_scope: null, timing: { ...timing, status: "retired" }, fee: null }],
      "Example Firm",
      "America/Toronto",
      now,
    );
    expect(renewals[0].stale).toEqual(["Example Firm withdrew this IRCC timing after the reminder was set."]);
    const view = homeView({ firmName: "Example Firm", personName: "Casey Nguyen", timezone: "America/Toronto", now, matter: null, consultant: null, tasks: [], documents: [], invoices: [], messages: null });
    const page = html({ page: "home", home: { ...view, renewals } });
    expect(page).toContain('data-state="stale-source"');
    expect(page).toContain('<span class="bd chg"><i></i>May be out of date</span> Example Firm withdrew this IRCC timing after the reminder was set. Ask Example Firm to confirm it before you rely on it.');
    // Without `now` (older callers), nothing is flagged.
    expect(portalRenewals([{ id: "r1", document_label: "Synthetic permit", expires_on: "2027-03-12", remind_on: "2027-01-12", service_scope: null, timing: { ...timing, status: "retired" }, fee: null }], "Example Firm", "UTC")[0].stale).toBeUndefined();
  });
});
