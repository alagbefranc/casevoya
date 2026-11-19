/**
 * Stripe's embedded onboarding opens its own screens (document upload and the like) as overlays
 * on the page. A browser modal (`showModal()`) is drawn above every z-index and makes the rest of
 * the page inert, so those screens opened behind "Finish with Stripe" and could not be used.
 * The dialog is an in-page layer instead, and Stripe's overlays are told to sit above it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/components/sheet/stripe-connect.tsx", "utf8");
const css = readFileSync("src/styles/kit/compat.css", "utf8");

function onboardingDialog(): string {
  const start = component.indexOf("function OnboardingDialog(");
  const end = component.indexOf("export function StripeAccountStatus(");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return component.slice(start, end);
}

describe("Finish with Stripe dialog", () => {
  it("is an in-page layer on document.body, never a browser modal", () => {
    const dialog = onboardingDialog();
    expect(dialog).not.toMatch(/showModal\(/);
    expect(dialog).toMatch(/createPortal\(/);
    expect(dialog).toMatch(/className=\{"dlg-page"\}/);
    // The Sheet's generic opener calls showModal() on a data-dlg target: the Stripe buttons don't use it.
    expect(component).not.toMatch(/data-dlg=\{STRIPE_DIALOG\}/);
  });

  it("keeps Stripe's own overlays above the layer", () => {
    const stripeZ = Number(/const STRIPE_OVERLAY_Z = (\d+);/.exec(component)?.[1]);
    const layerZ = Number(/\.dlg-page\{[^}]*z-index:(\d+)/.exec(css)?.[1]);
    expect(component).toMatch(/overlayZIndex: STRIPE_OVERLAY_Z/);
    expect(Number.isFinite(stripeZ) && Number.isFinite(layerZ)).toBe(true);
    expect(stripeZ).toBeGreaterThan(layerZ);
  });

  it("still closes with its buttons and Escape, and re-reads the account from Stripe on close", () => {
    const dialog = onboardingDialog();
    expect(dialog.match(/onClick=\{onClose\}/g)?.length).toBe(2);
    expect(dialog).toMatch(/event\.key === "Escape"/);
    expect(dialog).toMatch(/onExit=\{onClose\}/);
    expect(component).toMatch(/const close = \(\) => \{\s*setShown\(false\);\s*settle\(\);/);
  });
});
