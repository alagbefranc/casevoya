import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupMarkup } from "@/components/port/markup/setup";

function pressedSwatches(html: string) {
  return [...html.matchAll(/aria-pressed="true" aria-label="([A-Za-z]+)" data-c="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[2]);
}

describe("setup branding accent", () => {
  it("presses the first swatch and leaves the preview as designed when nothing is saved", () => {
    const html = renderToStaticMarkup(<SetupMarkup firmName="Synthetic Firm" />);
    expect(pressedSwatches(html)).toEqual(["#0075DE"]);
    expect(html).toContain('<div class="prev" id="prev">');
  });

  it("shows a saved accent in the preview and presses its swatch", () => {
    const html = renderToStaticMarkup(<SetupMarkup firmName="Synthetic Firm" accent="#205C38" />);
    expect(pressedSwatches(html)).toEqual(["#205c38"]);
    expect(html).toContain('<div class="prev" id="prev" style="--brand:#205C38">');
  });

  it("keeps a saved accent that is not a swatch without pressing one", () => {
    const html = renderToStaticMarkup(<SetupMarkup accent="#123456" />);
    expect(pressedSwatches(html)).toEqual([]);
    expect(html).toContain('style="--brand:#123456"');
  });

  it("ignores a malformed accent", () => {
    const html = renderToStaticMarkup(<SetupMarkup accent="red;background:url(x)" />);
    expect(pressedSwatches(html)).toEqual(["#0075DE"]);
    expect(html).toContain('<div class="prev" id="prev">');
  });

  it("names each calendar and payment provider as the label's own text", () => {
    const html = renderToStaticMarkup(<SetupMarkup />);
    for (const name of ["Google Calendar", "Zoom", "Calendly", "Stripe"]) {
      expect(html).toMatch(new RegExp(`<div class="conn"><img [^>]*/><div>${name}<small>`));
    }
  });
});
