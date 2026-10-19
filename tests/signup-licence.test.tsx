import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SETUP_COPY, SetupMarkup } from "@/components/port/markup/setup";
import { START_TRIAL_COPY, START_TRIAL_LICENCE_FIELDS, StartTrialMarkup } from "@/components/port/markup/start-trial";
import { CHECK_NOTE, UNTIL_CHECKED, licenceIntro } from "@/modules/sheet/licence-present";

// Decision 2026-10-19: only licensed CICC consultants sign up. The start-trial screen asks for the
// licence with the setup screen's own "Licence number" and "Licence class" fields.

/** The whole `.fld` element that holds the control with this id. */
function field(html: string, id: string): string {
  const at = html.indexOf(`id="${id}"`);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<div class="fld"', at);
  let depth = 0;
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = start;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  throw new Error(`unclosed field ${id}`);
}

describe("the licence at sign-up", () => {
  const trial = renderToStaticMarkup(createElement(StartTrialMarkup));
  const setup = renderToStaticMarkup(createElement(SetupMarkup));

  it("uses the setup screen's licence number and class fields exactly, right after the firm name", () => {
    for (const id of START_TRIAL_LICENCE_FIELDS) expect(field(trial, id)).toBe(field(setup, id));
    expect(field(trial, "lno")).toContain('data-req="Enter your licence number"');
    expect(field(trial, "cl")).toContain('<option>RCIC</option><option selected="">RCIC-IRB</option>');
    expect(trial.indexOf('id="firm"')).toBeLessThan(trial.indexOf('id="lno"'));
    expect(trial.indexOf('id="lno"')).toBeLessThan(trial.indexOf('id="cl"'));
    expect(trial.indexOf('id="cl"')).toBeLessThan(trial.indexOf('id="tos"'));
  });

  it("asks for it on the resume screen too (signed in, no firm yet)", () => {
    const resume = renderToStaticMarkup(<StartTrialMarkup resume={{ email: "owner@example.test" }} />);
    for (const id of START_TRIAL_LICENCE_FIELDS) expect(field(resume, id)).toBe(field(setup, id));
  });

  it("shows the licence declared at sign-up on the setup screen's licence step", () => {
    const filled = renderToStaticMarkup(<SetupMarkup licence={{ number: "R512345", className: "RCIC" }} />);
    expect(field(filled, "lno")).toContain('value="R512345"');
    expect(field(filled, "cl")).toContain('<option selected="">RCIC</option><option>RCIC-IRB</option>');
  });
});

describe("copy after 2026-10-19", () => {
  const trial = renderToStaticMarkup(createElement(StartTrialMarkup));
  const setup = renderToStaticMarkup(createElement(SetupMarkup));

  it("no longer says real client invitations wait for verification or practice steps", () => {
    for (const text of Object.values(START_TRIAL_COPY)) expect(trial).toContain(text);
    expect(trial).not.toMatch(/stay locked until verification|Usually takes a few business days|firm and licence are verified/);
    for (const key of ["licenceLead", "proofHint", "sampleRail", "sampleLead", "sampleAlertTitle", "sampleAlert"] as const) expect(setup).toContain(SETUP_COPY[key]);
    expect(setup).not.toMatch(/by hand before real clients|six steps are done and your licence check passes|Try it before real clients/);
  });

  it("says on Licences that the number is checked against the CICC register list", () => {
    expect(CHECK_NOTE).toBe("The number is checked against the CICC register list");
    expect(UNTIL_CHECKED).toContain("invite real clients");
    expect(licenceIntro()).toContain("checked against the CICC register list");
    expect(licenceIntro()).not.toMatch(/by hand|business day|once one licence is checked/);
  });
});
