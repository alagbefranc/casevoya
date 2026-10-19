"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { isLicensedMembership, LICENCE_FACT_COLUMNS } from "@/lib/tenant/roles";
import { clientEvidence } from "@/modules/agreements/evidence";
import { sealEnvelope } from "@/modules/agreements/seal";
import {
  agreementStaffError,
  authorityError,
  countersignerFor,
  isSendableKind,
  type NewAgreementFields,
  readAuthority,
  readCountersign,
  readNewAgreement,
  readNewTemplate,
  readVoid,
  sameTerms,
  signersFor,
} from "@/modules/sheet/agreements-present";
import { memberNames } from "@/modules/sheet/chrome-load";

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

type StaffSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The matter's responsible consultant, with whether they are licensed (mirrors
 * app.membership_is_licensed, which send_agreement checks again) and their name.
 */
async function responsibleConsultant(supabase: StaffSupabase, org: string, membershipId: string | null) {
  if (!membershipId) return null;
  const [membership, credential, names] = await Promise.all([
    supabase.from("memberships").select("id, role, status").eq("organization_id", org).eq("id", membershipId).maybeSingle(),
    supabase.from("consultant_credentials").select(LICENCE_FACT_COLUMNS).eq("organization_id", org).eq("membership_id", membershipId).maybeSingle(),
    memberNames(supabase, org),
  ]);
  const row = membership.data;
  const licensed = Boolean(row && row.status === "active" && isLicensedMembership(row.role, credential.data ?? null));
  const name = names.get(membershipId);
  return { membershipId, licensed, name: name && name !== "Unassigned" ? name : null };
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

type Signers = ReturnType<typeof signersFor>;

/**
 * Who signs an agreement of this kind on this matter: the applicant, the sponsor when there is
 * one, then the responsible licensed consultant for a countersigned kind. `{ error }` when nobody
 * can sign or countersign. The database checks every signer again on send.
 */
async function signersForMatter(
  supabase: StaffSupabase,
  org: string,
  matterId: string,
  kind: string,
): Promise<{ signers: Signers; sample: boolean } | { error: string }> {
  const [participants, matter] = await Promise.all([
    supabase.from("matter_participants").select("person_id, role").eq("organization_id", org).eq("matter_id", matterId),
    supabase.from("matters").select("responsible_consultant_membership_id, is_sample").eq("organization_id", org).eq("id", matterId).maybeSingle(),
  ]);
  const personIds = [...new Set((participants.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const people = personIds.length
    ? await supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds)
    : null;
  const names = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  // Clients sign first; the responsible licensed consultant countersigns last, for the firm.
  const countersigner = countersignerFor(kind, await responsibleConsultant(supabase, org, matter.data?.responsible_consultant_membership_id ?? null));
  if (countersigner && "error" in countersigner) return { error: countersigner.error };
  const signers = signersFor(participants.data ?? [], names, countersigner);
  if (!signers.some((signer) => signer.role === "client")) {
    return { error: "This matter has no applicant to sign. Add the applicant to the matter first." };
  }
  return { signers, sample: matter.data?.is_sample === true };
}

async function sendAgreement(supabase: StaffSupabase, agreementId: string, signers: Signers): Promise<{ status: string } | { error: string }> {
  const sent = await supabase.rpc("send_agreement", {
    p_agreement_id: agreementId,
    p_signers: signers,
    p_idempotency_key: `sheet-send-${agreementId}`,
    p_expires_at: null,
  });
  if (sent.error) return { error: agreementStaffError(sent.error.message) };
  const result = sent.data && typeof sent.data === "object" && !Array.isArray(sent.data) ? sent.data : {};
  return { status: typeof result.status === "string" ? result.status : "sent" };
}

/**
 * Creates an agreement on a matter from an approved template and, unless `draft` is set, sends
 * it for in-house signature: the applicant first, then the sponsor when there is one. A draft this
 * firm already made from the same template on the same matter, with exactly the same terms (scope,
 * fee, currency, exclusions, refund policy, government fees note), and never sent, is used instead
 * of making a second one (so a retry after a step-up does not leave duplicate drafts). The fee
 * comes in as typed and is converted to minor units here. `sample`: the matter is a sample one,
 * so nobody real is emailed.
 */
export async function createAndSendAgreement(
  input: { organizationId: string; draft?: boolean } & NewAgreementFields,
): Promise<{ agreementId: string; status: string; sample: boolean } | { error: string; draftId?: string }> {
  const read = readNewAgreement(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const org = input.organizationId;
  const { matterId, templateId, ...terms } = read.input;

  const template = await supabase.from("agreement_templates").select("id, kind, name, status").eq("organization_id", org).eq("id", templateId).maybeSingle();
  if (!template.data || template.data.status !== "approved") return { error: "Choose an approved agreement template." };
  if (!isSendableKind(template.data.kind)) return { error: "Quotes and amendments are not sent from this dialog." };
  const who = await signersForMatter(supabase, org, matterId, template.data.kind);
  if ("error" in who) return { error: who.error };

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
  if (input.draft) return { agreementId, status: "draft", sample: who.sample };

  const sent = await sendAgreement(supabase, agreementId, who.signers);
  if ("error" in sent) return { error: sent.error, draftId: agreementId };
  return { agreementId, status: sent.status, sample: who.sample };
}

/** Sends a draft that was saved without sending (the agreement's own view: Send for signature). */
export async function sendAgreementDraft(input: {
  organizationId: string;
  agreementId: string;
}): Promise<{ agreementId: string; status: string; sample: boolean } | { error: string }> {
  if (!isUuid(input.agreementId)) return { error: "Choose the agreement to send." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const org = input.organizationId;
  const agreement = await supabase.from("agreements").select("id, matter_id, kind, status").eq("organization_id", org).eq("id", input.agreementId).maybeSingle();
  if (!agreement.data) return { error: "That agreement isn’t available." };
  if (agreement.data.status !== "draft") return { error: "This agreement was already sent." };
  if (!isSendableKind(agreement.data.kind)) return { error: "Quotes and amendments are not sent from here." };
  const who = await signersForMatter(supabase, org, agreement.data.matter_id, agreement.data.kind);
  if ("error" in who) return { error: who.error };
  const sent = await sendAgreement(supabase, agreement.data.id, who.signers);
  if ("error" in sent) return { error: sent.error };
  return { agreementId: agreement.data.id, status: sent.status, sample: who.sample };
}

/** Voids an envelope still out for signature. The envelope and its events stay on record. */
export async function voidAgreementEnvelope(input: { organizationId: string; envelopeId: string; reason: string }): Promise<{ ok: true } | { error: string }> {
  const read = readVoid(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { error } = await session.supabase.rpc("void_agreement_envelope", { p_envelope_id: read.input.envelopeId, p_reason: read.input.reason });
  if (error) return { error: agreementStaffError(error.message) };
  return { ok: true };
}

/**
 * Records government representation authority for one client on one matter
 * (public.representation_authorities). Separate from any agreement: signing a service agreement
 * never records it. The database checks the role (firm owner or licensed consultant), the
 * step-up and the matter, and audits it.
 */
export async function recordRepresentationAuthority(input: {
  organizationId: string;
  client: string;
  scope: string;
  evidence: string;
  effective: string;
}): Promise<{ id: string } | { error: string }> {
  const read = readAuthority(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("record_representation_authority", {
    p_matter_id: read.input.matterId,
    p_person_id: read.input.personId,
    p_scope: read.input.scope,
    p_evidence_locator: read.input.evidence,
    p_effective_on: read.input.effectiveOn,
    p_agreement_id: null,
  });
  if (error) return { error: authorityError(error.message) };
  if (typeof data !== "string") return { error: "The authority was not recorded." };
  return { id: data };
}

/**
 * Countersign: the signed-in staff member signs an envelope where they are the current signer,
 * with the same consent the portal records. The database checks the turn, the identity, the
 * consultant's licence, aal2 and a recent step-up; a step-up refusal comes back as the step-up
 * message so the page can send the person to /mfa?step=6 and reopen the dialog after. When this
 * is the last signature, the laid-out sealed PDF is rendered and attached here (the first
 * download does it otherwise).
 */
export async function countersignAgreement(input: {
  organizationId: string;
  envelopeId: string;
  consent: boolean;
}): Promise<{ status: string } | { error: string }> {
  const read = readCountersign(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const evidence = await clientEvidence();
  const { data, error } = await session.supabase.rpc("sign_agreement", {
    p_envelope_id: read.input.envelopeId,
    p_consent: true,
    p_idempotency_key: `sheet-countersign-${read.input.envelopeId}-${crypto.randomUUID()}`,
    p_ip: evidence.ip,
    p_user_agent: evidence.userAgent,
  });
  if (error) return { error: agreementStaffError(error.message) };
  const status = data && typeof data === "object" && !Array.isArray(data) && typeof data.status === "string" ? data.status : "signed";
  if (status === "completed") await sealEnvelope(read.input.envelopeId);
  return { status };
}
