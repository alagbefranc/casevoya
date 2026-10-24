import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LivePortal } from "@/components/portal/live";
import type { PortalDocumentCard } from "@/modules/documents/load";
import type { PortalInvoice } from "@/modules/finance/portal-load";
import type { ChatData, ChatMessage } from "@/modules/messages/present";
import { homeView, shortDay, type HomeInput } from "@/modules/portal/home-present";
import type { PortalViewer } from "@/modules/portal/load";
import type { PortalTask } from "@/modules/portal/tasks-load";

// The client portal's Home (docs/specs/client-portal-fidelity.md §1–2): the designed hero, summary
// strip, tracker and panels, filled from the client's own records. Everything here is synthetic.

const person = { id: "p1", displayName: "Casey Nguyen", email: "casey@example.test", phone: null, isMinor: false, role: "applicant" };

const viewer: PortalViewer = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Example Firm",
  organizationSlug: "example-firm",
  timezone: "America/Toronto",
  role: "client",
  person,
  matters: [{ id: "m1", title: "Work permit", stage: "evidence collection", onHold: false, reference: "EX-2026-0007" }],
  people: [person],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

function task(overrides: Partial<PortalTask>): PortalTask {
  return { id: "t1", title: "Add dates to your photos", status: "open", dueOn: "2026-10-27", completedAt: null, blockerNote: null, intakeResponseId: null, ...overrides };
}

function card(overrides: Partial<PortalDocumentCard>): PortalDocumentCard {
  return {
    key: "k1",
    title: "Passport, bio page",
    personName: "Casey Nguyen",
    meta: "",
    versionLabel: "",
    when: "",
    labels: ["Uploaded", "Accepted"],
    needsYou: false,
    countsAsAccepted: true,
    canDownload: true,
    alert: null,
    alertLang: "en",
    versionId: null,
    expectedVersion: null,
    requestId: null,
    requestVersion: null,
    documentId: null,
    matterId: "m1",
    personId: "p1",
    refId: null,
    purpose: "passport",
    sensitivity: "standard",
    audience: "client",
    canReview: false,
    ...overrides,
  };
}

function invoice(overrides: Partial<PortalInvoice>): PortalInvoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: "INV-0218",
    description: "",
    matterTitle: "Work permit",
    amountCents: 113000,
    paidCents: 0,
    refundedCents: 0,
    creditedCents: 0,
    currency: "cad",
    status: "open",
    issuedOn: "2026-10-01",
    dueOn: "2026-11-06",
    open: true,
    processing: false,
    state: { tone: "", label: "Open" },
    receipts: [],
    creditNotes: [],
    ...overrides,
  };
}

function chat(messages: Partial<ChatMessage>[]): ChatData {
  return {
    mode: "portal",
    organizationId: viewer.organizationId,
    firmName: "Example Firm",
    timezone: "America/Toronto",
    now: "2026-10-24T13:00:00Z",
    threads: [],
    messages: messages.map((message, index) => ({
      id: `msg${index}`,
      threadId: "th1",
      body: "",
      createdAt: "2026-10-24T12:55:00Z",
      mine: false,
      authorName: "Dana Consultant",
      authorKind: "staff",
      requiresAck: false,
      acknowledged: false,
      acknowledgedBy: [],
      readBy: [],
      unread: true,
      attachments: [],
      ...message,
    })),
    selectedId: null,
    opened: false,
    matters: [],
    audienceOptions: [],
    documents: [],
    selfPersonId: "p1",
    matterId: null,
  };
}

function input(overrides: Partial<HomeInput> = {}): HomeInput {
  return {
    firmName: "Example Firm",
    personName: "Casey Nguyen",
    timezone: "America/Toronto",
    now: new Date("2026-10-24T13:00:00Z"),
    matter: viewer.matters[0],
    consultant: "Dana Consultant",
    tasks: [],
    documents: [],
    invoices: [],
    messages: null,
    ...overrides,
  };
}

function render(view: ReturnType<typeof homeView> | null, who: PortalViewer = viewer) {
  return renderToStaticMarkup(createElement(LivePortal, { page: "home", viewer: who, home: view, taskCount: 2, unread: 1, logo: null }));
}

describe("portal Home: what it shows", () => {
  it("leads with the earliest open task, due date and link", () => {
    const view = homeView(
      input({
        tasks: [
          task({ id: "late", title: "Later task", dueOn: "2026-11-02" }),
          task({ id: "soon", title: "Add dates to your photos", dueOn: "2026-10-27", intakeResponseId: "22222222-2222-4222-8222-222222222222" }),
          task({ id: "done", title: "Done task", status: "done", dueOn: "2026-10-20" }),
        ],
      }),
    );
    expect(view.next.title).toBe("Add dates to your photos");
    expect(view.next.eyebrow).toBe("Your next step · due Tue 27 Oct");
    expect(view.next.href).toBe("/portal/intake?response=22222222-2222-4222-8222-222222222222");
    expect(view.strip.todo).toBe("2 tasks");
    expect(view.strip.byWhen).toBe("Tue 27 Oct");
    expect(view.strip.who).toBe("Dana Consultant");
    expect(view.strip.whatNext).toBe("You send your documents");
  });

  it("falls back to a requested document, then a bill, then a calm hero", () => {
    const upload = homeView(input({ documents: [card({ key: "r", title: "Marriage certificate", labels: ["Requested"], needsYou: true, countsAsAccepted: false })] }));
    expect(upload.next.title).toBe("Upload Marriage certificate");
    expect(upload.next.href).toBe("/portal/upload");

    const bill = homeView(input({ invoices: [invoice({})] }));
    expect(bill.next.title).toBe("Pay invoice INV-0218");
    expect(bill.next.action).toBe("Pay");
    expect(bill.strip.todo).toBe("1 payment");
    expect(homeView(input({ tasks: [task({})], invoices: [invoice({})] })).strip.todo).toBe("2 things");
    expect(bill.invoice).toEqual({
      title: "Invoice INV-0218 · balance",
      detail: "Paid to Example Firm · due 6 Nov",
      amount: "CAD 1,130.00",
      href: "/portal/pay?invoice=11111111-1111-4111-8111-111111111111",
    });

    const calm = homeView(input({ consultant: null }));
    expect(calm.next.calm).toBe(true);
    expect(calm.next.title).toBe("Nothing needs you right now");
    expect(calm.strip.todo).toBe("Nothing right now");
    expect(calm.strip.byWhen).toBe("No date set");
    expect(calm.strip.who).toBe("Example Firm");
  });

  it("puts the tracker on the matter's stage", () => {
    const states = (stage: string) => homeView(input({ matter: { ...viewer.matters[0], stage } })).steps?.map((step) => step.state[0]).join("");
    expect(states("engagement pending")).toBe("cttttttt");
    expect(states("evidence collection")).toBe("ddcttttt");
    expect(states("consultant review")).toBe("dddctttt");
    expect(states("government processing")).toBe("ddddddct");
    expect(states("closed")).toBe("dddddddd");
    expect(homeView(input({ matter: null })).steps).toBeNull();
    expect(homeView(input({ matter: { ...viewer.matters[0], onHold: true } })).strip.whatNext).toBe("Your file is on hold for now");
  });

  it("splits sent documents into accepted and waiting, and shows the latest message from the firm", () => {
    const view = homeView(
      input({
        documents: [
          card({ key: "a", title: "Passport, bio page" }),
          card({ key: "b", title: "Marriage certificate", labels: ["Uploaded", "Being reviewed"], countsAsAccepted: false }),
          card({ key: "c", title: "Relationship photos", labels: ["Uploaded", "Changes needed"], countsAsAccepted: false, needsYou: true }),
          card({ key: "d", title: "Police certificate", labels: ["Requested"], countsAsAccepted: false, needsYou: true }),
        ],
        messages: chat([
          { body: "Older note", createdAt: "2026-10-20T10:00:00Z" },
          { body: "Your passport is accepted.\nNext we need the photo dates.", createdAt: "2026-10-24T12:55:00Z" },
          { body: "My own reply", createdAt: "2026-10-24T12:58:00Z", mine: true, authorName: "Casey Nguyen" },
        ]),
      }),
    );
    expect(view.docs.accepted.map((doc) => doc.title)).toEqual(["Passport, bio page"]);
    expect(view.docs.pending).toEqual([
      { key: "b", title: "Marriage certificate", label: "Being reviewed", tone: "rev" },
      { key: "c", title: "Relationship photos", label: "Changes needed", tone: "chg" },
    ]);
    expect(view.message).toEqual({ author: "Dana Consultant", preview: "Your passport is accepted. Next we need the photo dates.", when: "08:55" });
  });

  it("formats a due day without shifting it across time zones", () => {
    expect(shortDay("2026-10-20")).toBe("Tue 20 Oct");
  });
});

describe("portal Home: the designed layout", () => {
  it("renders the hero, strip, tracker, documents panel and sidebar chrome", () => {
    const html = render(
      homeView(
        input({
          tasks: [task({})],
          documents: [card({}), card({ key: "b", title: "Marriage certificate", labels: ["Uploaded", "Being reviewed"], countsAsAccepted: false })],
          invoices: [invoice({})],
          messages: chat([{ body: "Next we need the photo dates." }]),
        }),
      ),
    );
    expect(html).toContain('class="next rv"');
    expect(html).toContain("Hi Casey.");
    expect(html).toContain('href="/portal/tasks"');
    expect(html).toContain('class="q4 panel rv"');
    expect(html).toContain("Who is working on it?");
    expect(html).toContain('class="steps"');
    expect(html).toContain('class="c" aria-current="step"><span>Documents</span>');
    expect(html).toContain("There’s no live link to IRCC, and nothing here is a decision.");
    expect(html).toContain("Documents you’ve sent");
    expect(html).toContain("Accepted by your consultant");
    expect(html).toContain('<span class="bd rev"><i></i>Being reviewed</span>');
    expect(html).toContain("Next we need the photo dates.");
    expect(html).toContain("CAD 1,130.00");
    // Sidebar: logo tile (initials without a logo), matter pill, badges, avatar, footer.
    expect(html).toContain('<span class="firmlogo">EF</span>');
    expect(html).toContain('class="mx"');
    expect(html).toContain('<span class="k b">2</span>');
    expect(html).toContain('<span class="k b">1</span>');
    expect(html).toContain('<span class="av" aria-hidden="true">CN</span>');
    expect(html).toContain("Applicant");
    expect(html).toContain("Powered by Casevoya");
    expect(html).toContain("EX-2026-0007");
  });

  it("renders the firm's logo when there is one", () => {
    const html = renderToStaticMarkup(createElement(LivePortal, { page: "home", viewer, logo: "https://example.test/logo.png" }));
    expect(html).toContain('<span class="firmlogo"><img src="https://example.test/logo.png"');
  });

  it("renders the empty file: calm hero and empty panels, no tracker without a matter", () => {
    const empty: PortalViewer = { ...viewer, person: null, matters: [], people: [] };
    const html = render(null, empty);
    expect(html).toContain("Nothing needs you right now");
    expect(html).toContain("Nothing accepted yet.");
    expect(html).toContain("Nothing waiting for review.");
    expect(html).toContain("No messages yet");
    expect(html).toContain("Nothing to pay");
    expect(html).not.toContain('class="steps"');
    expect(html).not.toContain('class="mx"');
  });
});
