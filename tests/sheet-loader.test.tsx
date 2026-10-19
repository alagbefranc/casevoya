import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetLoader } from "@/components/sheet/sheet-loader";

describe("SheetLoader (first-load skeleton)", () => {
  it("draws the app shell with the animated brand mark, announced as loading", () => {
    const html = renderToStaticMarkup(<SheetLoader />);
    expect(html).toContain('role="status"');
    expect(html).toContain(">Loading<");
    // The real frame's geometry: dark 264px sidebar, light rounded panel.
    expect(html).toContain("grid-template-columns:264px 1fr");
    expect(html).toContain("background:#111");
    expect(html).toContain("cv-sk-panel");
    // The favicon mark, animated, as the sidebar logo.
    expect(html).toContain('src="/assets/brand/vo-mark-white.svg"');
    expect(html).toContain("@keyframes cvWrite");
    expect(html).toContain("@keyframes cvShimmer");
    expect(html).toContain("prefers-reduced-motion");
  });
});
