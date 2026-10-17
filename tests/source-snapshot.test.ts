import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SOURCE_HOSTS,
  RULES_SECTION_5_SAMPLE,
  assertPublishable,
  officialUrlIsAllowlisted,
  parseSourceSnapshot,
  publicationBlockers,
  RulePublicationError,
  SourceSnapshotValidationError,
} from "@/modules/content-governance";

const HASH = "a".repeat(64);

function snapshot(finalUrl: string) {
  return {
    sourceId: "00000000-0000-4000-8000-000000000001",
    finalUrl,
    publisher: "Immigration, Refugees and Citizenship Canada",
    retrievedAt: "2026-10-01T12:00:00Z",
    contentHash: HASH,
    retrievalResult: "success" as const,
  };
}

describe("official host allowlist", () => {
  it("matches the migration seed, including cic.gc.ca", () => {
    const sql = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../supabase/migrations/20261017110000_source_governance.sql",
      ),
      "utf8",
    );
    const seeded = [...sql.matchAll(/\('([a-z0-9.-]+)', 'suffix'/g)].map((match) => match[1]);
    expect(seeded).toEqual([...OFFICIAL_SOURCE_HOSTS]);
    expect(seeded).toContain("canada.ca");
    expect(seeded).toContain("cic.gc.ca");
  });

  it("allows IRCC hosts and rejects a cic.gc.ca lookalike", () => {
    const allowed = [
      "https://www.canada.ca/en/immigration-refugees-citizenship/fictional-casevoya",
      "https://ircc.canada.ca/fictional-casevoya",
      "https://cic.gc.ca/fictional-casevoya",
      "https://www.cic.gc.ca/fictional-casevoya",
      "https://services.cic.gc.ca/fictional-casevoya",
    ];
    for (const url of allowed) {
      expect(officialUrlIsAllowlisted(url), url).toBe(true);
      const parsed = parseSourceSnapshot(snapshot(url));
      expect(parsed.allowedHost).toBe(new URL(url).hostname);
      expect(parsed.publishedAt).toBeNull();
      expect(parsed.publishedOn).toBeNull();
      expect(parsed.modifiedAt).toBeNull();
      expect(parsed.modifiedOn).toBeNull();
      expect(parsed.currentTo).toBeNull();
      expect(parsed.reviewStatus).toBe("draft");
    }

    const rejected = [
      "https://cic.gc.ca.evil.com/fictional-casevoya",
      "https://www.canada.ca.evil.com/fictional-casevoya",
      "https://notcanada.ca/fictional-casevoya",
      "https://evilcanada.ca/fictional-casevoya",
      "http://www.canada.ca/en/immigration-refugees-citizenship/fictional-casevoya",
      "https://example.com/fictional-casevoya",
    ];
    for (const url of rejected) {
      expect(officialUrlIsAllowlisted(url), url).toBe(false);
      expect(() => parseSourceSnapshot(snapshot(url))).toThrow(SourceSnapshotValidationError);
      try {
        parseSourceSnapshot(snapshot(url));
      } catch (error) {
        expect(error).toBeInstanceOf(SourceSnapshotValidationError);
        expect((error as SourceSnapshotValidationError).message).toMatch(/allowlist/);
      }
    }
  });

  it("does not invent a retrieval time or a content hash", () => {
    expect(() =>
      parseSourceSnapshot({ ...snapshot("https://cic.gc.ca/fictional-casevoya"), contentHash: undefined }),
    ).toThrow(SourceSnapshotValidationError);
    expect(() =>
      parseSourceSnapshot({ ...snapshot("https://cic.gc.ca/fictional-casevoya"), retrievedAt: undefined }),
    ).toThrow(SourceSnapshotValidationError);
  });
});

describe("rule publication gate", () => {
  it("rejects the incomplete RULES section 5 sample", () => {
    const blockers = publicationBlockers(RULES_SECTION_5_SAMPLE);
    expect(blockers).toEqual(
      expect.arrayContaining([
        "missing_claim",
        "missing_source_url",
        "missing_content_hash",
        "missing_retrieved_at",
        "missing_reviewer",
        "missing_effective_applicability",
      ]),
    );
    expect(() => assertPublishable(RULES_SECTION_5_SAMPLE)).toThrow(RulePublicationError);
  });

  it("accepts a fictional cic.gc.ca record and rejects a copied retrieval date", () => {
    const complete = {
      ...RULES_SECTION_5_SAMPLE,
      claim: "FICTIONAL fixture. Not an immigration requirement.",
      source_url: "https://www.cic.gc.ca/fictional-casevoya",
      source_section: "fictional-section",
      source_publisher: "Immigration, Refugees and Citizenship Canada",
      effective_from: "2020-01-01T00:00:00Z",
      retrieved_at: "2026-10-01T12:00:00Z",
      content_hash: HASH,
      reviewed_by: "00000000-0000-4000-8000-000000000002",
      reviewed_at: "2026-10-16T15:00:00Z",
      next_review_at: "2026-11-01T00:00:00Z",
      test_case_ids: ["fictional-case"],
    };
    expect(publicationBlockers(complete)).toEqual([]);

    expect(
      publicationBlockers({
        ...complete,
        effective_from: complete.retrieved_at,
      }),
    ).toContain("effective_from_copies_retrieved_at");

    expect(
      publicationBlockers({
        ...complete,
        source_url: "https://cic.gc.ca.evil.com/fictional-casevoya",
      }),
    ).toContain("source_url_not_allowlisted");
  });
});
