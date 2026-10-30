import { describe, expect, it } from "vitest";
import { safeAccessError } from "@/lib/auth/step-up";
import {
  STAFF_INVITE_ROLES,
  emailPlaceholder,
  inviteExpiry,
  inviteLink,
  invitationRow,
  memberRow,
  needsStepUp,
  readStaffInvite,
  staffInviteError,
  staffRoleCell,
  staffRows,
  staffStepUpLocation,
  type DirectoryMember,
  type PendingInvitation,
} from "@/modules/sheet/staff-present";

const NOW = new Date("2026-10-18T15:00:00Z");
const TZ = "America/Toronto";

const owner: DirectoryMember = {
  membershipId: "m-owner",
  name: "Dana Lee",
  email: "dana@maple.test",
  role: "firm_owner",
  status: "active",
  licensed: true,
  twoStep: true,
};

function invite(over: Partial<PendingInvitation>): PendingInvitation {
  return {
    id: "i-1",
    email: "sam.ortiz@maple.test",
    role: "case_manager",
    createdAt: "2026-10-17T15:00:00Z",
    expiresAt: "2026-10-24T15:00:00Z",
    ...over,
  };
}

describe("staff tab rows", () => {
  it("names an owner who holds a licence the Designer's way", () => {
    expect(staffRoleCell("firm_owner", true)).toEqual({ left: "Owner", right: "Licensed consultant" });
    expect(staffRoleCell("firm_owner", false)).toBe("Owner");
    expect(staffRoleCell("finance_user", false)).toBe("Finance");
  });

  it("shows a member's email and two-step status only when the database returned them", () => {
    expect(memberRow(owner)).toMatchObject({
      name: "Dana Lee",
      email: "dana@maple.test",
      state: { tone: "ok", label: "Accepted" },
      note: "Two-step on",
      action: { kind: "more" },
    });
    const hidden = memberRow({ ...owner, role: "assistant", email: null, twoStep: null, status: "suspended" });
    expect(hidden).toMatchObject({ email: "", note: "Two-step required", role: "Assistant", state: { tone: "chg", label: "Suspended" } });
    expect(memberRow({ ...owner, twoStep: false }).note).toBe("Two-step not set up");
  });

  it("shows an open invitation as sent with its expiry, and an expired one as resendable", () => {
    const open = invitationRow(invite({}), NOW, TZ);
    expect(open).toMatchObject({
      name: "sam.ortiz@maple.test",
      email: "Invited 17 Oct",
      role: "Case manager",
      state: { tone: "rev", label: "Sent", detail: "expires 24 Oct" },
      note: "Single use",
      action: { kind: "revoke", invitationId: "i-1" },
    });
    expect(open.person).toEqual({ name: "sam ortiz" });
    const expired = invitationRow(invite({ id: "i-2", expiresAt: "2026-10-14T15:00:00Z" }), NOW, TZ);
    expect(expired.state).toEqual({ tone: "chg", label: "Expired 14 Oct" });
    expect(expired.action).toEqual({ kind: "resend", invitationId: "i-2" });
  });

  it("lists the team, then open invitations newest first, then the latest expired one per person and role", () => {
    const rows = staffRows(
      [owner],
      [
        invite({ id: "old-open", email: "a@maple.test", createdAt: "2026-10-12T15:00:00Z", expiresAt: "2026-10-19T15:00:00Z" }),
        invite({ id: "new-open", email: "b@maple.test", createdAt: "2026-10-18T10:00:00Z", expiresAt: "2026-10-25T10:00:00Z" }),
        invite({ id: "exp-1", email: "c@maple.test", expiresAt: "2026-10-10T15:00:00Z" }),
        invite({ id: "exp-2", email: "c@maple.test", expiresAt: "2026-10-12T15:00:00Z" }),
        // Expired, but the same person already has an open invitation for that role.
        invite({ id: "exp-3", email: "b@maple.test", expiresAt: "2026-10-11T15:00:00Z" }),
      ],
      NOW,
      TZ,
    );
    expect(rows.map((row) => ("invitationId" in row.action ? row.action.invitationId : row.name))).toEqual([
      "Dana Lee",
      "new-open",
      "old-open",
      "exp-2",
    ]);
  });

  it("has no sample people", () => {
    const html = JSON.stringify(staffRows([owner], [invite({})], NOW, TZ));
    expect(html).not.toMatch(/Northline|Amara|Daniel|Lena|Grace|Joon/);
  });
});

describe("invite staff dialog", () => {
  it("offers the four staff roles the database accepts, in the Designer's order", () => {
    expect(STAFF_INVITE_ROLES.map(([label]) => label)).toEqual(["Case manager", "Licensed consultant", "Assistant", "Finance"]);
    expect(STAFF_INVITE_ROLES.map(([, role]) => role)).toEqual(["case_manager", "licensed_consultant", "assistant", "finance_user"]);
  });

  it("reads what the dialog sends", () => {
    expect(readStaffInvite({ email: "  Sam@Maple.TEST ", role: "Finance" })).toEqual({ input: { email: "sam@maple.test", role: "finance_user" } });
    expect(readStaffInvite({ email: "", role: "Assistant" })).toEqual({ error: "Add their work email." });
    expect(readStaffInvite({ email: "not-an-email", role: "Assistant" })).toEqual({ error: "Enter a valid email address." });
    expect(readStaffInvite({ email: "sam@maple.test", role: "Practice manager" })).toEqual({ error: "Choose a staff role." });
    expect(readStaffInvite({ email: "sam@maple.test", role: "Firm owner" })).toEqual({ error: "Choose a staff role." });
  });

  it("uses the signed-in person's domain for the placeholder", () => {
    expect(emailPlaceholder("dana@maple.test")).toBe("name@maple.test");
    expect(emailPlaceholder(null)).toBe("name@example.com");
    expect(emailPlaceholder("broken")).toBe("name@example.com");
  });

  it("says when an invitation sent now expires, in the firm's timezone", () => {
    expect(inviteExpiry(NOW, TZ)).toBe("25 Oct");
    expect(inviteExpiry(new Date("2026-10-18T02:00:00Z"), TZ)).toBe("24 Oct");
  });

  it("sends a step-up refusal to /mfa and back to the open dialog", () => {
    expect(needsStepUp(staffInviteError("staff invitations require a recent TOTP step-up"))).toBe(true);
    expect(needsStepUp(staffInviteError("revoking an invitation requires a recent TOTP step-up"))).toBe(true);
    expect(needsStepUp(safeAccessError("aal2"))).toBe(true);
    expect(needsStepUp(staffInviteError("only a firm owner can invite staff"))).toBe(false);
    expect(staffStepUpLocation("/sheet/invitations", "?tab=staff", true)).toBe(
      `/mfa?step=6&next=${encodeURIComponent("/sheet/invitations?tab=staff&dlg=invite")}&for=staff_invite`,
    );
    expect(staffStepUpLocation("/sheet/invitations", "?dlg=invite", false)).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/invitations")}&for=staff_invite`);
  });

  it("says to wait when the invitation limit is reached", () => {
    const limited = "Too many invitations were sent recently. Please wait and try again later.";
    expect(staffInviteError("invitation limit reached: this address was sent 5 invitations in the last 24 hours; try again tomorrow")).toBe(limited);
    expect(safeAccessError("invitation limit reached: this firm sent 50 invitations in the last hour; try again later")).toBe(limited);
    expect(needsStepUp(staffInviteError("invitation limit reached: you sent 30 invitations in the last hour; try again later"))).toBe(false);
  });

  it("never passes a database message through", () => {
    expect(staffInviteError("only a firm owner can invite staff")).toBe("Only a firm owner can invite or remove staff.");
    expect(staffInviteError("email is invalid")).toBe("Enter a valid email address.");
    expect(staffInviteError("duplicate key value violates unique constraint")).toBe("That action could not be completed.");
  });

  it("builds the invitation link on the current origin", () => {
    expect(inviteLink("https://app.example.test/", "/invite/abc")).toBe("https://app.example.test/invite/abc");
  });
});
