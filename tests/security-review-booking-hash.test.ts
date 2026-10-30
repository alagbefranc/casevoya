import { beforeEach, describe, expect, it, vi } from "vitest";

// Public booking wiring (security review): page reads run on the visitor's session, the hold goes
// through the service role with the server's hash and the visitor's verified user id.

vi.mock("server-only", () => ({}));

const sessionRpc = vi.fn();
const serviceRpc = vi.fn();
let sub: string | null = null;
let aal: string | undefined;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: sessionRpc, auth: { getClaims: async () => ({ data: sub ? { claims: { sub, aal } } : null }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: serviceRpc }) }));

const VIEWER = "22222222-2222-4222-8222-222222222222";
const ARGS = {
  p_firm_slug: "synthetic",
  p_event_slug: "initial",
  p_start: "2030-01-01T15:00:00.000Z",
  p_name: "Sam Example",
  p_email: "sam@example.test",
  p_phone: null,
  p_time_zone: "UTC",
  p_idempotency_key: "key-12345678",
  p_client_hash: "a".repeat(64),
};

beforeEach(() => {
  sessionRpc.mockReset();
  serviceRpc.mockReset();
  sub = null;
  aal = undefined;
});

describe("publicDeps", () => {
  it("reads the page and slots with the visitor's session", async () => {
    sessionRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { publicDeps } = await import("@/modules/scheduling/public-deps");
    const deps = await publicDeps();
    await deps.event("synthetic", "initial");
    await deps.busy("id", "a", "b");
    expect(sessionRpc.mock.calls.map(([name]) => name)).toEqual(["booking_public_event", "booking_public_busy"]);
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("holds through the service role, naming the signed-in visitor", async () => {
    serviceRpc.mockResolvedValue({ data: { public_ref: "x" }, error: null });
    sub = VIEWER;
    const { publicDeps } = await import("@/modules/scheduling/public-deps");
    await (await publicDeps()).hold(ARGS);
    expect(sessionRpc).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenCalledWith("booking_public_hold", { ...ARGS, p_viewer: VIEWER, p_viewer_aal: "aal1" });
    aal = "aal2";
    await (await publicDeps()).hold(ARGS);
    expect(serviceRpc).toHaveBeenLastCalledWith("booking_public_hold", { ...ARGS, p_viewer: VIEWER, p_viewer_aal: "aal2" });
  });

  it("names no viewer when signed out or when the session subject is not a user id", async () => {
    serviceRpc.mockResolvedValue({ data: { public_ref: "x" }, error: null });
    const { publicDeps } = await import("@/modules/scheduling/public-deps");
    await (await publicDeps()).hold(ARGS);
    sub = "not-a-uuid";
    await (await publicDeps()).hold(ARGS);
    expect(serviceRpc.mock.calls.map(([, args]) => [args.p_viewer, args.p_viewer_aal])).toEqual([[null, null], [null, null]]);
  });

  it("surfaces the database error message so postPublicHold can map it", async () => {
    serviceRpc.mockResolvedValue({ data: null, error: { message: "booking type not found" } });
    const { publicDeps } = await import("@/modules/scheduling/public-deps");
    await expect((await publicDeps()).hold(ARGS)).rejects.toThrow(/booking type not found/);
  });
});
