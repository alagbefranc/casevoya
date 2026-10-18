import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AcceptClientMarkup } from "@/components/port/markup/accept-client";
import { AcceptFamilyMarkup } from "@/components/port/markup/accept-family";
import { AcceptSponsorMarkup } from "@/components/port/markup/accept-sponsor";
import { AcceptStaffMarkup } from "@/components/port/markup/accept-staff";

function staffPasswordRules() {
  const html = renderToStaticMarkup(createElement(AcceptStaffMarkup));
  const start = html.indexOf('<ul class="rules">');
  return html.slice(start, html.indexOf("</ul>", start) + 5);
}

describe("portal accept sign-in step", () => {
  const screens = [
    ["client", AcceptClientMarkup, "#4"],
    ["sponsor", AcceptSponsorMarkup, "/portal"],
    ["family", AcceptFamilyMarkup, "/portal"],
  ] as const;

  for (const [name, Screen, then] of screens) {
    it(`${name}: offers a password with the Designer rules, password selected`, () => {
      const html = renderToStaticMarkup(createElement(Screen));
      expect(html).toContain('id="ppw" type="password" autoComplete="new-password"');
      expect(html).toContain(staffPasswordRules());
      expect(html).toMatch(/aria-checked="false"[^>]*data-v="passkey"/);
      expect(html).toMatch(/aria-checked="true"[^>]*data-v="password"/);
      expect(html).toContain("Already have a Casevoya sign-in? Sign in");
      expect(html).toMatch(/<div data-signin="code" hidden="">/);
      expect(html).toContain(`class="otp" data-then="${then}"`);
    });
  }

  it("client Done links go to the real portal, and the first-task card waits for a real request", () => {
    const html = renderToStaticMarkup(createElement(AcceptClientMarkup));
    expect(html).not.toContain("/sheet/portal");
    expect(html).toContain('href="/portal/upload"');
    expect(html).toContain('href="/portal"');
    expect(html).toMatch(/class="ready" data-first-request="" style="display:none"/);
  });
});
