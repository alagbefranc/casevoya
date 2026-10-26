import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFeeRows, refreshFeeClaim, refreshLawClaim, splitSpousalRow } from "../scripts/ops/capture-official-claims.mjs";
import { loadOfficialClaims, preparedClaims, readCaptureFiles } from "../scripts/ops/load-official-claims.mjs";
import { lawFullSectionText } from "@/modules/content-governance/claim-capture";
import { asMaintenance, createTestDb, type TestDb } from "./helpers/postgres";

/**
 * The capture script's live re-read of the fee list and Justice Laws (decision 6, 2026-10-25) on
 * synthetic pages, and the loader on the committed capture files: what is refused and why, and a
 * full load into PGlite that is idempotent.
 */

const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp";
const PAGE = { sha256: "a".repeat(64), retrievedAt: "2026-10-25T12:00:00.000Z" };

// A synthetic fee list in the live page's shape: sections (h2 with id), groups (h3), sub-groups
// (h4), a table's own header row, a row's small note. Fictional names and amounts.
const FEE_HTML = `<main>
<h2 id="temporary">Temporary Residence</h2>
<h3>Synthetic permits</h3>
<table><thead><tr><th>Fees</th><th>$CAN</th></tr></thead><tbody>
<tr><td><strong>Synthetic permit – per person</strong></td><td>11.00</td></tr>
<tr><td><p><strong>Include a synthetic child</strong></p></td><td>3.00&nbsp;<sup>(per&nbsp;child)</sup></td></tr>
</tbody></table>
<h3>Synthetic removals</h3>
<table><thead><tr><th>You left before a synthetic date</th><th>$CAN</th></tr></thead><tbody>
<tr><td><strong>Synthetic country</strong></td><td>7.00</td></tr></tbody></table>
<h2 id="permanent">Permanent Residence</h2>
<h3>Synthetic programs</h3>
<h4>Opened in a synthetic year</h4>
<table><tbody><tr><td><strong>Your application</strong></td><td>5.00</td></tr></tbody></table>
<h3 id="rprf">Right of permanent residence fee</h3>
<table><tbody><tr><td><strong>Right of permanent residence fee</strong></td><td>2.00</td></tr></tbody></table>
<h2 id="sponsorship">Family sponsorship</h2>
<h3>Spouse, partner or children (abroad)</h3>
<table><tbody>
<tr><td><p class='mrgn-bttm-0'><strong>Sponsor your spouse or partner without right of permanent residence fee</strong></p><p class='small'>This amount includes the sponsorship fee, the processing fee and the right of permanent residence fee.</p></td><td>4.00</td></tr>
</tbody></table>
</main>`;

const fee = (section: string, value: string, feed: unknown = { value }) => ({
  key: "CA.FEES.SYNTHETIC",
  category: "fee",
  page: FEES,
  sourceUrl: FEES,
  section,
  claim: "Synthetic fee claim.",
  value,
  feeFeedCheck: feed,
});

describe("the fee list re-read", () => {
  const rows = readFeeRows(FEE_HTML);

  it("reads each row under all its headings", () => {
    expect(rows.map((row) => [row.path.join(" > "), row.names[0], row.amountCents, row.qualifier])).toEqual([
      ["Temporary Residence > Synthetic permits", "Synthetic permit – per person", 1100, null],
      ["Temporary Residence > Synthetic permits", "Include a synthetic child", 300, "(per child)"],
      ["Temporary Residence > Synthetic removals > You left before a synthetic date", "Synthetic country", 700, null],
      ["Permanent Residence > Synthetic programs > Opened in a synthetic year", "Your application", 500, null],
      ["Permanent Residence > Right of permanent residence fee", "Right of permanent residence fee", 200, null],
      ["Family sponsorship > Spouse, partner or children (abroad)", "Sponsor your spouse or partner without right of permanent residence fee", 400, null],
    ]);
  });

  it("keeps a fee only when the live amount matches the capture and fees.json, with the page's hash", () => {
    const kept = refreshFeeClaim(fee("Temporary Residence > Synthetic permits > Include a synthetic child", "$3.00 CAD per child", { value: "$3" }), rows, PAGE);
    expect(kept).toMatchObject({ claim: { value: "$3.00 CAD per child", sourceUrl: `${FEES}#temporary`, liveCheck: { sha256: PAGE.sha256 } } });
    const nested = refreshFeeClaim(fee("Permanent Residence > Synthetic programs > Opened in a synthetic year > Your application", "$5.00 CAD"), rows, PAGE);
    expect(nested).toHaveProperty("claim");
    expect(refreshFeeClaim(fee("Temporary Residence > Synthetic permits > Synthetic permit – per person", "$12.00 CAD"), rows, PAGE)).toEqual({
      refused: "the live fee list prints $11.00 CAD, the capture said $12.00 CAD",
    });
    expect(refreshFeeClaim(fee("Temporary Residence > Synthetic permits > Synthetic permit – per person", "$11.00 CAD", { value: "$10" }), rows, PAGE)).toEqual({
      refused: "the live fee list prints $11.00 CAD, fees.json said $10",
    });
    expect(refreshFeeClaim(fee("Temporary Residence > Synthetic permits > Not on the page", "$1.00 CAD"), rows, PAGE)).toHaveProperty("refused");
  });

  it("splits a spousal row into its parts, keeping only the part printed on its own row (the RPRF)", () => {
    const row = { ...fee("Family sponsorship > Spouse, partner or children (abroad) > Sponsor your spouse or partner without right of permanent residence fee", "$4.00 CAD"), key: "CA.FEES.SPOUSE_ABROAD_NO_RPRF", program: "spousal_sponsorship", title: "Fee list" };
    const split = splitSpousalRow(row, rows, PAGE);
    expect(split.claims.map((part) => [part.key, part.value, part.sourceUrl])).toEqual([["CA.FEES.SPOUSE_ABROAD_RPRF_PART", "$2.00 CAD", `${FEES}#rprf`]]);
    expect(split.notLoaded.map((part) => part.key)).toEqual(["CA.FEES.SPOUSE_ABROAD_SPONSORSHIP_PART", "CA.FEES.SPOUSE_ABROAD_PROCESSING_PART"]);
    // Nothing is calculated: each part's amount is one the page prints on a row of its own.
    for (const part of split.claims) expect(rows.some((printed) => `$${(printed.amountCents / 100).toFixed(2)} CAD` === part.value && printed.names[0] === "Right of permanent residence fee")).toBe(true);
  });
});

describe("the Justice Laws re-read", () => {
  const LAW = `<h3>Synthetic division</h3>
<p class="MarginalNote"><span class="wb-invisible">Marginal note:</span>Synthetic rule</p>
<ul class="Section ProvisionList"><li><p class="Subsection"><strong><a class="sectionLabel" id="s-7"><span class="sectionLabel">7</span></a></strong> <span class="lawlabel">(1)</span> A synthetic person must do a synthetic thing.</p></li>
<li><p class="MarginalNote"><span class="wb-invisible">Marginal note:</span>Exception</p><p class="Subsection"><span class="lawlabel">(2)</span> Unless:</p><ul class="ProvisionList"><li><p class="Paragraph"><span class="lawlabel">(a)</span> it is synthetic.</p></li></ul></li></ul>
<div class="HistoricalNote"><ul class="HistoricalNote"><li class="HistoricalNoteSubItem">2001, c. 1, s. 7</li></ul></div>
<p class="MarginalNote"><span class="wb-invisible">Marginal note:</span>Next</p><p class="Section"><strong><a class="sectionLabel" id="s-7.1"><span class="sectionLabel">7.1</span></a></strong> A single synthetic provision.</p><div class="HistoricalNote"><ul class="HistoricalNote"><li>2002, c. 2</li></ul></div>
<p class="MarginalNote"><span class="wb-invisible">Marginal note:</span>Last</p><p class="Section"><strong><a class="sectionLabel" id="s-8"><span class="sectionLabel">8</span></a></strong> Another.</p>`;

  it("reads a whole section, with its marginal notes and paragraphs, and no amendment history", () => {
    expect(lawFullSectionText(LAW, "s-7")).toBe("7 (1) A synthetic person must do a synthetic thing. Marginal note: Exception (2) Unless: (a) it is synthetic.");
    expect(lawFullSectionText(LAW, "s-7.1")).toBe("7.1 A single synthetic provision.");
    expect(lawFullSectionText(LAW, "s-9")).toBeNull();
  });

  it("uses the live text and the live page's dates, and says whether it matches the XML", () => {
    const claim = {
      key: "CA.SYNTH.S7",
      category: "law",
      page: "https://laws-lois.justice.gc.ca/eng/acts/S-0/FullText.html",
      sourceUrl: "https://laws-lois.justice.gc.ca/eng/acts/S-0/FullText.html#s-7",
      section: "Section 7",
      claim: "Synthetic Act, section 7, consolidated text current to 2000-01-01 (full text in sectionText).",
      value: null,
      sectionText: "7 (1) An older synthetic text.",
    };
    const result = refreshLawClaim(claim, LAW, { ...PAGE, currentTo: "2026-09-30", lastAmendedOn: "2026-03-26" });
    expect(result).toMatchObject({
      claim: {
        claim: "Synthetic Act, section 7, consolidated text current to 2026-09-30.",
        currentTo: "2026-09-30",
        lastAmended: "2026-03-26",
        liveCheck: { text: "differs from Justice Canada's XML: the live page's text is used" },
      },
    });
  });
});

describe("the committed capture files", () => {
  const prepared = preparedClaims(readCaptureFiles());

  it("refuses the fee placeholders, the non-federal page and the split rows, and nothing it loads has them", () => {
    const reasons = prepared.refused.map((item) => item.reason);
    expect(reasons.filter((reason) => /Error loading fee/.test(reason))).toHaveLength(11);
    expect(prepared.refused.filter((item) => item.reason.startsWith("split into its parts")).map((item) => item.key).sort()).toEqual([
      "CA.FEES.SPOUSE_ABROAD_NO_RPRF",
      "CA.FEES.SPOUSE_IN_CANADA_NO_RPRF",
    ]);
    expect(prepared.refused.find((item) => item.key === "CA.CICC.REGISTER.SEARCH")?.reason).toMatch(/official Government of Canada page/);
    for (const { payload } of prepared.claims) {
      expect(`${payload.claim} ${payload.value ?? ""} ${payload.excerpt ?? ""}`).not.toMatch(/error loading fee/i);
      expect(payload.page.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("loads every fee and law claim from the live re-read, with the live page's hash", () => {
    const files = readCaptureFiles(["captured-all-sources.json"]);
    const pages = new Map((files[0].data.pages as { url: string; sha256: string }[]).map((page) => [page.url, page.sha256]));
    const claims = (files[0].data.claims as { category: string; page: string; refused?: string; liveCheck?: { sha256: string } }[]).filter(
      (claim) => (claim.category === "fee" || claim.category === "law") && !claim.refused,
    );
    expect(claims.length).toBeGreaterThan(300);
    for (const claim of claims) expect(claim.liveCheck?.sha256).toBe(pages.get(claim.page));
  });
});

describe("loading them into the database", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it("dry run counts, a load makes them live, and a second load changes nothing", async () => {
    await asMaintenance(db);
    const query = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
    const files = readCaptureFiles();
    const dry = await loadOfficialClaims({ query, files, dryRun: true });
    const total = (counts: Record<string, Record<string, number>>, field: string) => Object.values(counts).reduce((sum, count) => sum + count[field], 0);
    expect(total(dry.counts, "new")).toBe(prepared().claims.length);
    expect(Number((await db.query<{ n: string }>(`select count(*) as n from public.rule_versions where origin = 'official_capture'`)).rows[0].n)).toBe(0);

    const loaded = await loadOfficialClaims({ query, files, dryRun: false });
    expect(total(loaded.counts, "new")).toBe(prepared().claims.length);
    expect(total(loaded.counts, "refused")).toBe(prepared().refused.length);
    const live = await db.query<{ n: string }>(`select count(*) as n from public.rule_versions v where v.origin = 'official_capture' and app.rule_version_is_live(v.id)`);
    expect(Number(live.rows[0].n)).toBe(prepared().claims.length);

    const again = await loadOfficialClaims({ query, files, dryRun: false });
    expect(total(again.counts, "unchanged")).toBe(prepared().claims.length);
    expect(total(again.counts, "new") + total(again.counts, "changed")).toBe(0);
  }, 600_000);

  function prepared() {
    return preparedClaims(readCaptureFiles());
  }
});
