import { beforeEach, describe, expect, it, vi } from "vitest";

// Migration uploads: who may import is decided before any of the request body is read, and the
// body is limited by Content-Length and while it streams. Synthetic ids only.

const ORG = "00000000-0000-4000-8000-000000000001";
const ORIGIN = "https://app.casevoya.test";

const state = vi.hoisted(() => ({
  access: { kind: "signed-out" } as { kind: string; staff?: { organizationId: string; role: string } },
  aal: "aal2" as string,
  mfaSatisfied: false,
}));

vi.mock("@/modules/sheet/load", () => ({ loadSheetAccess: vi.fn(async () => state.access) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.aal } }) } },
    rpc: async (name: string) => ({ data: name === "session_mfa_satisfied" ? state.mfaSatisfied : null, error: null }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

const calls = vi.hoisted(() => ({ upload: vi.fn(), commitDocuments: vi.fn(), run: vi.fn() }));
vi.mock("@/modules/migration/actions", async (original) => ({
  ...(await original<typeof import("@/modules/migration/actions")>()),
  uploadMigrationFile: calls.upload,
  commitMigrationDocuments: calls.commitDocuments,
  runMigrationAction: calls.run,
}));

const { POST } = await import("@/app/api/migration/[action]/route");

const params = (action: string) => ({ params: Promise.resolve({ action }) });

/** A streamed body (no Content-Length) that counts how many chunks were pulled. */
function countingStream(chunks: number, chunkBytes: number) {
  const seen = { pulls: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.pulls >= chunks) return controller.close();
      seen.pulls += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
  }, { highWaterMark: 0 });
  return { stream, seen };
}

function streamed(action: string, stream: ReadableStream<Uint8Array>, contentType = "application/json") {
  return new Request(`${ORIGIN}/api/migration/${action}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": contentType },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

function owner() {
  state.access = { kind: "live", staff: { organizationId: ORG, role: "firm_owner" } };
}

describe("migration upload route", () => {
  beforeEach(() => {
    state.access = { kind: "signed-out" };
    state.aal = "aal2";
    state.mfaSatisfied = false;
    calls.upload.mockReset().mockResolvedValue({ ok: true, id: "batch" });
    calls.commitDocuments.mockReset().mockResolvedValue({ ok: true, remaining: 0, status: "committed" });
    calls.run.mockReset().mockResolvedValue({ ok: true });
  });

  it("refuses a signed-out caller without reading the body", async () => {
    const { stream, seen } = countingStream(3, 1024);
    const response = await POST(streamed("upload", stream, "multipart/form-data; boundary=x"), params("upload"));
    expect(response.status).toBe(401);
    expect(seen.pulls).toBe(0);
    expect(calls.upload).not.toHaveBeenCalled();
  });

  it("refuses staff who are not the firm owner, and an owner without two-step, before reading", async () => {
    state.access = { kind: "live", staff: { organizationId: ORG, role: "case_manager" } };
    const first = countingStream(3, 1024);
    const denied = await POST(streamed("commit-documents", first.stream, "multipart/form-data; boundary=x"), params("commit-documents"));
    expect(denied.status).toBe(403);
    expect(first.seen.pulls).toBe(0);

    owner();
    state.aal = "aal1";
    const second = countingStream(3, 1024);
    const noMfa = await POST(streamed("map", second.stream), params("map"));
    expect(noMfa.status).toBe(403);
    expect(((await noMfa.json()) as { error: string }).error).toMatch(/two-step/);
    expect(second.seen.pulls).toBe(0);
    expect(calls.commitDocuments).not.toHaveBeenCalled();
    expect(calls.run).not.toHaveBeenCalled();
  });

  it("refuses a declared Content-Length over the limit before reading", async () => {
    owner();
    const request = new Request(`${ORIGIN}/api/migration/upload`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x", "content-length": String(64 * 1024 * 1024) },
    });
    const response = await POST(request, params("upload"));
    expect(response.status).toBe(413);
    expect(calls.upload).not.toHaveBeenCalled();

    const bad = new Request(`${ORIGIN}/api/migration/map`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "content-length": "lots" },
    });
    expect((await POST(bad, params("map"))).status).toBe(400);
  });

  it("stops reading a streamed body once it passes the limit", async () => {
    owner();
    const { stream, seen } = countingStream(40, 1024 * 1024);
    const response = await POST(streamed("map", stream), params("map"));
    expect(response.status).toBe(413);
    expect(seen.pulls).toBeLessThanOrEqual(8);
    expect(calls.run).not.toHaveBeenCalled();
  });

  it("passes a firm owner's upload and JSON step through", async () => {
    owner();
    const form = new FormData();
    form.set("organizationId", ORG);
    form.set("kind", "clients_matters");
    form.set("file", new File(["name,email\nA,a@example.test\n"], "clients.csv", { type: "text/csv" }));
    const upload = await POST(new Request(`${ORIGIN}/api/migration/upload`, { method: "POST", headers: { origin: ORIGIN }, body: form }), params("upload"));
    expect(upload.status).toBe(200);
    expect(calls.upload).toHaveBeenCalledTimes(1);
    const [org, file, kind, zip] = calls.upload.mock.calls[0] as [string, File, string, File | null];
    expect(org).toBe(ORG);
    expect(kind).toBe("clients_matters");
    expect(zip).toBeNull();
    expect(await file.text()).toContain("a@example.test");

    // Sample mode and a passkey session (session_mfa_satisfied) are accepted too.
    state.access = { kind: "sample", staff: { organizationId: ORG, role: "firm_owner" } };
    state.aal = "aal1";
    state.mfaSatisfied = true;
    const body = { org: ORG, batch: ORG };
    const json = await POST(
      new Request(`${ORIGIN}/api/migration/discard`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) }),
      params("discard"),
    );
    expect(json.status).toBe(200);
    expect(calls.run).toHaveBeenCalledWith("discard", body);
  });

  it("still refuses another origin and an unknown action", async () => {
    owner();
    const cross = new Request(`${ORIGIN}/api/migration/map`, { method: "POST", headers: { origin: "https://elsewhere.test" }, body: "{}" });
    expect((await POST(cross, params("map"))).status).toBe(403);
    const unknown = new Request(`${ORIGIN}/api/migration/nope`, { method: "POST", headers: { origin: ORIGIN }, body: "{}" });
    expect((await POST(unknown, params("nope"))).status).toBe(404);
  });
});
