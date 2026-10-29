import type { PackEditorData } from "@/components/sheet/designer/program-pack-publish";
import type { OpenConflict, ConflictEvidence } from "@/components/sheet/designer/source-conflict-panel";
import type { RuleTestRow } from "@/components/sheet/designer/rule-tests-panel";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readPackEditor(organizationId: string, data: unknown): PackEditorData {
  const row = record(data);
  const claims = Array.isArray(row?.claims) ? row.claims : [];
  const members = Array.isArray(row?.members) ? row.members : [];
  return {
    organizationId,
    licensed: row?.licensed === true,
    claims: claims.flatMap((item) => {
      const claim = record(item);
      if (!claim || typeof claim.version_id !== "string" || typeof claim.key !== "string") return [];
      return [{
        versionId: claim.version_id,
        key: claim.key,
        programKey: typeof claim.program_key === "string" ? claim.program_key : null,
        claim: typeof claim.claim === "string" ? claim.claim : "",
      }];
    }),
    members: members.flatMap((item) => {
      const member = record(item);
      if (!member || typeof member.membership_id !== "string" || typeof member.licence !== "string") return [];
      return [{ membershipId: member.membership_id, name: typeof member.name === "string" ? member.name : "Licensed member", licence: member.licence }];
    }),
  };
}

export function readRuleTests(data: unknown): RuleTestRow[] {
  const row = record(data);
  const cases = Array.isArray(row?.cases) ? row.cases : [];
  return cases.flatMap((item) => {
    const test = record(item);
    if (!test || typeof test.id !== "string") return [];
    return [{
      id: test.id,
      kind: typeof test.kind === "string" ? test.kind : "",
      title: typeof test.title === "string" ? test.title : "",
      expected: typeof test.expected === "string" ? test.expected : "",
      actual: typeof test.actual === "string" ? test.actual : "",
      pass: test.pass === true,
    }];
  });
}

export function readConflict(data: unknown): OpenConflict | null {
  const row = record(data);
  if (!row || typeof row.id !== "string" || row.status !== "open") return null;
  if (typeof row.left_url !== "string" || typeof row.right_url !== "string") return null;
  return {
    id: row.id,
    leftUrl: row.left_url,
    rightUrl: row.right_url,
    reason: typeof row.opened_reason === "string" ? row.opened_reason : "",
    resolution: typeof row.resolution === "string" ? row.resolution : null,
    status: row.status,
  };
}

export function readConflictEvidence(rows: readonly { id: string; source_url: string | null; evidence_excerpt: string | null }[]): ConflictEvidence[] {
  return rows.flatMap((row) => {
    if (!row.source_url || !row.evidence_excerpt) return [];
    return [{ id: row.id, url: row.source_url, excerpt: row.evidence_excerpt }];
  });
}
