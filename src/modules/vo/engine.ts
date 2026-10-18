import "server-only";

import { workersAi, type AiBinding } from "@/modules/i18n/translate";
import { VO_MODEL, type VoChatMessage } from "./prompt";

/**
 * Vo runs on the Worker's Workers AI binding only (wrangler.jsonc "ai": { "binding": "AI" }), the
 * same engine and model family as "Draft in French". Outside the deployed Worker there is no
 * binding and Vo says it is unavailable: no REST fallback and no Cloudflare token in the app.
 * Neither the prompt nor the answer is logged here.
 */
export { workersAi, type AiBinding };

export type VoModelResult = { text: string; model: string; ms: number } | { error: "failed" };

function responseText(result: unknown): string {
  if (result && typeof result === "object" && typeof (result as { response?: unknown }).response === "string") {
    return (result as { response: string }).response;
  }
  return "";
}

export async function runVoModel(messages: VoChatMessage[], ai: AiBinding, now: () => number = Date.now): Promise<VoModelResult> {
  const started = now();
  let result: unknown;
  try {
    result = await ai.run(VO_MODEL, { messages, temperature: 0.2, max_tokens: 700 });
  } catch {
    // The provider's message may echo the input; it is not passed on or logged.
    return { error: "failed" };
  }
  return { text: responseText(result), model: VO_MODEL, ms: Math.max(0, Math.round(now() - started)) };
}
