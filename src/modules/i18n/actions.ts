"use server";

import { MAX_TRANSLATE_CHARS, translateDraft } from "@/modules/i18n/translate";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

const MESSAGES = {
  empty: "Write the English first.",
  too_long: `Keep it under ${MAX_TRANSLATE_CHARS} characters.`,
  unsupported_language: "Only English to French drafts are available.",
  unavailable: "Draft in French is not available here. Write the French yourself, or try on app.casevoya.ca.",
  failed: "The French draft could not be made. Try again, or write it yourself.",
  rate_limited: "You have asked for many drafts in a short time. Try again later.",
  denied: "Only firm staff signed in with two-step verification can draft in French.",
} as const;

/**
 * "Draft in French": a machine draft of client-facing English that the staff member must check
 * and edit before saving. The database checks the caller is active staff of the firm with staff
 * MFA and counts the request (20 an hour, 100 a day); then the Worker's Workers AI binding
 * drafts it. The text is never logged or stored here.
 */
export async function draftInFrench(input: { organizationId: string; text: string }) {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const text = typeof input.text === "string" ? input.text : "";
  if (!text.trim()) return { error: MESSAGES.empty };
  if (text.length > MAX_TRANSLATE_CHARS) return { error: MESSAGES.too_long };

  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("consume_translation_draft", {
    p_organization_id: input.organizationId,
    p_char_count: text.length,
  });
  if (error) return { error: MESSAGES.denied };
  const quota = data && typeof data === "object" && !Array.isArray(data) ? (data as { ok?: unknown }) : null;
  if (quota?.ok !== true) return { error: MESSAGES.rate_limited };

  const result = await translateDraft(text, "en", "fr-CA");
  if ("error" in result) return { error: MESSAGES[result.error] };
  return { text: result.text, model: result.model };
}
