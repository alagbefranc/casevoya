import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The page's server reads and the LiveKit screen aren't needed to check what shows while it loads.
vi.mock("@/components/video/call-screen", () => ({ CallScreen: () => null }));
vi.mock("@/modules/portal/load", () => ({ loadPortalAccess: vi.fn() }));
vi.mock("@/modules/sheet/load", () => ({ loadSheetAccess: vi.fn() }));
vi.mock("@/modules/video/service", () => ({ readCall: vi.fn() }));

const { default: CallPage } = await import("@/app/call/[ref]/page");
const { CallLoading } = await import("@/components/video/call-loading");

describe("/call/[ref] loading state (DES-04)", () => {
  it("shows the call card with skeleton placeholders while the call loads, never a blank page", () => {
    const page = CallPage({ params: Promise.resolve({ ref: "ABC123" }) }) as ReactElement<{ fallback: unknown }>;
    const fallback = page.props.fallback;
    expect(isValidElement(fallback)).toBe(true);
    const html = renderToStaticMarkup(fallback as ReactElement);
    expect(html).toContain('class="cv-call"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Opening the call…");
    expect(html).toContain('class="sk"');
    expect(renderToStaticMarkup(createElement(CallLoading))).toBe(html);
  });
});
