/**
 * What the Claude Agent SDK may do in a Vo run (https://code.claude.com/docs/en/agent-sdk/custom-tools
 * and /typescript, read 2026-10-18; see docs/integrations/vo-agent.md).
 *
 * Three independent locks, any one of which is enough:
 *  1. Availability: `tools: []` removes every built-in tool (Bash, Read, Write, Edit, Glob, Grep,
 *     WebSearch, WebFetch, Task/subagents...) from the model's context, and the same names are
 *     listed bare in `disallowedTools`. Only our in-process MCP server's tools exist.
 *  2. Permission: `allowedTools` names exactly this task's tools; `permissionMode: "dontAsk"`
 *     never prompts, and `canUseTool` denies anything that falls through.
 *  3. A PreToolUse hook denies every call whose name is not on this task's allowlist, and logs
 *     each call (allowed or denied) by name.
 * No filesystem settings are loaded (`settingSources: []`), the working directory is an empty
 * scratch directory, the subprocess environment carries only PATH, HOME and the model key, and
 * turns and spend are capped per run.
 */
import { VO_MODEL } from "../../../src/modules/vo/prompt";
import type { VoTask } from "../../../src/modules/vo/sign";
import { TASK_TOOLS, type VoToolName } from "./tools";

export const MCP_SERVER = "casevoya";
export const MAX_TURNS = 8;
export const MAX_BUDGET_USD = 0.75;

/** Every built-in Claude Code tool, denied by bare name (removed from context). */
export const BUILTIN_TOOLS = [
  "Agent",
  "Bash",
  "BashOutput",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "ListMcpResourcesTool",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "ReadMcpResourceTool",
  "Skill",
  "SlashCommand",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "ToolSearch",
  "WebFetch",
  "WebSearch",
  "Write",
] as const;

export function qualified(name: VoToolName): string {
  return `mcp__${MCP_SERVER}__${name}`;
}

export function allowedToolNames(task: VoTask): string[] {
  return TASK_TOOLS[task].map(qualified);
}

export function isAllowedTool(task: VoTask, toolName: string): boolean {
  return allowedToolNames(task).includes(toolName);
}

export type ToolLog = { name: string; allowed: boolean }[];

type HookOutput = {
  hookSpecificOutput?: { hookEventName: "PreToolUse"; permissionDecision: "allow" | "deny"; permissionDecisionReason: string };
};

/** PreToolUse: deny anything off the allowlist; log every attempt. */
export function preToolUseHook(task: VoTask, log: ToolLog) {
  return async (input: { hook_event_name?: string; tool_name?: string }): Promise<HookOutput> => {
    const name = String(input.tool_name ?? "");
    const allowed = isAllowedTool(task, name);
    log.push({ name, allowed });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: allowed ? "allow" : "deny",
        permissionDecisionReason: allowed ? "Vo allowlist" : "Vo can only use its own Casevoya tools for this task.",
      },
    };
  };
}

/** The permission prompt fallback: same allowlist, never "ask". */
export function canUseTool(task: VoTask) {
  return async (toolName: string, input: Record<string, unknown>) =>
    isAllowedTool(task, toolName)
      ? { behavior: "allow" as const, updatedInput: input }
      : { behavior: "deny" as const, message: "Vo can only use its own Casevoya tools for this task.", interrupt: true };
}

/** The subprocess environment: nothing but PATH, HOME and the model key. */
export function agentEnv(source: Record<string, string | undefined>, apiKey: string): Record<string, string> {
  return { PATH: source.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: source.HOME ?? "/tmp", ANTHROPIC_API_KEY: apiKey };
}

export function agentOptions(input: {
  task: VoTask;
  systemPrompt: string;
  server: unknown;
  log: ToolLog;
  apiKey: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  abortController?: AbortController;
}) {
  return {
    model: VO_MODEL,
    systemPrompt: input.systemPrompt,
    tools: [] as string[],
    disallowedTools: [...BUILTIN_TOOLS],
    allowedTools: allowedToolNames(input.task),
    mcpServers: { [MCP_SERVER]: input.server },
    permissionMode: "dontAsk" as const,
    canUseTool: canUseTool(input.task),
    hooks: { PreToolUse: [{ hooks: [preToolUseHook(input.task, input.log)] }] },
    settingSources: [] as string[],
    maxTurns: MAX_TURNS,
    maxBudgetUsd: MAX_BUDGET_USD,
    cwd: input.cwd,
    env: agentEnv(input.env ?? {}, input.apiKey),
    abortController: input.abortController,
  };
}
