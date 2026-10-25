import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { excerpt, readClaim } from "../scripts/ops/capture-official-claims.mjs";
import { AddClaimDialog, ClaimReviewDialogs } from "@/components/sheet/designer/source-claims";
import { SheetTemplates } from "@/components/sheet/designer/templates";
import { CAPTURED_CLAIMS, CAPTURED_PAGES } from "@/modules/content-governance/captured-claims";
import { claimUrlProblem, lawSectionText, readPageDates } from "@/modules/content-governance/claim-capture";
import { captureClaimPage } from "@/modules/content-governance/claim-page";
import { claimAddData } from "@/modules/sheet/source-claims-load";
import { claimDates, claimError, claimStatus, type ClaimEvidenceRow } from "@/modules/sheet/source-claims-present";
import { templatesData, type RuleRow } from "@/modules/sheet/templates-present";

/**
 * SRC-01/02/03 presentation: reading an official page without inventing anything, the separate
 * dates with Unknown, the workbench statuses, and the review panel's choices per role. The HTML
 * below is synthetic; the captured file is checked for shape only (deep official URLs, hashes,
 * pages for every claim), never for values.
 */

const SYNTHETIC_LAW = `
<p id='assentedDate'>Regulations are current to 2026-01-31 and <a href='index.html#hist'>last amended</a> on 2025-12-01.</p>
<p class="Section" id="s-7"><strong>7</strong> (1) A fee of $1 is payable for a synthetic application. <span class="MarginalNote">Marginal note: Exception</span> (2) Not this.</p>
<p class="Section" id="s-8"><strong>8</strong> Another synthetic section.</p>
<dt>Date modified: </dt><dd><time property="dateModified">﻿2026-02-02</time></dd>`;

const SYNTHETIC_FEES = `<main>
<h2 id="temporary">Temporary Residence</h2><h3>Synthetic permits</h3>
<table><tr><td><strong>Synthetic permit – per person</strong></td><td>12.50</td></tr></table>
<dl><dt>Date modified:</dt><dd><time property="dateModified">2026-03-03</time></dd></dl></main>`;

describe("Reading an official page", () => {
  it("reads only the dates the page prints; anything else stays null", () => {
    expect(readPageDates(SYNTHETIC_LAW)).toEqual({ modifiedOn: "2026-02-02", lastAmendedOn: "2025-12-01", currentTo: "2026-01-31" });
    expect(readPageDates(SYNTHETIC_FEES)).toEqual({ modifiedOn: "2026-03-03", lastAmendedOn: null, currentTo: null });
    expect(readPageDates("<p>No dates here. current to 2026-02-31</p>")).toEqual({ modifiedOn: null, lastAmendedOn: null, currentTo: null });
  });

  it("refuses a homepage or landing page, a non-official site, and a page with neither anchor nor section", () => {
    for (const url of ["https://www.canada.ca", "https://www.canada.ca/en.html", "https://www.canada.ca/en/immigration-refugees-citizenship.html", "https://laws-lois.justice.gc.ca/eng/"]) {
      expect(claimUrlProblem(url)).toMatch(/homepage/);
    }
    expect(claimUrlProblem("https://example.com/a/b.html#c")).toMatch(/official Government of Canada/);
    expect(claimUrlProblem("http://ircc.canada.ca/english/information/fees/fees.asp#temporary")).toMatch(/official/);
    expect(claimUrlProblem("https://ircc.canada.ca/english/information/fees/fees.asp")).toMatch(/section anchor/);
    expect(claimUrlProblem("https://ircc.canada.ca/english/information/fees/fees.asp", "Temporary Residence")).toBeNull();
    expect(claimUrlProblem("https://ircc.canada.ca/english/information/fees/fees.asp#temporary")).toBeNull();
  });

  it("takes a law section's opening provision word for word, and a fee row as printed", () => {
    expect(lawSectionText(SYNTHETIC_LAW, "s-7")).toBe("7 (1) A fee of $1 is payable for a synthetic application.");
    expect(lawSectionText(SYNTHETIC_LAW, "s-9")).toBeNull();
    const law = readClaim({ key: "CA.X.Y", program: null, page: "https://laws-lois.justice.gc.ca/eng/regulations/X/FullText.html", law: "s-7", claim: "c" }, SYNTHETIC_LAW);
    expect(law).toEqual({ sourceUrl: "https://laws-lois.justice.gc.ca/eng/regulations/X/FullText.html#s-7", section: "Section 7", value: "$1 (as written in the section)", excerpt: "7 (1) A fee of $1 is payable for a synthetic application." });
    const fee = readClaim({ key: "CA.X.Z", program: null, page: "https://ircc.canada.ca/x/fees.asp", fee: { anchor: "temporary", name: "Synthetic permit – per person" }, claim: "c" }, SYNTHETIC_FEES);
    expect(fee).toMatchObject({ sourceUrl: "https://ircc.canada.ca/x/fees.asp#temporary", value: "$12.50 CAD", excerpt: "Synthetic permits: Synthetic permit – per person: 12.50 ($CAN)" });
    expect(readClaim({ key: "CA.X.Z", program: null, page: "https://ircc.canada.ca/x/fees.asp", fee: { anchor: "temporary", name: "Missing row" }, claim: "c" }, SYNTHETIC_FEES)).toEqual({ missing: expect.stringContaining("Missing row") });
    const long = excerpt("word ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(600);
    expect(long.endsWith("…")).toBe(true);
  });

  it("captures the page on the server: its SHA-256, time and printed dates, or says why not", async () => {
    const url = "https://laws-lois.justice.gc.ca/eng/regulations/X/FullText.html#s-7";
    const ok = await captureClaimPage(url, (async () => new Response(SYNTHETIC_LAW, { status: 200 })) as typeof fetch, () => new Date("2026-10-25T12:00:00Z"));
    expect(ok.snapshot).toMatchObject({ retrieved_at: "2026-10-25T12:00:00.000Z", http_status: 200 });
    expect(ok.snapshot?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect("dates" in ok && ok.dates).toEqual({ modifiedOn: "2026-02-02", lastAmendedOn: "2025-12-01", currentTo: "2026-01-31" });
    const down = await captureClaimPage(url, (async () => { throw new Error("timeout"); }) as typeof fetch);
    expect(down).toEqual({ snapshot: null, reason: "The page couldn’t be reached from Casevoya." });
    expect((await captureClaimPage("https://example.com/a/b#c", fetch)).snapshot).toBeNull();
  });

  it("ships captured drafts that each cite a deep official page, captured with a hash and time", () => {
    expect(CAPTURED_CLAIMS.length).toBeGreaterThan(0);
    for (const page of CAPTURED_PAGES) {
      expect(page.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isNaN(Date.parse(page.retrievedAt))).toBe(false);
    }
    for (const claim of CAPTURED_CLAIMS) {
      expect(claimUrlProblem(claim.sourceUrl)).toBeNull();
      expect(CAPTURED_PAGES.some((page) => page.url === claim.page)).toBe(true);
      expect(claim.excerpt.length).toBeLessThanOrEqual(600);
      expect(claim.key).toMatch(/^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9_]*)+$/);
    }
  });
});

const CAPTURED: ClaimEvidenceRow = {
  sourceUrl: "https://laws-lois.justice.gc.ca/eng/regulations/X/FullText.html#s-7",
  section: "Section 7",
  excerpt: "7 (1) A fee of $1 is payable for a synthetic application.",
  formNumber: null,
  formModifiedOn: null,
  publishedOn: null,
  modifiedOn: "2026-02-02",
  lastAmendedOn: "2025-12-01",
  currentTo: "2026-01-31",
  checkedOn: "2026-10-25",
  attestedOn: null,
  attestedBy: null,
  snapshot: { sha256: "a".repeat(64), retrievedAt: "2026-10-25T12:00:00Z", finalUrl: "https://laws-lois.justice.gc.ca/eng/regulations/X/FullText.html", publisher: "Justice Laws" },
};

const NOW = new Date("2026-10-25T15:00:00Z");

function rule(status: string, facts: Partial<NonNullable<RuleRow["facts"]>> = {}): RuleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    stableKey: "CA.CLAIM.SYNTHETIC.C1",
    versionNumber: 1,
    jurisdiction: "CA",
    programKey: "synthetic",
    status,
    effectiveFrom: null,
    nextReviewAt: null,
    claim: "Synthetic claim.",
    applicabilityNote: null,
    reviewer: null,
    lastChecked: null,
    affected: 0,
    source: null,
    facts: {
      status,
      resolution: null,
      applicabilityNote: null,
      effectiveFrom: null,
      effectiveTo: null,
      reviewedAt: null,
      reviewer: null,
      statusReason: null,
      evidence: [CAPTURED],
      version: 3,
      value: "$1",
      ...facts,
    },
  };
}

const viewer = (role: string) => ({ organizationId: "22222222-2222-4222-8222-222222222222", role, today: "2026-10-25", timeZone: "America/Toronto", now: NOW });

describe("Review workbench", () => {
  it("names each review state, with Unknown for any date the page doesn't state", () => {
    const facts = (status: string, extra: Partial<NonNullable<RuleRow["facts"]>> = {}) => rule(status, extra).facts!;
    expect(claimStatus(facts("draft", { evidence: [] }), NOW).label).toBe("Draft");
    expect(claimStatus(facts("evidence_captured"), NOW)).toMatchObject({ label: "Unresolved", detail: "applicability not resolved" });
    expect(claimStatus(facts("professional_review", { resolution: "partly" }), NOW).label).toBe("Ready for approval");
    expect(claimStatus(facts("rejected"), NOW).label).toBe("Rejected");
    expect(claimStatus(facts("suspended"), NOW).label).toBe("Suspended");
    expect(claimStatus(facts("published"), NOW).label).toBe("Approved, live");
    expect(claimStatus(facts("published", { effectiveTo: "2026-10-01T04:00:00Z" }), NOW).label).toBe("Expired");

    expect(claimDates(CAPTURED, { effectiveFrom: null, reviewedAt: null })).toEqual([
      { label: "Published", value: "Unknown" },
      { label: "Modified", value: "2 Feb 2026" },
      { label: "Last amended", value: "1 Dec 2025" },
      { label: "Effective", value: "Unknown" },
      { label: "Current to", value: "31 Jan 2026" },
      { label: "Retrieved", value: "25 Oct 2026" },
      { label: "Reviewed", value: "Unknown" },
    ]);
    expect(claimDates({ ...CAPTURED, snapshot: null }, { effectiveFrom: null, reviewedAt: "2026-10-25T14:00:00Z" }).find((line) => line.label === "Retrieved")?.value).toBe("Unknown");
  });

  it("offers each step only to a licensed reviewer and only in the right state; asks for the attestation without a capture", () => {
    const waiting = templatesData({ tab: "rule", program: [], messages: [], rules: [], packs: 0, selected: rule("evidence_captured"), today: "2026-10-25", viewer: viewer("licensed_consultant") });
    expect(waiting.rule?.review).toMatchObject({ canResolve: true, canApprove: false, canReject: true, canSuspend: false, version: 3, applicability: expect.stringMatching(/^Not resolved yet/) });
    expect(waiting.rule?.source).toBeNull();
    expect(waiting.rule?.summary).toBe("Unresolved. CA, synthetic. Effective Unknown.");
    const ready = templatesData({ tab: "rule", program: [], messages: [], rules: [], packs: 0, selected: rule("professional_review", { resolution: "applies", applicabilityNote: "Synthetic note" }), today: "2026-10-25", viewer: viewer("firm_owner") });
    expect(ready.rule?.review).toMatchObject({ canApprove: true, applicability: "Applies. Synthetic note", needsAttestation: false, nextReviewDefault: "2027-01-23" });
    const manager = templatesData({ tab: "rule", program: [], messages: [], rules: [], packs: 0, selected: rule("professional_review", { resolution: "applies" }), today: "2026-10-25", viewer: viewer("case_manager") });
    expect(manager.rule?.review).toMatchObject({ licensed: false, canResolve: false, canApprove: false, canReject: false, canSuspend: false });
    const live = templatesData({ tab: "rule", program: [], messages: [], rules: [], packs: 0, selected: rule("published", { resolution: "applies" }), today: "2026-10-25", viewer: viewer("licensed_consultant") });
    expect(live.rule?.review).toMatchObject({ canApprove: false, canSuspend: true, status: { label: "Approved, live" } });
    const uncaptured = templatesData({ tab: "rule", program: [], messages: [], rules: [], packs: 0, selected: rule("professional_review", { resolution: "applies", evidence: [{ ...CAPTURED, snapshot: null }] }), today: "2026-10-25", viewer: viewer("firm_owner") });
    expect(uncaptured.rule?.review?.needsAttestation).toBe(true);

    const html = renderToStaticMarkup(createElement(SheetTemplates, { data: waiting }));
    expect(html).toContain("Evidence (1)");
    expect(html).toContain("Unknown");
    expect(html).toContain(`SHA-256 ${"a".repeat(64)}`);
    expect(html).toContain("Resolve applicability");
    expect(html).not.toContain("Approve and publish");
    const dialogs = renderToStaticMarkup(createElement(ClaimReviewDialogs, { review: uncaptured.rule!.review! }));
    expect(dialogs).toContain('data-claim-act="approve"');
    expect(dialogs).toContain("data-attest");
    expect(renderToStaticMarkup(createElement(SheetTemplates, { data: manager }))).toContain("A firm owner or licensed consultant resolves applicability");
  });

  it("puts versions waiting for review first, and offers Add claim with the captured drafts to staff who may add", () => {
    const data = templatesData({ tab: "sources", program: [], messages: [], rules: [rule("published"), rule("evidence_captured")], packs: 0, selected: null, today: "2026-10-25", viewer: viewer("case_manager"), addClaim: claimAddData({ organizationId: "o", role: "case_manager" }, "2026-10-25") });
    expect(data.sources.rows.map((row) => row.state.label)).toEqual(["Unresolved", "Approved, live"]);
    expect(data.sources.addClaim?.canAdd).toBe(true);
    expect(claimAddData({ organizationId: "o", role: "assistant" }, "2026-10-25").canAdd).toBe(false);
    const html = renderToStaticMarkup(createElement(AddClaimDialog, { data: data.sources.addClaim! }));
    expect(html).toContain('data-claim-act="add"');
    expect(html).toContain(CAPTURED_CLAIMS[0].key);
    expect(renderToStaticMarkup(createElement(SheetTemplates, { data }))).toContain('data-dlg="dlgClaim"');
  });

  it("explains the database's refusals plainly", () => {
    expect(claimError("a homepage is not evidence: give the exact page the claim is on")).toMatch(/homepage/);
    expect(claimError("Casevoya has no capture of this page: approving it needs your attestation that you opened the official page yourself and the entry matches it")).toMatch(/Tick that you opened/);
    expect(claimError("you entered this yourself, so another licensed member of the firm approves it")).toMatch(/another licensed member/);
    expect(claimError("publication blocked: approval_required")).toBe("That couldn’t be saved.");
  });
});
