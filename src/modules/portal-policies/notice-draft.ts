import "server-only";

import { workersAi, type AiBinding } from "@/modules/i18n/translate";
import { acceptNoticeDraft, noticePrompt, type NoticeFacts } from "@/modules/portal-policies/notice-facts";

export const NOTICE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type NoticeDraftResult = { body: string; model: string } | { error: "unavailable" | "failed" | "rejected" };

function responseText(result: unknown): string {
  if (result && typeof result === "object" && typeof (result as { response?: unknown }).response === "string") {
    return (result as { response: string }).response;
  }
  return "";
}

/**
 * One Workers AI draft of a privacy notice from an already checked fact sheet. Outside the Worker
 * there is no binding and this returns unavailable. The caller has already applied the quota.
 * The text is not logged.
 */
export async function draftNoticeFromFacts(facts: NoticeFacts, deps: { ai?: AiBinding | null } = {}): Promise<NoticeDraftResult> {
  const ai = deps.ai === undefined ? workersAi() : deps.ai;
  if (!ai) return { error: "unavailable" };
  let result: unknown;
  try {
    result = await ai.run(NOTICE_MODEL, {
      messages: [
        { role: "system", content: "You write a privacy notice from a fact sheet. You never add facts." },
        { role: "user", content: noticePrompt(facts) },
      ],
      temperature: 0,
      max_tokens: 2500,
    });
  } catch {
    return { error: "failed" };
  }
  const accepted = acceptNoticeDraft(responseText(result), facts);
  if ("error" in accepted) return { error: "rejected" };
  return { body: accepted.body, model: NOTICE_MODEL };
}
