import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripeLive, stripeServer } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import { EVIDENCE_MAX_BYTES } from "@/modules/finance/credits-present";
import { submitDisputeEvidence, type EvidenceContext } from "@/modules/finance/dispute-evidence";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Evidence for a card dispute (FIN-13), in the server's Stripe mode: multipart form data with `org`, `dispute`
 * (the invoice_disputes id), `explanation` and one `file`. Run as the signed-in staff member; the
 * database decides who may (billing access, recent step-up) before Stripe is called with the
 * platform's test key on the firm's connected account. The file goes to Stripe only.
 */
export async function POST(request: Request) {
  // Cookie-authenticated, so only this site's own pages may post here.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This must come from Casevoya.", 403);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > EVIDENCE_MAX_BYTES + 64 * 1024) return refuse("Use a file under 4.5 MB.", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse("Choose a file.", 400);
  }
  const org = String(form.get("org") ?? "");
  const dispute = String(form.get("dispute") ?? "");
  const explanation = String(form.get("explanation") ?? "");
  const file = form.get("file");
  if (!isUuid(org)) return refuse("Choose a firm.", 400);
  if (!(file instanceof File)) return refuse("Choose a file.", 400);
  if (file.size > EVIDENCE_MAX_BYTES) return refuse("Use a file under 4.5 MB.", 413);

  const supabase = await createClient({ organizationId: org });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return refuse("Sign in first.", 401);
  const actor = String(claims.claims.sub);
  const stripe = stripeServer();
  if (!stripe) return refuse("Stripe isn’t configured for this environment. Nothing was sent to Stripe.", 503);

  const live = stripeLive();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await submitDisputeEvidence(
    { disputeId: dispute, explanation, fileName: file.name, bytes },
    {
      livemode: live,
      context: async (id) => {
        const { data, error } = await supabase.rpc("dispute_evidence_context", { p_dispute_id: id });
        return { data: (data ?? null) as EvidenceContext | null, error: error?.message ?? null };
      },
      uploadFile: async ({ accountId, bytes: data, name, type }) => {
        const created = await stripe.files.create(
          { purpose: "dispute_evidence", file: { data: Buffer.from(data), name, type } },
          { stripeAccount: accountId },
        );
        // Created with the server's key, so it is in the server's mode.
        return { id: created.id, livemode: live };
      },
      submit: async ({ accountId, disputeId, fileId, explanation: text }) => {
        const updated = await stripe.disputes.update(
          disputeId,
          { evidence: { uncategorized_file: fileId, ...(text ? { uncategorized_text: text } : {}) }, submit: true },
          { stripeAccount: accountId },
        );
        return { livemode: updated.livemode };
      },
      // Recorded by the server only (the database refuses it from a signed-in session), for the
      // user who passed dispute_evidence_context above.
      record: async (args) => {
        try {
          const { error } = await createServiceClient().rpc("service_record_dispute_evidence", { ...args, p_actor: actor });
          return { error: error?.message ?? null };
        } catch {
          return { error: "evidence was not recorded" };
        }
      },
    },
  );
  if ("error" in result) return refuse(result.error, result.status);
  return NextResponse.json({ ok: true, fileName: result.fileName });
}
