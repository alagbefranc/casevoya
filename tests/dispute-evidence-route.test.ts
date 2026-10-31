import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dispute evidence route (FIN-13): the request needs a declared length under the cap, and the
 * caller must be signed in before any of the body is read.
 */
const state = vi.hoisted(() => ({ sub: null as string | null, submitted: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: state.sub ? { claims: { sub: state.sub } } : null }) },
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: async () => ({ error: null }) }) }));
vi.mock("@/lib/stripe/server", () => ({ stripeLive: () => false, stripeServer: () => ({ files: {}, disputes: {} }) }));
vi.mock("@/modules/finance/dispute-evidence", () => ({
  submitDisputeEvidence: async (input: { fileName: string; bytes: Uint8Array }) => {
    state.submitted.push(input);
    return { ok: true, fileName: input.fileName };
  },
}));

const { POST } = await import("@/app/api/stripe/dispute-evidence/route");
const { EVIDENCE_MAX_BYTES } = await import("@/modules/finance/credits-present");

const URL_ = "https://app.example/api/stripe/dispute-evidence";
const ORG = "00000000-0000-4000-8000-000000000001";
const DISPUTE = "00000000-0000-4000-8000-000000000002";

async function multipart(fileBytes = 16) {
  const form = new FormData();
  form.set("org", ORG);
  form.set("dispute", DISPUTE);
  form.set("explanation", "Synthetic explanation");
  form.set("file", new File([new Uint8Array(fileBytes)], "evidence.pdf", { type: "application/pdf" }));
  const encoded = new Response(form);
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), type: encoded.headers.get("content-type") ?? "" };
}

/** A body stream that records whether anything pulled from it. */
function tracked(bytes: Uint8Array) {
  const seen = { read: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.read = true;
      controller.enqueue(bytes);
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { stream, seen };
}

function request(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new Request(URL_, { method: "POST", body, headers: { origin: "https://app.example", ...headers }, duplex: "half" } as RequestInit);
}

beforeEach(() => {
  state.sub = "00000000-0000-4000-8000-0000000000aa";
  state.submitted = [];
});

describe("dispute evidence route", () => {
  it("refuses a request without a Content-Length before reading the body", async () => {
    const { bytes, type } = await multipart();
    const { stream, seen } = tracked(bytes);
    const response = await POST(request(stream, { "content-type": type }));
    expect(response.status).toBe(411);
    expect(seen.read).toBe(false);
    expect(state.submitted).toEqual([]);
  });

  it("refuses a declared length above the cap, or one that is not a byte count, before reading", async () => {
    const { bytes, type } = await multipart();
    const big = tracked(bytes);
    expect((await POST(request(big.stream, { "content-type": type, "content-length": String(EVIDENCE_MAX_BYTES + 64 * 1024 + 1) }))).status).toBe(413);
    expect(big.seen.read).toBe(false);
    const odd = tracked(bytes);
    expect((await POST(request(odd.stream, { "content-type": type, "content-length": "12abc" }))).status).toBe(400);
    expect(odd.seen.read).toBe(false);
  });

  it("refuses a signed-out caller before reading the body", async () => {
    state.sub = null;
    const { bytes, type } = await multipart();
    const { stream, seen } = tracked(bytes);
    const response = await POST(request(stream, { "content-type": type, "content-length": String(bytes.byteLength) }));
    expect(response.status).toBe(401);
    expect(seen.read).toBe(false);
  });

  it("stops reading a body that runs past the cap despite a small declared length", async () => {
    const { bytes, type } = await multipart(EVIDENCE_MAX_BYTES + 128 * 1024);
    const { stream } = tracked(bytes);
    const response = await POST(request(stream, { "content-type": type, "content-length": "1024" }));
    expect(response.status).toBe(413);
    expect(state.submitted).toEqual([]);
  });

  it("accepts a signed-in staff member's evidence within the cap", async () => {
    const { bytes, type } = await multipart();
    const { stream } = tracked(bytes);
    const response = await POST(request(stream, { "content-type": type, "content-length": String(bytes.byteLength) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, fileName: "evidence.pdf" });
    expect(state.submitted).toHaveLength(1);
  });
});
