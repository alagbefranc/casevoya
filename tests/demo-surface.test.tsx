import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { metadata as clientMeta } from "@/app/accept/client/page";
import { metadata as familyMeta } from "@/app/accept/family/page";
import { metadata as sponsorMeta } from "@/app/accept/sponsor/page";
import { metadata as staffMeta } from "@/app/accept/staff/page";
import HelpPage from "@/app/help/client-home-screen/page";
import { metadata as helpMeta } from "@/app/help/client-home-screen/page";
import { metadata as inviteMeta } from "@/app/invite/[token]/page";
import { metadata as mfaMeta } from "@/app/mfa/page";
import HomePage from "@/app/page";
import { metadata as portalMeta } from "@/app/portal/[[...slug]]/page";
import { metadata as recoveryMeta } from "@/app/recovery/page";
import RecoveryPage from "@/app/recovery/page";
import { metadata as setupMeta } from "@/app/setup/page";
import { metadata as sheetMeta } from "@/app/sheet/[[...slug]]/page";
import { metadata as signInMeta } from "@/app/sign-in/page";
import SignInPage from "@/app/sign-in/page";
import { metadata as trialMeta } from "@/app/start-trial/page";
import StartTrialPage from "@/app/start-trial/page";
import { AcceptClientMarkup } from "@/components/port/markup/accept-client";
import { AcceptFamilyMarkup } from "@/components/port/markup/accept-family";
import { AcceptSponsorMarkup } from "@/components/port/markup/accept-sponsor";
import { AcceptStaffMarkup } from "@/components/port/markup/accept-staff";
import { RecoveryMarkup } from "@/components/port/markup/recovery";
import { SetupMarkup } from "@/components/port/markup/setup";
import { SignInMarkup } from "@/components/port/markup/sign-in";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { TwoStepMarkup } from "@/components/port/markup/two-step";
import { PORTAL_SLUGS } from "@/components/portal/demo";
import { EmptyPortal, LivePortal } from "@/components/portal/live";
import { isGatedPath, signInLocation } from "@/lib/auth/redirect";
import type { PortalViewer } from "@/modules/portal/load";

const FORBIDDEN = /northline|amara|olena|rafael|r712345|prototype/i;

const TITLES = [
  signInMeta.title,
  mfaMeta.title,
  recoveryMeta.title,
  setupMeta.title,
  trialMeta.title,
  clientMeta.title,
  familyMeta.title,
  sponsorMeta.title,
  staffMeta.title,
  inviteMeta.title,
  portalMeta.title,
  sheetMeta.title,
  helpMeta.title,
];

function assertClean(node: ReactNode, label: string) {
  const html = renderToStaticMarkup(createElement("div", null, node));
  const found = html.match(FORBIDDEN);
  if (found) throw new Error(`${label} rendered “${found[0]}”`);
  expect(html.length).toBeGreaterThan(20);
}

const person = {
  id: "p1",
  displayName: "Casey Nguyen",
  email: "casey@example.test",
  phone: null,
  isMinor: false,
  role: "client",
};

const viewer: PortalViewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Example Firm",
  timezone: "America/Toronto",
  role: "client",
  person,
  matters: [{ id: "m1", title: "Work permit", stage: "Open", onHold: false }],
  people: [person, { ...person, id: "p2", displayName: "Jordan Lee", role: "sponsor" }],
  grants: [{ id: "g1", kind: "guardian", purpose: "File a form", subjectName: "Jordan Lee", granteeName: "Casey Nguyen" }],
  shares: [{ id: "s1", sectionKey: "passport_bio", subjectName: "Casey Nguyen", granteeName: "Jordan Lee", matterTitle: "Work permit" }],
  prefs: { emailNotices: true, smsNotices: false, deadlineReminders: true, locale: "en-CA" },
  sections: [{ id: "sec1", sectionKey: "identity", summary: "Recorded", personName: "Casey Nguyen", matterTitle: "Work permit" }],
};

const emptyViewer: PortalViewer = {
  ...viewer,
  person: null,
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

const LIVE_PAGES = ["home", ...PORTAL_SLUGS.filter((slug) => slug !== "olena" && slug !== "rafael")];

describe("public and live surfaces", () => {
  it("keeps demo names out of titles", () => {
    for (const title of TITLES) {
      expect(typeof title).toBe("string");
      expect(String(title)).not.toMatch(FORBIDDEN);
    }
  });

  it("renders public pages without demo copy", () => {
    assertClean(createElement(HomePage), "home");
    assertClean(createElement(HelpPage), "help");
  });

  it("renders auth pages with empty inputs and no demo copy", () => {
    assertClean(createElement(SignInPage), "sign-in page");
    assertClean(createElement(SignInMarkup), "sign-in");
    assertClean(createElement(TwoStepMarkup), "mfa");
    assertClean(createElement(RecoveryPage), "recovery page");
    assertClean(createElement(RecoveryMarkup), "recovery");
    assertClean(createElement(StartTrialPage), "start-trial page");
    assertClean(createElement(StartTrialMarkup), "start-trial");
    assertClean(createElement(SetupMarkup), "setup");
    assertClean(createElement(AcceptClientMarkup), "accept client");
    assertClean(createElement(AcceptFamilyMarkup), "accept family");
    assertClean(createElement(AcceptSponsorMarkup), "accept sponsor");
    assertClean(createElement(AcceptStaffMarkup), "accept staff");
  });

  it("renders live portal paths from the signed-in firm only", () => {
    assertClean(createElement(EmptyPortal), "empty portal");
    for (const page of LIVE_PAGES) {
      assertClean(createElement(LivePortal, { page, viewer }), `live ${page}`);
      assertClean(createElement(LivePortal, { page, viewer: emptyViewer }), `empty ${page}`);
    }
  });

  it("sends signed-out portal, sheet and app visitors to sign-in with next", () => {
    expect(signInLocation("/portal/pay", "?state=paid")).toBe("/sign-in?next=%2Fportal%2Fpay%3Fstate%3Dpaid");
    expect(signInLocation("/sheet/matter", "?id=1")).toBe("/sign-in?next=%2Fsheet%2Fmatter%3Fid%3D1");
    expect(isGatedPath("/app")).toBe(true);
    expect(isGatedPath("/app/invitations")).toBe(true);
    expect(isGatedPath("/portal")).toBe(true);
    expect(isGatedPath("/portal/documents")).toBe(true);
    expect(isGatedPath("/sheet")).toBe(true);
    expect(isGatedPath("/sheet/matter")).toBe(true);
    expect(isGatedPath("/sign-in")).toBe(false);
    expect(isGatedPath("/accept/client")).toBe(false);
  });
});
