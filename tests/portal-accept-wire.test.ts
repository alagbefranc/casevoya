import { beforeEach, describe, expect, it, vi } from "vitest";

// Bugs 3 and 4 (2026-10-25): the accept wizard opened the invitation on every step and retry, and a
// rate-limited invitation read "This invitation can no longer be used."

const TOKEN = "c".repeat(64);

const state = vi.hoisted(() => ({
  previews: [] as unknown[],
  previewCalls: [] as unknown[][],
  drafts: 0,
}));

vi.mock("react", () => ({
  useRef: <T,>(value: T) => ({ current: value }),
  useCallback: <T,>(fn: T) => fn,
}));
vi.mock("@/components/port/kit", () => ({ toast2: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: {} }) } }) }));
vi.mock("@/modules/portal-invitations/actions", () => ({
  previewPortalInvitation: async (...args: unknown[]) => {
    state.previewCalls.push(args);
    return { preview: state.previews.length > 1 ? state.previews.shift() : state.previews[0] };
  },
  savePortalInvitationDraft: async () => {
    state.drafts += 1;
    return { ok: true };
  },
  acceptPortalInvitation: vi.fn(),
}));
vi.mock("@/app/auth/port-actions", () => ({
  getAuthContext: async () => ({ configured: true, signedIn: false }),
  createTrialFirm: vi.fn(),
  enrollAuthenticator: vi.fn(),
  confirmPortalInvite: vi.fn(),
  continuePortalInvite: vi.fn(),
  issueRecoveryCodes: vi.fn(),
  joinPortalInvite: vi.fn(),
  joinStaffInvite: vi.fn(),
  resendPortalInviteCode: vi.fn(),
  previewStaffInvite: vi.fn(),
  redeemRecovery: vi.fn(),
  requestMfaReset: vi.fn(),
  saveSetupStep: vi.fn(),
  sendRecoveryEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpForTrial: vi.fn(),
  updatePassword: vi.fn(),
  verifyEmailCode: vi.fn(),
  verifyTotpCode: vi.fn(),
}));

const { usePortActions } = await import("@/components/port/wire");

const OPEN = {
  status: "open",
  invitee: { display_name: "Ana Client", email: "client@example.test" },
  organization: { display_name: "Synthetic Firm" },
  policies: { portal_terms: { id: "t1" }, privacy_notice: { id: "p1" } },
};

function fakeRoot() {
  return {
    dataset: {} as Record<string, string>,
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent: () => true,
  } as unknown as HTMLElement;
}

function next(root: HTMLElement, step: number) {
  const el = { hasAttribute: (name: string) => name === "data-next", dataset: {} } as unknown as HTMLElement;
  return { type: "click" as const, page: "accept-client", step, el, root };
}

describe("client accept wizard: opening the invitation", () => {
  beforeEach(() => {
    state.previews = [OPEN];
    state.previewCalls = [];
    state.drafts = 0;
  });

  it("opens the invitation once per page load, not on every step or retry", async () => {
    const act = usePortActions("accept-client", TOKEN);
    const root = fakeRoot();
    expect(await act({ type: "step", page: "accept-client", step: 0, root })).toBeNull();
    expect(await act(next(root, 0))).toBeNull();
    expect(await act({ type: "step", page: "accept-client", step: 1, root })).toBeNull();
    expect(await act(next(root, 1))).toBeNull();
    expect(await act({ type: "step", page: "accept-client", step: 0, root })).toBeNull();
    expect(await act(next(root, 0))).toBeNull();
    expect(state.drafts).toBe(3);
    expect(state.previewCalls).toEqual([[TOKEN, true]]);
  });

  it("says to wait when the invitation is rate-limited, and a later try is not another open", async () => {
    state.previews = [{ status: "rate_limited" }, OPEN];
    const act = usePortActions("accept-client", TOKEN);
    const root = fakeRoot();
    expect(await act({ type: "step", page: "accept-client", step: 0, root })).toEqual({
      ok: false,
      message: "Too many tries. Please wait a few minutes and try again.",
    });
    // Not kept: the next try reads again (uncounted) and goes on once the limit has passed.
    expect(await act(next(root, 0))).toBeNull();
    expect(state.previewCalls).toEqual([
      [TOKEN, true],
      [TOKEN, false],
    ]);
  });

  it("still says a closed invitation can no longer be used", async () => {
    state.previews = [{ status: "revoked" }];
    const act = usePortActions("accept-client", TOKEN);
    const root = fakeRoot();
    const result = await act(next(root, 0));
    expect(result).toEqual({ ok: false, message: "This invitation can no longer be used." });
  });
});
