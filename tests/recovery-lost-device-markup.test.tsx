import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecoveryMarkup } from "@/components/port/markup/recovery";

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
});
