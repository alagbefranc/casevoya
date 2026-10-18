import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import prompt from "@/modules/i18n/fr-ca.json";
import { frTypography } from "@/modules/i18n/typography";

/**
 * Machine French drafts of client-facing text staff write, through the Worker's Workers AI binding
 * (wrangler.jsonc "ai": { "binding": "AI" }). The result is a DRAFT: the caller shows it labelled
 * "Machine draft: check before sending" and a person must review it before it is saved.
 *
 * Only on the deployed Worker: outside it (next dev, tests, a Node server) there is no binding and
 * the feature says it is unavailable. There is deliberately no REST fallback with an account API
 * token, so no Cloudflare token sits in the app's environment (docs/i18n/README.md).
 *
 * Never logs or stores the text; the caller enforces staff, MFA and the quota first
 * (public.consume_translation_draft).
 */

export const TRANSLATE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const TRANSLATE_PROMPT_VERSION: string = prompt.promptVersion;
export const MAX_TRANSLATE_CHARS = 4000;

/** The part of the Workers AI binding this module uses. */
export type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };

export type TranslateResult = { text: string; model: string } | { error: TranslateError };
export type TranslateError = "empty" | "too_long" | "unsupported_language" | "unavailable" | "failed";

/** The AI binding of the running Worker, or null outside it. */
export function workersAi(): AiBinding | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const ai = env.AI as AiBinding | undefined;
    return ai && typeof ai.run === "function" ? ai : null;
  } catch {
    return null;
  }
}

function responseText(result: unknown): string {
  if (result && typeof result === "object" && typeof (result as { response?: unknown }).response === "string") {
    return (result as { response: string }).response;
  }
  return "";
}

/**
 * English to Canadian French (fr-CA, OQLF typography) with the chosen model and the same prompt as
 * the email drafts. Refuses empty text and text over 4000 characters; nothing is cut or stripped.
 */
export async function translateDraft(
  text: string,
  from: "en",
  to: "fr-CA",
  deps: { ai?: AiBinding | null } = {},
): Promise<TranslateResult> {
  if (from !== "en" || to !== "fr-CA") return { error: "unsupported_language" };
  if (typeof text !== "string" || !text.trim()) return { error: "empty" };
  if (text.length > MAX_TRANSLATE_CHARS) return { error: "too_long" };
  const ai = deps.ai === undefined ? workersAi() : deps.ai;
  if (!ai) return { error: "unavailable" };
  let result: unknown;
  try {
    result = await ai.run(TRANSLATE_MODEL, {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: `[note from an immigration consultant's office to their client]\n${text}` },
      ],
      temperature: 0,
      max_tokens: 2048,
    });
  } catch {
    // The provider's message may echo the input; it is not passed on or logged.
    return { error: "failed" };
  }
  const french = responseText(result).trim();
  if (!french) return { error: "failed" };
  return { text: frTypography(french), model: TRANSLATE_MODEL };
}
