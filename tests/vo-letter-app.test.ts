/**
 * The app side of Vo letter drafts (src/modules/vo/letter-actions.ts, AI-01) with the agent
 * service mocked (no live model call): "unavailable" before anything is counted, the database's
 * refusals (Vo off, letter switch off, no approved facts) in plain words and without a call to
 * the service, the signed letter_draft request carrying the letter type and the person's own
 * token, and the step-up refusal on Approve coming back as the shared step-up message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MATTER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const LETTER = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpc: {} as Record<string, { data: unknown; error: null | { message: string } }>,
  env: {} as Record<string, unknown>,
  fetches: [] as { body: string }[],
  reply: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "55555555-5555-4555-8555-555555555555" } } }),
      getSession: async () => ({ data: { session: { access_token: "user-token-abcdefghijklmnopqrstuvwxyz" } } }),
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const key of ["select", "eq", "order", "limit"]) chain[key] = () => chain;
      chain.maybeSingle = async () => ({ data: { id: "66666666-6666-4666-8666-666666666666" } });
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpc[name] ?? { data: null, error: null };
    },
  }),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: state.env }),
}));

const { draftLetterWithVo, approveLetter, createLetter } = await import("@/modules/vo/letter-actions");

beforeEach(() => {
  state.rpcCalls = [];
  state.fetches = [];
  state.rpc = { begin_vo_letter_draft: { data: { ok: true, run_id: RUN, matter_id: MATTER }, error: null } };
  state.reply = { result: "drafted", draftId: LETTER, text: "Synthetic Applicant [F1].", needsRule: false, sources: [] };
  state.env = {
    VO_AGENT_SECRET: "k".repeat(48),
    VO_AGENT: {
      fetch: async (input: Request) => {
        state.fetches.push({ body: await input.text() });
        return new Response(JSON.stringify(state.reply), { status: 200 });
      },
    },
  };
});

describe("Draft letter with Vo (app)", () => {
  it("is unavailable before anything is counted when the Vo service isn't set up", async () => {
    state.env = {};
    const out = await draftLetterWithVo({ organizationId: ORG, matterId: MATTER, letterType: "cover_letter" });
    expect(out).toEqual({ error: expect.stringMatching(/Vo is unavailable/) });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("says so in plain words when Vo is off, the letter switch is off or there is no approved fact, without calling the service", async () => {
    for (const [code, pattern] of [
      ["off", /Vo is off for this firm/],
      ["capability_off", /turned off Vo’s letter drafts/],
      ["no_facts", /no approved facts Vo may use/],
    ] as const) {
      state.rpc.begin_vo_letter_draft = { data: { ok: false, error: code }, error: null };
      expect(await draftLetterWithVo({ organizationId: ORG, matterId: MATTER, letterType: "cover_letter" })).toEqual({ error: expect.stringMatching(pattern) });
    }
    expect(state.fetches).toHaveLength(0);
    expect(await draftLetterWithVo({ organizationId: ORG, matterId: MATTER, letterType: "contract" })).toEqual({ error: "Choose a letter type." });
  });

  it("sends a signed letter_draft request with the letter type and the person's own token, and returns the draft letter", async () => {
    const out = await draftLetterWithVo({ organizationId: ORG, matterId: MATTER, letterType: "explanation" });
    expect(out).toEqual({ ok: true, letterId: LETTER });
    expect(state.rpcCalls[0]).toEqual({ name: "begin_vo_letter_draft", args: { p_organization_id: ORG, p_matter_id: MATTER, p_letter_type: "explanation" } });
    const sent = JSON.parse(state.fetches[0].body);
    expect(sent).toMatchObject({ task: "letter_draft", runId: RUN, matterId: MATTER, threadId: null, question: null, letterType: "explanation", accessToken: "user-token-abcdefghijklmnopqrstuvwxyz" });
  });

  it("closes the run when the service never answered", async () => {
    state.env.VO_AGENT = { fetch: async () => new Response("", { status: 503 }) };
    const out = await draftLetterWithVo({ organizationId: ORG, matterId: MATTER, letterType: "cover_letter" });
    expect(out).toEqual({ error: expect.stringMatching(/Vo is unavailable/) });
    expect(state.rpcCalls.at(-1)).toEqual({ name: "finish_vo_run", args: { p_run_id: RUN, p_result: "failed", p_failure: "unavailable" } });
  });
});

describe("Letters by hand and their review (app)", () => {
  it("saves a hand-written letter whatever Vo's switches say", async () => {
    state.rpc.create_matter_letter = { data: LETTER, error: null };
    expect(await createLetter({ organizationId: ORG, matterId: MATTER, letterType: "other", title: "Note", body: "Dear officer," })).toEqual({ ok: true, letterId: LETTER });
    expect(await createLetter({ organizationId: ORG, matterId: MATTER, letterType: "other", title: "", body: "x" })).toEqual({ error: expect.stringMatching(/title and 1 to 12,000/) });
  });

  it("turns a step-up refusal into the shared step-up message, and a non-licensed refusal into plain words", async () => {
    state.rpc.approve_matter_letter = { data: null, error: { message: "step-up is required" } };
    const stepUp = await approveLetter({ organizationId: ORG, letterId: LETTER, version: 1 });
    const { safeAccessError } = await import("@/lib/auth/step-up");
    expect(stepUp).toEqual({ error: safeAccessError("step-up is required") });
    state.rpc.approve_matter_letter = { data: null, error: { message: "staff access denied" } };
    expect(await approveLetter({ organizationId: ORG, letterId: LETTER, version: 1 })).toEqual({ error: "Only a licensed member of the firm can approve a letter." });
  });
});
