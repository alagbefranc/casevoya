import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createRedactedCopy: the caller's session checks (begin_redacted_copy) and the per-user limit run
 * before the server reads the source; the copy is opened and finished by the service role for the
 * signed-in user. Mocked database, storage and redaction engine; no network.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const TICKET = "33333333-3333-4333-8333-333333333333";
const COPY_DOC = "44444444-4444-4444-8444-444444444444";
const COPY_VERSION = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";

const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  begin: { data: null as unknown, error: null as null | { message: string } },
  allowed: true,
  downloads: 0,
  redactions: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a minute and try again.",
  rateLimit: async (name: string, key: string) => {
    state.calls.push({ name: `limit:${name}`, args: { key } });
    return state.allowed;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (name === "begin_redacted_copy") return state.begin;
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        download: async () => {
          state.downloads += 1;
          return { data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null };
        },
        upload: async () => ({ data: {}, error: null }),
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name: `service:${name}`, args });
      if (name === "service_create_redacted_copy_intent") {
        return { data: { document_id: COPY_DOC, version_id: COPY_VERSION, storage_key: `${ORG}/quarantine/${COPY_VERSION}/x` }, error: null };
      }
      if (name === "service_finish_redacted_copy") return { data: { upload_state: "clean", scan_result: "structural_only" }, error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  }),
}));
vi.mock("@/modules/documents/redact", () => ({
  RedactionError: class RedactionError extends Error {},
  redactDocument: async () => {
    state.redactions += 1;
    return new TextEncoder().encode("%PDF-1.7\n%redacted\n");
  },
}));
vi.mock("@/modules/documents/verify", () => ({
  inspectDocumentBytes: () => "application/pdf",
  verifyDocumentStream: async () => ({ ok: false }),
}));

const { createRedactedCopy } = await import("@/modules/documents/actions");

const input = { organizationId: ORG, sourceVersionId: SOURCE, matterId: MATTER, regions: [{ page: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] };

beforeEach(() => {
  state.calls = [];
  state.begin = { data: { ticket_id: TICKET, storage_key: `${ORG}/k`, media_type: "application/pdf", byte_size: 4 }, error: null };
  state.allowed = true;
  state.downloads = 0;
  state.redactions = 0;
});

describe("createRedactedCopy", () => {
  it("reads nothing when the caller's checks refuse (#301)", async () => {
    state.begin = { data: null, error: { message: "document redaction denied" } };
    const result = await createRedactedCopy(input);
    expect(result).toEqual({ error: "Only firm staff can make a redacted copy." });
    expect(state.downloads).toBe(0);
    expect(state.redactions).toBe(0);
    expect(state.calls.some((call) => call.name.startsWith("service:"))).toBe(false);
  });

  it("reads nothing when the per-user limit is reached", async () => {
    state.allowed = false;
    const result = await createRedactedCopy(input);
    expect(result).toEqual({ error: "Too many attempts. Please wait a minute and try again." });
    expect(state.calls.map((call) => call.name)).toEqual(["limit:RL_DOCUMENT_WORK"]);
    expect(state.calls[0].args).toEqual({ key: `user:${USER}` });
    expect(state.downloads).toBe(0);
  });

  it("refuses a source too large for the server before downloading it", async () => {
    state.begin = { data: { ticket_id: TICKET, storage_key: `${ORG}/k`, media_type: "application/pdf", byte_size: 90 * 1024 * 1024 }, error: null };
    const result = await createRedactedCopy(input);
    expect(result).toHaveProperty("error");
    expect(state.downloads).toBe(0);
  });

  it("opens and finishes the copy on the server path for the signed-in user (#300)", async () => {
    const result = await createRedactedCopy(input);
    expect(result).toMatchObject({ documentId: COPY_DOC, versionId: COPY_VERSION, uploadState: "clean" });
    const names = state.calls.map((call) => call.name);
    expect(names).toEqual([
      "limit:RL_DOCUMENT_WORK",
      "begin_redacted_copy",
      "service:service_create_redacted_copy_intent",
      "service:service_finish_redacted_copy",
    ]);
    expect(names).not.toContain("create_redacted_copy_intent");
    expect(names).not.toContain("service:finish_verified_document_upload");
    expect(state.calls[2].args).toMatchObject({ p_ticket_id: TICKET, p_actor_user_id: USER, p_filename: "redacted.pdf" });
    expect(state.calls[3].args).toMatchObject({ p_version_id: COPY_VERSION, p_actor_user_id: USER, p_detected_media_type: "application/pdf" });
  });
});
