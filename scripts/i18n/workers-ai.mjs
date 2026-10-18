// Workers AI over the REST API, for the offline drafting and comparison scripts only (the app uses
// the Worker's AI binding, src/modules/i18n/translate.ts).
// Needs CLOUDFLARE_API_TOKEN (a token with Workers AI access) and CLOUDFLARE_ACCOUNT_ID (or the
// account in wrangler.jsonc). Never prints either.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PROMPT = JSON.parse(readFileSync(path.join(root, "src/modules/i18n/fr-ca.json"), "utf8"));

function accountId() {
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (fromEnv) return fromEnv;
  const wrangler = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  const match = wrangler.match(/"account_id"\s*:\s*"([0-9a-f]{32})"/);
  if (!match) throw new Error("Set CLOUDFLARE_ACCOUNT_ID.");
  return match[1];
}

export function credentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error("Set CLOUDFLARE_API_TOKEN (Workers AI access). It is never printed.");
  return { token, account: accountId() };
}

async function run(model, body, { token, account }, attempt = 0) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if ((!response.ok || !data?.success) && attempt < 3 && (response.status === 429 || response.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    return run(model, body, { token, account }, attempt + 1);
  }
  if (!response.ok || !data?.success) {
    const reason = data?.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(`${model}: ${reason}`);
  }
  return data.result;
}

/** The text a Workers AI result carries, across the result shapes the catalog's models use. */
export function resultText(result) {
  if (typeof result?.translated_text === "string") return result.translated_text;
  if (typeof result?.response === "string") return result.response;
  const choice = result?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  // Responses-API shape (gpt-oss): the last message item's output_text.
  const items = Array.isArray(result?.output) ? result.output : [];
  for (const item of [...items].reverse()) {
    const part = item?.content?.find?.((content) => content?.type === "output_text");
    if (part?.text) return part.text;
  }
  return "";
}

/**
 * One English string to fr-CA with the given model. Translation models get no prompt. `kind`
 * (for example "button label") is sent as a bracketed context line, per the prompt's rule 8.
 */
export async function translate(model, text, creds = credentials(), kind = null) {
  if (model === "@cf/meta/m2m100-1.2b") {
    return resultText(await run(model, { text, source_lang: "en", target_lang: "fr" }, creds)).trim();
  }
  const input = kind ? `[${kind}]\n${text}` : text;
  if (model.startsWith("@cf/openai/gpt-oss")) {
    const result = await run(model, { instructions: PROMPT.system, input, reasoning: { effort: "low" } }, creds);
    return resultText(result).trim();
  }
  const result = await run(
    model,
    {
      messages: [
        { role: "system", content: PROMPT.system },
        { role: "user", content: input },
      ],
      temperature: 0,
      max_tokens: 1024,
    },
    creds,
  );
  return resultText(result).trim();
}
