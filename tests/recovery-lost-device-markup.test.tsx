import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecoveryMarkup } from "@/components/port/markup/recovery";
import { mfaResetSentCopy } from "@/modules/auth/mfa-reset-copy";

function lostDeviceStep() {
  const html = renderToStaticMarkup(createElement(RecoveryMarkup));
  const start = html.indexOf('<section data-step="4"');
  return html.slice(start, html.indexOf("</section>", start));
}

// Francis, Oct 30: the reset steps' empty rings looked like checkboxes that would not check.
describe("recovery: lost two-step device", () => {
  it("shows the reset steps as numbered progress, not empty rings that read as checkboxes", () => {
    const step = lostDeviceStep();
    expect(step).toContain('class="proof steps"');
    expect(step).not.toContain('<span class="st"></span>');
    expect(step).toContain('<span class="st num" aria-hidden="true">2</span>');
    expect(step).toContain('<span class="st num" aria-hidden="true">3</span>');
    expect(step).not.toMatch(/type="(checkbox|radio)"/);
  });

  it("goes straight to sending the request: no control has to be ticked first", () => {
    const step = lostDeviceStep();
    expect(step).toContain('data-go="5"');
    expect(step).toContain('data-novalidate=""');
    expect(step).not.toContain("required");
  });

  // Lost two-step device (20261102100100): the copy says what really happens.
  it("says who confirms the request, the 24-hour expiry and the re-enrolment, for both routes", () => {
    const step = lostDeviceStep();
    expect(step).toContain("If you’re the firm’s only owner, Casevoya support confirms it instead");
    expect(step).toContain("Your firm’s owners get an email and a notice in Casevoya");
    expect(step).toContain("within 24 hours");
    const html = renderToStaticMarkup(createElement(RecoveryMarkup));
    const sent = html.slice(html.indexOf('<section data-step="5"'));
    expect(sent).toContain('id="mr-lead"');
    expect(sent).toContain("We emailed your firm’s other owners");
    expect(sent).not.toContain("will get in touch");
    const firm = mfaResetSentCopy("firm", false);
    expect(firm.heading).toBe("Request sent");
    expect(firm.lead).toMatch(/emailed your firm’s other owners.*24 hours.*set up two-step again/);
    const platform = mfaResetSentCopy("platform", false);
    expect(platform.lead).toMatch(/only owner, so Casevoya support reviews this request/);
    expect(platform.lead).not.toContain("other owners");
    expect(mfaResetSentCopy("firm", true)).toMatchObject({ heading: "Your request is waiting" });
    expect(mfaResetSentCopy("firm", true).lead).toContain("already emailed");
  });
});
