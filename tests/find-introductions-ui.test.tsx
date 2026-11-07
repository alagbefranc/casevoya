import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FindIntroductions, SheetSettingsFirm, type FirmData } from "@/components/sheet/designer/settings-firm";

const firm: FirmData = { firmName: "Synthetic Firm", rows: [{ label: "Display name", value: "Synthetic Firm" }] };

describe("Find introductions on Settings > Firm", () => {
  it("stays out of the Designer firm page when the firm has no introductions row", () => {
    const html = renderToStaticMarkup(createElement(SheetSettingsFirm, { data: firm }));
    expect(html).not.toContain("Introductions");
    expect(html).not.toContain("data-find-intro");
  });

  it("shows off by default, what would be shared, and a Turn on control for the owner", () => {
    const html = renderToStaticMarkup(
      createElement(FindIntroductions, { data: { on: false, owner: true, organizationId: "11111111-1111-4111-8111-111111111111" } }),
    );
    expect(html).toContain("Introductions are off");
    expect(html).toContain("does not share");
    expect(html).toContain("name, email, goal, country, language and time zone");
    expect(html).toContain("not a directory");
    expect(html).toContain("A lead already created stays");
    expect(html).toContain('data-find-intro="on"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Turn on<");
    expect(html).not.toContain("Northline");
  });

  it("shows on, Turn off, and no control for someone who is not the owner", () => {
    const owner = renderToStaticMarkup(
      createElement(FindIntroductions, { data: { on: true, owner: true, organizationId: "11111111-1111-4111-8111-111111111111" } }),
    );
    expect(owner).toContain("Introductions are on");
    expect(owner).toContain('data-find-intro="off"');
    expect(owner).toContain(">Turn off<");
    const staff = renderToStaticMarkup(
      createElement(FindIntroductions, { data: { on: false, owner: false, organizationId: "11111111-1111-4111-8111-111111111111" } }),
    );
    expect(staff).not.toContain("data-find-intro");
    expect(staff).toContain("The firm owner can change this.");
    expect(staff).toContain("Introductions are off");
  });
});

describe("find hostname route", () => {
  it("keeps app.casevoya.ca and adds find.casevoya.ca beside it", () => {
    const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const appAt = text.indexOf('"pattern": "app.casevoya.ca"');
    const findAt = text.indexOf('"pattern": "find.casevoya.ca"');
    expect(appAt).toBeGreaterThan(0);
    expect(findAt).toBeGreaterThan(appAt);
    expect(text.match(/"pattern": "app\.casevoya\.ca"/g)).toHaveLength(1);
  });
});
