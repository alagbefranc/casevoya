/**
 * Vo document reading inside the service (PRD AI-01..AI-06, SRC-06, SRC-09; RULES.md).
 *
 * Why the plain Messages API here and not the Agent SDK's query(): reading one document is a
 * single extraction call with no tools at all. The file goes in as a native PDF `document` block
 * or an `image` block, and structured outputs (`output_config.format`, a JSON schema built from the
 * firm's switches) constrain the answer to proposals. With no tool loop there is nothing an
 * instruction hidden in the document could make the model call; the answer is still checked here
 * and again by public.finish_vo_document_review before anything is saved. The model client is
 * injected (`DocModel`), so tests run the whole path with a scripted model and never call the API.
 *
 * Order: switches and category first (refused before any download), then the file through the
 * staff member's own authorized download, then one model call, then the checks below, then
 * finish_vo_document_review AS THE STAFF MEMBER.
 */
import { Buffer } from "node:buffer";
import { NEEDS_CONSULTANT, NEEDS_RULE, neutralize, newNonce, oneLine, VO_MODEL } from "../../../src/modules/vo/prompt";
import { guardVoOutput } from "../../../src/modules/vo/guard";
import type { VoTaskRequest, VoTaskResponse } from "../../../src/modules/vo/sign";
import {
  anyDocCapability,
  voCategoryAllowed,
  voDocCapabilities,
  voDocMagicMatches,
  voDocMaxBytes,
  voDocMedia,
  voDocumentCategory,
  VO_DOC_CATEGORY_LABEL,
  type VoDocCapabilities,
  type VoDocCategory,
  type VoDocSettings,
} from "../../../src/modules/vo/vo-doc";
import { docxText } from "../../../src/modules/vo/docx-text";
import { voDocSchema, voDocSystemPrompt, voDocUserText, VO_DOC_EFFORT, VO_DOC_MAX_TOKENS, VO_DOC_PROMPT_VERSION } from "../../../src/modules/vo/vo-doc-prompt";
import { redactIdentity } from "./tools";
import type { VoDocData, VoDocVersion } from "./vo-doc-data";

/** The part of the Messages API response this task reads. */
export type DocModelMessage = {
  model?: string;
  stop_reason?: string | null;
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
};

/** `client.beta.messages.create` in production (runtime/server.ts); a script in tests. */
export type DocModel = { create(params: Record<string, unknown>): Promise<DocModelMessage> };

/** The service's own step that reads the file, recorded in the run log's tool list. */
export const READ_TOOL = "read_document_version";

export type ProposalInput = {
  kind: "classification" | "field" | "missing_field" | "inconsistency" | "deadline" | "needs_rule";
  label: string;
  value?: string | null;
  detail?: string | null;
  page?: number | null;
  confidence?: number | null;
  category?: string | null;
  sensitivity?: string | null;
  due_on?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ISO_ANYWHERE = /(\d{4}-\d{2}-\d{2})/;

function validIso(value: string): boolean {
  if (!ISO.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  const year = Number(value.slice(0, 4));
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && year >= 1900 && year <= 2200;
}

/** Identity-number redaction (tools.ts) that keeps YYYY-MM-DD dates readable. */
function redactKeepDates(value: string): string {
  return value
    .split(ISO_ANYWHERE)
    .map((part) => (ISO.test(part) ? part : redactIdentity(part)))
    .join("");
}

/** Flags are things to check, never findings (rule 4): accusing words become neutral ones. */
const ACCUSING = /\b(?:fraud\w*|forg(?:e|ed|er|ery|eries|ing)|fake[ds]?|counterfeit\w*|tamper\w*|falsif\w*|doctored|fabricat\w*|not genuine|ingenuine|bogus)\b/gi;
function neutral(value: string): string {
  return value.replace(ACCUSING, "inconsistent");
}

/** Vo's own words (labels, details): the reply guard, then redaction and neutral wording. */
function words(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const guarded = guardVoOutput(value);
  if (guarded.kind === "abstain") return NEEDS_RULE;
  if (guarded.kind !== "draft") return "";
  return oneLine(neutral(redactKeepDates(guarded.text)), max);
}

/**
 * A value printed on the document: kept as printed (a bank balance is not a fee), with links,
 * emails, markup and identity numbers removed.
 */
function printed(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = neutralize(value, max * 3)
    .replace(/<\/?[a-z][^>]{0,300}>/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi, "[link removed]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]");
  return oneLine(redactKeepDates(text), max);
}

function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded < min || rounded > max ? null : rounded;
}

function items(value: unknown, max: number): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, max) : [];
}

export type NormalizedReading = {
  readable: boolean;
  proposals: ProposalInput[];
  needsRule: boolean;
  /** Vo read something that looks like a category the firm keeps from Vo: only the suggestion stays. */
  blocked: VoDocCategory | null;
  counts: { fields: number; flags: number; deadlines: number };
};

/**
 * The model's JSON as proposals the database accepts: only switched-on capabilities, identity
 * numbers redacted, links and contacts removed, flags neutral, deadlines only where they are one
 * of the dates read from the page, and anything that would need a rule as NEEDS_RULE.
 */
export function normalizeReading(raw: unknown, ctx: { caps: VoDocCapabilities; settings: VoDocSettings | null; sensitivity: string }): NormalizedReading {
  const empty: NormalizedReading = { readable: false, proposals: [], needsRule: false, blocked: null, counts: { fields: 0, flags: 0, deadlines: 0 } };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const r = raw as Record<string, unknown>;
  if (r.readable !== true) return empty;
  const out: ProposalInput[] = [];
  let blocked: VoDocCategory | null = null;

  if (ctx.caps.classification && r.classification && typeof r.classification === "object") {
    const c = r.classification as Record<string, unknown>;
    const purpose = words(c.purpose, 200);
    const category = typeof c.category === "string" && c.category in VO_DOC_CATEGORY_LABEL ? c.category : null;
    if (purpose && !purpose.includes(NEEDS_RULE) && category) {
      const suggested = typeof c.sensitivity === "string" && ["narrative", "medical", "criminal"].includes(c.sensitivity) ? c.sensitivity : null;
      out.push({
        kind: "classification",
        label: "Suggested purpose",
        value: purpose,
        detail: VO_DOC_CATEGORY_LABEL[category as VoDocCategory | "other"],
        category,
        // Only ever more protective than the document is now.
        sensitivity: ctx.sensitivity === "ordinary" ? suggested : null,
        confidence: clamp(c.confidence, 0, 100),
      });
      if (category !== "other" && !voCategoryAllowed(ctx.settings, category)) blocked = category as VoDocCategory;
    }
  }

  const fields: ProposalInput[] = [];
  const flags: ProposalInput[] = [];
  const deadlines: ProposalInput[] = [];
  const rules: ProposalInput[] = [];
  if (!blocked && ctx.caps.fields) {
    for (const f of items(r.fields, 20)) {
      const label = words(f.label, 120);
      let kind = typeof f.kind === "string" ? f.kind : "text";
      const raw = typeof f.value === "string" ? f.value.trim() : "";
      if (kind === "date" && !validIso(raw)) kind = "text";
      const value = kind === "date" ? raw : printed(raw, 300);
      if (!label || !value) continue;
      fields.push({ kind: "field", label, value, detail: kind, page: clamp(f.page, 1, 2000), confidence: clamp(f.confidence, 0, 100) });
    }
    const dates = new Set(fields.filter((f) => f.detail === "date").map((f) => f.value as string));
    for (const d of items(r.deadlines, 5)) {
      const date = typeof d.date === "string" ? d.date.trim() : "";
      const label = words(d.label, 120);
      if (!label) continue;
      if (label.includes(NEEDS_RULE)) {
        // A date that would come from a rule ("renew 6 months before expiry"), not from the page.
        rules.push({ kind: "needs_rule", label: "Needs a sourced rule", detail: label });
        continue;
      }
      // Grounded: the date must be one Vo read on the page, never one it worked out.
      if (!validIso(date) || !dates.has(date)) continue;
      deadlines.push({ kind: "deadline", label, value: date, due_on: date, page: clamp(d.page, 1, 2000) });
    }
    for (const n of items(r.needs_rule, 5)) {
      const label = words(n.label, 120);
      let detail = words(n.detail, 480);
      if (!label) continue;
      if (!detail.includes(NEEDS_RULE)) detail = `${detail ? `${detail} ` : ""}${NEEDS_RULE}`;
      rules.push({ kind: "needs_rule", label, detail });
    }
  }
  if (!blocked && ctx.caps.missing) {
    for (const m of items(r.missing, 10)) {
      const label = words(m.label, 120);
      if (label) flags.push({ kind: "missing_field", label, detail: words(m.detail, 500) || null, page: clamp(m.page, 1, 2000) });
    }
  }
  if (!blocked && ctx.caps.inconsistencies) {
    for (const i of items(r.inconsistencies, 10)) {
      const label = words(i.label, 120);
      if (label) flags.push({ kind: "inconsistency", label, detail: words(i.detail, 500) || null, page: clamp(i.page, 1, 2000) });
    }
  }
  const proposals = [...out, ...fields, ...deadlines, ...flags, ...rules.slice(0, 5)].slice(0, 60);
  const needsRule = proposals.some((p) => p.kind === "needs_rule" || [p.label, p.value, p.detail].some((text) => typeof text === "string" && (text.includes(NEEDS_RULE) || text.includes(NEEDS_CONSULTANT))));
  return { readable: true, proposals, needsRule, blocked, counts: { fields: fields.length, flags: flags.length, deadlines: deadlines.length } };
}

/** First-party prices per million tokens (input, output), for the run log's estimate (AI-02). */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
};

export function estimateCostUsd(model: string, usage: DocModelMessage["usage"]): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) * 1.25 + (usage?.cache_read_input_tokens ?? 0) * 0.1;
  const cost = (input * price[0] + (usage?.output_tokens ?? 0) * price[1]) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}

function many(count: number, one: string, other: string) {
  return `${count} ${count === 1 ? one : other}`;
}

export function readingSummary(version: VoDocVersion, reading: NormalizedReading): string {
  const parts = [many(reading.counts.fields, "value", "values"), many(reading.counts.flags, "thing to check", "things to check"), many(reading.counts.deadlines, "proposed deadline", "proposed deadlines")];
  let text = `Vo read ${oneLine(version.purpose, 120)} (version ${version.versionNumber}): ${parts.join(", ")}.`;
  if (reading.blocked) text += ` It looks like a ${VO_DOC_CATEGORY_LABEL[reading.blocked].toLowerCase()}, which the firm doesn’t let Vo read, so only the suggested category was kept.`;
  if (reading.needsRule) text += ` Where a step would need an immigration rule, Vo wrote ${NEEDS_RULE}.`;
  return `${text} Nothing changes until a person accepts it.`;
}

export type DocRunDeps = {
  model: DocModel | null;
  data: VoDocData;
  apiKey: string | null;
  now?: () => number;
  nonce?: string;
  /** Production: RateLimitError / connection errors are "unavailable", the rest "failed". */
  classifyError?: (error: unknown) => "unavailable" | "failed";
};

export type DocRunOutcome = VoTaskResponse & { tools: string[]; downloaded: boolean };

export async function runDocumentReview(request: VoTaskRequest, deps: DocRunDeps): Promise<DocRunOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const tools: string[] = [];
  let downloaded = false;
  const finish = (args: Record<string, unknown>) =>
    deps.data.rpc("finish_vo_document_review", {
      p_run_id: request.runId,
      p_prompt_version: VO_DOC_PROMPT_VERSION,
      p_latency_ms: Math.min(600000, Math.max(0, Math.round(now() - started))),
      p_tools: tools,
      ...args,
    });
  const failed = async (failure: "unavailable" | "failed" | "empty" | "refused" | "unsupported_file", extra: Record<string, unknown> = {}): Promise<DocRunOutcome> => {
    await finish({ p_result: "failed", p_failure: failure, ...extra });
    return { result: "failed", failure, tools, downloaded };
  };

  if (request.task !== "document_review" || !request.versionId) return failed("failed");
  if (!deps.apiKey || !deps.model) return failed("unavailable");

  // The firm's switches and the document's category, checked before the file is fetched.
  const [settings, version] = await Promise.all([deps.data.settings(), deps.data.version(request.versionId)]);
  if (!version || version.uploadState !== "clean") return failed("refused");
  const caps = voDocCapabilities(settings);
  if (settings?.enabled === false || !anyDocCapability(caps)) return failed("refused");
  if (!voCategoryAllowed(settings, voDocumentCategory(version.purpose, version.sensitivity))) return failed("refused");
  const media = voDocMedia(version.mediaType);
  const limit = voDocMaxBytes(media);
  if (!media || version.byteSize > limit) return failed("unsupported_file");

  tools.push(READ_TOOL);
  const bytes = await deps.data.download(version.id, limit);
  downloaded = Boolean(bytes);
  if (!bytes) return failed("failed");
  if (bytes.byteLength > limit || !voDocMagicMatches(media, bytes)) return failed("unsupported_file");

  // A Word document goes to the model as its text only; nothing in the file is run.
  const docText = media.kind === "docx" ? docxText(bytes) : null;
  if (media.kind === "docx" && !docText) return failed("unsupported_file");
  const data = media.kind === "docx" ? "" : Buffer.from(bytes).toString("base64");
  const nonce = deps.nonce ?? newNonce();
  const file =
    media.kind === "docx"
      ? { type: "document", source: { type: "text", media_type: "text/plain", data: docText } }
      : media.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: media.mediaType, data } }
        : { type: "image", source: { type: "base64", media_type: media.mediaType, data } };
  const params: Record<string, unknown> = {
    model: VO_MODEL,
    max_tokens: VO_DOC_MAX_TOKENS,
    // A refused request is re-run server-side on the recommended fallback model (by category).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: VO_DOC_EFFORT, format: { type: "json_schema", schema: voDocSchema(caps) } },
    system: voDocSystemPrompt(caps),
    messages: [{ role: "user", content: [file, { type: "text", text: voDocUserText({ nonce, purpose: version.purpose, filename: version.filename, versionNumber: version.versionNumber }) }] }],
  };

  let message: DocModelMessage;
  try {
    message = await deps.model.create(params);
  } catch (error) {
    // The SDK's error may echo data; it is not passed on or logged.
    return failed(deps.classifyError ? deps.classifyError(error) : "failed");
  }
  const served = typeof message.model === "string" && /^[a-z0-9@][a-z0-9@._/-]{2,119}$/.test(message.model) ? message.model : VO_MODEL;
  const metrics = {
    p_model: served,
    p_input_tokens: Math.max(0, Math.round(message.usage?.input_tokens ?? 0)),
    p_output_tokens: Math.max(0, Math.round(message.usage?.output_tokens ?? 0)),
    p_cost_usd: estimateCostUsd(served, message.usage),
  };
  // A refusal or a cut-off answer is never read as proposals.
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return failed("failed", metrics);
  const text = message.content.find((block) => block.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failed("failed", metrics);
  }
  const reading = normalizeReading(parsed, { caps, settings, sensitivity: version.sensitivity });
  if (!reading.readable) {
    await finish({ p_result: "abstained", ...metrics });
    return { result: "abstained", tools, downloaded };
  }
  if (!reading.proposals.length) return failed("empty", metrics);

  const summary = readingSummary(version, reading);
  const saved = await finish({
    p_result: "drafted",
    p_title: `Read ${oneLine(version.purpose, 180)}`,
    p_body: summary,
    p_proposals: reading.proposals,
    p_needs_rule: reading.needsRule,
    ...metrics,
  });
  if (saved.error || typeof saved.data !== "string") return { result: "failed", failure: "failed", tools, downloaded };
  return {
    result: "drafted",
    draftId: saved.data,
    text: summary,
    needsRule: reading.needsRule,
    sources: [{ kind: "document_version", id: version.id, label: `${oneLine(version.purpose, 100)}, version ${version.versionNumber}` }],
    tools,
    downloaded,
  };
}
