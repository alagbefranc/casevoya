import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GoLiveSwitch } from "@/components/sheet/designer/go-live-switch";
import { GoLiveSteps, SAMPLE_COPY, SampleCasePanel, type GoLiveData, type SampleCaseData } from "@/components/sheet/designer/sample-case";
import { SetupBanner } from "@/components/sheet/designer/setup-banner";
import { defaultLanding } from "@/lib/auth/landing";
import {
  LICENCE_ADDED,
  LICENCE_BLOCKED,
  TRIAL_ENDED,
  blockerStep,
  goLiveRemaining,
  hasVerifiedLicence,
  inviteBlockers,
  progressLine,
  setupState,
  switchToLiveRefusal,
  type SetupCredential,
  type SetupRows,
} from "@/modules/sheet/setup-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("@/modules/sheet/sample-actions", () => ({ recordSampleStep: async () => ({ ok: true }), switchToLive: async () => ({ ok: true }) }));

const DECLARED: SetupCredential = {
  status: "declared",
  verificationMethod: null,
  registerStatus: null,
  entitlementToPractise: null,
  disciplineSuspended: false,
  disciplineRevoked: false,
  holderRole: "firm_owner",
  holderStatus: "active",
};

const VERIFIED: SetupCredential = {
  ...DECLARED,
  status: "verified",
  verificationMethod: "manual_public_register",
  registerStatus: "active",
  entitlementToPractise: true,
};

/** A firm that signed up in sample mode before 2026-10-19, like Curry immigration: no licence yet. */
const OLD_SAMPLE_FIRM: SetupRows = { verificationStatus: "unverified", credentials: [], subscriptionStatus: "trial" };

describe("go-live blockers (mirror of app.real_client_invite_blockers)", () => {
  it("asks only for the owner's licence: no practice steps and no wait for a register check", () => {
    expect(inviteBlockers(OLD_SAMPLE_FIRM)).toEqual(["owner_licence_missing"]);
    expect(inviteBlockers({ ...OLD_SAMPLE_FIRM, verificationStatus: "pending_review", credentials: [DECLARED] })).toEqual([]);
  });

  it("counts only an active firm owner's licence", () => {
    expect(inviteBlockers({ ...OLD_SAMPLE_FIRM, credentials: [{ ...DECLARED, holderRole: "licensed_consultant" }] })).toEqual(["owner_licence_missing"]);
    expect(inviteBlockers({ ...OLD_SAMPLE_FIRM, credentials: [{ ...DECLARED, holderStatus: "suspended" }] })).toEqual(["owner_licence_missing"]);
  });

  it("blocks a revoked, suspended, inactive or not-entitled owner licence, from its status or its flags", () => {
    for (const blocked of [
      { status: "revoked" },
      { status: "suspended" },
      { status: "inactive" },
      { status: "not_entitled" },
      { disciplineRevoked: true },
      { disciplineSuspended: true },
      { registerStatus: "inactive" },
      { entitlementToPractise: false },
    ]) {
      expect(inviteBlockers({ ...OLD_SAMPLE_FIRM, credentials: [{ ...DECLARED, ...blocked }] })).toEqual(["owner_licence_blocked"]);
    }
  });

  it("keeps a restricted firm and an ended trial blocked, in the database's order, and reports a missing firm", () => {
    expect(inviteBlockers({ verificationStatus: "restricted", credentials: [{ ...VERIFIED, status: "revoked" }], subscriptionStatus: "trial_ended" })).toEqual([
      "firm_restricted",
      "owner_licence_blocked",
      "trial_ended",
    ]);
    expect(inviteBlockers({ verificationStatus: "verified", credentials: [VERIFIED], subscriptionStatus: "trial_ended" })).toEqual(["trial_ended"]);
    expect(inviteBlockers({ ...OLD_SAMPLE_FIRM, verificationStatus: null })).toEqual(["firm_not_found"]);
  });

  it("counts a verified licence from a manual register check or a CICC list match (app.firm_has_verified_licence)", () => {
    expect(hasVerifiedLicence([VERIFIED])).toBe(true);
    expect(hasVerifiedLicence([{ ...VERIFIED, verificationMethod: "cicc_list" }])).toBe(true);
    expect(hasVerifiedLicence([{ ...VERIFIED, verificationMethod: "cicc_list", entitlementToPractise: null }])).toBe(true);
    expect(hasVerifiedLicence([{ ...VERIFIED, entitlementToPractise: null }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, verificationMethod: "self_declared" }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, status: "declared" }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, holderRole: "case_manager" }])).toBe(false);
  });
});

describe("blocker to setup step", () => {
  it("words each blocker; a restricted firm and a blocked licence are one step", () => {
    expect(blockerStep("owner_licence_missing")).toEqual({ key: "licence_added", label: LICENCE_ADDED, href: "/sheet/licence" });
    expect(blockerStep("owner_licence_blocked")).toEqual({ key: "licence_blocked", label: LICENCE_BLOCKED, href: "/sheet/licence" });
    expect(blockerStep("firm_restricted")).toEqual(blockerStep("owner_licence_blocked"));
    expect(blockerStep("trial_ended")).toEqual({ key: "trial", label: TRIAL_ENDED, href: "/sheet/settings?tab=billing" });
    expect(blockerStep("firm_not_found").label).toBe("Firm setup isn’t finished");
    expect(goLiveRemaining(["firm_restricted", "owner_licence_blocked", "trial_ended"]).map((step) => step.label)).toEqual([LICENCE_BLOCKED, TRIAL_ENDED]);
  });

  it("leaves only “Add your CICC licence” and, when relevant, the ended trial: no practice steps", () => {
    const fresh = setupState(OLD_SAMPLE_FIRM);
    expect(fresh.remaining.map((step) => step.label)).toEqual([LICENCE_ADDED]);
    expect(progressLine(fresh)).toBe("Still to do: add your CICC licence.");

    const ended = setupState({ ...OLD_SAMPLE_FIRM, subscriptionStatus: "trial_ended" });
    expect(ended.remaining.map((step) => step.label)).toEqual([LICENCE_ADDED, TRIAL_ENDED]);
    expect(progressLine(ended)).toBe("Still to do: add your CICC licence, choose a plan (your trial has ended).");

    const ready = setupState({ ...OLD_SAMPLE_FIRM, credentials: [DECLARED] });
    expect(ready).toMatchObject({ hasCredential: true, licenceOk: true, remaining: [] });
    expect(progressLine(ready)).toBe("Your CICC licence is on file: the firm owner can switch to live.");
    expect(progressLine(ready)).not.toMatch(/practice|verif|register check/i);
  });

  it("words set_sample_mode's refusals", () => {
    expect(switchToLiveRefusal("firm owner step-up is required")).toEqual({ error: "Confirm it’s you with your authenticator, then try again.", stepUp: true });
    expect(switchToLiveRefusal("sample mode stays on until real client invitations unlock")).toEqual({ error: "Finish the items still to do first.", stepUp: false });
    expect(switchToLiveRefusal("permission denied for table organizations").error).not.toContain("permission");
  });
});

describe("Finish setup banner", () => {
  const data = { firmName: "Curry immigration", progress: "Still to do: add your CICC licence.", collapsed: false };

  it("is the Designer's .alert warn with a Finish setup link to the sample-mode page", () => {
    const html = renderToStaticMarkup(createElement(SetupBanner, { data }));
    expect(html).toMatch(/^<div class="alert warn" role="status" data-setup-banner="1"><svg class="ic" aria-hidden="true"><use href="\/assets\/icons-coreui\/sprite.svg#i-info"><\/use><\/svg>/);
    expect(html).toContain("<b>Curry immigration is in sample mode</b>");
    expect(html).toContain("Practice data only: everyone here is fictional, and real clients can’t be invited until the firm owner switches to live.");
    expect(html).toContain("Still to do: add your CICC licence.");
    expect(html).not.toMatch(/practice step|of 8/i);
    expect(html).toContain('<div class="acts"><a class="btn p sm" href="/sheet/sample-mode">Finish setup</a>');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(">Hide details</button>");
    expect(html).not.toMatch(/dismiss|close/i);
  });

  it("collapsed for the session, it keeps its first line and Finish setup", () => {
    const html = renderToStaticMarkup(createElement(SetupBanner, { data: { ...data, collapsed: true } }));
    expect(html).toContain("<b>Curry immigration is in sample mode</b>");
    expect(html).toContain('<span id="setupMore" hidden="">');
    expect(html).toContain(">Finish setup</a>");
    expect(html).toContain(">Show details</button>");
  });
});

describe("go-live checklist and Switch to live", () => {
  const blocked: GoLiveData = {
    licence: { added: false, blocked: false, status: null },
    trialEnded: false,
    remaining: [LICENCE_ADDED],
    owner: true,
  };

  it("shows one licence tile linking to Licences, and the trial only when it has ended", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSteps, { data: blocked }));
    expect(html).toMatch(/^<div class="smp-g" data-golive="steps"><div class="smp-i k2-spot" data-spot="1">/);
    expect(html).toContain('<a href="/sheet/licence">Add your CICC licence</a>');
    expect(html).not.toMatch(/Licence verified|Practice step|Your trial has ended/);
    const done = renderToStaticMarkup(createElement(GoLiveSteps, { data: { ...blocked, licence: { added: true, blocked: false, status: "waiting for review" }, trialEnded: true } }));
    expect(done.match(/<span class="bd ok"><i><\/i>Done<\/span>/g)).toHaveLength(1);
    expect(done).toContain("On file. The number is checked against the CICC register list.");
    expect(done).toContain('<a href="/sheet/settings?tab=billing">Your trial has ended</a>');
    const paused = renderToStaticMarkup(createElement(GoLiveSteps, { data: { ...blocked, licence: { added: true, blocked: true, status: "needs attention" } } }));
    expect(paused).toContain('<a href="/sheet/licence">Your CICC licence needs attention</a>');
    expect(paused).toContain("licence-paused-72@1x.webp");
  });

  it("disables the owner's button and lists what is left while blockers remain", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSwitch, { data: blocked }));
    expect(html).toContain('<button type="button" class="btn p" aria-disabled="true" aria-describedby="whyLive">');
    expect(html).toContain("Still to do: Add your CICC licence.");
  });

  it("enables it once the owner's licence is declared", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSwitch, { data: { ...blocked, licence: { added: true, blocked: false, status: "waiting for review" }, remaining: [] } }));
    expect(html).toContain('<button type="button" class="btn p" aria-describedby="whyLive">');
    expect(html).not.toContain("aria-disabled");
  });

  it("shows other staff the status but no button", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSwitch, { data: { ...blocked, owner: false } }));
    expect(html).not.toContain("<button");
    expect(html).toContain("Only the firm owner can switch to live. Still to do: Add your CICC licence.");
  });
});

describe("the sample case as an optional tour", () => {
  const sample: SampleCaseData = {
    applicant: "Priya",
    steps: [{ key: "intake", image: "intake", title: "Send an intake form", note: "Priya fills in her history", href: "/sheet/matters", done: false }],
    licence: { holder: "Amara Osei", status: "waiting for review" },
  };

  it("says the steps are optional and that invitations open on switching to live, for a sample-mode firm", () => {
    const html = renderToStaticMarkup(createElement(SampleCasePanel, { data: sample }));
    expect(html).toContain(SAMPLE_COPY.lead);
    expect(html).toContain("1 practice step left, optional ");
    expect(html).toContain(SAMPLE_COPY.why);
    expect(html).not.toMatch(/licence check passes|Opens after verification/);
    expect(html).toContain('<button class="btn p" aria-disabled="true" aria-describedby="whyInv">');
  });

  it("tells a live firm its invitations are open, with the same classes", () => {
    const html = renderToStaticMarkup(createElement(SampleCasePanel, { data: { ...sample, firmLive: true } }));
    expect(html).toContain(SAMPLE_COPY.leadLive);
    expect(html).toContain(`<b>${SAMPLE_COPY.lockedLive}</b>`);
    expect(html).toContain('<a class="btn p" href="/sheet/invitations?tab=clients" aria-describedby="whyInv">');
    expect(html).not.toContain("Real client invitations are locked");
  });
});

describe("landing after sign-in", () => {
  it("sends staff of a sample-mode firm to Finish setup when there is no explicit next", () => {
    expect(defaultLanding("/sheet", true)).toBe("/sheet/sample-mode");
  });

  it("leaves live firms, clients and new accounts where they were", () => {
    expect(defaultLanding("/sheet", false)).toBe("/sheet");
    expect(defaultLanding("/portal", true)).toBe("/portal");
    expect(defaultLanding("/start-trial", false)).toBe("/start-trial");
    expect(defaultLanding("/sign-in", false)).toBe("/sign-in?next=/app");
  });
});
