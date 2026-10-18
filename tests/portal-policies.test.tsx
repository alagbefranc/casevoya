import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatterInviteDialog, type MatterInviteData } from "@/components/sheet/designer/matter";
import {
  PolicyMissingAlert,
  PortalPoliciesAfter,
  SettingsPortalHeader,
  SheetPortalPolicies,
} from "@/components/sheet/designer/portal-policies";
import { InvitationsMarkup } from "@/components/sheet/markup/invitations";
import {
  canPublishPolicies,
  currentPolicies,
  defaultPolicy,
  defaultPortalTerms,
  defaultPrivacyNotice,
  missingPolicies,
  nextVersionLabel,
  policyKindForDialog,
  policyPublishError,
  policyStepUpLocation,
  POLICY_BODY_MAX,
  readPolicyDraft,
} from "@/modules/portal-policies/defaults";
import { policyCards, policyDialog, publishedOn } from "@/modules/portal-policies/present";
import { needsStepUp } from "@/modules/sheet/matter-wire";

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  result: { data: "11111111-1111-4111-8111-111111111111" as unknown, error: null as null | { code?: string; message: string } },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.calls.push({ name, args });
      return rpc.result;
    },
  }),
}));

const { publishPortalPolicy } = await import("@/modules/portal-invitations/actions");

const FIRM = { firmName: "Maple Immigration", privacyContactName: "Dana Lee", privacyContactEmail: "privacy@maple.example" };
const NO_CONTACT = { firmName: "Maple Immigration", privacyContactName: null, privacyContactEmail: null };

/** Fills the blanks the firm must complete, the way a reviewer would. */
function filled(body: string): string {
  return body.replace(/\[Add [^\]]*\]/g, "Our providers store client data in Canada.");
}

describe("default portal policy drafts", () => {
  it("fill in the firm's name and privacy contact and stay under the database limit", () => {
    for (const build of [defaultPortalTerms, defaultPrivacyNotice]) {
      const { title, body } = build(FIRM);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThanOrEqual(POLICY_BODY_MAX);
      expect(body).toContain("Maple Immigration");
      expect(body).toContain("Dana Lee, privacy@maple.example");
      expect(body).not.toMatch(/Northline|Amara/);
    }
  });

  it("follow PIPEDA's principles in the privacy notice: accountability, purposes, consent, sharing, retention, safeguards, access and complaints", () => {
    const { body } = defaultPrivacyNotice(FIRM);
    for (const heading of [
      "Who is responsible",
      "What we collect",
      "Why we collect it",
      "Your choices and consent",
      "Who we share it with",
      "How long we keep it",
      "How we protect it",
      "Accuracy, access and correction",
      "Questions and complaints",
    ]) {
      expect(body).toContain(heading);
    }
    expect(body).toContain("withdraw your consent");
    expect(body).toContain("Office of the Privacy Commissioner of Canada");
    expect(body).toContain("We do not sell your personal information.");
  });

  it("say the portal status is not a live IRCC feed and point to the retainer agreement", () => {
    const { body } = defaultPortalTerms(FIRM);
    expect(body).toContain("not a live feed from Immigration, Refugees and Citizenship Canada");
    expect(body).toContain("retainer agreement");
  });

  it("leave a visible blank when the firm has no privacy contact, and refuse to publish until it is filled", () => {
    const terms = defaultPortalTerms(NO_CONTACT);
    expect(terms.body).toContain("[Add the name of your privacy officer]");
    expect(terms.body).toContain("[Add your privacy contact email]");
    expect(readPolicyDraft({ kind: "portal_terms", versionLabel: "1", ...terms })).toEqual({ error: expect.stringContaining("square brackets") });
    expect(readPolicyDraft({ kind: "portal_terms", versionLabel: "1", ...terms, body: filled(terms.body) })).toHaveProperty("input");
  });

  it("make the firm review where data is stored and how long it is kept before the privacy notice can be published", () => {
    const notice = defaultPolicy("privacy_notice", FIRM);
    expect("error" in readPolicyDraft({ kind: "privacy_notice", versionLabel: "1", ...notice })).toBe(true);
    const ok = readPolicyDraft({ kind: "privacy_notice", versionLabel: "1", ...notice, body: filled(notice.body) });
    expect("input" in ok && ok.input.body.length).toBeLessThanOrEqual(POLICY_BODY_MAX);
  });
});

describe("publish dialog checks", () => {
  it("accept the database's version label shape and length limits", () => {
    const base = { kind: "portal_terms", title: "Terms", body: "Text" };
    expect(readPolicyDraft({ ...base, versionLabel: "2026-10.v1_a" })).toEqual({ input: { kind: "portal_terms", versionLabel: "2026-10.v1_a", title: "Terms", body: "Text" } });
    expect(readPolicyDraft({ ...base, versionLabel: "" })).toHaveProperty("error");
    expect(readPolicyDraft({ ...base, versionLabel: "v 2" })).toHaveProperty("error");
    expect(readPolicyDraft({ ...base, versionLabel: "x".repeat(41) })).toHaveProperty("error");
    expect(readPolicyDraft({ ...base, versionLabel: "1", kind: "cookies" })).toHaveProperty("error");
    expect(readPolicyDraft({ ...base, versionLabel: "1", title: " " })).toHaveProperty("error");
    expect(readPolicyDraft({ ...base, versionLabel: "1", title: "t".repeat(201) })).toHaveProperty("error");
    expect(readPolicyDraft({ ...base, versionLabel: "1", body: "a".repeat(POLICY_BODY_MAX + 1) })).toEqual({ error: expect.stringContaining("8,000") });
    expect(readPolicyDraft({ ...base, versionLabel: "1", body: "a".repeat(POLICY_BODY_MAX) })).toHaveProperty("input");
  });

  it("suggest the next version label", () => {
    expect(nextVersionLabel(null)).toBe("1");
    expect(nextVersionLabel("1")).toBe("2");
    expect(nextVersionLabel("v1.9")).toBe("v1.10");
    expect(nextVersionLabel("2026-10")).toBe("2026-11");
    expect(nextVersionLabel("draft")).toBe("draft-2");
  });

  it("explain a reused version label and never pass a database message through", () => {
    expect(policyPublishError({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe("That version label is already published. Use a new one.");
    expect(policyPublishError({ message: "portal policy is incomplete" })).toContain("version label");
    expect(policyPublishError({ message: "portal policy publishing requires a recent step-up" })).toBeNull();
  });

  it("send a step-up back to Settings > Client portal with the same dialog open", () => {
    const location = policyStepUpLocation("/sheet/settings", "?tab=portal", "privacy_notice");
    expect(location.startsWith("/mfa?step=6&next=")).toBe(true);
    expect(decodeURIComponent(location.split("next=")[1])).toBe("/sheet/settings?tab=portal&dlg=privacy");
    expect(policyKindForDialog("terms")).toBe("portal_terms");
    expect(policyKindForDialog("privacy")).toBe("privacy_notice");
    expect(policyKindForDialog("invite")).toBeNull();
  });

  it("only offer publishing to the roles the database accepts", () => {
    expect(canPublishPolicies("firm_owner")).toBe(true);
    expect(canPublishPolicies("licensed_consultant")).toBe(true);
    expect(canPublishPolicies("case_manager")).toBe(false);
    expect(canPublishPolicies("assistant")).toBe(false);
  });
});

describe("current policies", () => {
  const rows = [
    { id: "a", kind: "portal_terms", version_label: "1", title: "Terms", body: "old", published_at: "2026-10-01T10:00:00Z" },
    { id: "b", kind: "portal_terms", version_label: "2", title: "Terms", body: "new", published_at: "2026-10-17T23:30:00Z" },
    { id: "c", kind: "other", version_label: "1", title: "x", body: "x", published_at: "2026-10-18T00:00:00Z" },
  ];

  it("pick the newest version of each kind, as the accept screen does, and list what is missing", () => {
    const current = currentPolicies(rows);
    expect(current.portal_terms?.versionLabel).toBe("2");
    expect(current.privacy_notice).toBeNull();
    expect(missingPolicies(current)).toEqual(["privacy_notice"]);
    expect(missingPolicies(currentPolicies([]))).toEqual(["portal_terms", "privacy_notice"]);
  });

  it("show the published date in the firm's timezone", () => {
    expect(publishedOn("2026-10-17T23:30:00Z", "America/Toronto")).toBe("17 Oct 2026");
    expect(publishedOn("2026-10-17T23:30:00Z", "Asia/Kolkata")).toBe("18 Oct 2026");
    expect(policyCards(currentPolicies(rows), "America/Toronto")).toEqual([
      { kind: "portal_terms", current: { versionLabel: "2", title: "Terms", publishedOn: "17 Oct 2026" } },
      { kind: "privacy_notice", current: null },
    ]);
  });

  it("start the dialog from the published text with the next label, or from the draft", () => {
    const current = currentPolicies(rows);
    expect(policyDialog("portal_terms", current.portal_terms, FIRM, ORG)).toEqual({
      kind: "portal_terms", organizationId: ORG, versionLabel: "3", title: "Terms", body: "new", draft: false,
    });
    const draft = policyDialog("privacy_notice", null, FIRM, ORG);
    expect(draft).toMatchObject({ versionLabel: "1", title: "Privacy notice", draft: true });
    expect(draft.body).toBe(defaultPrivacyNotice(FIRM).body);
  });
});

describe("publishPortalPolicy action", () => {
  beforeEach(() => {
    rpc.calls = [];
    rpc.result = { data: "11111111-1111-4111-8111-111111111111", error: null };
  });

  it("publishes through public.publish_portal_policy with the checked, trimmed values and no code", async () => {
    const result = await publishPortalPolicy({ organizationId: ORG, kind: "portal_terms", versionLabel: " 2 ", title: " Terms ", body: "Body\r\ntext ", code: null });
    expect(result).toEqual({ id: "11111111-1111-4111-8111-111111111111" });
    expect(rpc.calls).toEqual([
      { name: "publish_portal_policy", args: { p_kind: "portal_terms", p_version_label: "2", p_title: "Terms", p_body: "Body\ntext" } },
    ]);
  });

  it("refuses a draft with blanks before calling the database", async () => {
    const draft = defaultPrivacyNotice(NO_CONTACT);
    const result = await publishPortalPolicy({ organizationId: ORG, kind: "privacy_notice", versionLabel: "1", ...draft, code: null });
    expect(result).toHaveProperty("error");
    expect(rpc.calls).toHaveLength(0);
  });

  it("turns the database's step-up refusal into the step-up message the page acts on", async () => {
    rpc.result = { data: null, error: { code: "42501", message: "portal policy publishing requires a recent step-up" } };
    const result = await publishPortalPolicy({ organizationId: ORG, kind: "portal_terms", versionLabel: "1", title: "Terms", body: "Text", code: null });
    expect("error" in result && needsStepUp(result.error)).toBe(true);
  });

  it("says when the version label was already used", async () => {
    rpc.result = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    const result = await publishPortalPolicy({ organizationId: ORG, kind: "portal_terms", versionLabel: "1", title: "Terms", body: "Text", code: null });
    expect(result).toEqual({ error: "That version label is already published. Use a new one." });
  });

  it("refuses a firm that is not a firm id", async () => {
    expect(await publishPortalPolicy({ organizationId: "nope", kind: "portal_terms", versionLabel: "1", title: "T", body: "B", code: null })).toEqual({ error: "Choose a firm." });
    expect(rpc.calls).toHaveLength(0);
  });
});

describe("Settings > Client portal", () => {
  const cards = policyCards(currentPolicies([]), "America/Toronto");

  it("says invitations can't be accepted until both are published, and opens a publish dialog per document", () => {
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(SheetPortalPolicies, { data: { firmName: "Maple Immigration", cards, canPublish: true, contactMissing: false } }),
        createElement(PortalPoliciesAfter, { dialogs: [policyDialog("portal_terms", null, FIRM, ORG), policyDialog("privacy_notice", null, FIRM, ORG)] }),
      ),
    );
    expect(html).toContain("Clients can’t accept portal invitations yet");
    expect(html).toContain('data-dlg="dlgTerms"');
    expect(html).toContain('data-dlg="dlgPrivacy"');
    expect(html).toContain('<dialog class="dlg wide" id="dlgTerms"');
    expect(html).toContain('data-policy="portal_terms" data-org="' + ORG + '"');
    expect(html).toContain('data-policy="privacy_notice" data-org="' + ORG + '"');
    expect(html).toContain('<textarea class="ta" id="pTB"');
    expect(html).toContain("not legal advice");
    expect(html).toContain("Not published");
  });

  it("is read-only for staff who can't publish", () => {
    const html = renderToStaticMarkup(createElement(SheetPortalPolicies, { data: { firmName: "Maple Immigration", cards, canPublish: false, contactMissing: true } }));
    expect(html).not.toContain("data-dlg=");
    expect(html).toContain("Only a firm owner or licensed consultant can publish");
    expect(html).toContain("no privacy contact on file");
  });

  it("uses the Designer's Settings top bar and tabs with Client portal selected", () => {
    const html = renderToStaticMarkup(createElement(SettingsPortalHeader, { firmName: "Maple Immigration" }));
    expect(html).toContain('<button role="tab" data-t="general">Firm</button>');
    expect(html).toContain('<button role="tab" data-t="portal" class="on">Client portal</button>');
  });
});

describe("Invite to the portal while the firm's policies are unpublished", () => {
  const invite: MatterInviteData = {
    matter: { client: "Ana Pereira", reference: null },
    email: "",
    mail: { lead: "Maple invited you.", rest: "Open the link." },
    preview: "/accept/client",
    locked: false,
    wire: { organizationId: ORG, matterId: "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e" },
  };

  it("says so, links to Settings > Client portal, and does not send", () => {
    const html = renderToStaticMarkup(createElement(MatterInviteDialog, { data: { ...invite, policiesMissing: ["portal_terms", "privacy_notice"] } }));
    expect(html).toContain("Your firm hasn’t published the portal terms of use and privacy notice.");
    expect(html).toContain('href="/sheet/settings?tab=portal"');
    expect(html).toContain('<button class="btn p" disabled="">Send invitation</button>');
    expect(html).not.toContain("data-invite=");
  });

  it("is unchanged once both are published", () => {
    const captured = renderToStaticMarkup(createElement(MatterInviteDialog, { data: { ...invite, policiesMissing: [] } }));
    expect(captured).toContain('data-invite="1"');
    expect(captured).not.toContain("hasn’t published");
    // The Designer's own dialog is still byte-for-byte the capture without the field.
    expect(renderToStaticMarkup(createElement(InvitationsMarkup, { variant: "tab-clients" }))).toContain('id="dlgC"');
  });

  it("names only the missing document on Home", () => {
    const html = renderToStaticMarkup(createElement(PolicyMissingAlert, { kinds: ["privacy_notice"] }));
    expect(html).toContain("hasn’t published the privacy notice.");
  });
});
