import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupMarkup, setupCardCopy } from "@/components/port/markup/setup";
import { setupTrialBadge } from "@/modules/firm-onboarding/setup-trial";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { k2Count } from "@/components/port/kit";
import { pendingVerifyEmail, verifyHref } from "@/lib/auth/pending-verify";
import { PLAN_CHOICE_KEY, parsePlanChoice, readPlanChoice, rememberPlanChoice } from "@/lib/plan-choice";

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

describe("signup E2E fixes (#330)", () => {
  it("the signed-in setup page calls the trial pill from a server module", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const page = readFileSync(path.join(root, "src/app/setup/page.tsx"), "utf8");
    const shared = readFileSync(path.join(root, "src/modules/firm-onboarding/setup-trial.ts"), "utf8");
    const screen = readFileSync(path.join(root, "src/components/port/markup/setup.tsx"), "utf8");
    expect(shared).not.toMatch(/^\s*["']use client["']/m);
    expect(screen.startsWith('"use client"')).toBe(true);
    expect(page).toContain('import { setupTrialBadge } from "@/modules/firm-onboarding/setup-trial"');
    expect(page).toContain("trialBadge = setupTrialBadge(subscription ?? null)");
    expect(page).not.toMatch(/setupTrialBadge[\s\S]{0,120}markup\/setup/);
    expect(screen).not.toMatch(/export function setupTrialBadge/);
  });

  it("setup's trial pill never shows a hardcoded 14 days", () => {
    expect(setupTrialBadge(null)).toBe("Free trial");
    expect(setupTrialBadge({ status: "trial", trial_ends_at: null, card_required: true })).toBe("Free trial");
    const now = new Date("2026-11-03T12:00:00Z");
    expect(setupTrialBadge({ status: "trial", trial_ends_at: "2026-12-03T12:00:00Z", card_required: false }, now)).toBe("Trial · 30 days left");
    const html = renderToStaticMarkup(<SetupMarkup firmName="Maple" />);
    expect(html).not.toMatch(/14 days left/);
    expect(html).toContain('<span class="pill">Free trial</span>');
  });

  it("setup's last step offers Add a card to start the admin-length trial", () => {
    expect(setupCardCopy(30).title).toBe("Add a card to start your 30-day free trial");
    expect(setupCardCopy(30).href).toBe("/sheet/settings?tab=billing&dlg=plan");
    const html = renderToStaticMarkup(<SetupMarkup firmName="Maple" card={{ trialDays: 30 }} />);
    expect(html).toContain("Add a card to start your 30-day free trial");
    expect(html).toContain('href="/sheet/settings?tab=billing&amp;dlg=plan"');
    expect(renderToStaticMarkup(<SetupMarkup firmName="Maple" />)).not.toContain("data-setup-card");
  });

  it("no setup or start-trial copy says the firm is live", () => {
    const html = renderToStaticMarkup(<SetupMarkup firmName="Maple" />) + renderToStaticMarkup(<StartTrialMarkup trialDays={30} />);
    expect(html).not.toMatch(/firm is live|starts live/i);
  });

  it("a pending sign-up resumes at the code step for its email", () => {
    expect(pendingVerifyEmail("a+b@mail.example")).toBe("a+b@mail.example");
    expect(pendingVerifyEmail("not an email")).toBeNull();
    expect(verifyHref("a+b@mail.example")).toBe("/start-trial?verify=a%2Bb%40mail.example");
    const html = renderToStaticMarkup(<StartTrialMarkup verifyEmail="a@firm.ca" />);
    expect(html).toContain('value="a@firm.ca"');
    expect(html).toContain(">a@firm.ca</b>");
  });

  it("remembers the pricing page's plan for the plan dialog", () => {
    expect(parsePlanChoice("Firm", "annual")).toEqual({ plan: "firm", interval: "year" });
    expect(parsePlanChoice("enterprise", "month")).toBeNull();
    const store = memory();
    expect(rememberPlanChoice("?plan=solo&interval=month", store)).toEqual({ plan: "solo", interval: "month" });
    expect(readPlanChoice(store)).toEqual({ plan: "solo", interval: "month" });
    store.setItem(PLAN_CHOICE_KEY, "{bad");
    expect(readPlanChoice(store)).toBeNull();
  });

  it("the resend countdown reads as one value, not a digit reel", () => {
    const el = { dataset: {} as Record<string, string>, classList: { add() {} }, innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
    k2Count(el as unknown as HTMLElement, "07");
    expect(el.innerHTML.match(/class="k2-dg" aria-hidden="true"/g)?.length).toBe(2);
    expect(el.innerHTML).toContain('<span class="k2-sr">07</span>');
  });
});
