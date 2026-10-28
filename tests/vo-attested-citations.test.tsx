/**
 * Vo cites attested claims (Francis's decision 2026-10-25, #188): official content whose page
 * Casevoya didn't capture, which a licensed reviewer attested, is cited only with
 * "Page not captured by Casevoya, checked by <reviewer> on <date>" next to the citation, in the
 * words of the claim's evidence on Source review (#242). Covers the shared line, the citations Ask
 * Vo and "Draft with Vo" return (the attestation from the run's stored citations, never from the
 * service), the Vo drafts page's source list, letters, and the agent's tool output and prompt.
 * Synthetic records only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VoData, VoOfficialItem, VoOfficialSource } from "../services/vo-agent/src/data";
import { parseOfficialContent, parseOfficialSources } from "../services/vo-agent/src/data";
import { LETTER_TOOL_SPECS } from "../services/vo-agent/src/letter-tools";
import { runVoTask, type AgentSdk, type SdkMessage } from "../services/vo-agent/src/task";
import type { RunContext } from "../services/vo-agent/src/tools";
import { SourceTimeline } from "@/components/sheet/designer/drafts";
import { MatterLetterDialogs } from "@/components/sheet/designer/matter-letters";
import { captureLine } from "@/modules/sheet/source-claims-present";
import { lettersDialogs, type LetterRow, type LetterVersionRow } from "@/modules/sheet/letters-present";
import { sourceItems } from "@/modules/sheet/vo-present";
import { attestationLine, citationsFor, withStoredAttestation } from "@/modules/vo/grounding";
import { ATTESTED_SOURCES, voSystemPrompt, VO_PROMPT_VERSION } from "@/modules/vo/prompt";
import type { VoSourceRef, VoTaskRequest } from "@/modules/vo/sign";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const MATTER = "33333333-3333-4333-8333-333333333333";
const RULE = "44444444-4444-4444-8444-444444444444";
const FEE = "66666666-6666-4666-8666-666666666666";
const LETTER = "77777777-7777-4777-8777-777777777777";
const PAGE = "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-attested.html#s2";
const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp";
const LINE = "Page not captured by Casevoya, checked by Amara Osei on 24 Oct 2026";

describe("the attestation line", () => {
  it("uses the words of the claim's evidence on Source review (#242)", () => {
    expect(attestationLine("Amara Osei", "2026-10-24")).toBe(LINE);
    const evidence = { sourceUrl: PAGE, section: null, excerpt: null, formNumber: null, formModifiedOn: null, publishedOn: null, modifiedOn: null, lastAmendedOn: null, currentTo: null, checkedOn: null, attestedOn: "2026-10-24", attestedBy: "Amara Osei", snapshot: null };
    expect(attestationLine("Amara Osei", "2026-10-24")).toBe(captureLine(evidence));
    expect(attestationLine(null, "2026-10-24")).toBe("Page not captured by Casevoya, checked by a licensed member on 24 Oct 2026");
    expect(attestationLine("Amara Osei", null)).toBeNull();
    expect(attestationLine("Amara Osei", "2026-13-01")).toBeNull();
  });
});

describe("Ask Vo and Draft with Vo citations", () => {
  const attested: VoSourceRef = { kind: "official", id: RULE, label: "Program rule: synthetic", sourceKind: "rule_version", url: PAGE, marker: "S1" };
  const fee: VoSourceRef = { kind: "official", id: FEE, label: "IRCC fee: Study permit", sourceKind: "fee", url: FEES, marker: "S2" };
  const stored = [
    { kind: "official", id: RULE, source_kind: "rule_version", url: PAGE, attested: true, attested_by: "Amara Osei", attested_on: "2026-10-24" },
    { kind: "official", id: FEE, source_kind: "fee", url: FEES, attested: false },
  ];

  it("carries the attestation the database stored on the run, never the one the service sent", () => {
    const forged: VoSourceRef = { ...attested, attested: true, attestedBy: "Forged Name", attestedOn: "1999-01-01" };
    const forgedFee: VoSourceRef = { ...fee, attested: true, attestedBy: "Forged Name", attestedOn: "1999-01-01" };
    const shown = citationsFor(withStoredAttestation([forged, forgedFee, { kind: "matter", id: MATTER, label: "SF-2026-0001" }], stored), { matterId: MATTER });
    expect(shown.map((ref) => [ref.id, ref.href, ref.attestation])).toEqual([
      [RULE, PAGE, LINE],
      [FEE, FEES, null],
      [MATTER, `/sheet/matters/${MATTER}`, null],
    ]);
    expect(JSON.stringify(shown)).not.toContain("Forged");
  });

  it("leaves out an official citation the run didn't keep, and an attested one with no attestation to show", () => {
    expect(citationsFor(withStoredAttestation([attested], [stored[1]]), { matterId: MATTER })).toEqual([]);
    expect(citationsFor([{ ...attested, attested: true }], { matterId: MATTER })).toEqual([]);
    // When the run can't be read, the citations stay as the run's own reads gave them.
    expect(withStoredAttestation([attested], null)).toEqual([attested]);
  });
});

describe("Vo drafts page source list", () => {
  it("shows the attestation line next to the citation", () => {
    const items = sourceItems(
      [
        { kind: "message", id: "m", label: "Client message 17 Oct" },
        { kind: "official", id: RULE, label: "Program rule: synthetic", sourceKind: "rule_version", url: PAGE, attested: true, attestedBy: "Amara Osei", attestedOn: "2026-10-24" },
        { kind: "official", id: FEE, label: "IRCC fee: Study permit", sourceKind: "fee", url: FEES },
      ],
      { matterId: MATTER },
    );
    expect(items[1]).toEqual({ label: "Program rule: synthetic", href: PAGE, detail: LINE });
    expect(items[2]).toEqual({ label: "IRCC fee: Study permit", href: FEES });
    const html = renderToStaticMarkup(createElement(SourceTimeline, { data: { id: "tl", summary: "3 sources", done: true, said: "Checked 3 sources", clock: "0.3s", items } }));
    expect(html).toContain(`Program rule: synthetic</a> (${LINE})`);
    expect(html).not.toContain("IRCC fee: Study permit</a> (");
  });
});

describe("letters", () => {
  it("shows the attestation line next to an attested source", () => {
    const row: LetterRow = {
      id: LETTER,
      letter_type: "cover_letter",
      title: "Cover letter",
      origin: "vo",
      status: "draft",
      current_version: 1,
      approved_version: null,
      approved_by_membership_id: null,
      approved_at: null,
      approved_self: null,
      created_at: "2026-10-24T14:00:00Z",
      updated_at: "2026-10-24T14:00:00Z",
      version: 1,
      is_sample: true,
    };
    const version: LetterVersionRow = {
      letter_id: LETTER,
      version_number: 1,
      title: "Cover letter",
      body: "Synthetic attested claim [S1].",
      facts: [],
      official: [
        { ref: "S1", kind: "rule_version", content: "Synthetic attested claim.", source_url: PAGE, source_section: "synthetic-section", checked_on: "2026-10-24", snapshot_sha256: null, attested_on: "2026-10-24", attested: true, attested_by: "Amara Osei" },
      ],
      left_out: [],
      origin: "vo",
      created_by: "55555555-5555-4555-8555-555555555555",
      created_at: "2026-10-24T14:00:00Z",
    };
    const viewer = { organizationId: ORG, matterId: MATTER, timeZone: "America/Toronto", canWrite: true, licensed: false, vo: "on" as const };
    const data = lettersDialogs([row], [version], viewer, { member: () => "a licensed member", user: () => "Synthetic Manager" });
    expect(data.letters[0].sources[0].detail).toBe(`section: synthetic-section · checked 24 Oct 2026 · ${LINE}`);
    expect(renderToStaticMarkup(createElement(MatterLetterDialogs, { data }))).toContain(LINE);
  });
});

// ---------------------------------------------------------------------------
// The agent: tool output and prompt
// ---------------------------------------------------------------------------

function source(extra: Partial<VoOfficialSource>): VoOfficialSource {
  return {
    kind: "rule_version",
    id: RULE,
    label: "CA.SYNTHETIC.ATTESTED",
    content: "Synthetic attested claim. Not an immigration requirement.",
    sourceUrl: PAGE,
    checkedOn: "2026-10-24",
    section: "synthetic-section",
    formNumber: null,
    formModifiedOn: null,
    currentTo: null,
    sha256: null,
    attested: true,
    attestedBy: "Amara Osei",
    attestedOn: "2026-10-24",
    ...extra,
  };
}

function askData(rpcs: { name: string; args: Record<string, unknown> }[], official: VoOfficialSource[]): VoData {
  return {
    settings: async () => ({ enabled: true, reply_drafts: true, staff_answers: true, read_client_messages: true, read_identity: true, read_relationship: true, read_financial: true, read_medical: false, read_criminal: false, read_narratives: false }),
    firm: async () => ({ name: "Synthetic Firm", slug: "synthetic", sampleMode: false }),
    matter: async (id) => ({ id, title: "Synthetic matter", reference: "SF-2026-0001", stage: "intake", isSample: false }),
    people: async () => [],
    threadPeople: async () => [],
    messages: async () => [],
    requests: async () => [],
    tasks: async () => [],
    deadlines: async () => [],
    documents: async () => [],
    approvedSources: async () => [],
    freeSlots: async () => ({ starts: [], bookingLink: null, timeZone: "America/Toronto" }),
    runFacts: async () => ({ facts: [], hidden: 0 }),
    runOfficialContent: async () => official,
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      return { data: null, error: null };
    },
  };
}

function scripted(result: string, seen: { results: string[]; system: string }): AgentSdk {
  const handlers = new Map<string, (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[] }>>();
  return {
    tool: (name, _description, _shape, handler) => {
      handlers.set(name, handler);
      return { name };
    },
    createSdkMcpServer: (options) => ({ type: "sdk", name: options.name, tools: options.tools }),
    query: ({ options }) =>
      (async function* () {
        seen.system = String((options as { systemPrompt?: unknown }).systemPrompt ?? "");
        const hook = (options.hooks as { PreToolUse: { hooks: ((input: Record<string, unknown>) => Promise<{ hookSpecificOutput?: { permissionDecision: string } }>)[] }[] }).PreToolUse[0].hooks[0];
        const input = { topic: "synthetic attested claim" };
        const decision = await hook({ hook_event_name: "PreToolUse", tool_name: "mcp__casevoya__read_official_content", tool_input: input });
        if (decision.hookSpecificOutput?.permissionDecision === "allow") {
          const out = await handlers.get("read_official_content")!(input, {});
          seen.results.push(out.content.map((block) => block.text).join("\n"));
        }
        yield { type: "result", subtype: "success", result, usage: { input_tokens: 900, output_tokens: 60 }, total_cost_usd: 0.01 } as SdkMessage;
      })(),
  };
}

const askRequest = (): VoTaskRequest => ({
  v: 1,
  runId: RUN,
  organizationId: ORG,
  membershipId: "88888888-8888-4888-8888-888888888881",
  userId: "88888888-8888-4888-8888-888888888888",
  task: "ask",
  matterId: MATTER,
  threadId: null,
  question: "What does the synthetic attested claim say?",
  accessToken: "user-access-token-abcdefghijklmnop",
  expiresAt: Date.now() + 60_000,
});

describe("the agent's tool output and prompt", () => {
  it("reads the attestation from the database's rows", () => {
    const raw = [{ kind: "rule_version", id: RULE, label: "x", content: "y", source_url: PAGE, checked_on: "2026-10-24", attested: true, attested_by: "Amara Osei", attested_on: "2026-10-24" }];
    expect(parseOfficialSources(raw)[0]).toMatchObject({ attested: true, attestedBy: "Amara Osei", attestedOn: "2026-10-24", sha256: null });
    expect(parseOfficialContent(raw)[0]).toMatchObject({ attested: true, attestedBy: "Amara Osei", attestedOn: "2026-10-24" });
    expect(parseOfficialContent([{ ...raw[0], attested: false }])[0]).toMatchObject({ attested: false, attestedBy: null, attestedOn: null });
  });

  it("Ask Vo: says the page wasn't captured by Casevoya, and the citation carries the attestation; the database adds it on save", async () => {
    const rpcs: { name: string; args: Record<string, unknown> }[] = [];
    const seen = { results: [] as string[], system: "" };
    const out = await runVoTask(askRequest(), {
      sdk: scripted("The rule says so [S1].", seen),
      data: askData(rpcs, [source({}), source({ id: FEE, attestedOn: null })]),
      apiKey: "key",
      cwd: "/tmp/vo",
      nonce: "N0NCE",
    });
    const shown = seen.results.join("\n");
    expect(shown).toContain(`[S1] Program rule, official page checked 2026-10-24. ${LINE}:`);
    // An attested item with no date to show is never handed out.
    expect(shown).not.toContain("[S2]");
    expect(seen.system).toContain(ATTESTED_SOURCES);
    expect(ATTESTED_SOURCES).toMatch(/Casevoya couldn't capture that official page/);
    expect(out.result).toBe("answered");
    if (out.result !== "answered") return;
    expect(out.sources[0]).toMatchObject({ kind: "official", id: RULE, attested: true, attestedBy: "Amara Osei", attestedOn: "2026-10-24" });
    const finish = rpcs.find((rpc) => rpc.name === "finish_vo_run")!;
    expect(finish.args).toMatchObject({ p_prompt_version: VO_PROMPT_VERSION.ask });
    expect(finish.args.p_sources).toEqual([{ kind: "official", id: RULE, label: "Program rule: CA.SYNTHETIC.ATTESTED", source_kind: "rule_version" }]);
  });

  it("letters: find_official_content says it too, and the letter prompt explains it", async () => {
    const item: VoOfficialItem = { kind: "rule_version", id: RULE, label: "CA.SYNTHETIC.ATTESTED", content: "Synthetic attested claim.", sourceUrl: PAGE, checkedOn: "2026-10-24", attested: true, attestedBy: "Amara Osei", attestedOn: "2026-10-24" };
    const ctx = {
      request: { ...askRequest(), task: "letter_draft" },
      data: { officialContent: async () => [item] },
      nonce: "N0NCE",
      settings: null,
      sources: new Map(),
      calls: [],
      draft: null,
      abstainedByDraft: false,
    } as unknown as RunContext;
    const out = await LETTER_TOOL_SPECS.find_official_content.run(ctx, { topic: "synthetic attested claim" });
    expect(out.content[0].text).toContain(`[S1] Program rule, official page checked 2026-10-24. ${LINE}:`);
    expect(voSystemPrompt("letter_draft", "N0NCE")).toContain(ATTESTED_SOURCES);
  });
});
