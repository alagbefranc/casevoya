import { describe, expect, it } from "vitest";
import { isInvitationToken, isStaffInviteRole, normalizeEmail } from "@/lib/auth/invitations";
import { isStaffArea, staffMfaRedirectPath } from "@/lib/auth/staff-session";
import {
  STEP_UP_WINDOW_SECONDS,
  passkeySessionActive,
  passkeyStepUpIsFresh,
  totpStepUpIsFresh,
} from "@/lib/auth/step-up";

const NOW = 1_700_000_000;

describe("staff MFA redirect", () => {
  it("sends staff at aal1 to the authenticator page", () => {
    expect(
      staffMfaRedirectPath({
        pathname: "/app/invitations",
        signedIn: true,
        currentAal: "aal1",
        activeRoles: ["firm_owner"],
      }),
    ).toBe("/mfa?next=%2Fapp%2Finvitations");
  });

  it("only ever puts a same-site path in next", () => {
    expect(
      staffMfaRedirectPath({
        pathname: "/app/..//evil.example",
        signedIn: true,
        currentAal: "aal1",
        activeRoles: ["firm_owner"],
      }),
    ).toBe("/mfa?next=%2Fapp");
  });

  it("leaves clients, confirmed staff, and non-workspace routes alone", () => {
    expect(
      staffMfaRedirectPath({
        pathname: "/app",
        signedIn: true,
        currentAal: "aal1",
        activeRoles: ["client", "adult_dependant"],
      }),
    ).toBeNull();
    expect(
      staffMfaRedirectPath({
        pathname: "/app",
        signedIn: true,
        currentAal: "aal2",
        activeRoles: ["case_manager"],
      }),
    ).toBeNull();
    expect(
      staffMfaRedirectPath({
        pathname: "/invite/abc",
        signedIn: true,
        currentAal: "aal1",
        activeRoles: ["assistant"],
      }),
    ).toBeNull();
    expect(isStaffArea("/app")).toBe(true);
    expect(isStaffArea("/mfa")).toBe(false);
  });

  it("lets a passkey or recovery-assured staff session into the workspace", () => {
    expect(
      staffMfaRedirectPath({
        pathname: "/app",
        signedIn: true,
        currentAal: "aal1",
        activeRoles: ["firm_owner"],
        mfaSatisfied: true,
      }),
    ).toBeNull();
  });
});

describe("TOTP step-up", () => {
  it("accepts a recent totp timestamp and rejects stale, missing, or non-totp methods", () => {
    expect(totpStepUpIsFresh([{ method: "totp", timestamp: NOW - 30 }], NOW)).toBe(true);
    expect(totpStepUpIsFresh([{ method: "totp", timestamp: (NOW - 30) * 1000 }], NOW)).toBe(true);
    expect(totpStepUpIsFresh([{ method: "totp", timestamp: NOW - STEP_UP_WINDOW_SECONDS - 1 }], NOW)).toBe(false);
    expect(totpStepUpIsFresh([{ method: "password", timestamp: NOW }], NOW)).toBe(false);
    expect(totpStepUpIsFresh(["totp"], NOW)).toBe(false);
    expect(totpStepUpIsFresh([{ method: "totp", timestamp: NOW + 120 }], NOW)).toBe(false);
    expect(STEP_UP_WINDOW_SECONDS).toBe(15 * 60);
  });
});

describe("passkey assurance", () => {
  it("treats a passkey amr entry as a session and as a fresh step-up", () => {
    const fresh = [{ method: "passkey", timestamp: NOW - 30 }];
    expect(passkeySessionActive(fresh, NOW)).toBe(true);
    expect(passkeyStepUpIsFresh(fresh, NOW)).toBe(true);
    const stale = [{ method: "passkey", timestamp: NOW - STEP_UP_WINDOW_SECONDS - 1 }];
    expect(passkeySessionActive(stale, NOW)).toBe(true);
    expect(passkeyStepUpIsFresh(stale, NOW)).toBe(false);
    expect(passkeySessionActive([{ method: "passkey", timestamp: NOW + 120 }], NOW)).toBe(false);
    expect(passkeySessionActive(["passkey"], NOW)).toBe(false);
    expect(passkeyStepUpIsFresh([{ method: "totp", timestamp: NOW }], NOW)).toBe(false);
  });
});

describe("invitation inputs", () => {
  it("accepts a 64-char hex token and a normalized staff email", () => {
    expect(isInvitationToken("a".repeat(64))).toBe(true);
    expect(isInvitationToken("A".repeat(64))).toBe(false);
    expect(isInvitationToken("short")).toBe(false);
    expect(normalizeEmail("  Staff@Example.TEST ")).toBe("staff@example.test");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(isStaffInviteRole("assistant")).toBe(true);
    expect(isStaffInviteRole("client")).toBe(false);
  });
});
