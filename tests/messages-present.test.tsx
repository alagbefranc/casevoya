import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "@/components/messages/chat";
import { renderEmail } from "@/modules/email/templates";
import {
  audienceLine,
  dayLabel,
  groupByDay,
  listTime,
  messageError,
  previewOf,
  sortThreads,
  type ChatData,
  type ChatMessage,
  type ChatThread,
} from "@/modules/messages/present";
import { notificationGroups, readItems, shortDate, type NotificationItem } from "@/modules/sheet/notifications-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("@/modules/messages/actions", () => ({
  sendMessage: async () => ({ ok: true }),
  markThreadRead: async () => ({ ok: true }),
  acknowledgeMessage: async () => ({ ok: true }),
}));
vi.mock("@/modules/documents/actions", () => ({ authorizeDocumentDownload: async () => ({ error: "x" }) }));

const NOW = "2026-10-18T15:00:00Z";
const ZONE = "America/Toronto";

function message(id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    threadId: "t1",
    body: `Synthetic ${id}`,
    createdAt,
    mine: false,
    authorName: "Synthetic Consultant",
    authorKind: "staff",
    requiresAck: false,
    acknowledged: false,
    acknowledgedBy: [],
    readBy: [],
    unread: false,
    attachments: [],
    ...extra,
  };
}

describe("message presentation", () => {
  it("labels days in the reader's zone: Today, Yesterday, then the date", () => {
    expect(dayLabel("2026-10-18T13:00:00Z", NOW, ZONE)).toBe("Today");
    // 01:30 UTC on the 18th is still the 17th in Toronto.
    expect(dayLabel("2026-10-18T01:30:00Z", NOW, ZONE)).toBe("Yesterday");
    expect(dayLabel("2026-10-12T15:00:00Z", NOW, ZONE)).toBe("Mon 12 Oct");
    expect(dayLabel("2025-10-12T15:00:00Z", NOW, ZONE)).toBe("Sun 12 Oct 2025");
    expect(listTime("2026-10-18T13:05:00Z", NOW, ZONE)).toBe("09:05");
    expect(listTime("2026-10-12T15:00:00Z", NOW, ZONE)).toBe("12 Oct");
  });

  it("groups messages oldest first by day, whatever order they arrive in", () => {
    const groups = groupByDay(
      [message("c", "2026-10-18T14:00:00Z"), message("a", "2026-10-16T14:00:00Z"), message("b", "2026-10-18T01:00:00Z")],
      NOW,
      ZONE,
    );
    expect(groups.map((group) => [group.label, group.messages.map((row) => row.id)])).toEqual([
      ["Fri 16 Oct", ["a"]],
      ["Yesterday", ["b"]],
      ["Today", ["c"]],
    ]);
  });

  it("says who can read a conversation, and who cannot, before sending", () => {
    expect(audienceLine({ mode: "portal", firmName: "Maple", audience: [], excluded: ["Rafael", "Olena"] })).toEqual({
      visible: "You and Maple staff on your file",
      hidden: "Not Rafael or Olena",
    });
    expect(audienceLine({ mode: "portal", firmName: "Maple", audience: ["Priya", "Rafael"], excluded: [], selfName: "Priya" }).visible).toBe(
      "You, Rafael and Maple staff on your file",
    );
    expect(audienceLine({ mode: "staff", firmName: "Maple", audience: ["Priya Sharma"], excluded: ["Rafael Sharma"] })).toEqual({
      visible: "Priya Sharma and staff on this matter",
      hidden: "Not Rafael Sharma",
    });
  });

  it("orders threads newest first and shortens previews", () => {
    const base = { matterId: "m", matterTitle: "M", title: "T", audience: [], audienceIds: [], excluded: [], preview: "", unread: 0, sample: false };
    const threads: ChatThread[] = [
      { ...base, id: "old", lastAt: "2026-10-01T00:00:00Z" },
      { ...base, id: "new", lastAt: "2026-10-18T00:00:00Z" },
    ];
    expect(sortThreads(threads).map((row) => row.id)).toEqual(["new", "old"]);
    expect(previewOf("a\n\nb   c")).toBe("a b c");
    expect(previewOf("x".repeat(200))).toHaveLength(90);
  });

  it("says database refusals plainly, never the database text", () => {
    expect(messageError("message rate limit reached")).toMatch(/wait a few minutes/);
    expect(messageError("a document in this message is not shared with everyone who can read it")).toMatch(/can’t be shared/);
    expect(messageError("some internal SQL detail")).toBe("That didn’t go through. Nothing was sent.");
  });
});

const DATA: ChatData = {
  mode: "portal",
  organizationId: "00000000-0000-4000-8000-000000000001",
  firmName: "Maple Example Immigration",
  timezone: ZONE,
  now: NOW,
  threads: [
    {
      id: "t1",
      matterId: "m1",
      matterTitle: "Synthetic matter",
      title: "Synthetic Consultant",
      audience: ["Synthetic Applicant"],
      audienceIds: ["p1"],
      excluded: ["Synthetic Sponsor"],
      lastAt: "2026-10-18T13:00:00Z",
      preview: "Synthetic b",
      unread: 1,
      sample: false,
    },
  ],
  messages: [
    message("a", "2026-10-17T13:00:00Z", { mine: true, authorKind: "client", authorName: "Synthetic Applicant" }),
    message("b", "2026-10-18T13:00:00Z", {
      requiresAck: true,
      unread: true,
      attachments: [{ documentId: "d1", label: "Synthetic passport", versionId: "v1", href: null }],
    }),
  ],
  selectedId: "t1",
  opened: true,
  matters: [{ id: "m1", title: "Synthetic matter" }],
  audienceOptions: [],
  documents: [],
  selfPersonId: "p1",
  matterId: null,
};

describe("chat view structure (redesigned as a chat view at the owner's request, 2026-10-18)", () => {
  it("renders the conversation list, a live log grouped by day, the audience above a labelled composer", () => {
    const html = renderToStaticMarkup(createElement(ChatView, { data: DATA }));
    expect(html).toContain('<section class="cv" data-view="thread" aria-label="Messages">');
    expect(html).toContain('<aside class="cv-list" aria-label="Conversations">');
    expect(html).toMatch(/<button type="button" class="cv-tr un" aria-current="true">/);
    expect(html).toContain('<span class="cv-badge" aria-label="1 unread">1</span>');
    expect(html).toMatch(/class="cv-log" role="log" aria-live="polite" aria-label="Messages with Synthetic Consultant"/);
    // Days in order, the unread marker before the first unread message.
    const yesterday = html.indexOf(">Yesterday<");
    const today = html.indexOf(">Today<");
    expect(yesterday).toBeGreaterThan(0);
    expect(today).toBeGreaterThan(yesterday);
    expect(html.indexOf('class="cv-new"')).toBeGreaterThan(today);
    // Mine on the right, theirs with the sender's name and initial.
    expect(html).toContain('<div class="cv-row me">');
    expect(html).toContain('<span class="cv-who">Synthetic Consultant</span>');
    // A critical instruction with its Acknowledge button; an attachment chip.
    expect(html).toContain("Critical instruction");
    expect(html).toContain(">Acknowledge</button>");
    expect(html).toMatch(/class="cv-chip">.*Synthetic passport<\/button>/);
    // Audience shown before sending; composer labelled and described by it.
    expect(html).toContain("Visible to: <b>You and Maple Example Immigration staff on your file</b>. Not Synthetic Sponsor.");
    expect(html).toContain('<label class="cv-sr" for="cv-input">Message</label>');
    expect(html).toMatch(/<textarea id="cv-input" class="cv-ta" rows="1" maxLength="4000" placeholder="Write a message" aria-describedby="cv-aud">/);
    expect(html).toMatch(/<button type="button" class="btn p cv-send" disabled="">Send<\/button>/);
    // A client never gets the critical-instruction option (staff only).
    expect(html).not.toContain("ask them to acknowledge");
  });

  it("shows staff the audience picker for a new conversation and the critical option, and an empty state", () => {
    const staff: ChatData = {
      ...DATA,
      mode: "staff",
      threads: [],
      messages: [],
      selectedId: null,
      matterId: "m1",
      audienceOptions: [{ personId: "p1", name: "Synthetic Applicant", role: "Applicant", email: true }],
    };
    const html = renderToStaticMarkup(createElement(ChatView, { data: staff }));
    expect(html).toContain("No conversations on this matter yet.");
    expect(html).toContain('<legend class="cv-sr">Who can read it</legend>');
    expect(html).toContain("Synthetic Applicant");
    expect(html).toContain("Choose who can read it before you write.");
    expect(html).toContain("Critical instruction: ask them to acknowledge it");
  });
});

describe("staff notifications presentation", () => {
  const items: NotificationItem[] = [
    { id: "1", kind: "message", occurred_at: "2026-10-18T13:40:00Z", matter_id: "m1", actor_name: "Synthetic Applicant", subject: null, detail: null, href: "/sheet/matters/m1?tab=messages&thread=t", read: false },
    { id: "2", kind: "document", occurred_at: "2026-10-18T12:00:00Z", matter_id: "m1", actor_name: "Synthetic Applicant", subject: "Relationship photos", detail: "v2", href: "/sheet/matters/m1?tab=documents", read: true },
    { id: "3", kind: "deadline", occurred_at: "2026-10-17T15:00:00Z", matter_id: "m1", actor_name: null, subject: "Respond to request", detail: "2026-10-30", href: "/sheet/matters/m1?tab=tasks", read: false },
    { id: "4", kind: "booking", occurred_at: "2026-10-17T14:00:00Z", matter_id: null, actor_name: "Synthetic Visitor", subject: "Consultation", detail: "2026-10-22T10:30", href: "/sheet/consultations", read: false },
    { id: "5", kind: "payment", occurred_at: "2026-10-17T13:00:00Z", matter_id: "m1", actor_name: null, subject: "INV-0001", detail: null, href: "/sheet/finance?tab=payments", read: false },
  ];
  // The loader names a matter by its reference and title (matterLabel).
  const name = () => "SF-2026-0001 (Synthetic matter)";

  it("drops malformed rows and links that leave the Sheet", () => {
    expect(readItems([...items, { id: "x", kind: "other" }, { ...items[0], href: "https://evil.example" }, null])).toHaveLength(5);
    expect(readItems("nope")).toEqual([]);
  });

  it("groups by the firm's day with the Designer's sentences", () => {
    const groups = notificationGroups({ items, tab: "all", now: NOW, timezone: ZONE, matterName: name });
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.id)])).toEqual([
      ["Today", ["1", "2"]],
      ["Yesterday", ["3", "4", "5"]],
    ]);
    const rows = groups.flatMap((group) => group.rows);
    expect(rows[0].parts).toEqual(["Synthetic sent a message on ", { b: "SF-2026-0001 (Synthetic matter)" }]);
    expect(rows[1].parts).toEqual(["Synthetic uploaded ", { b: "Relationship photos" }, " (v2)"]);
    expect(rows[2].parts).toEqual(["Deadline reminder for ", { b: "SF-2026-0001 (Synthetic matter)" }, ": Respond to request, due Fri 30 Oct"]);
    expect(rows[3].parts).toEqual(["Synthetic Visitor booked ", { b: "Consultation" }, ": Thu 22 Oct, 10:30"]);
    expect(rows[4].parts).toEqual(["Card payment received for ", { b: "INV-0001" }]);
    expect(rows.map((row) => row.unread)).toEqual([true, false, true, true, true]);
    expect(rows[0].time).toBe("09:40");
    expect(rows[4].lead).toBe("system");
  });

  it("System shows what Casevoya raises (deadline reminders and card payments); Mentions is empty until mentions exist", () => {
    expect(notificationGroups({ items, tab: "system", now: NOW, timezone: ZONE, matterName: name }).flatMap((g) => g.rows.map((r) => r.id))).toEqual(["3", "5"]);
    expect(notificationGroups({ items, tab: "mentions", now: NOW, timezone: ZONE, matterName: name })).toEqual([]);
    expect(shortDate("bad")).toBe("");
  });
});

describe("EX07 new message email", () => {
  it("maps the message template to EX07 and carries no message text", () => {
    const email = renderEmail({ template: "message", firm: "Maple", body: "Synthetic secret", text: "Synthetic secret" });
    expect(email.design).toBe("EX07");
    expect(email.subject).toBe("New message from Maple");
    expect(`${email.html} ${email.text} ${email.preheader}`).not.toContain("Synthetic secret");
    expect(email.html).toContain("/portal/messages");
  });
});
