import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mfaActiveStep } from "@/app/mfa/page";
import { AcceptClientMarkup } from "@/components/port/markup/accept-client";
import { AcceptFamilyMarkup } from "@/components/port/markup/accept-family";
import { AcceptSponsorMarkup } from "@/components/port/markup/accept-sponsor";
import { AcceptStaffMarkup } from "@/components/port/markup/accept-staff";
import { RecoveryMarkup } from "@/components/port/markup/recovery";
import { SetupMarkup } from "@/components/port/markup/setup";
import { SignInMarkup } from "@/components/port/markup/sign-in";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { TwoStepMarkup, type TotpEnrollment } from "@/components/port/markup/two-step";
import { PortScreen } from "@/components/port/screen";

const enrollment: TotpEnrollment = {
  factorId: "11111111-1111-4111-8111-111111111111",
  secret: "REALSECRETKEY12",
  qr: "data:image/svg+xml;utf-8,%3Csvg%3E%3C/svg%3E",
};

function mfaHtml(activeStep: number, enrolled: TotpEnrollment | null) {
  return renderToStaticMarkup(
    <PortScreen page="mfa" variant="au" initialStep={activeStep}>
      <TwoStepMarkup email="casey@example.test" activeStep={activeStep} enrollment={enrolled} />
    </PortScreen>,
  );
}

/** The open panel is the one CSS shows: `[data-step].on { display: block }`. */
function openPanel(html: string, step: number) {
  const match = html.match(
    new RegExp(`<section\\b(?=[^>]*\\bdata-step="${step}")(?=[^>]*\\bclass="on")[^>]*>[\\s\\S]*?</section>`),
  );
  return match?.[0] ?? "";
}

describe("/mfa step", () => {
  it("shows the code entry when a factor is already verified", () => {
    expect(mfaActiveStep(true, null)).toBe(0);
    expect(mfaActiveStep(true, 2)).toBe(0);
    const html = mfaHtml(0, null);
    const panel = openPanel(html, 0);
    expect(panel).toMatch(/<input/);
    expect(panel).toContain("Enter your code");
    expect(html).not.toContain("JBSW");
  });

  it("shows setup with the enrolled secret when there is no factor", () => {
    expect(mfaActiveStep(false, null)).toBe(2);
    const html = mfaHtml(2, enrollment);
    const panel = openPanel(html, 2);
    expect(panel).toMatch(/<input/);
    expect(panel).toContain("REAL SECR ETKE Y12");
    expect(panel).toContain(enrollment.qr);
    expect(panel).toContain(`data-factor="${enrollment.factorId}"`);
    expect(html).not.toContain("JBSW");
    expect(html).not.toContain("4F7K-29QX");
  });
});

describe("auth screens keep a step visible", () => {
  it("marks step 0 on sign-in, setup, recovery, trial and accept pages", () => {
    const screens = [
      SignInMarkup,
      SetupMarkup,
      RecoveryMarkup,
      StartTrialMarkup,
      AcceptClientMarkup,
      AcceptFamilyMarkup,
      AcceptSponsorMarkup,
      AcceptStaffMarkup,
    ];
    for (const Screen of screens) {
      const html = renderToStaticMarkup(createElement(Screen));
      expect(html).toMatch(/<section\b(?=[^>]*\bdata-step="0")(?=[^>]*\bclass="on")/);
    }
  });
});
