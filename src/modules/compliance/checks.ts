/**
 * The Close privacy request form's own checks, shared by the page (before anything is sent, so an
 * empty or incomplete form is answered in place instead of after a step-up) and the server action
 * (before the database call, which asks for a step-up first). The database checks again.
 */
export type PrivacyCloseDraft = {
  kind?: string | null;
  outcome: string;
  refusalReason: string;
  evidence: string;
  deliveredBy: string;
  note: string;
};

export function privacyCloseProblem(draft: PrivacyCloseDraft): { field: string; error: string } | null {
  if (!["fulfilled", "partly_fulfilled", "refused", "withdrawn"].includes(draft.outcome)) return { field: "pcO", error: "Choose an outcome." };
  if (draft.kind === "deletion" && !["refused", "withdrawn"].includes(draft.outcome)) {
    return { field: "pcO", error: "Records aren’t deleted here: refuse the deletion with a reason, or record it withdrawn." };
  }
  const refusal = draft.refusalReason.trim();
  if (draft.outcome === "refused" && refusal.length < 3) return { field: "pcR", error: "Give the reason for refusing." };
  const evidence = draft.evidence.trim();
  if ((draft.outcome === "fulfilled" || draft.outcome === "partly_fulfilled") && evidence.length < 3) {
    return { field: "pcE", error: "Record the evidence of what was done." };
  }
  if (evidence.length > 2000) return { field: "pcE", error: "Keep the evidence under 2,000 characters." };
  const delivery = draft.deliveredBy.trim();
  if (delivery && (delivery.length < 3 || delivery.length > 200)) return { field: "pcD", error: "Write how it was delivered in 3 to 200 characters." };
  const note = draft.note.trim();
  if (note && (note.length < 3 || note.length > 2000)) return { field: "pcN", error: "Write the note in 3 to 2,000 characters." };
  return null;
}
