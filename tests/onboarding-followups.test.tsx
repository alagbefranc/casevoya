import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TOAST_CLEAR_OF, toastBottom } from "@/components/port/kit";
import { SetupMarkup } from "@/components/port/markup/setup";
import { PASSKEY_SETUP, TwoStepMarkup } from "@/components/port/markup/two-step";
import { recoveryCodesShown } from "@/lib/auth/mfa-step";

// Issue #261: follow-ups found shipping #260. Fix 1 (the rate-limit countdown) is in onboarding-signup.test.ts.

const root = path.resolve(import.meta.dirname, "..");

describe("toasts never cover a setup step's Continue (fix 2)", () => {
  it("the setup footer, which holds Back and Continue on every step, is what toasts keep clear of", () => {
    const html = renderToStaticMarkup(<SetupMarkup />);
    expect(TOAST_CLEAR_OF).toBe(".wz-foot");
    const footer = html.slice(html.indexOf('<footer class="wz-foot"'));
    expect(footer.length).toBeLessThan(html.length);
    expect(footer.slice(0, footer.indexOf("</footer>"))).toContain("data-next");
  });

  it("desktop: a footer stuck to the bottom lifts the stack above it", () => {
    // 1280×800, `.toasts{bottom:40px}`, the 73px footer at the bottom, one 58px toast.
    const bottom = toastBottom(40, [{ top: 727, bottom: 800 }], 800, 58);
    expect(bottom).toBe(800 - 727 + 12);
    // The stack's lowest edge is above the footer's top.
    expect(800 - bottom).toBeLessThan(727);
  });

  it("390px: the full-width footer lifts the full-width stack above it", () => {
    // 390×844, the phone rule `.toasts{bottom:16px}`, the 69px footer.
    const bottom = toastBottom(16, [{ top: 775, bottom: 844 }], 844, 64);
    expect(844 - bottom).toBeLessThan(775);
  });

  it("a footer that isn't under the stack, or isn't shown, leaves it where the CSS puts it", () => {
    expect(toastBottom(40, [{ top: 420, bottom: 493 }], 800, 58)).toBe(40);
    expect(toastBottom(40, [{ top: 0, bottom: 0 }], 800, 58)).toBe(40);
    expect(toastBottom(40, [{ top: 900, bottom: 973 }], 800, 58)).toBe(40);
    expect(toastBottom(40, [], 800, 58)).toBe(40);
  });

  it("every toast is placed after it joins the stack, and again when the page scrolls or resizes", () => {
    const kit = readFileSync(path.join(root, "src/components/port/kit.ts"), "utf8");
    expect(kit).toContain("wrap.append(toast);\n  liftToasts(wrap);");
    expect(kit).toContain('window.addEventListener("scroll", relift, { passive: true, capture: true });');
    expect(kit).toContain('window.addEventListener("resize", relift, { passive: true });');
  });
});

describe("two-step setup never shows an empty recovery-codes list (fix 3)", () => {
  it("“Add a passkey instead” says it is coming later and doesn't open the codes step", () => {
    const html = renderToStaticMarkup(<TwoStepMarkup activeStep={2} />);
    const at = html.indexOf("Add a passkey instead");
    expect(at).toBeGreaterThan(-1);
    const button = html.slice(html.lastIndexOf("<button", at), html.indexOf(">", html.lastIndexOf("<button", at)) + 1);
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toContain("data-go");
    expect(button).toContain(`title="${PASSKEY_SETUP.title}"`);
    expect(html.slice(at, html.indexOf("</button>", at))).toContain(
      `Works with Face ID, Touch ID, Windows Hello and Android${PASSKEY_SETUP.note}`,
    );
    expect(PASSKEY_SETUP.note).toBe(" · Coming later");
    // Nothing on the page opens step 3 by a button; only a verified authenticator code does (`data-then="#3"`).
    expect(html).not.toContain('data-go="3"');
    expect(html).toContain('data-then="#3"');
  });

  it("the codes step counts as shown only when every slot holds a code", () => {
    const fake = (codes: string[]) =>
      ({ querySelectorAll: () => codes.map((textContent) => ({ textContent })) }) as unknown as ParentNode;
    expect(recoveryCodesShown(fake(Array(10).fill("")))).toBe(false);
    expect(recoveryCodesShown(fake([]))).toBe(false);
    expect(recoveryCodesShown(fake(["ABCD-EFGH", ""]))).toBe(false);
    expect(recoveryCodesShown(fake(Array(10).fill("ABCD-EFGH")))).toBe(true);
  });

  it("the codes step sends anyone who reaches it without codes back to setup", () => {
    const wire = readFileSync(path.join(root, "src/components/port/wire.ts"), "utf8");
    expect(wire).toContain('if (page === "mfa" && event.step === 3 && !recoveryCodesShown(event.root)) {');
    expect(wire).toContain('event.root.dispatchEvent(new CustomEvent("port-go", { detail: "#2" }));');
  });
});
