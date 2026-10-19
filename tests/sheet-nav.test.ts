import { describe, expect, it } from "vitest";
import { sheetNavHref } from "@/components/sheet/sheet-nav";

const ORIGIN = "https://app.casevoya.ca";
const click = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
function link(href: string | null, attrs: Record<string, string> = {}) {
  return {
    getAttribute: (name: string) => (name === "href" ? href : (attrs[name] ?? null)),
    hasAttribute: (name: string) => name in attrs,
    target: attrs.target ?? "",
  } as unknown as HTMLAnchorElement;
}

describe("sheetNavHref", () => {
  it("turns a plain click on a Sheet link into a client navigation", () => {
    expect(sheetNavHref(click, link("/sheet/finance"), ORIGIN, "/sheet")).toBe("/sheet/finance");
    expect(sheetNavHref(click, link("/sheet/matters/abc?tab=documents"), ORIGIN, "/sheet")).toBe("/sheet/matters/abc?tab=documents");
    expect(sheetNavHref(click, link(`${ORIGIN}/sheet`), ORIGIN, "/sheet/finance")).toBe("/sheet");
  });

  it("leaves everything else to the browser", () => {
    expect(sheetNavHref({ ...click, defaultPrevented: true }, link("/sheet/finance"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref({ ...click, metaKey: true }, link("/sheet/finance"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref({ ...click, button: 1 }, link("/sheet/finance"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("/sheet/finance", { target: "_blank" }), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("/sheet/export.zip", { download: "" }), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("#"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("/portal"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("/sign-out"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("https://casevoya.ca/help"), ORIGIN, "/sheet")).toBeNull();
    expect(sheetNavHref(click, link("/sheet/finance#top"), ORIGIN, "/sheet/finance")).toBeNull();
    expect(sheetNavHref(click, null, ORIGIN, "/sheet")).toBeNull();
  });
});
