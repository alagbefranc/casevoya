import { describe, expect, it } from "vitest";
import { writeInviteBadge } from "@/components/port/invite-badge";
import { escapeHtml } from "@/lib/html";
import { isAcceptableEmail, normalizeEmail } from "@/lib/auth/invitations";
import { readStaffInvite } from "@/modules/sheet/staff-present";
import { firmDetailChanges } from "@/modules/settings/firm-input";

type FakeNode = { kind: "element"; tag: string } | { kind: "text"; text: string };

/** A badge double: records the nodes it is given and refuses any HTML parsing. */
function badgeDouble() {
  const badge = {
    nodes: [] as FakeNode[],
    replaceChildren(...nodes: FakeNode[]) {
      badge.nodes = nodes;
    },
  };
  Object.defineProperty(badge, "innerHTML", {
    set() {
      throw new Error("innerHTML must not be used for server data");
    },
  });
  return badge;
}

const doc = {
  createElement: (tag: string) => ({ kind: "element", tag }) as FakeNode,
  createTextNode: (text: string) => ({ kind: "text", text }) as FakeNode,
};

const MARKUP = `<img src=x onerror="alert(1)">@example.test`;

describe("accept-staff invitation badge", () => {
  it("writes the email as a text node, literally", () => {
    const badge = badgeDouble();
    writeInviteBadge(badge as never, MARKUP, doc as never);
    expect(badge.nodes).toEqual([
      { kind: "element", tag: "i" },
      { kind: "text", text: `For ${MARKUP}` },
    ]);
  });

  it("writes an ordinary address the same way", () => {
    const badge = badgeDouble();
    writeInviteBadge(badge as never, "new.hire@example.test", doc as never);
    expect(badge.nodes[1]).toEqual({ kind: "text", text: "For new.hire@example.test" });
  });
});

describe("escapeHtml", () => {
  it("escapes every character that can open markup or end an attribute", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\`</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;");
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("Grace Lin · Licensed consultant")).toBe("Grace Lin · Licensed consultant");
  });
});

describe("invitation email validation", () => {
  it("accepts ordinary addresses", () => {
    for (const value of ["a@example.test", "first.last+tag@sub.example.co", "x_y-z@example.test", "o'brien@example.test"]) {
      expect(isAcceptableEmail(value)).toBe(true);
    }
    expect(normalizeEmail("  New.Hire@Example.TEST ")).toBe("new.hire@example.test");
    expect(normalizeEmail("O'Brien@Example.test")).toBe("o'brien@example.test");
  });

  it("refuses markup, quoting characters and control characters", () => {
    for (const value of [
      MARKUP,
      "a<b@example.test",
      "a>b@example.test",
      'a"b@example.test',
      "a`b@example.test",
      "a(b)@example.test",
      "a;b@example.test",
      "a,b@example.test",
      "a\\b@example.test",
      "a\u0007b@example.test",
      "a\u007fb@example.test",
    ]) {
      expect(isAcceptableEmail(value), value).toBe(false);
      expect(normalizeEmail(value), value).toBeNull();
    }
  });

  it("refuses those addresses in the staff invite dialog and the firm contact form", () => {
    expect(readStaffInvite({ email: MARKUP, role: "Case manager" })).toEqual({ error: "Enter a valid email address." });
    expect("input" in readStaffInvite({ email: "new.hire@example.test", role: "Case manager" })).toBe(true);
    expect(firmDetailChanges({ billing_contact_email: "billing`@example.test" })).toEqual({ error: "Enter a full email address." });
    expect(firmDetailChanges({ billing_contact_email: "o'brien@example.test" })).toEqual({ changes: { billing_contact_email: "o'brien@example.test" } });
    expect("input" in readStaffInvite({ email: "o'brien@example.test", role: "Case manager" })).toBe(true);
    expect(firmDetailChanges({ billing_contact_email: "billing@example.test" })).toEqual({ changes: { billing_contact_email: "billing@example.test" } });
  });
});
