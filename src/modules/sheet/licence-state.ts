/**
 * One set of words for a consultant's licence, used on every page (decision 2026-10-19: the firm
 * owner counts as licensed; a declared licence is enough to work and invite real clients; the
 * CICC register list check reads Verified, Needs review or Declared).
 *
 *   verified      the number matched the CICC register list (or a manual register check)
 *   needs_review  the list check couldn't confirm it (number not found, name differs); nothing is blocked
 *   declared      on file, not checked against the list yet; nothing is blocked
 *   blocked       revoked, suspended, inactive or not entitled to practise: new matters are locked
 *   owner         the firm owner with no credential on file: counts as licensed
 */
export type LicenceState = "verified" | "needs_review" | "declared" | "blocked" | "owner";

const BLOCKED = new Set(["revoked", "suspended", "inactive", "not_entitled"]);

/** The state from the credential's status and the result of its latest check (licence_check_result). */
export function licenceState(input: { status: string | null | undefined; latestResult?: string | null; isOwner?: boolean }): LicenceState {
  const status = input.status ?? null;
  if (!status) return input.isOwner ? "owner" : "declared";
  if (status === "verified") return "verified";
  if (BLOCKED.has(status)) return "blocked";
  return input.latestResult === "needs_review" ? "needs_review" : "declared";
}

/** The badge words, the same on Licences, New matter, the sample-mode page and anywhere else. */
export const LICENCE_STATE_LABEL: Record<LicenceState, string> = {
  verified: "Verified",
  needs_review: "Needs review",
  declared: "Declared",
  blocked: "Blocked",
  owner: "Owner",
};

/** The same state in a sentence ("Licence: declared, not checked against the CICC list yet"). */
export const LICENCE_STATE_SENTENCE: Record<LicenceState, string> = {
  verified: "verified on the CICC register list",
  needs_review: "needs review: the CICC list check couldn’t confirm it",
  declared: "declared, not checked against the CICC list yet",
  blocked: "blocked by the regulator’s status",
  owner: "the firm owner counts as licensed",
};
