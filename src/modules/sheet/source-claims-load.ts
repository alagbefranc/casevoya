/**
 * SRC-01/02/03: maps the rows the Templates loader reads (RLS, as the signed-in staff member) into
 * the claim facts the workbench shows, and the Add claim dialog's choices. Nothing is filled in:
 * a date the evidence doesn't have stays null (Unknown on screen).
 */
import type { AddClaimData } from "@/components/sheet/designer/source-claims";
import type { SheetStaff } from "@/modules/sheet/load";
import type { ClaimEvidenceRow, ClaimFacts, Resolution } from "@/modules/sheet/source-claims-present";

type VersionRow = {
  id: string;
  version: number;
  status: string;
  status_reason: string | null;
  effective_from: string | null;
  effective_to: string | null;
  output_value: unknown;
  applicability: unknown;
  applicability_note: string | null;
};

type EvidenceRow = {
  snapshot_id: string | null;
  source_section: string | null;
  source_url: string | null;
  evidence_excerpt: string | null;
  form_number: string | null;
  form_modified_on: string | null;
  published_on: string | null;
  modified_on: string | null;
  last_amended_on: string | null;
  current_to: string | null;
  checked_on: string | null;
  page_attested_on: string | null;
  page_attested_by_membership_id: string | null;
};

type SnapshotRow = { publisher: string; final_url: string; retrieved_at: string; content_hash: string };

function field(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" && found.trim() ? found : null;
}

export function claimFactsFor(
  row: VersionRow,
  evidence: readonly EvidenceRow[],
  snapshots: ReadonlyMap<string, SnapshotRow>,
  reviewedAt: string | null,
  reviewer: string | null,
  names: ReadonlyMap<string, string>,
): ClaimFacts & { version: number; value: string | null } {
  const resolution = field(row.applicability, "resolution");
  const items: ClaimEvidenceRow[] = evidence.map((item) => {
    const snapshot = item.snapshot_id ? snapshots.get(item.snapshot_id) : undefined;
    return {
      sourceUrl: item.source_url,
      section: item.source_section,
      excerpt: item.evidence_excerpt,
      formNumber: item.form_number,
      formModifiedOn: item.form_modified_on,
      publishedOn: item.published_on,
      modifiedOn: item.modified_on,
      lastAmendedOn: item.last_amended_on,
      currentTo: item.current_to,
      checkedOn: item.checked_on,
      attestedOn: item.page_attested_on,
      attestedBy: item.page_attested_by_membership_id ? (names.get(item.page_attested_by_membership_id) ?? null) : null,
      snapshot: snapshot ? { sha256: snapshot.content_hash, retrievedAt: snapshot.retrieved_at, finalUrl: snapshot.final_url, publisher: snapshot.publisher } : null,
    };
  });
  return {
    status: row.status,
    resolution: resolution === "applies" || resolution === "does_not_apply" || resolution === "partly" ? (resolution as Resolution) : null,
    applicabilityNote: row.applicability_note,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    reviewedAt,
    reviewer,
    statusReason: row.status_reason,
    evidence: items,
    version: row.version,
    value: field(row.output_value, "text"),
  };
}

const ADDERS = new Set(["firm_owner", "licensed_consultant", "case_manager"]);

/**
 * The Add claim dialog: who may add. It no longer offers the committed capture files: the loader
 * loads those as live official claims (#188, decisions 2026-10-25); Add claim is for a claim the
 * firm enters itself (a processing time, for example), which keeps licensed approval.
 */
export function claimAddData(staff: Pick<SheetStaff, "organizationId" | "role">, today: string): AddClaimData {
  return {
    organizationId: staff.organizationId,
    canAdd: ADDERS.has(staff.role),
    today,
  };
}
