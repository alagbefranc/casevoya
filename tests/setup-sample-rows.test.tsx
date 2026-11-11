import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SETUP_COPY, SetupMarkup } from "@/components/port/markup/setup";
import { sampleSteps } from "@/modules/sheet/sample-present";

function proofList(html: string): string {
  const start = html.indexOf('<div class="proof">');
  const end = html.indexOf('<div class="alert', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("setup sample-case six rows", () => {
  it("renders the six practice names as static rows, not controls", () => {
    const html = renderToStaticMarkup(createElement(SetupMarkup, { firmName: "Fixture Firm", policiesMissing: true }));
    const proof = proofList(html);
    for (const title of [
      "Send an intake form",
      "Send a service agreement",
      "Request and review an upload",
      "Schedule a reminder",
      "Issue an invoice",
      "Export the file",
    ]) {
      expect(proof).toContain(title);
    }
    expect(proof.match(/To try/g)).toHaveLength(6);
    expect(proof).not.toMatch(/<button|<a\b|data-href|data-next|data-go|disabled|aria-disabled|role="button"/);
    expect(html).toContain('href="/sheet/sample-mode"');
    expect(html).toContain('data-cta="Open my workspace"');
    expect(html).toContain(SETUP_COPY.sampleAlertTitlePolicies);
    expect(html).toContain("Settings &gt; Client portal first");
    expect(html).toContain("The six steps are optional practice.");
  });

  it("keeps the same six static rows when portal terms are already published", () => {
    const html = renderToStaticMarkup(createElement(SetupMarkup, { firmName: "Fixture Firm", policiesMissing: false }));
    const proof = proofList(html);
    expect(proof.match(/To try/g)).toHaveLength(6);
    expect(proof).not.toMatch(/<a\b|<button/);
    expect(html).toContain(SETUP_COPY.sampleAlert);
    expect(html).not.toContain(SETUP_COPY.sampleAlertTitlePolicies);
  });

  it("points the working tour at the six sheet pages", () => {
    const steps = sampleSteps("matter-1", "Fixture Firm", "Priya", new Set());
    expect(steps.map((step) => [step.key, step.href, step.title])).toEqual([
      ["intake", "/sheet/intake-builder", "Send an intake form"],
      ["agreement", "/sheet/agreements", "Send a service agreement"],
      ["upload", "/sheet/matters/matter-1?tab=documents", "Request and review an upload"],
      ["reminder", "/sheet/automations", "Schedule a reminder"],
      ["invoice", "/sheet/finance?dlg=invoice", "Issue an invoice"],
      ["export", "/sheet/exports", "Export the file"],
    ]);
  });
});
