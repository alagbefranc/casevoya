/** Pure helpers for the Documents page's review dialog: what it sends, and where a step-up goes. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DocumentReviewInput = {
  versionId: string;
  expectedVersion: number;
  decision: "accepted" | "changes_requested";
  reason: string;
  /** A new expiry date, null to clear it, or undefined when unchanged. */
  expiry?: string | null;
};

/** What the dialog sends, or the first thing to fix. The database checks all of it again. */
export function readDocumentReview(fields: {
  versionId?: string;
  version?: string;
  decision?: string;
  reason?: string;
  expires?: string;
  previousExpires?: string;
}): { input: DocumentReviewInput } | { error: string } {
  const versionId = (fields.versionId ?? "").trim();
  const expectedVersion = Number(fields.version);
  if (!UUID.test(versionId) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return { error: "Open the review from a document in the list." };
  const decision = fields.decision === "changes_requested" ? "changes_requested" : fields.decision === "accepted" ? "accepted" : null;
  if (!decision) return { error: "Choose a decision." };
  const reason = (fields.reason ?? "").trim();
  if (reason.length < 3) return { error: decision === "accepted" ? "Say briefly why it is accepted." : "Say what the client needs to change." };
  if (reason.length > 2000) return { error: "Keep the reason under 2,000 characters." };
  const expires = (fields.expires ?? "").trim();
  if (expires && !DATE.test(expires)) return { error: "Enter the expiry as a date." };
  const previous = (fields.previousExpires ?? "").trim();
  const expiry = expires === previous ? undefined : expires || null;
  return { input: { versionId, expectedVersion, decision, reason, expiry } };
}

/** The step-up screen, coming back to Documents with the same review open (`?dlg=review&doc=`). */
export function reviewStepUpLocation(pathname: string, search: string, versionId: string): string {
  const params = new URLSearchParams(search);
  params.set("dlg", "review");
  params.set("doc", versionId);
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`;
}
