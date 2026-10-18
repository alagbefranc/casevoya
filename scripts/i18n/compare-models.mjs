#!/usr/bin/env node
// Runs the same Casevoya strings through several Workers AI models and writes the raw outputs as
// JSON, for the comparison in docs/i18n/workers-ai-model-choice.md. Scoring is done by a person
// reading the output; this script only checks placeholders mechanically.
// Usage: CLOUDFLARE_API_TOKEN=… node scripts/i18n/compare-models.mjs <out.json> [model ...]
import { writeFileSync } from "node:fs";
import { credentials, translate } from "./workers-ai.mjs";
import { samePlaceholders } from "../../src/modules/i18n/typography.ts";

export const SAMPLES = [
  ["EM06 body (deadline)", "Please upload a document to your file by {due_date}. Details are in your portal."],
  ["EM07 subject", "A step on your file is due {due_date}"],
  ["EM10 body (invoice)", "Invoice {invoice_number} has a balance due on {due_date}. The amount and payment options are in your portal."],
  ["EM11 body (advance)", "{firm_name} received your advance payment. Receipt {receipt_number} is in your portal."],
  ["Client funds (trust)", "The advance is held in trust in the firm’s client account until services are provided and invoiced. Casevoya records the firm’s client account; it does not hold client money."],
  ["Client funds (amount)", "Receipt RC-0091 · advance CAD 1,000.00"],
  ["Client funds (transfer)", "{firm_name} transferred {amount} from your client account to pay invoice {invoice_number}."],
  ["Sign-in code", "Use code {code} to finish signing in. It expires in 1 hour. If this wasn’t you, ignore this email."],
  ["EM16a body (booking)", "{date_time} ({time_zone_label}) with {consultant_name}. {firm_name} will call you at the number you gave."],
  ["EM16c body (cancelled)", "Your consultation on {date_time} ({time_zone_label}) was cancelled by {firm_name}. To book another time, contact {firm_name}."],
  ["EX06 body (accepted)", "{firm_name} accepted one of your documents for your file. Accepted means accepted by {firm_name}, not by the government."],
  ["EX08 body (payment failed)", "Your card payment to {firm_name} for invoice {invoice_number} didn’t go through. You haven’t been charged. You can try again in your portal."],
  ["EX09 preheader (refund)", "Refunds usually take 5 to 10 business days to appear."],
  ["EM02 body (invite)", "{inviter_name} at {firm_name} invited you to your client portal. Open your portal to see your first step. Your private link works once and expires in 7 days."],
  ["EM08 body (agreement)", "Your service agreement from {firm_name} is ready. Review it and sign in your portal."],
  ["CICC s. 32(g)", "CICC Code s. 32(g): withdraw the invoiced amount from the client account no later than 30 days after the day the client is invoiced."],
  ["CTA", "View booking"],
];

export const MODELS = [
  "@cf/meta/m2m100-1.2b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/openai/gpt-oss-120b",
];

if (process.argv[1]?.endsWith("compare-models.mjs")) {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: node scripts/i18n/compare-models.mjs <out.json> [model ...]");
    process.exit(2);
  }
  const models = process.argv.length > 3 ? process.argv.slice(3) : MODELS;
  const creds = credentials();
  const results = { retrievedAt: new Date().toISOString(), models, rows: [] };
  for (const [label, en] of SAMPLES) {
    const row = { label, en, outputs: {} };
    for (const model of models) {
      try {
        const fr = await translate(model, en, creds);
        row.outputs[model] = { fr, placeholdersIntact: samePlaceholders(en, fr) };
      } catch (error) {
        row.outputs[model] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    results.rows.push(row);
    console.error(`done: ${label}`);
  }
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
}
