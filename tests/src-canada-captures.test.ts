import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CLAIMS,
  capture,
  readChecklistItems,
  readEdition,
  readFormPage,
  readProgramSection,
} from "../scripts/ops/capture-official-claims.mjs";
import canada from "@/modules/content-governance/captured-canada-ca.json";
import { CAPTURED_CLAIMS, CAPTURED_PAGES, capturedPage } from "@/modules/content-governance/captured-claims";
import { claimUrlProblem, hashableBytes, readPageDates } from "@/modules/content-governance/claim-capture";
import { captureClaimPage } from "@/modules/content-governance/claim-page";
import { claimAddData } from "@/modules/sheet/source-claims-load";
import { preparedClaims } from "../scripts/ops/load-official-claims.mjs";

/**
 * SRC-01/02: canada.ca captures. The HTML and PDF text below are synthetic (form IMM 9999, made-up
 * sections); the committed capture is checked for shape and counts, never for its values.
 */

const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

/** Two variants of the script Akamai injects into each canada.ca response (per-request ak.* values). */
const injected = (rid: string, t: string, ak: string) =>
  `<script type="text/javascript">(window.BOOMR_mq=window.BOOMR_mq||[]).push(["addVar",{"rua.upush":"false","rua.cpush":"false"}]);</script>` +
  `<script>!function(a){var e="https://s.go-mpulse.net/boomerang/",t="addEventListener";a.BOOMR_config={};}(window);` +
  `(window.BOOMR_mq=window.BOOMR_mq||[]).push(["addVar",{"ak.v":"39","ak.cp":"1","ak.rid":"${rid}","ak.t":"${t}","ak.ak":"${ak}","ak.tlsv":"tls1.3"}]);</script>`;

const page = (body: string, script = "") => `<!DOCTYPE html><html lang="en"><head><title>Synthetic - Canada.ca</title>${script}<script src="/etc/wet.js"></script></head><body><main>${body}
<section class="pagedetails"><gcds-date-modified>2026-01-15</gcds-date-modified></section></main></body></html>`;

const FORM_PAGE = page(`<h1 property="name" id="wb-cont">Synthetic Form (IMM 9999)</h1>
<div class="alert alert-warning"><p>A new version of this form is available (01-2026). Make sure you are using the most recent version.</p></div>
<h2>Download the form</h2>
<p><a href="/content/dam/ircc/documents/pdf/english/kits/forms/imm9999/01-01-2026/imm9999e.pdf">Synthetic Form [IMM 9999] (PDF, 1.0 MB)</a>
<div class="mrgn-tp-sm"><span class="badge">Last updated: January 2026</span></div></p>`);

const PROGRAM_PAGE = page(`<h1 id="wb-cont">Who can apply</h1>
<h2 id="s1">Eligibility requirements</h2><p>You must meet <strong>all</strong> of these.</p><!-- <p>Hidden notice</p> --><ul><li>One</li><li>Two</li></ul>
<h3 id="s1a">A sub-heading</h3><p>Still in the section.</p>
<h2 id="s2">Next section</h2><p>Not this.</p>`);

const CHECKLIST_TEXT = `IMM 9999 (01-2026) E
FORMS LIST: The following IRCC forms must be completed, signed, and dated.
1
Synthetic form one (IMM 0001).
Note: A synthetic note.
2
Synthetic form two (IMM 0002), if applicable
\fPage 1 of 2
DOCUMENTS LIST:
1
Synthetic document one.
Save Reset Form Print Form
DOCUMENTS LIST (CONTINUED):
2
Synthetic document two,
continued on a second line.
IMM 9999 (01-2026) E Page 2 of 2`;

describe("canada.ca pages", () => {
  it("reads the Date modified canada.ca prints as <gcds-date-modified>", () => {
    expect(readPageDates(page("<h1>x</h1>"))).toEqual({ modifiedOn: "2026-01-15", lastAmendedOn: null, currentTo: null });
    expect(readPageDates('<gcds-date-modified lang="en"> 2025-12-12 </gcds-date-modified>').modifiedOn).toBe("2025-12-12");
    // The footer's <time property="dateModified"> wins when a page has both; an impossible date stays Unknown.
    expect(readPageDates('<time property="dateModified">2026-02-02</time><gcds-date-modified>2026-01-15</gcds-date-modified>').modifiedOn).toBe("2026-02-02");
    expect(readPageDates("<gcds-date-modified>2026-02-31</gcds-date-modified>").modifiedOn).toBeNull();
  });

  it("hashes a page without the CDN's per-request script, so two fetches of the same page hash equal", async () => {
    const one = page("<h1>Same</h1>", injected("2b6c1a4", "1729850000", "hOBiQwZUYzCg5VSAfCLimQ=="));
    const two = page("<h1>Same</h1>", injected("9f00e7d", "1729850003", "zz1QwZUYzCg5VSAfCLimQ=="));
    expect(one).not.toBe(two);
    const enc = (text: string) => new TextEncoder().encode(text);
    const a = hashableBytes(enc(one), "text/html;charset=utf-8");
    const b = hashableBytes(enc(two), "text/html;charset=utf-8");
    expect(a.basis).toBe("html-without-injected-scripts");
    expect(sha(a.bytes)).toBe(sha(b.bytes));
    // Only the injected scripts go: the page's own script and content stay, and a content change still shows.
    expect(new TextDecoder().decode(a.bytes)).toContain('<script src="/etc/wet.js"></script>');
    expect(sha(hashableBytes(enc(page("<h1>Changed</h1>", injected("2b6c1a4", "1", "x"))), "text/html").bytes)).not.toBe(sha(a.bytes));
    // A page without such a script, and a PDF, hash as the bytes received.
    const plain = enc(page("<h1>Same</h1>"));
    expect(hashableBytes(plain, "text/html")).toEqual({ bytes: plain, basis: "bytes" });
    const pdf = enc(`%PDF-1.7 ${injected("1", "2", "3")}`);
    expect(hashableBytes(pdf, "application/pdf").basis).toBe("bytes");

    // The server's Add claim fetch hashes the same way, and matches the capture script's hash.
    const at = () => new Date("2026-10-25T12:00:00Z");
    const serve = (html: string) => (async () => new Response(html, { status: 200, headers: { "content-type": "text/html;charset=utf-8" } })) as typeof fetch;
    const url = "https://www.canada.ca/en/immigration-refugees-citizenship/services/x/y.html#s1";
    const first = await captureClaimPage(url, serve(one), at);
    const second = await captureClaimPage(url, serve(two), at);
    expect(first.snapshot?.sha256).toBe(sha(a.bytes));
    expect(second.snapshot?.sha256).toBe(first.snapshot?.sha256);
    expect("dates" in first && first.dates.modifiedOn).toBe("2026-01-15");
  });

  it("reads a form page's download badge, the PDF edition and its source, and checklist items word for word", () => {
    const spec = { page: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm9999.html", formNumber: "IMM 9999" };
    expect(readFormPage(spec, FORM_PAGE)).toEqual({
      title: "Synthetic Form (IMM 9999)",
      pdfUrl: "https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm9999/01-01-2026/imm9999e.pdf",
      claim: "IRCC form page for Synthetic Form (IMM 9999): the downloadable form is “Synthetic Form [IMM 9999] (PDF, 1.0 MB)”, marked “Last updated: January 2026”.",
      sourceUrl: `${spec.page}#wb-cont`,
      section: "Synthetic Form (IMM 9999) > Download the form",
      value: "Last updated: January 2026",
      excerpt: "A new version of this form is available (01-2026). Make sure you are using the most recent version. Download the form: Synthetic Form [IMM 9999] (PDF, 1.0 MB) Last updated: January 2026",
    });
    expect(readFormPage(spec, page("<h1 id='wb-cont'>No download</h1>"))).toEqual({ missing: expect.any(String) });

    expect(readEdition(spec, { raw: "x\nIMM 9999 (01-2026) E\n", xfa: null })).toMatchObject({ value: "01-2026", excerpt: "IMM 9999 (01-2026) E", editionSource: "printed text (pdftotext)" });
    expect(readEdition(spec, { raw: "Please wait...", xfa: "IMM 9999 (02-2026) E\n" })).toMatchObject({ value: "02-2026", editionSource: "XFA template drawn text (formNum)" });
    expect(readEdition(spec, { raw: "Please wait...", xfa: "@variables.Version=03-2026\n" })).toMatchObject({
      value: "03-2026",
      excerpt: "variables.Version=03-2026",
      section: "Form template metadata (version field)",
      editionSource: "XFA template metadata, not a drawn stamp",
    });
    expect(readEdition(spec, { raw: "Please wait...", xfa: null })).toEqual({ missing: expect.any(String) });

    expect(readChecklistItems(CHECKLIST_TEXT, "IMM 9999")).toEqual([
      { list: "Forms list", heading: "FORMS LIST: The following IRCC forms must be completed, signed, and dated.", n: 1, text: "Synthetic form one (IMM 0001). Note: A synthetic note." },
      { list: "Forms list", heading: "FORMS LIST: The following IRCC forms must be completed, signed, and dated.", n: 2, text: "Synthetic form two (IMM 0002), if applicable" },
      { list: "Documents list", heading: "DOCUMENTS LIST:", n: 1, text: "Synthetic document one." },
      { list: "Documents list", heading: "DOCUMENTS LIST:", n: 2, text: "Synthetic document two, continued on a second line." },
    ]);
  });

  it("reads a program page section from its heading to the next heading of its level, without hidden comments or the page footer", () => {
    const spec = { page: "https://www.canada.ca/en/immigration-refugees-citizenship/services/x/eligibility.html", section: { id: "s1" } };
    expect(readProgramSection(spec, PROGRAM_PAGE)).toEqual({
      title: "Who can apply",
      claim: "IRCC program page “Who can apply”, section “Eligibility requirements”, as published.",
      sourceUrl: `${spec.page}#s1`,
      section: "Who can apply > Eligibility requirements",
      value: null,
      excerpt: "Eligibility requirements You must meet all of these. One Two A sub-heading Still in the section.",
      sectionText: "Eligibility requirements You must meet all of these. One Two A sub-heading Still in the section.",
    });
    expect(readProgramSection({ ...spec, section: { id: "nope" } }, PROGRAM_PAGE)).toEqual({ missing: "no #nope" });
  });

  it("captures the canada.ca targets with a Chrome User-Agent, one fetch per page, and leaves out what it can't read", async () => {
    const formPage = (id: string) => FORM_PAGE.replaceAll("imm9999", id).replaceAll("IMM 9999", id.replace(/^([a-z]+)/, (l) => `${l.toUpperCase()} `));
    const agents = new Set<string>();
    const seen: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push(url);
      agents.add(new Headers(init.headers).get("user-agent") ?? "");
      const form = /application-forms-guides\/(imm5476)\.html$/.exec(url);
      if (form) return new Response(formPage(form[1]), { status: 200, headers: { "content-type": "text/html" } });
      if (url.endsWith("imm5476e.pdf")) return new Response("%PDF-1.7 synthetic", { status: 200, headers: { "content-type": "application/pdf" } });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const logged: string[] = [];
    const results = await capture({ fetcher, now: () => new Date("2026-10-25T12:00:00Z"), log: (line: string) => logged.push(line), delayMs: 0, pdfReader: () => ({ raw: "IMM 5476 (01-2026) E", xfa: null, kind: "static (pdftotext)" }) });
    expect([...agents]).toEqual([expect.stringMatching(/Chrome\/\d+/)]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(results.canada.complete).toBe(false);
    expect(results.canada.data.claims.map((claim: { key: string }) => claim.key)).toEqual(["CA.FORM.IMM5476", "CA.FORM.IMM5476.EDITION"]);
    expect(results.canada.data.claims[1]).toMatchObject({ page: expect.stringMatching(/imm5476e\.pdf$/), sourceUrl: expect.stringMatching(/imm5476e\.pdf$/), section: "Page footer (edition stamp)", value: "01-2026", formNumber: "IMM 5476" });
    const pages = results.canada.data.pages as { url: string; modifiedOn: string | null; sha256Of: string; title: string; printedDates: { modified: string } }[];
    expect(pages.map((p) => p.modifiedOn)).toEqual(["2026-01-15", null]);
    expect(pages[0].printedDates.modified).toBe("2026-01-15");
    expect(pages[1]).toMatchObject({ sha256Of: "bytes", title: "Synthetic Form (IMM 5476) (PDF)", printedDates: { modified: "Unknown" } });
    expect(logged.some((line) => line.startsWith("Left out CA.FORM.IMM5406:"))).toBe(true);
  });
});

describe("committed canada.ca drafts", () => {
  const claims = canada.claims as { key: string; category: string; page: string; sourceUrl: string; section: string; excerpt: string; value: string | null; claim: string }[];

  it("has the 55 captured targets: 26 form, 18 checklist and 11 program claims, the same keys as the capture script", () => {
    const count = (category: string) => claims.filter((claim) => claim.category === category).length;
    expect([claims.length, count("form"), count("checklist"), count("program")]).toEqual([55, 26, 18, 11]);
    expect(claims.filter((claim) => claim.key.startsWith("CA.CHECKLIST.IMM5483.FORM_"))).toHaveLength(6);
    expect(claims.filter((claim) => claim.key.startsWith("CA.CHECKLIST.IMM5483.DOC_"))).toHaveLength(10);
    const scripted = (CLAIMS as { key: string; out?: string }[]).filter((spec) => spec.out === "canada").map((spec) => spec.key);
    expect(claims.map((claim) => claim.key)).toEqual(scripted);
    expect(new Set(CAPTURED_CLAIMS.map((claim) => claim.key)).size).toBe(CAPTURED_CLAIMS.length);
  });

  it("cites a deep official page with its anchor or named section, within the database's limits, and stores only drafts", () => {
    for (const claim of claims) {
      expect(claimUrlProblem(claim.sourceUrl, claim.section)).toBeNull();
      expect(new URL(claim.sourceUrl).hostname).toBe("www.canada.ca");
      expect(claim.excerpt.length).toBeLessThanOrEqual(600);
      expect(claim.section.length).toBeLessThanOrEqual(300);
      expect((claim.value ?? "").length).toBeLessThanOrEqual(200);
      expect(claim.claim.length).toBeLessThanOrEqual(2000);
      expect(capturedPage(claim.page)).not.toBeNull();
      // Drafts only: no status, review or approval travels with a captured claim.
      expect(Object.keys(claim).filter((name) => /status|review|approv|publish|live/i.test(name))).toEqual([]);
    }
  });

  it("keeps every date the page prints, with modifiedOn set from the printed Date modified", () => {
    for (const p of canada.pages) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.printedDates.retrieved).toBe(p.retrievedAt);
      const printed = p.printedDates.modified;
      expect(p.modifiedOn).toBe(printed === "Unknown" ? null : printed);
      if (p.contentType?.includes("html")) expect(p.modifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      else expect(p.modifiedOn).toBeNull();
    }
    expect(CAPTURED_PAGES.length).toBe(3 + canada.pages.length);
  });

  it("no longer offers them in Add claim: the loader loads them as live official claims (decision 2026-10-25)", () => {
    const data = claimAddData({ organizationId: "o", role: "case_manager" }, "2026-10-25");
    expect(Object.keys(data).sort()).toEqual(["canAdd", "organizationId", "today"]);
    const prepared = preparedClaims([{ name: "captured-canada-ca.json", data: canada as never }]);
    expect(prepared.refused).toEqual([]);
    const form = prepared.claims.find((item) => item.payload.key === claims.find((claim) => claim.category === "form")!.key)!;
    expect(form.payload.form_number).toMatch(/^[A-Z]+ \d{4}$/);
    expect(form.payload.page.modified_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
