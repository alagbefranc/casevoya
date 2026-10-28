import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoAccessPanel, StateAlert, StateAlerts } from "@/components/sheet/designer/state-views";
import {
  deniedView,
  failedPaymentAlert,
  financeAccess,
  grantsAccess,
  MATTER_BILLING_DENIED,
  migrationAccess,
  newerReadingWaiting,
  noAccess,
  partialAlert,
  recordNotOpen,
  sourceStaleness,
  subscriptionAccess,
} from "@/modules/sheet/states-present";
import { checkUpload, sizeLabel, uploadFailed, UPLOAD_RULES } from "@/modules/sheet/upload-failure";

/** DES-04: the Sheet's permission-denied, stale-source, partial, failed-payment and failed-upload states. Synthetic rows only. */
const ZONE = "America/Toronto";
const NOW = new Date("2026-10-25T14:00:00Z");
const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);

describe("permission denied", () => {
  it("Finance and Subscription are for the firm owner and finance users only", () => {
    for (const role of ["firm_owner", "finance_user"]) {
      expect(financeAccess(role)).toBeNull();
      expect(subscriptionAccess(role)).toBeNull();
    }
    for (const role of ["licensed_consultant", "case_manager", "assistant"]) {
      const denied = financeAccess(role);
      expect(denied?.title).toBe("You don’t have access to Finance");
      expect(denied?.copy).toMatch(/firm owner and finance staff\. Ask your firm owner/);
      expect(subscriptionAccess(role)?.title).toBe("You don’t have access to Subscription");
    }
    expect(financeAccess("assistant")?.role).toBe("Your role is Assistant.");
  });

  it("Access grants and Support access answer the owner only; Office and team limits stay open", () => {
    expect(grantsAccess("firm_owner", "grants")).toBeNull();
    expect(grantsAccess("firm_owner", "support")).toBeNull();
    expect(grantsAccess("case_manager", "limits")).toBeNull();
    expect(grantsAccess("case_manager", "grants")?.title).toBe("You don’t have access to Access grants");
    expect(grantsAccess("licensed_consultant", "support")?.copy).toMatch(/Only the firm owner approves/);
  });

  it("Migration import is the firm owner's; a record not open says both reasons and where to go", () => {
    expect(migrationAccess("firm_owner")).toBeNull();
    expect(migrationAccess("case_manager")?.copy).toMatch(/only the firm owner can see and run one\. Ask your firm owner to run it\./);
    const matter = recordNotOpen("matter", "assistant", { label: "All matters", href: "/sheet/matters" });
    expect(matter.title).toBe("This matter isn’t open to you");
    expect(matter.copy).toMatch(/may not exist, or you aren’t assigned to it/);
    expect(matter.action).toEqual({ label: "All matters", href: "/sheet/matters" });
    expect(recordNotOpen("lead", "finance_user", { label: "Pipeline", href: "/sheet/pipeline" }).title).toBe("This lead isn’t open to you");
  });

  it("renders the Designer's No permission panel: lock mascot, reason, who to ask, one link, no table", () => {
    const out = html(createElement(NoAccessPanel, { data: noAccess("Finance", "Invoices are for the firm owner.", "assistant") }));
    expect(out).toContain('class="mascot vo-pose p-lock"');
    expect(out).toContain('aria-label="Vo holding a lock, private"');
    expect(out).toContain("<b style=\"font-weight:500\">You don’t have access to Finance</b>");
    expect(out).toContain("Invoices are for the firm owner. Ask your firm owner if you need access. Your role is Assistant.");
    expect(out).toContain('<a class="btn s sm" href="/sheet/roles">See what each role can do</a>');
    expect(out).toContain('data-no-access="1"');
    expect(out).not.toContain("<table");
    // A tab's own copy, without a role line.
    const tab = html(createElement(NoAccessPanel, { data: deniedView("You don’t have access to Complaints", "Ask your firm owner.") }));
    expect(tab).toContain("<small style=\"color:var(--t2)\">Ask your firm owner.</small>");
    expect(html(createElement(NoAccessPanel, { data: MATTER_BILLING_DENIED }))).toContain("You don’t have access to Billing on this matter");
  });
});

describe("stale official source", () => {
  it("is null when every rule, pack and page is current", () => {
    expect(
      sourceStaleness({
        rules: [{ label: "R.ONE v1", status: "published", effectiveTo: null, nextReviewAt: "2026-12-01T00:00:00Z" }],
        packs: [{ label: "Study permit program v1", status: "published", nextReviewAt: null }],
        sources: [{ label: "Fee list", reviewStatus: "verified", changeState: "unchanged", lastAttemptResult: "success", lastAttemptAt: "2026-10-20T12:00:00Z", nextReviewAt: null }],
        now: NOW,
        timeZone: ZONE,
      }),
    ).toBeNull();
  });

  it("lists review due, review date passed, expired, and a failed or blocked check, from the rows", () => {
    const alert = sourceStaleness({
      rules: [
        { label: "R.ONE v1", status: "review_due", effectiveTo: null, nextReviewAt: null },
        { label: "R.TWO v3", status: "published", effectiveTo: "2026-10-01T04:00:00Z", nextReviewAt: "2026-10-10T12:00:00Z" },
        // A draft isn't in use, so its dates don't make the page stale.
        { label: "R.DRAFT v1", status: "draft", effectiveTo: "2026-01-01T00:00:00Z", nextReviewAt: "2026-01-01T00:00:00Z" },
      ],
      packs: [{ label: "Study permit program v2", status: "published", nextReviewAt: "2026-10-20T12:00:00Z" }],
      sources: [
        { label: "IRCC fee list", reviewStatus: "verified", changeState: "unchanged", lastAttemptResult: "failed", lastAttemptAt: "2026-10-24T15:00:00Z", nextReviewAt: null },
        { label: "IRPR", reviewStatus: "verified", changeState: "change_detected", lastAttemptResult: "blocked", lastAttemptAt: null, nextReviewAt: null },
      ],
      now: NOW,
      timeZone: ZONE,
    });
    expect(alert?.kind).toBe("stale-source");
    expect(alert?.tone).toBe("warn");
    expect(alert?.title).toBe("5 official sources need review");
    expect(alert?.items).toEqual([
      "R.ONE v1: review required",
      "R.TWO v3: expired 1 Oct 2026, review was due 10 Oct 2026",
      "Study permit program v2: review was due 20 Oct 2026",
      "IRCC fee list: the last check failed (24 Oct 2026)",
      "IRPR: the last check was blocked, the page changed since it was reviewed",
    ]);
    expect(alert?.action).toEqual({ label: "Open Source review", href: "/sheet/templates?tab=sources" });
    expect(alert?.body).toMatch(/what a licensed reviewer last approved/);
  });

  it("caps the list at five and says how many more", () => {
    const rules = Array.from({ length: 8 }, (_, n) => ({ label: `R.N${n} v1`, status: "review_due", effectiveTo: null, nextReviewAt: null }));
    const alert = sourceStaleness({ rules, now: NOW, timeZone: ZONE, action: null, subject: "This rule" });
    expect(alert?.items).toHaveLength(6);
    expect(alert?.items[5]).toBe("and 3 more");
    expect(alert?.action).toBeNull();
    expect(alert?.body.startsWith("This rule may be out of date.")).toBe(true);
  });

  it("a newer fee list or estimate waiting for review, only when it is the newer one", () => {
    expect(newerReadingWaiting({ what: "reading of IRCC’s fee list", approvedAt: "2026-10-01T15:00:00Z", pendingAt: null, timeZone: ZONE })).toBeNull();
    expect(newerReadingWaiting({ what: "reading of IRCC’s fee list", approvedAt: "2026-10-20T15:00:00Z", pendingAt: "2026-10-01T15:00:00Z", timeZone: ZONE })).toBeNull();
    const fees = newerReadingWaiting({ what: "reading of IRCC’s fee list", approvedAt: "2026-10-01T15:00:00Z", pendingAt: "2026-10-24T15:00:00Z", timeZone: ZONE });
    expect(fees?.title).toBe("A newer reading of IRCC’s fee list is waiting for licensed review");
    expect(fees?.body).toBe("It was checked on 24 Oct 2026. Until a licensed member reviews it, the approved one checked on 1 Oct 2026 is shown and used.");
    // Calendar dates stay as written (no shift into the previous day in Toronto).
    const estimate = newerReadingWaiting({ what: "IRCC processing-time estimate", approvedAt: "2026-10-20", pendingAt: "2026-10-20", newer: true, timeZone: ZONE });
    expect(estimate?.body).toContain("checked on 20 Oct 2026");
  });

  it("renders as the Designer's warn alert with its clock icon and the next step", () => {
    const alert = sourceStaleness({ rules: [{ label: "R.ONE v1", status: "review_due", effectiveTo: null, nextReviewAt: null }], now: NOW, timeZone: ZONE });
    const out = html(createElement(StateAlert, { data: alert! }));
    expect(out).toContain('<div class="alert warn" role="status" data-state="stale-source">');
    expect(out).toContain("#i-clock");
    expect(out).toContain("<b>An official source needs review</b>");
    expect(out).toContain("<li>R.ONE v1: review required</li>");
    expect(out).toContain('<div class="acts"><a class="btn sm" href="/sheet/templates?tab=sources">Open Source review</a></div>');
  });
});

describe("partial", () => {
  it("says when a read hit its limit or failed, and is null otherwise", () => {
    expect(partialAlert([{ label: "Invoices", count: 12, cap: 500 }])).toBeNull();
    const capped = partialAlert([{ label: "Invoices", count: 500, cap: 500 }]);
    expect(capped?.tone).toBe("info");
    expect(capped?.items).toEqual(["Invoices: the newest 500 are shown; the rest aren’t listed"]);
    const failed = partialAlert([
      { label: "Rule versions", count: 0, cap: 200, failed: true },
      { label: "Program templates", count: 200, cap: 200 },
    ]);
    expect(failed?.tone).toBe("bad");
    expect(failed?.title).toBe("Part of this page couldn’t load");
    expect(failed?.items).toEqual(["Rule versions: couldn’t load", "Program templates: the newest 200 are shown; the rest aren’t listed"]);
    expect(failed?.body).toMatch(/Reload the page/);
  });

  it("StateAlerts skips the empty ones", () => {
    expect(html(createElement(StateAlerts, { items: [null, undefined] }))).toBe("");
    const out = html(createElement(StateAlerts, { items: [null, partialAlert([{ label: "Export history", count: 50, cap: 50 }])] }));
    expect(out).toContain('class="alert info"');
  });
});

describe("failed payment (Stripe test mode)", () => {
  const invoices = new Map([
    ["inv-1", { number: "INV-0001", client: "Client A" }],
    ["inv-2", { number: "INV-0002", client: "Client B" }],
  ]);

  it("names the invoices whose latest card payment failed or was canceled; a later success clears it", () => {
    const alert = failedPaymentAlert({
      payments: [
        { invoiceId: "inv-1", status: "failed", updatedAt: "2026-10-24T16:00:00Z" },
        { invoiceId: "inv-2", status: "failed", updatedAt: "2026-10-20T16:00:00Z" },
        { invoiceId: "inv-2", status: "succeeded", updatedAt: "2026-10-21T16:00:00Z" },
      ],
      invoices,
      now: NOW,
      timeZone: ZONE,
    });
    expect(alert?.kind).toBe("failed-payment");
    expect(alert?.tone).toBe("bad");
    expect(alert?.title).toBe("A card payment didn’t go through");
    expect(alert?.items).toEqual(["INV-0001 (Client A): payment failed or declined 24 Oct 2026"]);
    expect(alert?.body).toMatch(/Nothing was charged and the invoice stays open\. Next step: ask the client to pay again from their portal/);
    expect(alert?.action).toEqual({ label: "Open INV-0001", href: "/sheet/finance?tab=invoice&view=inv-1" });
  });

  it("adds disputes still taking evidence, and is null when nothing failed", () => {
    expect(failedPaymentAlert({ payments: [{ invoiceId: "inv-1", status: "succeeded", updatedAt: "2026-10-24T16:00:00Z" }], invoices, now: NOW, timeZone: ZONE })).toBeNull();
    const disputes = failedPaymentAlert({
      payments: [],
      invoices,
      disputes: [
        { number: "D-0001", status: "needs_response", evidenceDueBy: "2026-11-02T23:59:00Z" },
        { number: "D-0002", status: "needs_response", evidenceDueBy: "2026-10-01T23:59:00Z" },
        { number: "D-0003", status: "won", evidenceDueBy: null },
      ],
      now: NOW,
      timeZone: ZONE,
    });
    expect(disputes?.title).toBe("A disputed payment needs evidence");
    expect(disputes?.items).toEqual(["Dispute D-0001: needs evidence by 2 Nov 2026"]);
    expect(disputes?.action).toEqual({ label: "Refunds and disputes", href: "/sheet/finance?tab=refunds" });
    const out = html(createElement(StateAlert, { data: disputes! }));
    expect(out).toContain('<div class="alert bad" role="alert" data-state="failed-payment">');
  });
});

describe("failed upload", () => {
  it("refuses a wrong type with what to choose instead and a retry", () => {
    const failure = checkUpload({ name: "letter.exe", size: 1200 }, UPLOAD_RULES.evidence);
    expect(failure).toEqual({
      title: "That file type can’t be uploaded here",
      detail: "“letter.exe” isn’t a PDF, JPEG, PNG, HEIC or DOCX file.",
      next: "Nothing was uploaded. Choose a PDF, JPEG, PNG, HEIC or DOCX file (save or scan other documents as PDF first).",
      retry: "Choose another file",
    });
    expect(checkUpload({ name: "logo.gif", size: 10 }, UPLOAD_RULES.logo)?.next).toBe("Nothing was uploaded. Choose a PNG or JPG image.");
    expect(checkUpload({ name: "leads.xlsx", size: 10 }, UPLOAD_RULES.leadsCsv)?.detail).toBe("“leads.xlsx” isn’t a CSV file.");
  });

  it("refuses an empty or too large file, accepts a good one, and leaves an extensionless name to the server", () => {
    expect(checkUpload({ name: "scan.pdf", size: 0 }, UPLOAD_RULES.evidence)?.title).toBe("That file is empty");
    const big = checkUpload({ name: "proof.png", size: 5 * 1024 * 1024 }, UPLOAD_RULES.dispute);
    expect(big?.title).toBe("That file is too large");
    expect(big?.detail).toBe("“proof.png” is 5 MB; the limit for a dispute evidence is 4.5 MB.");
    expect(checkUpload({ name: "Receipt.PDF", size: 2048 }, UPLOAD_RULES.evidence)).toBeNull();
    expect(checkUpload({ name: "import.csv", size: 2048 }, UPLOAD_RULES.migrationCsv)).toBeNull();
    expect(checkUpload({ name: "photo", size: 2048 }, UPLOAD_RULES.logo)).toBeNull();
    expect(sizeLabel(900)).toBe("900 bytes");
    expect(sizeLabel(1536)).toBe("2 KB");
  });

  it("reads a server refusal as a type or size problem, or as a dropped upload to try again", () => {
    expect(uploadFailed("Use a PDF, JPEG, PNG, HEIC, or DOCX file name.", UPLOAD_RULES.evidence)).toEqual({
      title: "That file can’t be uploaded here",
      detail: "Use a PDF, JPEG, PNG, HEIC, or DOCX file name.",
      next: "Nothing was saved. Choose a PDF, JPEG, PNG, HEIC or DOCX file within the limit.",
      retry: "Choose another file",
    });
    expect(uploadFailed("That file is above your firm’s limit of 10 MB per file.", UPLOAD_RULES.evidence).retry).toBe("Choose another file");
    const dropped = uploadFailed("The file did not finish uploading", UPLOAD_RULES.evidence);
    expect(dropped.title).toBe("The upload didn’t finish");
    expect(dropped.detail).toBe("The file did not finish uploading.");
    expect(dropped.retry).toBe("Try again");
    expect(uploadFailed("", UPLOAD_RULES.logo).detail).toBe("The upload didn’t finish.");
  });
});
