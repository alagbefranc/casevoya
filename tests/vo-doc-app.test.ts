/**
 * The app side of Vo document reading with the agent service and Supabase mocked: "Read with Vo"
 * is unavailable before anything is counted, the database's checks come first (step-up, category,
 * a reading already waiting), the signed request names the version and nothing else, a service
 * that never answered closes the run; and the presenters: the review panel's rows, cards on Vo
 * drafts, the switches wired to the new settings, and the run log (PRD AI-01..AI-03).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MATTER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";

const state = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpc: {} as Record<string, { data: unknown; error: null | { message: string } }>,
  env: {} as Record<string, unknown>,
  fetches: [] as { url: string; body: string }[],
  reply: {} as Record<string, unknown>,
  status: 200,
  rows: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "77777777-7777-4777-8777-777777777777" } } }),
      getSession: async () => ({ data: { session: { access_token: "user-token-abcdefghijklmnopqrstuvwxyz" } } }),
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const key of ["select", "eq", "order", "limit"]) chain[key] = () => chain;
      chain.maybeSingle = async () => ({ data: table in state.rows ? state.rows[table] : { id: "88888888-8888-4888-8888-888888888888" } });
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

const { readDocumentWithVo, acceptVoDocProposal, rejectVoDocProposal } = await import("@/modules/vo/vo-doc-actions");
const { needsStepUp } = await import("@/modules/sheet/matter-wire");
const present = await import("@/modules/sheet/vo-present");
const docPresent = await import("@/modules/sheet/vo-doc-present");
const { voSettingChanges } = await import("@/modules/vo/errors");

beforeEach(() => {
  state.rpcCalls = [];
  state.rows = {};
  state.rpc = { begin_vo_document_review: { data: { ok: true, run_id: RUN, matter_id: MATTER, category: "identity" }, error: null } };
  state.fetches = [];
  state.status = 200;
  state.reply = { result: "drafted", draftId: DRAFT, text: "Vo read Passport bio page (version 1): 3 values.", needsRule: false, sources: [{ kind: "document_version", id: VERSION, label: "Passport bio page, version 1" }] };
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

describe("Read with Vo", () => {
  it("is unavailable before anything is counted when the service isn't set up", async () => {
    state.env = {};
    const out = await readDocumentWithVo({ organizationId: ORG, versionId: VERSION });
    expect(out).toEqual({ error: expect.stringContaining("unavailable") });
    expect(state.rpcCalls).toEqual([]);
  });

  it("starts the run in the database, then sends only the version with the person's own token", async () => {
    const out = await readDocumentWithVo({ organizationId: ORG, versionId: VERSION });
    expect(out).toEqual({ ok: true, draftId: DRAFT, matterId: MATTER, text: expect.stringContaining("Vo read"), needsRule: false });
    expect(state.rpcCalls[0]).toEqual({ name: "begin_vo_document_review", args: { p_organization_id: ORG, p_version_id: VERSION } });
    const body = JSON.parse(state.fetches[0].body) as Record<string, unknown>;
    expect(body).toMatchObject({ task: "document_review", runId: RUN, matterId: MATTER, versionId: VERSION, threadId: null, question: null, accessToken: "user-token-abcdefghijklmnopqrstuvwxyz" });
    expect(JSON.stringify(body)).not.toMatch(/service_role|SERVICE_ROLE/);
  });

  it("turns the database's refusals into plain messages, and a step-up into the step-up screen", async () => {
    state.rpc.begin_vo_document_review = { data: null, error: { message: "step-up is required" } };
    const stepUp = await readDocumentWithVo({ organizationId: ORG, versionId: VERSION });
    expect("error" in stepUp && needsStepUp(stepUp.error)).toBe(true);
    state.rpc.begin_vo_document_review = { data: { ok: false, error: "category_off", category: "medical" }, error: null };
    expect(await readDocumentWithVo({ organizationId: ORG, versionId: VERSION })).toEqual({ error: expect.stringContaining("Medical record") });
    state.rpc.begin_vo_document_review = { data: { ok: false, error: "already_read", draft_id: DRAFT, matter_id: MATTER }, error: null };
    expect(await readDocumentWithVo({ organizationId: ORG, versionId: VERSION })).toMatchObject({ draftId: DRAFT, matterId: MATTER, error: expect.stringContaining("already read") });
    expect(state.fetches).toEqual([]);
  });

  it("names a client who hasn't agreed to AI help, and says where they can (decision #263-3)", async () => {
    const PERSON = "99999999-9999-4999-8999-999999999999";
    state.rpc.begin_vo_document_review = { data: { ok: false, error: "client_ai_off", person_id: PERSON }, error: null };
    state.rows.persons = { display_name: "Ana Silva", user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    expect(await readDocumentWithVo({ organizationId: ORG, versionId: VERSION })).toEqual({
      code: "client_ai_off",
      error: "Ana Silva hasn’t agreed to AI help with their documents yet. They can turn on AI drafting help in their client portal, under Account. Nothing was read; review it yourself.",
    });
    state.rows.persons = { display_name: "Ana Silva", user_id: null };
    const noPortal = await readDocumentWithVo({ organizationId: ORG, versionId: VERSION });
    expect("error" in noPortal && noPortal.error).toContain("Invite them to the client portal");
    state.rows.persons = null;
    const unknown = await readDocumentWithVo({ organizationId: ORG, versionId: VERSION });
    expect("error" in unknown && unknown.error).toMatch(/^This client hasn’t agreed to AI help with their documents yet\./);
    expect(state.fetches).toEqual([]);
  });

  it("closes the run when the service never answered, and explains an unsupported file", async () => {
    state.status = 503;
    expect(await readDocumentWithVo({ organizationId: ORG, versionId: VERSION })).toEqual({ error: expect.stringContaining("unavailable") });
    expect(state.rpcCalls.at(-1)).toEqual({ name: "finish_vo_run", args: { p_run_id: RUN, p_result: "failed", p_failure: "unavailable" } });
    state.status = 200;
    state.reply = { result: "failed", failure: "unsupported_file" };
    expect(await readDocumentWithVo({ organizationId: ORG, versionId: VERSION })).toEqual({ error: expect.stringContaining("PDFs") });
  });

  it("accepts and rejects through the database functions only", async () => {
    state.rpc.accept_vo_doc_proposal = { data: { status: "accepted", deadline_id: "d1", draft_status: "draft" }, error: null };
    expect(await acceptVoDocProposal({ organizationId: ORG, proposalId: PROPOSAL, value: " Passport expires " })).toEqual({ ok: true, deadlineId: "d1", draftStatus: "draft" });
    expect(state.rpcCalls.at(-1)).toEqual({ name: "accept_vo_doc_proposal", args: { p_proposal_id: PROPOSAL, p_value: "Passport expires", p_due_on: null } });
    state.rpc.accept_vo_doc_proposal = { data: null, error: { message: "this proposal was already reviewed" } };
    expect(await acceptVoDocProposal({ organizationId: ORG, proposalId: PROPOSAL })).toEqual({ error: expect.stringContaining("already") });
    state.rpc.reject_vo_doc_proposal = { data: { status: "rejected", draft_status: "reviewed" }, error: null };
    expect(await rejectVoDocProposal({ organizationId: ORG, proposalId: PROPOSAL })).toEqual({ ok: true, draftStatus: "reviewed" });
    expect(await acceptVoDocProposal({ organizationId: ORG, proposalId: "not-a-uuid" })).toEqual({ error: "Choose a proposal." });
  });
});

describe("document reading presentation", () => {
  const viewer = { organizationId: ORG, firmName: "Synthetic Firm", isOwner: true, sampleMode: false, agentReady: true, timeZone: "America/Toronto" };
  const names = { matter: () => "Synthetic Applicant", reference: () => "SF-2026-0001", person: () => "Amara Osei" };
  const proposal = (extra: Partial<import("@/modules/sheet/vo-doc-present").VoProposalRow>) => ({
    id: PROPOSAL,
    position: 0,
    kind: "field" as const,
    label: "Full name",
    value: "Synthetic Applicant",
    detail: "name",
    page: 1,
    confidence: 98,
    category: null,
    dueOn: null,
    status: "proposed" as const,
    ...extra,
  });

  it("shows waiting proposals as the Designer's rows, with low confidence called out", () => {
    const panel = docPresent.readingPanel({
      id: DRAFT,
      organizationId: ORG,
      purpose: "Passport bio page",
      versionNumber: 2,
      mediaType: "application/pdf",
      sha256: "4f1c" + "0".repeat(56) + "a90e",
      needsRule: true,
      proposals: [
        proposal({ position: 0, kind: "classification", label: "Suggested purpose", value: "Passport bio page", detail: "Identity document", category: "identity", confidence: 93, page: null }),
        proposal({ position: 1 }),
        proposal({ id: "p2", position: 2, label: "Date of expiry", value: "2031-03-03", detail: "date", confidence: 72 }),
        proposal({ id: "p3", position: 3, kind: "deadline", label: "Passport expires", value: "2031-03-03", detail: null, dueOn: "2031-03-03", confidence: null }),
        proposal({ id: "p4", position: 4, kind: "inconsistency", label: "Photo", value: null, detail: "Glare over the photo.", confidence: null, page: null }),
        proposal({ id: "p5", position: 5, kind: "needs_rule", label: "Renewal", value: null, detail: "[needs a sourced rule]", confidence: null, page: null }),
        proposal({ id: "p6", position: 6, status: "accepted" }),
      ],
    })!;
    expect(panel.title).toBe("Passport bio page");
    expect(panel.pill).toEqual(["v2", "PDF", "sha256 4f1c…a90e"]);
    expect(panel.badge).toEqual({ tone: "rev", label: "Read by Vo", detail: "needs a sourced rule" });
    expect(panel.rows).toHaveLength(6);
    expect(panel.rows[0]).toMatchObject({ label: "Suggested purpose · Identity document", value: "Passport bio page", badge: { tone: "ok", label: "93%", detail: "whole file" }, editable: true });
    expect(panel.rows[2]).toMatchObject({ value: "3 Mar 2031", badge: { tone: "chg", label: "72%", detail: "p.1" } });
    expect(panel.rows[3]).toMatchObject({ label: "Proposed deadline · 3 Mar 2031", value: "Passport expires", badge: { tone: "blue", label: "Printed date" } });
    expect(panel.rows[4]).toMatchObject({ label: "Doesn’t match (not a finding)", editable: false });
    expect(panel.rows[5]).toMatchObject({ label: "Needs a sourced rule", badge: { tone: "bad" } });
    expect(panel.rows[1].attrs).toEqual({ "data-proposal": PROPOSAL, "data-kind": "field", "data-original": "Synthetic Applicant" });
    expect(panel.note).toContain("Values under 80%");
    expect(panel.paper.text).toEqual(["Full name: ", { hl: "Synthetic Applicant", f: "1" }, ".", " Date of expiry: ", { hl: "3 Mar 2031", f: "2" }, "."]);
    expect(panel.accept.attrs).toEqual({ "data-vo-doc-accept": DRAFT, "data-org": ORG });
    // Nothing left to decide: no panel.
    expect(docPresent.readingPanel({ id: DRAFT, organizationId: ORG, purpose: "P", versionNumber: 1, mediaType: "image/png", sha256: null, needsRule: false, proposals: [proposal({ status: "rejected" })] })).toBeNull();
  });

  it("lists a reading on Vo drafts, opening the matter's review panel, Reject discarding it", () => {
    const settings = present.effectiveSettings({ enabled: true }, false);
    const data = present.draftsPage({
      viewer,
      settings,
      waiting: [],
      week: [],
      running: null,
      abstained: null,
      names,
      readings: [
        {
          id: DRAFT,
          runId: RUN,
          title: "Read Passport bio page",
          body: "Vo read Passport bio page (version 1): 3 values.",
          matterId: MATTER,
          versionId: VERSION,
          sources: [{ kind: "document_version", id: VERSION, label: "Passport bio page, version 1" }],
          needsRule: false,
          isSample: false,
          createdAt: "2026-10-18T13:00:00Z",
          latencyMs: 9000,
          waiting: 4,
        },
      ],
    });
    expect(data.heading).toBe("Vo drafted one thing for you.");
    expect(data.cards[0]).toMatchObject({
      meta: ["Read by Vo", "needs your review", "Document reading"],
      // A reading is decided per proposal on the matter: Edit opens it; Accept says so.
      accept: { disabled: true },
      edit: { "data-nav": `/sheet/matters/${MATTER}?tab=documents&vo=${DRAFT}#ocr` },
      reject: { "data-vo-doc-discard": DRAFT, "data-org": ORG },
    });
    expect(data.cards[0].timeline.items).toContain("4 proposals to decide");
    expect(data.switches.find((s) => s.id === "swVoClassify")).toMatchObject({ on: true, attrs: { "data-vo-setting": "doc_classification" } });
    expect(data.switches.find((s) => s.id === "swVoFlags")).toMatchObject({ on: true, attrs: { "data-vo-setting": "doc_flags" } });
    expect(voSettingChanges("doc_flags", false)).toEqual({ missing_fields: false, inconsistency_flags: false });
    expect(voSettingChanges("ocr_normalisation", true)).toEqual({ ocr_normalisation: true });
    expect(voSettingChanges("send_email", true)).toBeNull();
  });

  it("offers Read with Vo only when Vo is on, available and a document capability is on", () => {
    expect(present.voCanReadDocuments(present.effectiveSettings({ enabled: true }, false), { agentReady: true })).toBe(true);
    expect(present.voCanReadDocuments(present.effectiveSettings(null, false), { agentReady: true })).toBe(false);
    expect(present.voCanReadDocuments(present.effectiveSettings({ enabled: true }, false), { agentReady: false })).toBe(false);
    const off = present.effectiveSettings({ enabled: true, doc_classification: false, ocr_normalisation: false, missing_fields: false, inconsistency_flags: false }, false);
    expect(present.voCanReadDocuments(off, { agentReady: true })).toBe(false);
  });

  it("logs a reading with its model, the read step, its cost and the version it read", () => {
    const rows = present.aiRunRows(
      [
        {
          id: RUN,
          kind: "document_review",
          result: "drafted",
          matterId: MATTER,
          threadId: null,
          userId: "u",
          model: "claude-opus-5-5",
          promptVersion: "docread-1",
          sourceCount: 1,
          tools: ["read_document_version"],
          costUsd: 0.034,
          failure: null,
          useful: null,
          createdAt: "2026-10-18T13:00:00Z",
          draft: { status: "reviewed", edited: null },
          versionId: VERSION,
        },
      ],
      names,
      viewer,
    );
    expect(rows[0]).toMatchObject({
      task: "Document reading for Synthetic Applicant",
      model: { left: "claude-opus-5-5", right: "1 tool call" },
      prompt: "docread-1",
      sources: `Document version ${VERSION.slice(0, 8)}`,
      cost: "$0.0340",
      review: { tone: "ok", label: "Reviewed" },
    });
  });
});
