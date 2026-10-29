import { EVIDENCE_MAX_BYTES, evidenceError, evidenceName, evidenceType, type EvidenceType } from "@/modules/finance/credits-present";

/**
 * Sends evidence for a card dispute to Stripe (FIN-13, in the server's Stripe mode), in this order:
 *   1. the database says who may (billing access to the matter, a recent step-up), that the
 *      dispute still takes evidence before its deadline, and which connected account it is on;
 *   2. the file (PDF, JPEG or PNG by its bytes, at most 4.5 MB) goes to Stripe's Files API on the
 *      firm's connected account, purpose `dispute_evidence`;
 *   3. the dispute is updated with that file and the explanation and submitted (`submit: true`);
 *   4. the database records the file's name, type, size and Stripe id, and when it was submitted.
 * Casevoya keeps no copy of the file. Each step is a dependency so tests use fakes.
 */

export type EvidenceContext = { dispute_id: string; account_id: string; number?: string };

export type EvidenceDeps = {
  /** The server's Stripe mode (live in production). Defaults to test. */
  livemode?: boolean;
  context: (disputeId: string) => Promise<{ data: EvidenceContext | null; error: string | null }>;
  uploadFile: (args: { accountId: string; bytes: Uint8Array; name: string; type: EvidenceType }) => Promise<{ id: string; livemode: boolean }>;
  submit: (args: { accountId: string; disputeId: string; fileId: string; explanation: string | null }) => Promise<{ livemode: boolean }>;
  record: (args: {
    p_dispute_id: string;
    p_stripe_file_id: string;
    p_file_name: string;
    p_content_type: EvidenceType;
    p_size_bytes: number;
    p_explanation: string;
    p_submitted: boolean;
    p_livemode: boolean;
  }) => Promise<{ error: string | null }>;
};

export type EvidenceInput = { disputeId: string; explanation: string; fileName: string | null; bytes: Uint8Array };

export type EvidenceResult = { ok: true; fileName: string } | { error: string; status: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_ID = /^(du|dp)_[A-Za-z0-9]{6,250}$/;
const ACCOUNT = /^acct_[A-Za-z0-9]{6,250}$/;

export async function submitDisputeEvidence(input: EvidenceInput, deps: EvidenceDeps): Promise<EvidenceResult> {
  if (!UUID.test(input.disputeId)) return { error: "Choose the dispute.", status: 400 };
  const explanation = input.explanation.trim();
  if (explanation.length > 5000) return { error: "Keep the explanation under 5,000 characters.", status: 400 };
  if (input.bytes.byteLength === 0) return { error: "Choose a file.", status: 400 };
  if (input.bytes.byteLength > EVIDENCE_MAX_BYTES) return { error: "Use a file under 4.5 MB.", status: 413 };
  const type = evidenceType(input.bytes);
  if (!type) return { error: "Use a PDF, JPG or PNG file.", status: 415 };
  const name = evidenceName(input.fileName, type);

  const context = await deps.context(input.disputeId);
  if (context.error || !context.data) return { error: evidenceError(context.error ?? "billing access denied"), status: 403 };
  const { dispute_id: stripeDispute, account_id: accountId } = context.data;
  if (!STRIPE_ID.test(stripeDispute) || !ACCOUNT.test(accountId)) return { error: "This dispute can’t take evidence here.", status: 409 };

  const live = deps.livemode === true;
  let fileId: string;
  try {
    const file = await deps.uploadFile({ accountId, bytes: input.bytes, name, type });
    if (file.livemode !== live) return { error: "Stripe answered in the other mode (test or live). Nothing was submitted.", status: 409 };
    fileId = file.id;
  } catch {
    return { error: "Stripe didn’t take the file. Nothing was submitted; try again.", status: 502 };
  }
  try {
    const updated = await deps.submit({ accountId, disputeId: stripeDispute, fileId, explanation: explanation || null });
    if (updated.livemode !== live) return { error: "Stripe answered in the other mode (test or live).", status: 409 };
  } catch {
    // The file is on Stripe but nothing was submitted: record it as not submitted so it is known.
    await deps.record({ p_dispute_id: input.disputeId, p_stripe_file_id: fileId, p_file_name: name, p_content_type: type, p_size_bytes: input.bytes.byteLength, p_explanation: explanation, p_submitted: false, p_livemode: live }).catch(() => null);
    return { error: "Stripe didn’t accept the evidence. Nothing was submitted; check the dispute’s state and try again.", status: 502 };
  }
  const recorded = await deps.record({
    p_dispute_id: input.disputeId,
    p_stripe_file_id: fileId,
    p_file_name: name,
    p_content_type: type,
    p_size_bytes: input.bytes.byteLength,
    p_explanation: explanation,
    p_submitted: true,
    p_livemode: live,
  });
  if (recorded.error) return { error: "Stripe has the evidence, but it wasn’t recorded here. Don’t submit it again; the dispute’s state updates when Stripe’s event arrives.", status: 500 };
  return { ok: true, fileName: name };
}
