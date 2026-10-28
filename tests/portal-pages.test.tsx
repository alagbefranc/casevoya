import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { LivePortal } from "@/components/portal/live";
import type { PortalDocumentCard, PortalDocuments } from "@/modules/documents/load";
import { matterCards } from "@/modules/portal/home-present";
import type { PortalViewer } from "@/modules/portal/load";
import type { PortalTask } from "@/modules/portal/tasks-load";

// Client portal pages (docs/specs/client-portal-fidelity.md §3): My matters, Tasks, Documents and
// Upload in the designed layouts, filled from the client's own records. Everything is synthetic.

const person = { id: "p1", displayName: "Casey Nguyen", email: "casey@example.test", phone: null, isMinor: false, role: "applicant" };

const viewer: PortalViewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Example Firm",
  organizationSlug: "example-firm",
  timezone: "America/Toronto",
  role: "client",
  person,
  matters: [
    {
      id: "m1",
      title: "Spousal sponsorship",
      stage: "evidence collection",
      onHold: false,
      reference: "EX-2026-0142",
      openedAt: "2026-09-02T14:00:00Z",
      people: [
        { name: "Casey Nguyen", role: "applicant", self: true },
        { name: "Jordan Lee", role: "sponsor", self: false },
        { name: "Sam Lee", role: "dependant", self: false },
      ],
    },
    { id: "m2", title: "Visitor record extension", stage: "closed", onHold: false, reference: "EX-2025-0388", openedAt: "2025-01-10T14:00:00Z", retentionOn: "2033-03-14", people: [{ name: "Casey Nguyen", role: "applicant", self: true }] },
    { id: "m3", title: "Work permit", stage: "intake", onHold: true, reference: null, people: [] },
  ],
  people: [person, { ...person, id: "p2", displayName: "Jordan Lee", role: "sponsor" }],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

function task(overrides: Partial<PortalTask>): PortalTask {
  return { id: "t1", title: "Add dates to your photos", status: "open", dueOn: "2026-10-27", completedAt: null, blockerNote: null, intakeResponseId: null, matterId: "m1", ...overrides };
}

function card(overrides: Partial<PortalDocumentCard>): PortalDocumentCard {
  return {
    key: "k1",
    title: "Passport, bio page",
    personName: "Casey Nguyen",
    meta: "Identity",
    versionLabel: "v2",
    when: "12 Oct",
    labels: ["Uploaded", "Accepted"],
    needsYou: false,
    countsAsAccepted: true,
    canDownload: true,
    alert: null,
    alertLang: "en",
    versionId: "v1",
    expectedVersion: 1,
    requestId: "q1",
    requestVersion: 1,
    documentId: null,
    matterId: "m1",
    personId: "p1",
    refId: null,
    purpose: "Passport",
    sensitivity: "ordinary",
    audience: "subject",
    canReview: false,
    ...overrides,
  };
}

const documents: PortalDocuments = {
  cards: [
    card({ key: "a", title: "Relationship photos", labels: ["Uploaded", "Changes needed"], countsAsAccepted: false, needsYou: true, alert: "Please add the date and city for each photo." }),
    card({ key: "b" }),
    card({ key: "c", title: "Joint lease", personId: "p2", personName: "Jordan Lee", requestId: null }),
  ],
  requests: [
    { id: "q1", matterId: "m1", personId: "p1", personName: "Casey Nguyen", purpose: "Relationship photos", explanation: "Add the date and city for each photo.", documentId: null, formats: [], sensitivity: "ordinary", audience: "matter" },
  ],
  progressLine: "",
  canReview: false,
  people: [],
};

const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(LivePortal, { viewer, taskCount: 1, unread: 0, logo: null, ...props } as never));

describe("My matters", () => {
  it("builds one card per matter: open first, tracker, tasks for you, consultant, closed with its records date", () => {
    const cards = matterCards({
      matters: viewer.matters,
      tasks: [task({}), task({ id: "t2" }), task({ id: "t3", status: "blocked" }), task({ id: "t4", matterId: "m2" })],
      consultants: new Map([["m1", "Dana Moreau"]]),
      timezone: "America/Toronto",
    });
    expect(cards.map((item) => item.id)).toEqual(["m1", "m3", "m2"]);
    const [first, held, closed] = cards;
    expect(first.label).toBe("EX-2026-0142 · opened 2 Sep 2026");
    expect(first.withLine).toBe("With Jordan Lee (sponsor) and Sam Lee (dependant)");
    expect(first.badge).toEqual({ tone: "blue", text: "2 tasks for you" });
    expect(first.consultant).toBe("Dana Moreau, consultant");
    expect(first.steps?.find((step) => step.state === "current")?.label).toBe("Documents");
    expect(first.href).toBe("/portal?matter=m1");
    expect(held.badge).toEqual({ tone: "chg", text: "On hold" });
    // No other readable names: say nothing rather than "Only you" (a client sees others only with a grant).
    expect(held.withLine).toBe("");
    expect(closed).toMatchObject({ label: "EX-2025-0388 · closed", closed: true, steps: null, note: "Records kept until Mar 2033", href: "/portal/documents?matter=m2" });
  });

  it("renders the designed cards and the empty state", () => {
    const cards = matterCards({ matters: viewer.matters, tasks: [task({})], consultants: new Map(), timezone: "America/Toronto" });
    const page = html({ page: "matters", matters: cards });
    expect(page).toContain('class="mcard rv"');
    expect(page).toContain("Each matter is one application Example Firm is working on for you.");
    expect(page).toContain('<span class="bd blue"><i></i>1 task for you</span>');
    expect(page).toContain('class="steps"');
    expect(page).toContain("Why some people see less");
    expect(html({ page: "matters", matters: [] })).toContain("No matters yet");
  });
});

describe("Tasks", () => {
  it("keeps the designed switch, and names who asked", () => {
    const page = html({ page: "tasks", tasks: [task({}), task({ id: "t2", status: "blocked", blockerNote: "Starts once your photos are in." }), task({ id: "t3", status: "done", completedAt: "2026-10-12T15:00:00Z" })] });
    expect(page).toContain('class="seg rv k2-rs"');
    expect(page).toContain('class="k2-rs-th"');
    expect(page).toContain("Requested by Example Firm");
    expect(page).toContain("Waiting on Example Firm");
  });
});

describe("Documents", () => {
  it("groups the client's requested documents and ones others shared, with the warn alert", () => {
    const page = html({ page: "documents", documents });
    expect(page).toContain("Everything you’ve sent, and what Example Firm thinks of it.");
    expect(page).toContain("All <span class=\"sep\" aria-hidden=\"true\"></span> 3");
    expect(page).toContain("Needs you <span class=\"sep\" aria-hidden=\"true\"></span> 1");
    expect(page).toContain("Requested by Example Firm");
    expect(page).toContain("Shared with you by others");
    expect(page).toContain("Why changes are needed");
    expect(page).toContain("“Please add the date and city for each photo.”");
    expect(page).toContain('href="/portal/upload"');
    expect(page).toContain(">Download</button>");
    expect(page).not.toMatch(/checked for viruses/i);
  });

  it("shows the empty state when nothing was asked for", () => {
    expect(html({ page: "documents", documents: { ...documents, cards: [], requests: [] } })).toContain("No documents requested yet");
  });
});

describe("Upload", () => {
  it("is the five-step flow, starting with the request", () => {
    const page = html({ page: "upload", documents });
    expect(page).toContain('class="stepper"');
    for (const label of ["1. Request", "2. Whose", "3. Add pages", "4. Check", "5. Send"]) expect(page).toContain(label);
    expect(page).toContain("Which request is this for?");
    expect(page).toContain("Relationship photos");
    expect(page).toContain('class="fstep on"');
    expect(page).toContain("Whose document is it?");
    expect(page).toContain("Every page is readable");
    expect(page).toContain('capture="environment"');
  });

  // #262 item 5: the client's own option showed "Y" (from "You"); it shows their initials, like everyone else's.
  it("step 2 shows the client's initials for their own document, and another person's initials for theirs", () => {
    const own = html({ page: "upload", documents });
    expect(own).toContain('<span class="av" aria-hidden="true">CN</span>');
    expect(own).not.toContain('<span class="av" aria-hidden="true">Y</span>');
    expect(own).toContain('<b style="font-weight:500">Me</b>');
    const theirs = html({
      page: "upload",
      documents: { ...documents, requests: [{ ...documents.requests[0], id: "q2", personId: "p2", personName: "Jordan Lee" }] },
    });
    expect(theirs).toContain('<span class="av" aria-hidden="true">JL</span>');
    expect(theirs).toContain('<b style="font-weight:500">Jordan Lee</b>');
  });

  it("says plainly when there's nothing to upload", () => {
    expect(html({ page: "upload", documents: { ...documents, requests: [] } })).toContain("Nothing to upload");
  });
});

describe("portal loading", () => {
  it("shows a skeleton while a page loads, never the no-access card", async () => {
    const { PortalLoading } = await import("@/components/portal/live");
    const page = renderToStaticMarkup(createElement(PortalLoading));
    expect(page).toContain('aria-busy="true"');
    expect(page).toContain("Opening your portal");
    expect(page).not.toMatch(/No portal yet|Nothing on file/);
  });
});

describe("the current-matter cookie", () => {
  it("is read by the server page from a plain module, not a client one", async () => {
    const { readFileSync } = await import("node:fs");
    const { PORTAL_MATTER_COOKIE } = await import("@/modules/portal/matter-cookie");
    expect(PORTAL_MATTER_COOKIE).toBe("cv_portal_matter");
    // A value imported from a "use client" module reaches a server component as a client
    // reference, so cookies().get() would never match (#172, @swe's check 1).
    for (const file of ["src/app/portal/[[...slug]]/page.tsx", "src/components/portal/remember-matter.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain('import { PORTAL_MATTER_COOKIE } from "@/modules/portal/matter-cookie";');
    }
    expect(readFileSync("src/modules/portal/matter-cookie.ts", "utf8")).not.toMatch(/^\s*["']use client["']/m);
  });
});

describe("Tasks narrow screens", () => {
  it("lets a long firm name shorten in the switch instead of overlapping", () => {
    const page = html({ page: "tasks", tasks: [task({})] });
    expect(page).toContain("#pc>.seg.k2-rs>button{min-width:0;overflow:hidden;text-overflow:ellipsis}");
    // On a phone the switch scrolls instead, so "Waiting on {firm} · n" stays whole.
    expect(page).toContain("@media (max-width:600px){#pc>.seg.k2-rs{display:flex;overflow-x:auto;scrollbar-width:none}");
  });
});

describe("Account switches without a mobile number", () => {
  it("disables WhatsApp and texts with a hint, and keeps email", () => {
    const page = html({ page: "account" });
    expect(page).toMatch(/id="pref-wa" disabled="" aria-disabled="true"/);
    expect(page).toMatch(/id="pref-sms" disabled="" aria-disabled="true"/);
    expect(page).toContain("Ask your firm to add your mobile number before choosing WhatsApp.");
    expect(page).not.toMatch(/id="pref-email" disabled/);
  });
});

describe("follow-ups from the #171 and #173 reports", () => {
  it("names an unreadable owner plainly and says how clients sign in", () => {
    const docs = html({ page: "documents", documents: { ...documents, cards: [card({ key: "z", title: "Joint lease", personId: "p9", personName: "Person", requestId: null })] } });
    expect(docs).toContain("Someone on your file");
    expect(html({ page: "account" })).toContain("You sign in with your email and password.");
  });
});
