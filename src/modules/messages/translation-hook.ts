/**
 * "Draft in French" (PRD OPS-04 "translation drafts"): the staff composer asks for a machine draft
 * through the same server action the portal document notes use (src/modules/i18n/actions.ts:
 * staff with MFA only, counted against the firm's quota, through the Worker's Workers AI binding;
 * unavailable outside the deployed Worker, and it says so).
 *
 * Whatever comes back is a DRAFT the sender must check: the composer labels it and won't send it
 * until they confirm they checked it. Only the text they send is stored; nothing is translated on
 * the server when sending.
 */
import { draftInFrench } from "@/modules/i18n/actions";

export type DraftTranslation = (text: string, organizationId: string) => Promise<{ text: string } | { error: string }>;

export const draftTranslation: DraftTranslation | null = async (text, organizationId) => {
  const result = await draftInFrench({ organizationId, text });
  if (typeof result.text === "string") return { text: result.text };
  return { error: result.error ?? "The French draft could not be made. Try again, or write it yourself." };
};
