import { describe, expect, it } from "vitest";
import { applyUrlState } from "@/components/sheet/sheet-state";
import { swipeAction } from "@/components/portal/use-portal";

// Client-side markup built from page data: the Sheet's ?state= preview (demo screens only, the
// heading set as text) and the demo portal's swipe actions (DOM nodes, not markup).

const NAME = `<img src=x onerror="alert(1)">Wei`;

function fakeSheet(demo: boolean) {
  const h1 = { textContent: NAME as string | null };
  const content = {
    innerHTML: "<p>live page</p>",
    querySelector: (selector: string) => (selector === "h1" ? h1 : null),
    insertAdjacentHTML(_where: string, html: string) {
      this.innerHTML = `${html}${this.innerHTML}`;
    },
  };
  const root = {
    querySelector: (selector: string) => (selector === ".statusbar .demo" ? (demo ? {} : null) : selector === "#content" ? content : null),
  };
  return { root: root as unknown as HTMLElement, content, h1 };
}

describe("Sheet ?state= preview", () => {
  it("does nothing on a live (non-demo) screen", () => {
    for (const state of ["empty", "error", "denied", "loading", "offline"]) {
      const { root, content, h1 } = fakeSheet(false);
      applyUrlState(root, "matter", `?state=${state}`);
      expect(content.innerHTML).toBe("<p>live page</p>");
      expect(h1.textContent).toBe(NAME);
    }
  });

  it("on a demo screen keeps the heading as text, never as markup", () => {
    for (const state of ["empty", "error", "denied"]) {
      const { root, content, h1 } = fakeSheet(true);
      applyUrlState(root, "matter", `?state=${state}`);
      expect(content.innerHTML).toContain('<h1 class="display"></h1>');
      expect(content.innerHTML).not.toContain("<img src=x");
      expect(content.innerHTML).not.toContain("onerror");
      expect(h1.textContent).toBe(NAME);
    }
  });

  it("still shows the loading and offline states on a demo screen", () => {
    const loading = fakeSheet(true);
    applyUrlState(loading.root, "matters", "?state=loading");
    expect(loading.content.innerHTML).toContain("Loading matters…");
    const offline = fakeSheet(true);
    applyUrlState(offline.root, "matters", "?state=offline");
    expect(offline.content.innerHTML).toContain("You’re offline");
    expect(offline.content.innerHTML).toContain("<p>live page</p>");
  });
});

type FakeNode = { tag: string; type?: string; href?: string; className?: string; textContent?: string; dataset: Record<string, string> };
const fakeDoc = { createElement: (tag: string): FakeNode => ({ tag, dataset: {} }) } as unknown as Document;

describe("portal swipe actions", () => {
  it("puts the row title only in a data attribute, as text", () => {
    const open = swipeAction(true, true, NAME, fakeDoc) as unknown as FakeNode;
    expect(open.tag).toBe("button");
    expect(open.dataset.toast).toBe(`Opened ${NAME}`);
    expect(open.textContent).toBe("Open");
    expect(Object.keys(open)).not.toContain("innerHTML");
  });

  it("builds the upload link and the mark-read button", () => {
    const upload = swipeAction(true, false, NAME, fakeDoc) as unknown as FakeNode;
    expect(upload).toMatchObject({ tag: "a", href: "/portal/upload", className: "up", textContent: "Upload" });
    const read = swipeAction(false, false, NAME, fakeDoc) as unknown as FakeNode;
    expect(read).toMatchObject({ tag: "button", type: "button", className: "mr", textContent: "Mark read" });
  });
});
