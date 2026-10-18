/**
 * "Draft in French" for staff-written client text: the Workers AI call (mocked), the guards and
 * quota order, the mandatory review of a machine draft, and the client's display fallback.
 * The database side (staff + MFA, quota, append-only French, audit) is in french-drafts.rls.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VERSION = "11111111-1111-4111-8111-111111111111";
const SECRET_TEXT = "Your passport scan for Example Person is blurry";

const state = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: { data: { ok: true } as unknown, error: null as null | { message: string } },
  signedIn: true,
  ai: null as null | { run: (model: string, input: Record<string, unknown>) => Promise<unknown> },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: state.signedIn ? { claims: { sub: "user-1" } } : null }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcResult;
    },
  }),
}));
vi.mock("@/lib/auth/verify-totp", () => ({ verifyTotpCode: async () => ({ ok: true }) }));
// The Worker's bindings: present only when a test puts an AI binding there.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!state.ai) throw new Error("not in a Worker");
    return { env: { AI: state.ai } };
  },
}));

const { translateDraft, TRANSLATE_MODEL, MAX_TRANSLATE_CHARS } = await import("@/modules/i18n/translate");
const { draftInFrench } = await import("@/modules/i18n/actions");
const { reviewDocumentVersion } = await import("@/modules/documents/actions");
const { textForViewer } = await import("@/modules/i18n/display");
const prompt = (await import("@/modules/i18n/fr-ca.json")).default;

function fakeAi(response: unknown) {
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  return {
    calls,
    run: async (model: string, input: Record<string, unknown>) => {
      calls.push({ model, input });
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcResult = { data: { ok: true }, error: null };
  state.signedIn = true;
  state.ai = null;
});

describe("translateDraft", () => {
  it("refuses empty, over-long and unsupported requests without calling the model", async () => {
    const ai = fakeAi({ response: "x" });
    expect(await translateDraft("   ", "en", "fr-CA", { ai })).toEqual({ error: "empty" });
    expect(await translateDraft("a".repeat(MAX_TRANSLATE_CHARS + 1), "en", "fr-CA", { ai })).toEqual({ error: "too_long" });
    expect(await translateDraft("Hello", "fr" as "en", "fr-CA", { ai })).toEqual({ error: "unsupported_language" });
    expect(ai.calls).toHaveLength(0);
  });

  it("is unavailable outside the Worker (no AI binding, no REST fallback)", async () => {
    expect(await translateDraft("Hello", "en", "fr-CA")).toEqual({ error: "unavailable" });
    expect(await translateDraft("Hello", "en", "fr-CA", { ai: null })).toEqual({ error: "unavailable" });
  });

  it("uses the chosen model and the fr-CA prompt, and applies OQLF typography to the draft", async () => {
    const ai = fakeAi({ response: " Veuillez téléverser une copie plus nette: la photo est floue. " });
    const result = await translateDraft("Please upload a clearer copy: the photo is blurry.", "en", "fr-CA", { ai });
    expect(result).toEqual({ text: "Veuillez téléverser une copie plus nette : la photo est floue.", model: TRANSLATE_MODEL });
    expect(ai.calls[0].model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    const messages = ai.calls[0].input.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: prompt.system });
    expect(messages[1].content.endsWith("Please upload a clearer copy: the photo is blurry.")).toBe(true);
  });

  it("keeps the full text: nothing is cut or stripped before the model", async () => {
    const ai = fakeAi({ response: "ok" });
    const text = `  Line one.\n\nLine two <b>with markup</b> & {braces}.  `;
    await translateDraft(text, "en", "fr-CA", { ai });
    const messages = ai.calls[0].input.messages as { content: string }[];
    expect(messages[1].content.endsWith(text)).toBe(true);
  });

  it("fails closed on a provider error or an empty answer, and never logs the text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    expect(await translateDraft(SECRET_TEXT, "en", "fr-CA", { ai: fakeAi(new Error(`provider echoed: ${SECRET_TEXT}`)) })).toEqual({ error: "failed" });
    expect(await translateDraft(SECRET_TEXT, "en", "fr-CA", { ai: fakeAi({ response: "  " }) })).toEqual({ error: "failed" });
    expect(await translateDraft(SECRET_TEXT, "en", "fr-CA", { ai: fakeAi({}) })).toEqual({ error: "failed" });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("blurry");
      spy.mockRestore();
    }
  });
});

describe("draftInFrench (server action)", () => {
  it("drafts through the Worker binding only after the database accepts the staff member and the quota", async () => {
    const ai = fakeAi({ response: "La photo est floue." });
    state.ai = ai;
    const result = await draftInFrench({ organizationId: ORG, text: "The photo is blurry." });
    expect(result).toEqual({ text: "La photo est floue.", model: TRANSLATE_MODEL });
    expect(state.rpcCalls).toEqual([{ name: "consume_translation_draft", args: { p_organization_id: ORG, p_char_count: 20 } }]);
    expect(ai.calls).toHaveLength(1);
  });

  it("does not call the model when the database refuses (not staff, no MFA, other firm) or the quota is spent", async () => {
    const ai = fakeAi({ response: "x" });
    state.ai = ai;
    state.rpcResult = { data: null, error: { message: "staff access denied" } };
    expect(await draftInFrench({ organizationId: ORG, text: "The photo is blurry." })).toEqual({
      error: "Only firm staff signed in with two-step verification can draft in French.",
    });
    state.rpcResult = { data: { ok: false, error: "rate_limited" }, error: null };
    expect((await draftInFrench({ organizationId: ORG, text: "The photo is blurry." })).error).toMatch(/many drafts/);
    expect(ai.calls).toHaveLength(0);
  });

  it("spends no quota on empty, over-long or signed-out requests", async () => {
    state.ai = fakeAi({ response: "x" });
    expect((await draftInFrench({ organizationId: ORG, text: " " })).error).toBeTruthy();
    expect((await draftInFrench({ organizationId: ORG, text: "a".repeat(4001) })).error).toMatch(/4000/);
    expect((await draftInFrench({ organizationId: "not-a-firm", text: "Hello" })).error).toBeTruthy();
    state.signedIn = false;
    expect((await draftInFrench({ organizationId: ORG, text: "Hello" })).error).toBe("Sign in first.");
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("says the feature is unavailable outside the Worker, after the guard", async () => {
    expect((await draftInFrench({ organizationId: ORG, text: "The photo is blurry." })).error).toMatch(/not available here/);
  });
});

describe("saving a review with French", () => {
  const base = { organizationId: ORG, versionId: VERSION, expectedVersion: 3, decision: "changes_requested", reason: "The photo is blurry.", code: "123456" };

  it("refuses a machine draft nobody confirmed checking, before touching the database", async () => {
    const result = await reviewDocumentVersion({ ...base, reasonFr: "La photo est floue.", reasonFrMachine: true, reasonFrReviewed: false });
    expect(result).toEqual({ error: "Check the machine-drafted French and confirm it before saving." });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("records a checked machine draft with the server's model id, and human French without one", async () => {
    state.rpcResult = { data: 4, error: null };
    await reviewDocumentVersion({ ...base, reasonFr: " La photo est floue. ", reasonFrMachine: true, reasonFrReviewed: true });
    expect(state.rpcCalls[0]).toEqual({
      name: "review_document_version_fr",
      args: {
        p_version_id: VERSION,
        p_expected_version: 3,
        p_decision: "changes_requested",
        p_reason: "The photo is blurry.",
        p_annotations: null,
        p_reason_fr: "La photo est floue.",
        p_machine_drafted: true,
        p_model: TRANSLATE_MODEL,
      },
    });
    await reviewDocumentVersion({ ...base, reasonFr: "La photo est floue.", reasonFrMachine: false });
    expect(state.rpcCalls[1].args).toMatchObject({ p_machine_drafted: false, p_model: null });
  });

  it("saves an English-only review exactly as before", async () => {
    state.rpcResult = { data: 4, error: null };
    await reviewDocumentVersion({ ...base, reasonFr: "  " });
    expect(state.rpcCalls[0].name).toBe("review_document_version");
    expect(Object.keys(state.rpcCalls[0].args).sort()).toEqual(["p_annotations", "p_decision", "p_expected_version", "p_reason", "p_version_id"]);
  });
});

describe("what the client sees", () => {
  it("shows the reviewed French to a French-preferring client and English otherwise", () => {
    expect(textForViewer("The photo is blurry.", "La photo est floue.", "fr-CA")).toEqual({ text: "La photo est floue.", lang: "fr" });
    expect(textForViewer("The photo is blurry.", "La photo est floue.", "en-CA")).toEqual({ text: "The photo is blurry.", lang: "en" });
    expect(textForViewer("The photo is blurry.", null, "fr-CA")).toEqual({ text: "The photo is blurry.", lang: "en" });
    expect(textForViewer("The photo is blurry.", "   ", "fr-CA")).toEqual({ text: "The photo is blurry.", lang: "en" });
    expect(textForViewer("The photo is blurry.", "La photo est floue.", undefined)).toEqual({ text: "The photo is blurry.", lang: "en" });
  });
});
