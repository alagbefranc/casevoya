"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import {
  agreementStaffError,
  isSendableKind,
  type NewAgreementFields,
  readNewAgreement,
  readNewTemplate,
  sameTerms,
  signersFor,
} from "@/modules/sheet/agreements-present";

/**
 * The Sheet's agreement actions, run as the signed-in staff member. Every rule (role, licence,
 * aal2 and recent step-up, sample mode, the responsible consultant's licence) is the database's:
 * these call the security-invoker wrappers and map refusals to short copy. No authenticator code
 * is sent; a step-up refusal comes back as the step-up message so the page can send the person
 * to /mfa?step=6.
 */
async function staffClient(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

export async function createAgreementTemplate(input: {
  organizationId: string;
  kind: string;
  name: string;
  body: string;
}): Promise<{ id: string } | { error: string }> {
  const read = readNewTemplate(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("create_agreement_template", {
    p_kind: read.input.kind,
    p_name: read.input.name,
    p_body: read.input.body,
  });
  if (error) return { error: agreementStaffError(error.message) };
  if (typeof data !== "string") return { error: "The template was not saved." };
  return { id: data };
}

export async function approveAgreementTemplate(input: {
  organizationId: string;
  templateId: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.templateId)) return { error: "Choose the template to approve." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { error } = await session.supabase.rpc("approve_agreement_template", { p_template_id: input.templateId });
  if (error) return { error: agreementStaffError(error.message) };
  return { ok: true };
}

/**
 * Creates an agreement on a matter from an approved template, then sends it for in-house
 * signature: the applicant first, then the sponsor when there is one. A draft this firm already
 * made from the same template on the same matter, with exactly the same terms (scope, fee,
 * currency, exclusions, refund policy, government fees note), and never sent, is sent instead of
 * making a second one (so a retry after a step-up does not leave duplicate drafts). The fee comes
 * in as typed and is converted to minor units here.
 */
export async function createAndSendAgreement(
  input: { organizationId: string } & NewAgreementFields,
): Promise<{ agreementId: string; status: string } | { error: string; draftId?: string }> {
  const read = readNewAgreement(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const org = input.organizationId;
  const { matterId, templateId, ...terms } = read.input;

  const [template, participants] = await Promise.all([
    supabase.from("agreement_templates").select("id, kind, name, status").eq("organization_id", org).eq("id", templateId).maybeSingle(),
    supabase.from("matter_participants").select("person_id, role").eq("organization_id", org).eq("matter_id", matterId),
  ]);
  if (!template.data || template.data.status !== "approved") return { error: "Choose an approved agreement template." };
  if (!isSendableKind(template.data.kind)) return { error: "Quotes and amendments are not sent from this dialog." };
  const personIds = [...new Set((participants.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const people = personIds.length
    ? await supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds)
    : null;
  const names = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const signers = signersFor(participants.data ?? [], names);
  if (signers.length === 0) return { error: "This matter has no applicant to sign. Add the applicant to the matter first." };

  // An unsent draft from this template on this matter, with the same terms, is reused.
  const drafts = await supabase
    .from("agreements")
    .select("id, current_version_id")
    .eq("organization_id", org)
    .eq("matter_id", matterId)
    .eq("template_id", templateId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1);
  const draft = drafts.data?.[0];
  const draftVersion = draft?.current_version_id
    ? await supabase
        .from("agreement_versions")
        .select("scope_summary, exclusions, refund_policy, fee_cents, currency, government_fee_note")
        .eq("organization_id", org)
        .eq("id", draft.current_version_id)
        .maybeSingle()
    : null;
  let agreementId = draft && draftVersion?.data && sameTerms(draftVersion.data, terms) ? draft.id : null;
  if (!agreementId) {
    const created = await supabase.rpc("create_agreement", {
      p_matter_id: matterId,
      p_kind: template.data.kind,
      p_title: template.data.name,
      // Null takes the approved template's text (the generated type says string; the function allows null).
      p_body: null as unknown as string,
      p_scope: terms.scope,
      p_exclusions: terms.exclusions,
      p_refund_policy: terms.refundPolicy,
      p_fee_cents: terms.feeCents,
      p_currency: terms.currency,
      p_government_fee_note: terms.governmentFeeNote,
      p_template_id: templateId,
      p_quote_expires_on: null,
      p_supersedes_id: null,
      p_comparison: null,
    });
    if (created.error) return { error: agreementStaffError(created.error.message) };
    if (typeof created.data !== "string") return { error: "The agreement was not created." };
    agreementId = created.data;
  }

  const sent = await supabase.rpc("send_agreement", {
    p_agreement_id: agreementId,
    p_signers: signers,
    p_idempotency_key: `sheet-send-${agreementId}`,
    p_expires_at: null,
  });
  if (sent.error) return { error: agreementStaffError(sent.error.message), draftId: agreementId };
  const result = sent.data && typeof sent.data === "object" && !Array.isArray(sent.data) ? sent.data : {};
  return { agreementId, status: typeof result.status === "string" ? result.status : "sent" };
}
