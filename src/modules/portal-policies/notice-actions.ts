"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { draftNoticeFromFacts } from "@/modules/portal-policies/notice-draft";
import { canPublishPolicies } from "@/modules/portal-policies/defaults";
import { noticeFacts, noticePrompt, readNoticeAnswers, type NoticeAnswers } from "@/modules/portal-policies/notice-facts";

const MESSAGES = {
  unavailable: "A privacy draft isn’t available on this server. The text in the box is unchanged.",
  failed: "The draft could not be written. The text in the box is unchanged.",
  rejected: "The draft included something that was not in your answers, so it was discarded. The text in the box is unchanged.",
  rate_limited: "You have asked for many drafts in a short time. Try again later. The text in the box is unchanged.",
  denied: "Only a firm owner or licensed consultant, signed in with two-step verification, can draft this notice.",
} as const;

/**
 * Writes a privacy-notice draft for this firm. It does not publish, and it does not change the
 * saved notice. The model sees the firm name, the privacy contact, a saved request target when
 * one exists, and the owner’s answers. It does not see client files or other people.
 */
export async function draftPrivacyNotice(input: { organizationId: string; answers: NoticeAnswers }): Promise<{ body: string; model: string } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const answers = readNoticeAnswers(input.answers);
  if ("error" in answers) return { error: answers.error };

  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Sign in first." };
  const membership = await supabase.from("memberships").select("role").eq("organization_id", input.organizationId).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!membership.data || !canPublishPolicies(String(membership.data.role))) return { error: MESSAGES.denied };

  const firm = await supabase.from("organizations").select("display_name, privacy_contact_name, privacy_contact_email").eq("id", input.organizationId).maybeSingle();
  const settings = await supabase.from("compliance_settings").select("privacy_response_days").eq("organization_id", input.organizationId).maybeSingle();
  const facts = noticeFacts(
    {
      firmName: firm.data?.display_name ?? "",
      contactName: firm.data?.privacy_contact_name ?? "",
      contactEmail: firm.data?.privacy_contact_email ?? "",
      requestDays: typeof settings.data?.privacy_response_days === "number" ? settings.data.privacy_response_days : null,
    },
    answers.answers,
  );
  if ("error" in facts) return { error: facts.error };
  const prompt = noticePrompt(facts);
  if (prompt.length > 4000) return { error: MESSAGES.failed };

  const quota = await supabase.rpc("consume_policy_draft", { p_organization_id: input.organizationId, p_char_count: prompt.length });
  if (quota.error) return { error: MESSAGES.denied };
  const row = quota.data && typeof quota.data === "object" && !Array.isArray(quota.data) ? (quota.data as { ok?: unknown }) : null;
  if (row?.ok !== true) return { error: MESSAGES.rate_limited };

  const drafted = await draftNoticeFromFacts(facts);
  if ("error" in drafted) return { error: MESSAGES[drafted.error] };
  return { body: drafted.body, model: drafted.model };
}
