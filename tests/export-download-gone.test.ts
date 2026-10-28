import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPORT_FILE_MISSING,
  exportDownloadable,
  exportError,
  exportRefusalStatus,
  exportState,
  storageObjectMissing,
} from "@/modules/sheet/exports-present";

// #262 item 2 (from #228): a client-file export whose ZIP was deleted under the retention policy
// shows as Deleted with no Download, and the download route answers 410/404 in plain words instead
// of a bare 502. Synthetic ids only.

const ORG = "00000000-0000-4000-8000-000000000001";
const EXPORT = "00000000-0000-4000-8000-000000000002";

const state = vi.hoisted(() => ({
  grant: { data: null as unknown, error: null as { message: string } | null },
  signed: { data: null as { signedUrl: string } | null, error: null as Record<string, unknown> | null },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "00000000-0000-4000-8000-000000000003" } } }) },
    rpc: async () => state.grant,
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => state.signed }) } }),
}));
vi.mock("@/lib/auth/verify-totp", () => ({ verifyTotpCode: async () => ({ ok: true }) }));

const { POST } = await import("@/app/api/exports/[exportId]/route");

async function download() {
  const response = await POST(
    new Request(`https://app.casevoya.ca/api/exports/${EXPORT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://app.casevoya.ca" },
      body: JSON.stringify({ organizationId: ORG, action: "download" }),
    }),
    { params: Promise.resolve({ exportId: EXPORT }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string; url?: string } };
}

const NOW = new Date("2026-10-20T10:00:00Z");
const OPEN = "2026-10-21T10:00:00Z";

describe("a deleted client-file export (#262)", () => {
  beforeEach(() => {
    state.grant = { data: { bucket: "matter-exports", storage_key: `${ORG}/${EXPORT}/file.zip`, seconds: 60 }, error: null };
    state.signed = { data: { signedUrl: "https://storage.example.test/signed" }, error: null };
  });

  it("reads as Deleted inside its 24-hour window, with no Download", () => {
    const row = { status: "ready" as const, expiresAt: OPEN, lastDownloadedOn: null, failureReason: null, expiresLabel: "21 Oct 06:00" };
    expect(exportState({ ...row, removedOn: "20 Oct" }, NOW)).toEqual({
      tone: "gr",
      label: "Deleted",
      detail: "file removed 20 Oct under the firm’s retention policy",
    });
    expect(exportState({ ...row, removedOn: "20 Oct", excludedCount: 3 }, NOW).label).toBe("Deleted");
    expect(exportState(row, NOW).label).toBe("Ready");
    expect(exportDownloadable({ status: "ready", expiresAt: OPEN, removedAt: "2026-10-20T09:00:00Z" }, NOW)).toBe(false);
    expect(exportDownloadable({ status: "ready", expiresAt: "2026-10-20T09:00:00Z", removedAt: null }, NOW)).toBe(false);
    expect(exportDownloadable({ status: "ready", expiresAt: OPEN, removedAt: null }, NOW)).toBe(true);
  });

  it("the route answers 410 for a deleted or expired export, in plain words", async () => {
    state.grant = { data: null, error: { message: "this export was deleted" } };
    const deleted = await download();
    expect(deleted.status).toBe(410);
    expect(deleted.body.error).toBe(exportError("this export was deleted"));
    expect(deleted.body.error).toMatch(/deleted under the firm’s retention policy/);

    state.grant = { data: null, error: { message: "this export link has expired" } };
    expect(await download()).toEqual({ status: 410, body: { error: "That download link has expired. Start a new export." } });

    state.grant = { data: null, error: { message: "step-up is required" } };
    expect((await download()).status).toBe(403);
  });

  it("a ZIP missing from storage is a clear 404, and another storage failure is never a bare 502", async () => {
    state.signed = { data: null, error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" } };
    expect(await download()).toEqual({ status: 404, body: { error: EXPORT_FILE_MISSING } });

    state.signed = { data: null, error: { name: "StorageUnknownError", message: "fetch failed" } };
    const other = await download();
    expect(other.status).toBe(503);
    expect(other.body.error).toMatch(/Try again/);

    state.signed = { data: { signedUrl: "https://storage.example.test/signed" }, error: null };
    expect(await download()).toEqual({ status: 200, body: { url: "https://storage.example.test/signed", seconds: 60 } });
  });

  it("maps refusals and storage errors", () => {
    expect(exportRefusalStatus("this export was deleted")).toBe(410);
    expect(exportRefusalStatus("this export link has expired")).toBe(410);
    expect(exportRefusalStatus("export access denied")).toBe(403);
    expect(storageObjectMissing({ message: "Object not found", statusCode: "404" })).toBe(true);
    expect(storageObjectMissing({ message: "fetch failed" })).toBe(false);
    expect(storageObjectMissing(null)).toBe(false);
  });
});
