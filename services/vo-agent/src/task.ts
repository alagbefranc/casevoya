/**
 * One Vo run inside the service: build this task's tools, run the Claude Agent SDK's query() with
 * the locked-down options (policy.ts), then record the outcome with finish_vo_run AS THE STAFF
 * MEMBER (their token, RLS and the function's own checks). The SDK is injected so tests can run
 * the whole path with a scripted model.
 */
import { NEEDS_CONSULTANT, newNonce, voSystemPrompt, voUserPrompt, VO_MODEL, VO_PROMPT_VERSION } from "../../../src/modules/vo/prompt";
import { dbSource, guardGroundedAnswer } from "../../../src/modules/vo/grounding";
import type { VoTaskRequest, VoTaskResponse } from "../../../src/modules/vo/sign";
import type { VoData } from "./data";
import { finishLetterRun } from "./letter-tools";
import { agentOptions, MCP_SERVER, type ToolLog } from "./policy";
import { TASK_TOOLS, TOOL_SPECS, type RunContext, type ToolResult } from "./tools";

/** The part of @anthropic-ai/claude-agent-sdk this service uses. */
export type AgentSdk = {
  query: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;
  tool: (name: string, description: string, shape: Record<string, unknown>, handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>, extras?: Record<string, unknown>) => unknown;
  createSdkMcpServer: (options: { name: string; version?: string; tools?: unknown[]; alwaysLoad?: boolean }) => unknown;
};

export type SdkMessage = {
  type: string;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: { content?: { type: string; name?: string }[] };
};

export type RunDeps = {
  sdk: AgentSdk;
  data: VoData;
  apiKey: string | null;
  cwd: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  nonce?: string;
};

export type RunOutcome = VoTaskResponse & { log: ToolLog; tools: string[] };

export async function runVoTask(request: VoTaskRequest, deps: RunDeps): Promise<RunOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const version = VO_PROMPT_VERSION[request.task];
  const log: ToolLog = [];

  const finish = async (args: Record<string, unknown>) =>
    deps.data.rpc("finish_vo_run", { p_run_id: request.runId, p_prompt_version: version, p_latency_ms: Math.min(600000, Math.max(0, Math.round(now() - started))), ...args });
  const failed = async (failure: "unavailable" | "failed" | "empty" | "nothing_to_draft", extra: Record<string, unknown> = {}): Promise<RunOutcome> => {
    await finish({ p_result: "failed", p_failure: failure, ...extra });
    return { result: "failed", failure, log, tools: [] };
  };

  // No model key: the Designer's "Vo is unavailable" state; everything works by hand.
  if (!deps.apiKey) return failed("unavailable");

  // A reply needs a client message to answer: without one, say so without spending a model call.
  if (request.task === "message_reply" && request.threadId) {
    const recent = await deps.data.messages(request.threadId, 12);
    if (!recent.some((message) => message.authorKind === "client")) return failed("nothing_to_draft");
  }

  const ctx: RunContext = {
    request,
    data: deps.data,
    nonce: deps.nonce ?? newNonce(),
    settings: await deps.data.settings(),
    sources: new Map(),
    calls: [],
    draft: null,
    abstainedByDraft: false,
  };

  const allowed = TASK_TOOLS[request.task];
  const tools = allowed.map((name) => {
    const spec = TOOL_SPECS[name];
    return deps.sdk.tool(
      spec.name,
      spec.description,
      spec.shape,
      async (args) => {
        ctx.calls.push(spec.name);
        try {
          return await spec.run(ctx, args ?? {});
        } catch {
          return { content: [{ type: "text", text: "That couldn't be read." }], isError: true };
        }
      },
      { annotations: { readOnlyHint: spec.readOnly, openWorldHint: false }, alwaysLoad: true },
    );
  });
  const server = deps.sdk.createSdkMcpServer({ name: MCP_SERVER, version: "1.0.0", tools, alwaysLoad: true });

  let resultText = "";
  let success = false;
  let usage = { input: 0, output: 0, cost: 0 };
  try {
    const stream = deps.sdk.query({
      prompt: voUserPrompt(request.task, ctx.nonce, request.question, request.letterType ?? null),
      options: agentOptions({
        task: request.task,
        systemPrompt: voSystemPrompt(request.task, ctx.nonce),
        server,
        log,
        apiKey: deps.apiKey,
        cwd: deps.cwd,
        env: deps.env,
      }),
    });
    for await (const message of stream) {
      if (message.type === "result") {
        success = message.subtype === "success";
        resultText = typeof message.result === "string" ? message.result : "";
        usage = { input: message.usage?.input_tokens ?? 0, output: message.usage?.output_tokens ?? 0, cost: message.total_cost_usd ?? 0 };
      }
    }
  } catch {
    // The SDK's error may echo data; it is not passed on or logged.
    success = false;
  }

  const metrics = {
    p_tools: ctx.calls.slice(0, 60),
    p_input_tokens: usage.input,
    p_output_tokens: usage.output,
    p_cost_usd: Math.round(usage.cost * 10000) / 10000,
  };
  const sources = [...ctx.sources.values()];
  const abstained = ctx.abstainedByDraft || resultText.trim().toLowerCase().startsWith(NEEDS_CONSULTANT);

  // AI-01: a letter is saved as a matter letter draft (letter-tools.ts), not as a vo_drafts row.
  if (request.task === "letter_draft") {
    const latencyMs = Math.min(600000, Math.max(0, Math.round(now() - started)));
    const outcome = await finishLetterRun(ctx, { metrics, latencyMs, success, abstained, finish });
    return { ...outcome, log, tools: ctx.calls };
  }

  if (request.task === "ask") {
    if (!success && !resultText) return failed("failed", metrics);
    // SRC-09: only sentences that cite the run's allowed set survive; markers the run never handed
    // out are dropped. Nothing supported (or the model's own consultant marker): Vo abstains.
    const grounded = guardGroundedAnswer(resultText, ctx.markers ?? new Map(), ctx.markerContent ?? new Map());
    if (grounded.kind === "empty") return failed("empty", metrics);
    if (grounded.kind === "abstain") {
      await finish({ p_result: "abstained", p_model: VO_MODEL, ...metrics });
      return { result: "abstained", reason: grounded.reason, log, tools: ctx.calls };
    }
    const saved = await finish({ p_result: "answered", p_model: VO_MODEL, p_sources: grounded.cited.map(dbSource), p_needs_rule: false, ...metrics });
    if (saved.error) return { result: "failed", failure: "failed", log, tools: ctx.calls };
    return { result: "answered", text: grounded.text, needsRule: false, sources: grounded.cited, log, tools: ctx.calls };
  }

  if (!ctx.draft) {
    if (abstained) {
      await finish({ p_result: "abstained", p_model: VO_MODEL, ...metrics });
      return { result: "abstained", reason: "consultant", log, tools: ctx.calls };
    }
    return failed(success ? "empty" : "failed", metrics);
  }
  // A draft must be grounded in at least one record Vo read.
  if (sources.length === 0) return failed("nothing_to_draft", metrics);
  const people = request.threadId ? await deps.data.threadPeople(request.threadId) : [];
  const names = people.join(", ") || "the client";
  const title = (request.task === "document_request" ? `Explain document requests to ${names}` : `Reply to ${names}`).slice(0, 200);
  const saved = await finish({
    p_result: "drafted",
    p_title: title,
    p_body: ctx.draft.text,
    p_sources: sources.map(dbSource),
    p_model: VO_MODEL,
    p_needs_rule: ctx.draft.needsRule,
    ...metrics,
  });
  if (saved.error || typeof saved.data !== "string") return { result: "failed", failure: "failed", log, tools: ctx.calls };
  return { result: "drafted", draftId: saved.data, text: ctx.draft.text, needsRule: ctx.draft.needsRule, sources, log, tools: ctx.calls };
}
