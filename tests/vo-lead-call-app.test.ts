/**
 * The app side of Vo lead follow-ups and call summaries with the agent service and Supabase mocked:
 * unavailable before anything is counted; the database's refusals (no consent to contact, a
 * capability off, a draft already waiting) come first and are shown plainly; notes that mention a
 * category the firm keeps from Vo are refused before any run starts; the signed request carries
 * the person's own token and only what the task needs; a service that never answered closes the
 * run; the review actions go to the database functions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const BOOKING = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpc: {} as Record<string, { data: unknown; error: null | { message: string } }>,
  env: {} as Record<string, unknown>,
  fetches: [] as { url: string; body: string }[],
  reply: {} as Record<string, unknown>,
  status: 200,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "77777777-7777-4777-8777-777777777777" } } }),
      getSession: async () => ({ data: { session: { access_token: "user-token-abcdefghijklmnopqrstuvwxyz" } } }),
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const key of ["select", "eq", "order", "limit", "in"]) chain[key] = () => chain;
      chain.maybeSingle = async () => ({ data: { id: "88888888-8888-4888-8888-888888888888" } });
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

const actions = await import("@/modules/vo/crm-actions");

const NOTES = "Discussed the work permit renewal. Client sends the employer letter by Friday.";

beforeEach(() => {
  state.rpcCalls = [];
  state.rpc = {
    begin_vo_lead_follow_up: { data: { ok: true, run_id: RUN, lead_id: LEAD, marketing: false }, error: null },
    begin_vo_call_summary: { data: { ok: true, run_id: RUN, booking_id: BOOKING, lead_id: LEAD, matter_id: null }, error: null },
  };
  state.fetches = [];
  state.status = 200;
  state.reply = { result: "drafted", draftId: DRAFT, text: "Hi Sam", needsRule: false, sources: [{ kind: "lead", id: LEAD, label: "Sam Example" }], leftOut: 0 };
  state.env = {
    VO_AGENT_SECRET: "k".repeat(48),
    VO_AGENT: {
      fetch: async (input: Request) => {
        state.fetches.push({ url: input.url, body: await input.text() });
        return new Response(JSON.stringify(state.reply), { status: state.status });
      },
    },
  };
});

describe("Draft follow-up with Vo", () => {
  it("is unavailable before anything is counted when the service isn't set up", async () => {
    state.env = {};
    expect(await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD })).toEqual({ error: expect.stringContaining("unavailable") });
    expect(state.rpcCalls).toEqual([]);
  });

  it("starts the run in the database, then sends only the lead with the person's own token", async () => {
    const out = await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD });
    expect(out).toMatchObject({ ok: true, draftId: DRAFT, text: "Hi Sam", leftOut: 0 });
    expect(state.rpcCalls[0]).toEqual({ name: "begin_vo_lead_follow_up", args: { p_organization_id: ORG, p_lead_id: LEAD } });
    const body = JSON.parse(state.fetches[0].body) as Record<string, unknown>;
    expect(body).toMatchObject({ task: "lead_follow_up", runId: RUN, leadId: LEAD, bookingId: null, matterId: null, notes: null, accessToken: "user-token-abcdefghijklmnopqrstuvwxyz" });
    expect(state.fetches[0].url).toBe("https://vo-agent/v1/run");
  });

  it("shows the database's refusals plainly, with no call to the service", async () => {
    state.rpc.begin_vo_lead_follow_up = { data: { ok: false, error: "no_consent" }, error: null };
    expect(await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD })).toEqual({ error: expect.stringContaining("hasn’t agreed to be contacted") });
    state.rpc.begin_vo_lead_follow_up = { data: { ok: false, error: "capability_off" }, error: null };
    expect(await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD })).toEqual({ error: expect.stringContaining("administrative reply drafts") });
    state.rpc.begin_vo_lead_follow_up = { data: { ok: false, error: "already_drafted", draft_id: DRAFT }, error: null };
    expect(await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD })).toEqual({ error: expect.stringContaining("already drafted"), draftId: DRAFT });
    state.rpc.begin_vo_lead_follow_up = { data: { ok: false, error: "off" }, error: null };
    expect(await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD })).toEqual({ error: expect.stringContaining("Vo is off") });
    expect(state.fetches).toEqual([]);
  });

  it("closes the run when the service never answered", async () => {
    state.status = 503;
    expect(await actions.draftLeadFollowUp({ organizationId: ORG, leadId: LEAD })).toEqual({ error: expect.stringContaining("unavailable") });
    expect(state.rpcCalls.at(-1)).toEqual({ name: "finish_vo_crm_run", args: { p_run_id: RUN, p_result: "failed", p_failure: "unavailable" } });
  });
});

describe("Summarise call notes with Vo", () => {
  it("checks the notes' length and the sensitive-category switches before any run starts", async () => {
    expect(await actions.summariseCallNotes({ organizationId: ORG, bookingId: BOOKING, notes: "short" })).toEqual({ error: expect.stringContaining("Paste your notes") });
    const medical = await actions.summariseCallNotes({ organizationId: ORG, bookingId: BOOKING, notes: "Client mentioned a hospital stay and new medication last spring." });
    expect(medical).toEqual({ error: expect.stringContaining("medical details") });
    expect(state.rpcCalls).toEqual([]);
    expect(state.fetches).toEqual([]);
  });

  it("sends the pasted notes in the signed request only, kept on the lead the database chose", async () => {
    state.reply = { result: "drafted", draftId: DRAFT, text: "Summary:\n- Renewal.", needsRule: false, sources: [{ kind: "booking", id: BOOKING, label: "Video call" }], leftOut: 0 };
    const out = await actions.summariseCallNotes({ organizationId: ORG, bookingId: BOOKING, notes: NOTES });
    expect(out).toMatchObject({ ok: true, draftId: DRAFT });
    expect(state.rpcCalls[0]).toEqual({ name: "begin_vo_call_summary", args: { p_organization_id: ORG, p_booking_id: BOOKING } });
    const body = JSON.parse(state.fetches[0].body) as Record<string, unknown>;
    expect(body).toMatchObject({ task: "call_summary", bookingId: BOOKING, leadId: LEAD, matterId: null, notes: NOTES });
  });
});

describe("a person decides", () => {
  it("marks a follow-up sent, saves a summary or rejects, through the database", async () => {
    state.rpc.mark_vo_lead_follow_up_sent = { data: "note-1", error: null };
    expect(await actions.markLeadFollowUpSent({ organizationId: ORG, draftId: DRAFT, body: "Hi Sam" })).toEqual({ ok: true, noteId: "note-1" });
    state.rpc.save_vo_call_summary = { data: "note-2", error: null };
    expect(await actions.saveCallSummary({ organizationId: ORG, draftId: DRAFT, body: "Summary" })).toEqual({ ok: true, noteId: "note-2" });
    expect(await actions.discardVoCrmDraft({ organizationId: ORG, draftId: DRAFT })).toEqual({ ok: true });
    expect(state.rpcCalls.map((call) => call.name)).toEqual(["mark_vo_lead_follow_up_sent", "save_vo_call_summary", "discard_vo_crm_draft"]);
    state.rpc.mark_vo_lead_follow_up_sent = { data: null, error: { message: "the lead has no consent to be contacted" } };
    expect(await actions.markLeadFollowUpSent({ organizationId: ORG, draftId: DRAFT, body: "Hi Sam" })).toEqual({ error: expect.stringContaining("withdrawn their consent") });
    state.rpc.save_vo_call_summary = { data: null, error: { message: "replace the [needs a sourced rule] placeholder before saving" } };
    expect(await actions.saveCallSummary({ organizationId: ORG, draftId: DRAFT, body: "Summary" })).toEqual({ error: expect.stringContaining("needs a sourced rule") });
  });
});
