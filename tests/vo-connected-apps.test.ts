/**
 * Ask Vo and the staff member's connected apps (services/vo-agent/src/connected-tools.ts), with the
 * Claude Agent SDK scripted: the tools exist only when the firm's switch is on, each call is checked
 * for that person's own connection, a create is only proposed, and the next step the person sees
 * (connect the app, confirm the proposal) is Casevoya's text.
 */
import { describe, expect, it } from "vitest";
import type { VoData } from "../services/vo-agent/src/data";
import { runVoTask, type AgentSdk, type SdkMessage } from "../services/vo-agent/src/task";
import type { ComposioExec, ConnectedState } from "../services/vo-agent/src/connected-tools";
import { citationHref, guardGroundedAnswer, markerPrefix } from "../src/modules/vo/grounding";
import type { VoTaskRequest } from "../src/modules/vo/sign";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "33333333-3333-4333-8333-333333333333";
const MEMBER = "77777777-7777-4777-8777-777777777771";
const ZOOM_ROW = "aaaaaaaa-1111-4111-8111-111111111111";
const PROPOSAL = "bbbbbbbb-1111-4111-8111-111111111111";

type Rpc = { name: string; args: Record<string, unknown> };
type Call = { name: string; input?: Record<string, unknown> };

function request(question: string): VoTaskRequest {
  return { v: 1, runId: "22222222-2222-4222-8222-222222222222", organizationId: ORG, membershipId: MEMBER, userId: "88888888-8888-4888-8888-888888888888", task: "ask", matterId: MATTER, threadId: null, question, accessToken: "user-access-token-abcdefghijklmnop", expiresAt: Date.now() + 60_000 };
}

function data(state: ConnectedState | null, rpcs: Rpc[], proposals: Record<string, unknown>[]): VoData {
  return {
    settings: async () => null,
    firm: async () => ({ name: "Synthetic Firm", slug: "synthetic", sampleMode: false }),
    matter: async (id) => ({ id, title: "Synthetic matter", reference: "SF-1", stage: "intake", isSample: false }),
    people: async () => [],
    threadPeople: async () => [],
    messages: async () => [],
    requests: async () => [],
    tasks: async () => [],
    deadlines: async () => [],
    documents: async () => [],
    approvedSources: async () => [],
    freeSlots: async () => ({ starts: [], bookingLink: null, timeZone: "America/Toronto" }),
    connectedState: async () => state,
    connectedReady: async (toolkit) =>
      !state ? { ok: false, why: "the firm owner has not turned on connected accounts" } : state.active.some((row) => row.toolkit === toolkit) ? { ok: true, mailLabel: "Casevoya" } : { ok: false, why: "connect that account first" },
    proposeConnected: async (input) => {
      proposals.push(input);
      return state?.active.some((row) => row.toolkit === input.toolkit) ? { ok: true, id: PROPOSAL } : { ok: false, why: "connect that account first" };
    },
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      return { data: null, error: null };
    },
  };
}

function scripted(script: { calls: Call[]; result: string }, seen: { results: string[]; tools: string[]; prompt: string }): AgentSdk {
  const handlers = new Map<string, (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[] }>>();
  return {
    tool: (name, _d, _s, handler) => {
      handlers.set(name, handler);
      seen.tools.push(name);
      return { name };
    },
    createSdkMcpServer: (options) => ({ type: "sdk", name: options.name, tools: options.tools }),
    query: ({ options }) =>
      (async function* () {
        seen.prompt = String(options.systemPrompt);
        const hook = (options.hooks as { PreToolUse: { hooks: ((input: Record<string, unknown>) => Promise<{ hookSpecificOutput?: { permissionDecision: string } }>)[] }[] }).PreToolUse[0].hooks[0];
        for (const call of script.calls) {
          const decision = await hook({ hook_event_name: "PreToolUse", tool_name: call.name, tool_input: call.input ?? {} });
          if (decision.hookSpecificOutput?.permissionDecision !== "allow") continue;
          const out = await handlers.get(call.name.replace(/^mcp__casevoya__/, ""))!(call.input ?? {}, {});
          seen.results.push(out.content.map((block) => block.text).join("\n"));
        }
        yield { type: "result", subtype: "success", result: script.result, usage: { input_tokens: 900, output_tokens: 60 }, total_cost_usd: 0.01 } as SdkMessage;
      })(),
  };
}

const READ = "mcp__casevoya__connected_app_read";
const PROPOSE = "mcp__casevoya__connected_app_propose";

describe("Ask Vo connected-app tools", () => {
  it("doesn't register them when the firm's connected-accounts switch is off, and refuses a call to them", async () => {
    const seen = { results: [] as string[], tools: [] as string[], prompt: "" };
    const composio: ComposioExec = async () => {
      throw new Error("must not be called");
    };
    const out = await runVoTask(request("List my Zoom meetings"), {
      sdk: scripted({ calls: [{ name: READ, input: { app: "zoom", action: "ZOOM_LIST_MEETINGS" } }], result: "[needs a consultant]" }, seen),
      data: data(null, [], []),
      apiKey: "key",
      cwd: "/tmp/vo",
      composio,
    });
    expect(seen.tools).not.toContain("connected_app_read");
    expect(seen.tools).not.toContain("connected_app_propose");
    expect(seen.prompt).not.toContain("connected_app");
    expect(seen.results).toEqual([]);
    expect(out.result).toBe("abstained");
  });

  it("registers both when the switch is on, and runs a read of the person's own connected app with a [C#] marker", async () => {
    const seen = { results: [] as string[], tools: [] as string[], prompt: "" };
    const calls: Parameters<ComposioExec>[0][] = [];
    const composio: ComposioExec = async (input) => (calls.push(input), { successful: true, data: { meetings: [{ topic: "Intake call", start_time: "2026-11-02T15:00:00Z" }] } });
    const rpcs: Rpc[] = [];
    const out = await runVoTask(request("What Zoom meetings do I have?"), {
      sdk: scripted({ calls: [{ name: READ, input: { app: "zoom", action: "ZOOM_LIST_MEETINGS", arguments: { page_size: 5, userId: "someone-else" } } }], result: "You have one Zoom meeting, the Intake call [C1]." }, seen),
      data: data({ membershipId: MEMBER, active: [{ id: ZOOM_ROW, toolkit: "zoom" }] }, rpcs, []),
      apiKey: "key",
      cwd: "/tmp/vo",
      composio,
    });
    expect(seen.tools).toEqual(expect.arrayContaining(["connected_app_read", "connected_app_propose"]));
    expect(seen.prompt).toContain('app "zoom" (Zoom, connected)');
    expect(seen.prompt).toContain('app "dropbox" (Dropbox, not connected)');
    // As the staff member's own Composio user, with the fixed userId winning over the model's.
    expect(calls).toEqual([{ userId: MEMBER, slug: "ZOOM_LIST_MEETINGS", arguments: { page_size: 5, userId: "me" } }]);
    expect(out).toMatchObject({ result: "answered", text: "You have one Zoom meeting, the Intake call [C1]." });
    const finish = rpcs.find((rpc) => rpc.name === "finish_vo_run")!;
    expect(finish.args.p_sources).toEqual([{ kind: "connected_app", id: ZOOM_ROW, label: "Zoom (your account)" }]);
  });

  it("answers 'connect that account first' with Casevoya's steps when the app isn't connected, without calling Composio", async () => {
    const seen = { results: [] as string[], tools: [] as string[], prompt: "" };
    let called = 0;
    const out = await runVoTask(request("List my Dropbox files"), {
      sdk: scripted({ calls: [{ name: READ, input: { app: "dropbox", action: "DROPBOX_LIST_FILES_IN_FOLDER", arguments: { path: "" } } }], result: "Dropbox needs connecting first." }, seen),
      data: data({ membershipId: MEMBER, active: [] }, [], []),
      apiKey: "key",
      cwd: "/tmp/vo",
      composio: async () => (called++, { successful: true, data: null }),
    });
    expect(called).toBe(0);
    expect(seen.results[0]).toMatch(/^connect that account first/);
    expect(out).toMatchObject({ result: "abstained", notices: ["Connect your Dropbox first: Settings › Integrations › Connect next to Dropbox. Then ask again."] });
  });

  it("turns a create into a pending proposal (nothing runs) and refuses actions off the list", async () => {
    const seen = { results: [] as string[], tools: [] as string[], prompt: "" };
    const proposals: Record<string, unknown>[] = [];
    let called = 0;
    const out = await runVoTask(request("Make a Zoom link for the intake call tomorrow at 10"), {
      sdk: scripted(
        {
          calls: [
            { name: PROPOSE, input: { app: "zoom", action: "ZOOM_DELETE_A_MEETING", arguments: { meetingId: "1" } } },
            { name: PROPOSE, input: { app: "zoom", action: "ZOOM_CREATE_A_MEETING", arguments: { topic: "Intake call", start_time: "2026-11-01T15:00:00Z", duration: 30, settings: { auto_recording: "cloud" } } } },
            { name: PROPOSE, input: { app: "zoom", action: "ZOOM_CREATE_A_MEETING", arguments: { topic: "Second" } } },
          ],
          result: "I set up a Zoom meeting for you to confirm [C1].",
        },
        seen,
      ),
      data: data({ membershipId: MEMBER, active: [{ id: ZOOM_ROW, toolkit: "zoom" }] }, [], proposals),
      apiKey: "key",
      cwd: "/tmp/vo",
      composio: async () => (called++, { successful: true, data: null }),
    });
    expect(called).toBe(0);
    expect(seen.results[0]).toMatch(/isn't on Vo's list/);
    expect(seen.results[2]).toMatch(/One proposal per request/);
    expect(proposals).toEqual([{ toolkit: "zoom", action: "ZOOM_CREATE_A_MEETING", arguments: { topic: "Intake call", start_time: "2026-11-01T15:00:00Z", duration: 30, userId: "me" }, summary: expect.stringContaining("Create a Zoom meeting") }]);
    expect(out).toMatchObject({ result: "answered", sources: [{ kind: "connected_app", id: PROPOSAL }] });
    expect((out as { notices?: string[] }).notices?.[0]).toMatch(/^Vo is waiting for you to confirm: zoom: Create a Zoom meeting.*Confirm or dismiss it in Settings › Integrations/);
  });

  it("gives connected apps their own marker and link", () => {
    expect(markerPrefix("connected_app")).toBe("C");
    expect(citationHref({ kind: "connected_app" }, { matterId: MATTER })).toBe("/sheet/settings?tab=integrations");
    const allowed = new Map([["C1", { kind: "connected_app" as const, id: ZOOM_ROW, label: "Zoom (your account)", marker: "C1" }]]);
    expect(guardGroundedAnswer("You have one meeting [C1]. Another [C2].", allowed)).toMatchObject({ kind: "answer", text: "You have one meeting [C1].", dropped: ["C2"] });
  });
});
