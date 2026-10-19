import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GoLiveSwitch } from "@/components/sheet/designer/go-live-switch";
import { GoLiveSteps, type GoLiveData } from "@/components/sheet/designer/sample-case";
import { SetupBanner } from "@/components/sheet/designer/setup-banner";
import { defaultLanding } from "@/lib/auth/landing";
import {
  LICENCE_VERIFIED,
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

const ALL_PRACTICE = ["intake", "agreement", "upload", "reminder", "invoice", "export"];

const VERIFIED: SetupCredential = {
  status: "verified",
  verificationMethod: "manual_public_register",
  registerStatus: "active",
  entitlementToPractise: true,
  disciplineSuspended: false,
  disciplineRevoked: false,
  holderRole: "firm_owner",
  holderStatus: "active",
};

/** A firm just signed up in sample mode, like Curry immigration: no licence, no proofs. */
const NEW_FIRM: SetupRows = { verificationStatus: "unverified", credentials: [], subscriptionStatus: "trial", proofs: [] };

describe("go-live blockers (mirror of app.real_client_invite_blockers)", () => {
  it("lists every blocker for a new sample-mode firm, in the database's order", () => {
    expect(inviteBlockers(NEW_FIRM)).toEqual([
      "firm_unverified",
      "licence_not_verified",
      ...ALL_PRACTICE.map((step) => `sample_step_missing:${step}`),
    ]);
  });

  it("is empty once the firm is verified, its licence checked and all six steps done", () => {
    expect(inviteBlockers({ verificationStatus: "verified", credentials: [VERIFIED], subscriptionStatus: "trial", proofs: ALL_PRACTICE })).toEqual([]);
  });

  it("adds trial_ended and reports a missing firm the way the database does", () => {
    expect(inviteBlockers({ verificationStatus: "verified", credentials: [VERIFIED], subscriptionStatus: "trial_ended", proofs: ALL_PRACTICE })).toEqual(["trial_ended"]);
    expect(inviteBlockers({ ...NEW_FIRM, verificationStatus: null })).toEqual(["firm_not_found"]);
  });

  it("counts a licence only when it was checked by hand on the public register and is in good standing", () => {
    expect(hasVerifiedLicence([VERIFIED])).toBe(true);
    expect(hasVerifiedLicence([{ ...VERIFIED, holderRole: "licensed_consultant" }])).toBe(true);
    expect(hasVerifiedLicence([{ ...VERIFIED, status: "declared" }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, verificationMethod: "self_declared" }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, registerStatus: "inactive" }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, entitlementToPractise: null }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, disciplineSuspended: true }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, disciplineRevoked: true }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, holderRole: "case_manager" }])).toBe(false);
    expect(hasVerifiedLicence([{ ...VERIFIED, holderStatus: "suspended" }])).toBe(false);
  });
});

describe("blocker to setup step", () => {
  it("merges firm_unverified and licence_not_verified into one licence step", () => {
    expect(blockerStep("firm_unverified")).toEqual(blockerStep("licence_not_verified"));
    expect(blockerStep("firm_unverified")).toEqual({ key: "licence_verified", label: LICENCE_VERIFIED, href: "/sheet/licence" });
    expect(goLiveRemaining(["firm_unverified", "licence_not_verified"], true).map((step) => step.key)).toEqual(["licence_verified"]);
  });

  it("says trial ended and each practice step in plain words", () => {
    expect(blockerStep("trial_ended")).toEqual({ key: "trial", label: "Your trial has ended: choose a plan", href: "/sheet/settings?tab=billing" });
    expect(ALL_PRACTICE.map((step) => blockerStep(`sample_step_missing:${step}`).label)).toEqual([
      "Practice step: send an intake form",
      "Practice step: send a service agreement",
      "Practice step: request and review an upload",
      "Practice step: schedule a reminder",
      "Practice step: issue an invoice",
      "Practice step: export the file",
    ]);
    expect(blockerStep("firm_not_found").label).toBe("Firm setup isn’t finished");
  });

  it("puts Add your CICC licence first when no licence is on file", () => {
    const steps = goLiveRemaining(inviteBlockers(NEW_FIRM), false);
    expect(steps.slice(0, 2).map((step) => step.label)).toEqual(["Add your CICC licence", LICENCE_VERIFIED]);
    expect(steps).toHaveLength(8);
  });

  it("counts eight steps and words the progress line", () => {
    const fresh = setupState(NEW_FIRM);
    expect([fresh.done, fresh.total]).toEqual([0, 8]);
    expect(progressLine(fresh)).toBe("0 of 8 done. Still to do: add your CICC licence, verify it against the CICC register, 6 practice steps.");

    const partway = setupState({ ...NEW_FIRM, credentials: [{ ...VERIFIED, status: "declared" }], proofs: ["intake", "agreement"] });
    expect(partway.done).toBe(3);
    expect(progressLine(partway)).toBe("3 of 8 done. Still to do: get it verified against the CICC register, 4 practice steps.");

    const ended = setupState({ verificationStatus: "verified", credentials: [VERIFIED], subscriptionStatus: "trial_ended", proofs: ALL_PRACTICE });
    expect(ended.done).toBe(8);
    expect(progressLine(ended)).toBe("8 of 8 done. Still to do: choose a plan (your trial has ended).");

    const ready = setupState({ verificationStatus: "verified", credentials: [VERIFIED], subscriptionStatus: "trial", proofs: ALL_PRACTICE });
    expect(ready.remaining).toEqual([]);
    expect(progressLine(ready)).toBe("8 of 8 done. Everything is ready: the firm owner can switch to live.");
  });

  it("words set_sample_mode's refusals", () => {
    expect(switchToLiveRefusal("firm owner step-up is required")).toEqual({ error: "Confirm it’s you with your authenticator, then try again.", stepUp: true });
    expect(switchToLiveRefusal("sample mode stays on until real client invitations unlock").stepUp).toBe(false);
    expect(switchToLiveRefusal("sample mode stays on until real client invitations unlock").error).toBe("Finish the remaining setup steps first.");
    expect(switchToLiveRefusal("permission denied for table organizations").error).not.toContain("permission");
  });
});

describe("Finish setup banner", () => {
  const data = { firmName: "Curry immigration", progress: "0 of 8 done. Still to do: add your CICC licence, verify it against the CICC register, 6 practice steps.", collapsed: false };

  it("is the Designer's .alert warn with a Finish setup link to the sample-mode page", () => {
    const html = renderToStaticMarkup(createElement(SetupBanner, { data }));
    expect(html).toMatch(/^<div class="alert warn" role="status" data-setup-banner="1"><svg class="ic" aria-hidden="true"><use href="\/assets\/icons-coreui\/sprite.svg#i-info"><\/use><\/svg>/);
    expect(html).toContain("<b>Curry immigration is in sample mode</b>");
    expect(html).toContain("Practice data only: everyone here is fictional, and real clients can’t be invited until setup is finished.");
    expect(html).toContain("0 of 8 done. Still to do: add your CICC licence");
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
    licence: { added: false, verified: false, status: null },
    trialEnded: false,
    remaining: ["Add your CICC licence", LICENCE_VERIFIED, "Practice step: send an intake form"],
    owner: true,
  };

  it("shows the licence steps as Designer step tiles linking to Licences", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSteps, { data: blocked }));
    expect(html).toMatch(/^<div class="smp-g" data-golive="steps"><div class="smp-i k2-spot" data-spot="1">/);
    expect(html).toContain('<a href="/sheet/licence">Add your CICC licence</a>');
    expect(html).toContain('<a href="/sheet/licence">Licence verified against the CICC register</a>');
    expect(html).not.toContain("Your trial has ended");
    const done = renderToStaticMarkup(createElement(GoLiveSteps, { data: { ...blocked, licence: { added: true, verified: true, status: "passed" }, trialEnded: true } }));
    expect(done.match(/<span class="bd ok"><i><\/i>Done<\/span>/g)).toHaveLength(2);
    expect(done).toContain('<a href="/sheet/settings?tab=billing">Your trial has ended</a>');
  });

  it("disables the owner's button and lists what is left while blockers remain", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSwitch, { data: blocked }));
    expect(html).toContain('<button type="button" class="btn p" aria-disabled="true" aria-describedby="whyLive">');
    expect(html).toContain("Switch to live</button>");
    expect(html).toContain("Still to do: Add your CICC licence; Licence verified against the CICC register; Practice step: send an intake form.");
  });

  it("enables it when nothing blocks", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSwitch, { data: { ...blocked, remaining: [] } }));
    expect(html).toContain('<button type="button" class="btn p" aria-describedby="whyLive">');
    expect(html).not.toContain("aria-disabled");
  });

  it("shows other staff the status but no button", () => {
    const html = renderToStaticMarkup(createElement(GoLiveSwitch, { data: { ...blocked, owner: false } }));
    expect(html).not.toContain("<button");
    expect(html).toContain("Only the firm owner can switch to live. Still to do: Add your CICC licence;");
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
