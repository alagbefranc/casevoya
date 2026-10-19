import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetLoader } from "@/components/sheet/sheet-loader";

describe("SheetLoader", () => {
  it("shows the animated brand mark on the shell's dark background, announced as loading", () => {
    const html = renderToStaticMarkup(<SheetLoader />);
    expect(html).toContain('role="status"');
    expect(html).toContain('src="/assets/brand/vo-mark-white.svg"');
    expect(html).toContain("background:#111");
    expect(html).toContain("background:#0075de");
    expect(html).toContain("@keyframes cvWrite");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain(">Loading<");
    expect(html).not.toContain("records load after sign-in");
  });
});
