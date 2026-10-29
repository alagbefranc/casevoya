import { describe, expect, it } from "vitest";
import { claimSourceCopy, claimSourcesFrom } from "@/modules/content-governance/claim-source-present";
import { extractSection, recheckBody, valueStillPrinted, type DueSource } from "@/modules/content-governance/source-recheck";

const source = (over: Partial<DueSource> = {}): DueSource => ({
  source_id: "11111111-1111-1111-1111-111111111111",
  url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic/page.html",
  content_hash: "a".repeat(64),
  claims: [{
    definition_id: "22222222-2222-2222-2222-222222222222",
    key: "CA.SYNTH.PAGE",
    category: "program",
    claim: "Synthetic claim.",
    value: null,
    section: "Synthetic section",
    source_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic/page.html#s1",
    excerpt: "Synthetic claim.",
  }],
  ...over,
});

const html = `<html><body><h2 id="s1">Synthetic section</h2><p>The page says this exact sentence.</p><h2 id="s2">Next</h2></body></html>`;

describe("source re-check", () => {
  it("reads the section the page prints and does not invent a missing one", () => {
    const claim = source().claims[0];
    expect(extractSection(html, claim)).toContain("The page says this exact sentence.");
    expect(extractSection(html, { ...claim, source_url: claim.source_url?.replace("#s1", "#missing") ?? null, section: null })).toBeNull();
  });

  it("keeps a stored value only when the new section still prints it", () => {
    expect(valueStillPrinted("CAD 10", "The fee is CAD 10 today.")).toBe("CAD 10");
    expect(valueStillPrinted("CAD 10", "The fee line was removed.")).toBeNull();
  });

  it("treats the same hash as unchanged and a missing section as partial", () => {
    const fetched = {
      sha256: "a".repeat(64),
      html,
      retrievedAt: "2026-10-29T12:00:00.000Z",
      httpStatus: 200,
      finalUrl: source().url,
      dates: { modifiedOn: null, lastAmendedOn: null, currentTo: null },
    };
    expect(recheckBody(source(), fetched).result).toBe("unchanged");
    const changed = recheckBody(source({ content_hash: "b".repeat(64) }), fetched);
    expect(changed.result).toBe("changed");
    if (changed.result === "changed") expect(changed.claims?.[0]?.claim).toContain("exact sentence");
    const unread = recheckBody(source({ content_hash: "b".repeat(64), claims: [{ ...source().claims[0], source_url: source().url, section: null }] }), fetched);
    expect(unread.result).toBe("partial");
    if (unread.result === "partial") expect(unread.claims).toBeUndefined();
  });
});

describe("client source context", () => {
  it("keeps the official link and the date, and says when a review is pending", () => {
    const map = claimSourcesFrom([{ request_id: "r1", url: "https://www.canada.ca/en/example.html", checked_on: "2026-10-01", review_pending: true, conflict_urls: ["https://www.canada.ca/a", "https://www.canada.ca/b"] }]);
    const source = map.get("r1");
    expect(source?.checkedOn).toBe("2026-10-01");
    expect(claimSourceCopy(source!, "1 Oct 2026").pending).toMatch(/reviewing a difference/);
    expect(claimSourceCopy({ url: source!.url, checkedOn: "2026-10-01", reviewPending: false, conflictUrls: null }, "1 Oct 2026").pending).toBeNull();
  });
});
