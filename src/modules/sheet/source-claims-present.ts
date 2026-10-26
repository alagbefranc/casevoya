/**
 * SRC-01, SRC-02, SRC-03: the review workbench in the Sheet's words. Pure. A claim is a rule
 * version with its evidence; every date shows on its own line and a date the page doesn't state
 * says "Unknown" (never filled from another date). The status names the six review states the
 * workbench tracks (draft, unresolved, rejected, suspended, expired, approved and live).
 */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { attestationError } from "@/modules/government/page-attestation";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

export const UNKNOWN = "Unknown";

export type Resolution = "applies" | "does_not_apply" | "partly";

export type ClaimEvidenceRow = {
  sourceUrl: string | null;
  section: string | null;
  excerpt: string | null;
  formNumber: string | null;
  formModifiedOn: string | null;
  publishedOn: string | null;
  modifiedOn: string | null;
  lastAmendedOn: string | null;
  currentTo: string | null;
  checkedOn: string | null;
  attestedOn: string | null;
  attestedBy: string | null;
  snapshot: { sha256: string; retrievedAt: string; finalUrl: string; publisher: string } | null;
};

export type ClaimFacts = {
  status: string;
  resolution: Resolution | null;
  applicabilityNote: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reviewedAt: string | null;
  reviewer: string | null;
  statusReason: string | null;
  evidence: readonly ClaimEvidenceRow[];
};

const RESOLUTION: Record<Resolution, string> = { applies: "Applies", does_not_apply: "Doesn’t apply", partly: "Applies in part" };

export function resolutionLabel(resolution: string | null | undefined): string | null {
  return resolution && resolution in RESOLUTION ? RESOLUTION[resolution as Resolution] : null;
}

/** Expired: approved, but the end date it states has passed. */
export function claimExpired(facts: Pick<ClaimFacts, "status" | "effectiveTo">, now: Date): boolean {
  return facts.status === "published" && Boolean(facts.effectiveTo) && new Date(facts.effectiveTo as string).getTime() <= now.getTime();
}

/** The workbench status: what a reviewer needs to know about this version now. */
export function claimStatus(facts: Pick<ClaimFacts, "status" | "resolution" | "effectiveTo" | "evidence">, now: Date): MatterBadge {
  if (claimExpired(facts, now)) return { tone: "gr", label: "Expired" };
  switch (facts.status) {
    case "published":
      return { tone: "ok", label: "Approved, live" };
    case "suspended":
      return { tone: "gr", label: "Suspended" };
    case "rejected":
      return { tone: "bad", label: "Rejected" };
    case "superseded":
      return { tone: "gr", label: "Superseded" };
    case "review_due":
      return { tone: "chg", label: "Review required" };
    case "approved":
      return { tone: "blue", label: "Approved" };
    default:
      break;
  }
  if (facts.evidence.length === 0) return { tone: "gr", label: "Draft" };
  if (facts.resolution === "applies" || facts.resolution === "partly") return { tone: "rev", label: "Ready for approval" };
  if (facts.resolution === "does_not_apply") return { tone: "chg", label: "Unresolved", detail: "resolved as not applying" };
  return { tone: "chg", label: "Unresolved", detail: "applicability not resolved" };
}

/** Waiting for a reviewer: the workbench queue. */
export function awaitingReview(status: string): boolean {
  return status === "draft" || status === "evidence_captured" || status === "professional_review" || status === "review_due";
}

function day(value: string | null): string {
  return value ? longDate(value.slice(0, 10)) : UNKNOWN;
}

function instantDay(value: string | null, timeZone: string): string {
  return value ? longDate(isoDateInTimeZone(new Date(value), timeZone)) : UNKNOWN;
}

/**
 * SRC-02: the dates of one piece of evidence, each on its own, in a fixed order. Retrieved is the
 * capture time (Unknown without a capture); Reviewed is the approving review's time.
 */
export function claimDates(
  evidence: ClaimEvidenceRow,
  facts: Pick<ClaimFacts, "effectiveFrom" | "reviewedAt">,
  timeZone = "America/Toronto",
): { label: string; value: string }[] {
  return [
    { label: "Published", value: day(evidence.publishedOn) },
    { label: "Modified", value: day(evidence.modifiedOn) },
    { label: "Last amended", value: day(evidence.lastAmendedOn) },
    { label: "Effective", value: facts.effectiveFrom ? instantDay(facts.effectiveFrom, timeZone) : UNKNOWN },
    { label: "Current to", value: day(evidence.currentTo) },
    { label: "Retrieved", value: evidence.snapshot ? instantDay(evidence.snapshot.retrievedAt, timeZone) : UNKNOWN },
    { label: "Reviewed", value: facts.reviewedAt ? instantDay(facts.reviewedAt, timeZone) : UNKNOWN },
  ];
}

/** "Captured by Casevoya, SHA-256 1d31…a865" or the attestation, or that it still needs one. */
export function captureLine(evidence: ClaimEvidenceRow): string {
  if (evidence.snapshot) return `Captured by Casevoya. SHA-256 ${evidence.snapshot.sha256}`;
  if (evidence.attestedOn) return `Page not captured by Casevoya, checked by ${evidence.attestedBy ?? "a licensed member"} on ${longDate(evidence.attestedOn)}`;
  return "Page not captured by Casevoya. The approving reviewer must open it and attest it matches.";
}

/** The database's refusals, in the Sheet's words. */
const ERRORS: [RegExp, string][] = [
  [/homepage/, "A homepage is not evidence: give the exact page the claim is on."],
  [/official Government of Canada page/, "The source must be an official Government of Canada page (canada.ca or a gc.ca site)."],
  [/section of the page/, "Give the link with its section anchor (#…), or name the section."],
  [/date checked/, "Add the date you checked the page (within the last year, not in the future)."],
  [/cannot be in the future/, "A date the page states can’t be in the future."],
  [/already waiting for review/, "A version of this claim is already waiting for review."],
  [/write the claim/, "Write the claim as the official page states it."],
  [/resolve applicability before approving/, "Resolve applicability before approving."],
  [/resolved as not applying/, "This claim was resolved as not applying, so it can’t be published. Reject it or resolve it again."],
  [/has expired/, "This version has expired: its end date has passed."],
  [/next review date/, "Choose the next review date (within two years)."],
  [/say why/, "Say why."],
  [/say who and what/, "Say who and what it applies to."],
  [/choose applies/, "Choose applies, doesn’t apply or applies in part."],
  [/nothing is waiting for review|only a version waiting|only a live version/, "This version isn’t in that state any more. Reload the page."],
  [/version conflict/, "Someone changed this version. Reload the page and try again."],
  [/staff access denied|review denied/, "Only a firm owner or licensed consultant whose licence is in good standing can do that."],
];

export function claimError(message: string): string {
  const gov = attestationError(message);
  if (gov) return gov;
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}
