"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { QuoteInstalmentInput, QuoteLineInput } from "@/components/sheet/designer/agreements-quote";
import { quoteError, readClauseEdit, readNewQuote, readQuoteConvert, readQuoteEdit, type QuoteEditFields } from "@/modules/sheet/agreements-views-present";

/**
 * The Sheet's quote and clause actions, run as the signed-in staff member. Every rule (licensed
 * membership, aal2 and recent step-up, sample mode, locked versions, mandatory clauses) is the
 * database's: these call the security-invoker wrappers and map refusals to short copy. A step-up
 * refusal comes back as the step-up message so the page can send the person to /mfa?step=6.
 */
async function staffClient(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

/** New quote: on the chosen matter, from an approved quote template or blank. */
export async function createQuote(input: { organizationId: string; matter: string; template: string; title: string }): Promise<{ agreementId: string } | { error: string }> {
  const read = readNewQuote(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("create_quote", {
    p_matter_id: read.input.matterId,
    p_title: read.input.title,
    p_template_id: read.input.templateId,
  });
  if (error) return { error: quoteError(error.message) };
  if (typeof data !== "string") return { error: "The quote was not created." };
  return { agreementId: data };
}

/** Edit quote: scope, texts, expiry, lines and instalments. The database totals it and decides. */
export async function saveQuote(input: {
  organizationId: string;
  agreementId: string;
  fields: QuoteEditFields;
  lines: QuoteLineInput[];
  instalments: QuoteInstalmentInput[];
}): Promise<{ versionId: string } | { error: string }> {
  const read = readQuoteEdit(input.agreementId, input.fields, input.lines, input.instalments);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const quote = read.input;
  const { data, error } = await session.supabase.rpc("save_quote", {
    p_agreement_id: quote.agreementId,
    p_scope: quote.scope,
    p_services: quote.services,
    p_exclusions: quote.exclusions,
    p_deliverables: quote.deliverables,
    p_fee_structure: quote.feeStructure,
    p_refund_policy: quote.refundPolicy,
    p_quote_expires_on: quote.expiresOn,
    p_government_fee_note: quote.governmentFeeNote,
    p_lines: quote.lines,
    p_instalments: quote.instalments,
  });
  if (error) return { error: quoteError(error.message) };
  if (typeof data !== "string") return { error: "The quote was not saved." };
  return { versionId: data };
}

/** Send quote: locks the version with its hash; the client accepts it in their portal. No email is sent (no approved design). */
export async function sendQuote(input: { organizationId: string; agreementId: string }): Promise<{ status: string } | { error: string }> {
  if (!isUuid(input.agreementId)) return { error: "Choose the quote to send." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("send_quote", { p_agreement_id: input.agreementId });
  if (error) return { error: quoteError(error.message) };
  const status = data && typeof data === "object" && !Array.isArray(data) && typeof data.status === "string" ? data.status : "sent";
  return { status };
}

/** Turn into agreement: a service-agreement draft from an approved service template. */
export async function quoteToAgreement(input: { organizationId: string; agreementId: string; template: string }): Promise<{ agreementId: string } | { error: string }> {
  const read = readQuoteConvert(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("quote_to_agreement", { p_agreement_id: read.input.agreementId, p_template_id: read.input.templateId });
  if (error) return { error: quoteError(error.message) };
  if (typeof data !== "string") return { error: "The agreement was not created." };
  return { agreementId: data };
}

/** Edit a clause: in place on an unsent draft, else a new version. The database refuses mandatory clauses and executed agreements. */
export async function editAgreementClause(input: { organizationId: string; agreementId: string; clauseId: string; body: string }): Promise<{ versionId: string } | { error: string }> {
  const read = readClauseEdit(input);
  if ("error" in read) return { error: read.error };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("edit_agreement_clause", {
    p_agreement_id: read.input.agreementId,
    p_clause_id: read.input.clauseId,
    p_body: read.input.body,
  });
  if (error) return { error: quoteError(error.message) };
  if (typeof data !== "string") return { error: "The clause was not saved." };
  return { versionId: data };
}
