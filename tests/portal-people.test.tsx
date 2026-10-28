import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { LivePortal } from "@/components/portal/live";
import type { PortalViewer } from "@/modules/portal/load";

// Client portal pages (docs/specs/client-portal-fidelity.md §3, §5): People on your file, Guardian
// access, Your account, the Messages frame and the intake fallback, from the client's own records.
// Everything here is synthetic.

const self = { id: "p1", displayName: "Casey Nguyen", email: "casey@example.test", phone: null, isMinor: false, role: "applicant" };

const viewer: PortalViewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Example Firm",
  organizationSlug: "example-firm",
  timezone: "America/Toronto",
  role: "client",
  person: self,
  matters: [],
  people: [
    { ...self, id: "p3", displayName: "Sam Lee", role: "dependant", isMinor: true, email: null },
    self,
    { ...self, id: "p2", displayName: "Jordan Lee", role: "sponsor", email: "jordan@example.test" },
  ],
  grants: [{ id: "g1", kind: "guardian", purpose: "Act for Sam on the visitor visa", subjectName: "Sam Lee", granteeName: "Casey Nguyen" }],
  shares: [{ id: "s1", sectionKey: "passport bio", subjectName: "Casey Nguyen", granteeName: "Jordan Lee", matterTitle: "Work permit" }],
  prefs: { emailNotices: true, smsNotices: false, deadlineReminders: true, locale: "en-CA" },
  sections: [{ id: "sec1", sectionKey: "identity", summary: "Recorded", personName: "Casey Nguyen", matterTitle: "Work permit" }],
};

const html = (page: string, who: PortalViewer = viewer, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(LivePortal, { page, viewer: who, logo: null, ...extra } as never));

describe("People on your file", () => {
  it("shows a card per person (you first), who sees what from real shares, and the children note", () => {
    const page = html("family");
    expect(page).toContain("Each person has their own view");
    expect(page).toContain('class="who rv"');
    expect(page.indexOf("You · Casey Nguyen")).toBeLessThan(page.indexOf(">Jordan Lee<"));
    expect(page).toContain("Sponsor · their own login, tasks and private records");
    expect(page).toContain("Dependant · a parent or guardian manages their records");
    expect(page).toContain("Who sees what");
    expect(page).toContain("<th>You</th><th>Sam</th><th>Jordan</th>");
    // Casey's shared passport: Casey and Jordan see it, Sam doesn't.
    expect(page).toMatch(/Casey Nguyen’s passport bio<\/td><td><span class="bd ok"><i><\/i>Yes<\/span><\/td><td><span class="bd unv"><i><\/i>Hidden<\/span><\/td><td><span class="bd ok"><i><\/i>Yes<\/span>/);
    expect(page).toContain("Children under 18");
    expect(page).toContain("Withdraw");
  });

  it("is an honest empty state with nobody on file", () => {
    const page = html("family", { ...viewer, people: [], shares: [] });
    expect(page).toContain("No people yet");
    expect(page).not.toContain("Who sees what");
  });
});

describe("Guardian access", () => {
  it("names who the person acts for and the authority on file", () => {
    const page = html("guardian");
    expect(page).toContain("You act for Sam");
    expect(page).toContain("You · Casey Nguyen");
    expect(page).toContain("Minor · you manage their records");
    expect(page).toContain("Your authority");
    expect(page).toContain("Act for Sam on the visitor visa");
    expect(page).toContain("tell Example Firm");
  });

  it("says so when there are no guardian grants", () => {
    expect(html("guardian", { ...viewer, grants: [] })).toContain("No guardian grants");
  });
});

describe("Your account", () => {
  it("lays out Profile and Language side by side, then what the firm may send, then signing in", () => {
    const page = html("account");
    expect(page).toContain('class="split rv"');
    expect(page).toContain("Time zone</span><b>America/Toronto</b>");
    expect(page).toContain('href="/portal/correction"');
    expect(page).toContain("What Example Firm may send you");
    expect(page).toContain("Always on");
    expect(page).toContain('id="pref-email"');
    expect(page).toContain('action="/sign-out"');
  });
});

describe("Messages and intake frames", () => {
  it("puts the designed heading and footnote around the chat", () => {
    const page = html("messages", viewer, { messages: null });
    expect(page).toContain('<h1 class="display">Messages</h1>');
    expect(page).toContain("Write to Example Firm any time. Before you send, you’ll always see who can read it.");
    expect(page).toContain("Messages aren’t legal advice until your consultant says so.");
  });

  it("shows the designed fallback when the forms can't be read", () => {
    const page = html("intake", viewer, { intake: null });
    expect(page).toContain("Your questions");
    expect(page).toContain("Your forms couldn’t be shown just now");
    expect(page).toContain("On record");
  });
});
