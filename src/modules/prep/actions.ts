"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { isUuid } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { SUBMISSION_CHANNELS, type SubmissionChannel } from "@/modules/government/present";
import { snapshotOfficialPage, federalOfficialUrl } from "@/modules/submissions/official-page";
import { channelPatternOk, MAX_BUNDLE_MAX_BYTES, MIN_BUNDLE_MAX_BYTES } from "@/modules/prep/channel-name";
import type { ProposedField } from "@/modules/prep/fields";
import type { Json } from "@/types/database.types";

/**
 * PREP-01 and PREP-03 server actions. Each one calls a public wrapper as the signed-in member.
 * The database checks role, step-up and licence. No form field, version or date is invented here:
 * the words are what staff typed from an official page, and the snapshot is the page the server fetched.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  if (/official Government of Canada|section of the page|form identifier|form version|field review|manual completion|field key|field label|fact key|mapping version|date checked|effective date|jurisdiction|stale|not yet effective|no longer current|different program|current approved/i.test(message)) {
    const sentence = message.replace(/^./, (char) => char.toUpperCase());
    return sentence.endsWith(".") ? sentence : `${sentence}.`;
  }
  if (/entered this yourself/i.test(message)) return "You entered this yourself, so another licensed member of the firm approves it.";
  if (/no capture of this page|attestation/i.test(message)) return "Casevoya has no capture of this page. Approve it only after you open the official page yourself and enter that date.";
  if (/file name/i.test(message)) return "The file name may use {reference}, {channel} and {date}, and must end in .pdf.";
  if (/bundle size|1 MiB/i.test(message)) return "The bundle size limit must be between 1 MiB and 100 MiB. That is a Casevoya limit, not an IRCC rule.";
  if (/not a current document/i.test(message)) return "Choose a current file on this matter.";
  return "That couldn’t be saved.";
}

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

export async function proposeFormTemplate(
  input: {
    organizationId: string;
    jurisdiction: string;
    programKey: string | null;
    officialFormId: string;
    officialUrl: string;
    sourceSection: string | null;
    formVersion: string;
    effectiveOn: string | null;
    outputFormat: string;
    fields: ProposedField[];
    checkedOn: string;
  },
) {
  const url = input.officialUrl.trim();
  if (!federalOfficialUrl(url)) return { error: "The source must be an official Government of Canada page (canada.ca or gc.ca)." };
  if (!DATE.test(input.checkedOn)) return { error: "Enter the date you checked the official page." };
  if (input.effectiveOn && !DATE.test(input.effectiveOn)) return { error: "Enter the effective date only if the official page states one." };
  if (input.outputFormat !== "field_review" && input.outputFormat !== "manual_completion") return { error: "Choose field review or manual completion." };
  if (input.outputFormat === "field_review" && input.fields.length < 1) return { error: "A field review needs at least one field transcribed from the form." };
  if (input.outputFormat === "manual_completion" && input.fields.length > 0) return { error: "Manual completion has no mapped fields. Leave the field list empty." };
  const programKey = text(input.programKey);
  if (programKey && !/^[a-z0-9_]{1,80}$/.test(programKey)) return { error: "The program key uses lowercase letters, digits and underscores, or leave it blank." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const fetched = await snapshotOfficialPage(url, fetch);
  const { data, error } = await s.supabase.rpc("propose_form_template", {
    p_org: input.organizationId,
    p_jurisdiction: input.jurisdiction.trim(),
    p_program_key: programKey,
    p_official_form_id: input.officialFormId.trim(),
    p_official_url: url,
    p_source_section: text(input.sourceSection),
    p_form_version: input.formVersion.trim(),
    p_mapping_version: null,
    p_effective_on: input.effectiveOn && DATE.test(input.effectiveOn) ? input.effectiveOn : null,
    p_output_format: input.outputFormat,
    p_fields: input.fields as unknown as Json,
    p_checked_on: input.checkedOn,
    p_snapshot: (fetched.snapshot ?? null) as unknown as Json,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data, snapshot: Boolean(fetched.snapshot), reason: fetched.snapshot ? null : fetched.reason };
}

export async function reviewFormTemplate(
  input: { organizationId: string; templateId: string; version: number; decision: string; note: string | null; pageOpenedOn?: string | null },
) {
  if (!isUuid(input.templateId)) return { error: "Choose the form template." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Choose approve or reject." };
  if (input.decision === "rejected" && (text(input.note)?.length ?? 0) < 3) return { error: "Say why it’s rejected." };
  if (input.pageOpenedOn && !DATE.test(input.pageOpenedOn)) return { error: "Enter the date you opened the official page." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("review_form_template", {
    p_template_id: input.templateId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: text(input.note),
    p_page_opened_on: input.decision === "approved" ? (input.pageOpenedOn ?? null) : null,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true as const };
}

export async function retireFormTemplate(input: { organizationId: string; templateId: string; version: number; reason: string }) {
  if (!isUuid(input.templateId)) return { error: "Choose the form template." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: "Say why it’s retired." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("retire_form_template", {
    p_template_id: input.templateId,
    p_expected_version: input.version,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true as const };
}

export async function pinFormTemplate(input: { organizationId: string; matterId: string; templateId: string }) {
  if (!isUuid(input.matterId) || !isUuid(input.templateId)) return { error: "Choose the matter and the form template." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("pin_form_template", { p_matter_id: input.matterId, p_template_id: input.templateId });
  if (error) return { error: refusal(error.message) };
  return { ok: true as const };
}

export async function saveBundleSelection(
  input: { organizationId: string; matterId: string; channel: string; items: { document_version_id: string; position: number }[] },
) {
  if (!isUuid(input.matterId) || !SUBMISSION_CHANNELS.includes(input.channel as SubmissionChannel)) return { error: "Choose the matter and the channel." };
  if (input.items.length > 100) return { error: "A bundle holds at most 100 documents." };
  if (input.items.some((item) => !isUuid(item.document_version_id))) return { error: "Choose a current file on this matter." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("save_bundle_selection", {
    p_matter_id: input.matterId,
    p_channel: input.channel as SubmissionChannel,
    p_items: input.items as unknown as Json,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true as const };
}

export async function setChannelExportRule(input: { organizationId: string; channel: string; namePattern: string; maxBytes: number }) {
  if (!SUBMISSION_CHANNELS.includes(input.channel as SubmissionChannel)) return { error: "Choose the channel." };
  if (!channelPatternOk(input.namePattern.trim())) return { error: "The file name may use {reference}, {channel} and {date}, and must end in .pdf." };
  if (!Number.isInteger(input.maxBytes) || input.maxBytes < MIN_BUNDLE_MAX_BYTES || input.maxBytes > MAX_BUNDLE_MAX_BYTES) {
    return { error: "The bundle size limit must be between 1 MiB and 100 MiB. That is a Casevoya limit, not an IRCC rule." };
  }
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("set_channel_export_rule", {
    p_org: input.organizationId,
    p_channel: input.channel as SubmissionChannel,
    p_name_pattern: input.namePattern.trim(),
    p_max_bytes: input.maxBytes,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true as const };
}
