import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterDialogs, MatterInviteDialog, MatterPeople, type MatterDialogsData, type MatterInviteData } from "@/components/sheet/designer/matter";
import { InvitationsMarkup } from "@/components/sheet/markup/invitations";
import { INVITE_WITHOUT_LINK, inviteEmailLines, renderEmail } from "@/modules/email/templates";
import { portalError } from "@/modules/portal-invitations/errors";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { safeAccessError } from "@/lib/auth/step-up";
import {
  acceptLink,
  acceptPath,
  expiryLabel,
  guardianSubjects,
  inviteStepUpLocation,
  PORTAL_ROLE_OPTIONS,
  portalRoleForParty,
  portalRoleFromLabel,
  portalRoleLabel,
  readPortalInvite,
  withoutInvite,
} from "@/modules/sheet/portal-invite";

const PERSON = "6f0c1d1e-8a3f-4b55-9d61-3b1d2c4e5f60";
const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MATTER = "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";

/** The Designer's own sample values. They live only in this test; the app never renders them. */
const DESIGNER_INVITE: MatterInviteData = {
  matter: { client: "Priya Sharma", reference: "NL-2026-0142" },
  email: "olena.k@example.com",
  mail: { lead: "Northline Immigration invited you to a secure portal.", rest: "Open the link to continue. It works once and expires in 7 days." },
  preview: "/sheet/accept-family",
  locked: false,
  toast: { title: "Invitation sent to Olena", sub: "She gives her own consent when she joins." },
};

const DIALOGS: MatterDialogsData = {
  current: 2,
  target: 3,
  version: 1,
  evidence: [],
  reason: "",
  owners: [{ name: "Dana Lee" }],
  reviewOn: "2026-10-30",
  receivedOn: "2026-10-18",
};

function region(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  expect(start, `missing ${open}`).toBeGreaterThanOrEqual(0);
  const end = html.indexOf(close, start);
  return html.slice(start, end + close.length);
}

describe("Invite to the portal dialog", () => {
  it("renders exactly as the captured Designer dialog when given the Designer's values", () => {
    const captured = region(renderToStaticMarkup(createElement(InvitationsMarkup, { variant: "tab-clients" })), '<dialog class="dlg" id="dlgC"', "</dialog>");
    const live = renderToStaticMarkup(createElement(MatterInviteDialog, { data: DESIGNER_INVITE }));
    expect(live).toBe(captured);
  });

  it("is not added to the matter dialogs unless the page passes it", () => {
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: DIALOGS }))).not.toContain("dlgC");
  });

  it("wires Send to this matter, previews the real email, and says when real invitations are locked", () => {
    const html = renderToStaticMarkup(
      createElement(MatterDialogs, {
        data: {
          ...DIALOGS,
          invite: {
            matter: { client: "Ana Pereira", reference: null },
            email: "",
            mail: inviteEmailLines("Maple Immigration", "portal"),
            preview: acceptPath("client"),
            locked: true,
            wire: { organizationId: ORG, matterId: MATTER },
          },
        },
      }),
    );
    expect(html).toContain(`data-invite="1" data-org="${ORG}" data-matter="${MATTER}"`);
    expect(html).not.toContain("data-toast");
    expect(html).toContain("<option>Ana Pereira</option>");
    expect(html).toContain("Your file with Maple Immigration is ready.");
    expect(html).toContain("Maple Immigration invited you to your client portal. Open your portal to see your first step. Your private link works once and expires in 7 days.");
    expect(html).not.toContain("The private link is not in this email.");
    expect(html).toContain("Real client invitations are locked");
    expect(html).not.toMatch(/Northline|Priya|Olena|olena\.k/);
  });

  it("adds a hidden Date of birth field in the Designer's field markup only when someone lacks one", () => {
    const html = renderToStaticMarkup(createElement(MatterInviteDialog, { data: { ...DESIGNER_INVITE, birthDate: { max: "2026-10-18" } } }));
    expect(html).toContain(
      '<div class="fld" id="cDF" hidden=""><label for="cD">Date of birth</label><input class="inp" id="cD" type="date" min="1900-01-01" max="2026-10-18" aria-describedby="cD-h"/>',
    );
    // Right after the Email field, and nothing else changes.
    expect(html.replace(/<div class="fld" id="cDF"[\s\S]*?<\/span><\/div>/, "")).toBe(
      renderToStaticMarkup(createElement(MatterInviteDialog, { data: DESIGNER_INVITE })),
    );
    expect(renderToStaticMarkup(createElement(MatterInviteDialog, { data: { ...DESIGNER_INVITE, birthDate: null } }))).not.toContain("cDF");
  });

  it("shows the lock only for a real matter in sample mode", () => {
    const html = renderToStaticMarkup(createElement(MatterInviteDialog, { data: { ...DESIGNER_INVITE, locked: false } }));
    expect(html).not.toContain("locked");
  });
});

describe("People tab cards", () => {
  const card = { person: { name: "Ana Pereira" }, role: "Principal applicant", parts: ["ana@example.test"], pill: { label: "No portal access" } };

  it("keeps the Designer's inert Manage button when the person cannot be invited", () => {
    const html = renderToStaticMarkup(createElement(MatterPeople, { cards: [card], relationships: [] }));
    expect(html).toContain('<button class="btn s sm" aria-label="Manage Ana Pereira"><svg');
    expect(html).not.toContain("data-invite-open");
  });

  it("opens the invitation from Manage for a client without portal access", () => {
    const html = renderToStaticMarkup(
      createElement(MatterPeople, { cards: [{ ...card, invite: { personId: PERSON, role: "Applicant", email: "ana@example.test" } }], relationships: [] }),
    );
    expect(html).toContain(
      `aria-label="Manage Ana Pereira" data-invite-open="1" data-person="${PERSON}" data-role="Applicant" data-email="ana@example.test" data-name="Ana Pereira"><svg`,
    );
  });

  it("marks a person without a date of birth so the dialog asks for it", () => {
    const html = renderToStaticMarkup(
      createElement(MatterPeople, {
        cards: [{ ...card, invite: { personId: PERSON, role: "Applicant", email: "ana@example.test", birthDateMissing: true } }],
        relationships: [],
      }),
    );
    expect(html).toContain(`data-name="Ana Pereira" data-dob="missing"`);
  });
});

describe("portal invite helpers", () => {
  it("invites each matter participant in the portal role the database expects", () => {
    expect(portalRoleForParty("applicant")).toBe("client");
    expect(portalRoleForParty("dependant")).toBe("adult_dependant");
    expect(portalRoleForParty("sponsor")).toBe("sponsor");
    expect(portalRoleForParty("employer")).toBe("employer_contact");
    expect(portalRoleForParty("guardian")).toBe("guardian");
    expect(portalRoleForParty("consultant")).toBeNull();
    for (const [role, label] of PORTAL_ROLE_OPTIONS) {
      expect(portalRoleLabel(role)).toBe(label);
      expect(portalRoleFromLabel(label)).toBe(role);
    }
    expect(portalRoleFromLabel("Payer")).toBeNull();
  });

  it("sends each role to its accept screen with the token, and only there", () => {
    expect(acceptPath("client")).toBe("/accept/client");
    expect(acceptPath("sponsor")).toBe("/accept/sponsor");
    expect(acceptPath("adult_dependant")).toBe("/accept/family");
    expect(acceptPath("guardian")).toBe("/accept/family");
    const token = "a".repeat(64);
    expect(acceptLink("https://app.example.test/", "sponsor", token)).toBe(`https://app.example.test/accept/sponsor?token=${token}`);
    expect(acceptLink("", "client", token)).toBe(`/accept/client?token=${token}`);
  });

  it("reads what the dialog sends, or the first thing to fix", () => {
    expect(readPortalInvite({ personId: PERSON, roleLabel: "Sponsor", email: " Rafael@Example.Test " })).toEqual({
      input: { personId: PERSON, role: "sponsor", email: "rafael@example.test", dateOfBirth: null },
    });
    expect(readPortalInvite({ personId: "", roleLabel: "Sponsor", email: "a@b.co" })).toEqual({ error: "Open the invitation from a person on this matter." });
    expect(readPortalInvite({ personId: PERSON, roleLabel: "Payer", email: "a@b.co" })).toEqual({ error: "Choose their role." });
    expect(readPortalInvite({ personId: PERSON, roleLabel: "Applicant", email: "" })).toEqual({ error: "Add their email address." });
    expect(readPortalInvite({ personId: PERSON, roleLabel: "Applicant", email: "not an email" })).toEqual({ error: "Enter a valid email address." });
  });

  it("requires a valid date of birth only when the dialog asked for one", () => {
    const fields = { personId: PERSON, roleLabel: "Applicant", email: "ana@example.test", today: "2026-10-18" };
    expect(readPortalInvite({ ...fields, dateOfBirth: "1990-04-04" })).toEqual({
      input: { personId: PERSON, role: "client", email: "ana@example.test", dateOfBirth: "1990-04-04" },
    });
    expect(readPortalInvite({ ...fields, dateOfBirth: "" })).toEqual({ error: "Add their date of birth. Only adults get a portal login." });
    expect(readPortalInvite({ ...fields, dateOfBirth: "2026-10-19" })).toEqual({ error: "The date of birth can’t be in the future." });
    expect(readPortalInvite({ ...fields, dateOfBirth: "1899-12-31" })).toEqual({ error: "Check the date of birth. It is before 1900." });
    expect(readPortalInvite({ ...fields, dateOfBirth: "04/04/1990" })).toEqual({ error: "Enter the date of birth as a full date." });
    expect(readPortalInvite({ ...fields, dateOfBirth: "2001-02-29" })).toEqual({ error: "Enter the date of birth as a full date." });
    expect(readPortalInvite({ ...fields, dateOfBirth: "2026-10-18" })).toMatchObject({ input: { dateOfBirth: "2026-10-18" } });
  });

  it("invites a guardian for the matter's minors, never for themselves", () => {
    expect(guardianSubjects(PERSON, ["m1", "m2", "m1", PERSON])).toEqual(["m1", "m2"]);
    expect(guardianSubjects(PERSON, Array.from({ length: 12 }, (_, i) => `m${i}`))).toHaveLength(10);
  });

  it("returns from step-up to the same person's invitation, and drops the flags after", () => {
    const location = inviteStepUpLocation("/sheet/matters/abc", "?tab=people", PERSON);
    expect(location).toBe(`/mfa?step=6&next=${encodeURIComponent(`/sheet/matters/abc?tab=people&dlg=invite&pid=${PERSON}`)}&for=portal_invite`);
    expect(withoutInvite("/sheet/matters/abc", `?tab=people&dlg=invite&pid=${PERSON}`)).toBe("/sheet/matters/abc?tab=people");
    expect(needsStepUp(safeAccessError("portal invitations require a recent step-up"))).toBe(true);
  });

  it("labels the expiry as a calendar date", () => {
    expect(expiryLabel("2026-10-25T03:00:00.000Z", "America/Toronto")).toBe("24 Oct");
    expect(expiryLabel(null, "America/Toronto")).toBeNull();
    expect(expiryLabel("nope", "America/Toronto")).toBeNull();
  });
});

describe("invitation copy", () => {
  it("previews the email the outbox sends: their private link, or the linkless fallback", () => {
    const lines = inviteEmailLines("Maple Immigration", "portal");
    const link = `https://app.casevoya.ca/accept/client?token=${"a".repeat(64)}`;
    const withLink = renderEmail({ template: "invite", kind: "portal", firm: "Maple Immigration", link }).text;
    // The staff screen shows the heading as its bold lead and the email paragraph word for word.
    expect(withLink).toContain(lines.lead.replace(/\.$/, ""));
    expect(withLink).toContain(lines.rest);
    expect(withLink).toContain(`Open your portal: ${link}`);
    expect(lines.rest).toContain("Your private link works once and expires in 7 days.");
    const linkless = renderEmail({ template: "invite", kind: "portal", firm: "Maple Immigration" }).text;
    expect(linkless).toContain(`Maple Immigration invited you to your client portal. ${INVITE_WITHOUT_LINK}`);
    expect(linkless).not.toContain("https://");
    expect(renderEmail({ template: "invite", kind: "staff", firm: "Maple" }).text).toContain("You’re invited to join Maple");
  });

  it("explains every refusal create_portal_invitation returns", () => {
    for (const code of ["invalid_email", "invalid_role", "email_does_not_match_person", "not_a_participant", "sample_mismatch", "real_client_invitations_locked", "date_of_birth_required", "minor_cannot_hold_login", "guardian_subject_required", "guardian_subject_not_minor", "rate_limited"]) {
      expect(portalError(code), code).not.toBe("That action could not be completed.");
    }
    expect(portalError("real_client_invitations_locked")).toMatch(/locked/);
  });
});
