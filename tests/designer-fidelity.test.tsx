import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SheetFrame, type RbarData } from "@/components/sheet/designer/frame";
import { SheetHome, type HomeData } from "@/components/sheet/designer/home";
import { MattersTopBar, SheetMatters, type MattersData } from "@/components/sheet/designer/matters";
import { SheetSidebar, type SidebarData } from "@/components/sheet/designer/sidebar";
import { IndexMarkup } from "@/components/sheet/markup/index";
import { MattersMarkup } from "@/components/sheet/markup/matters";
import { SampleModeMarkup } from "@/components/sheet/markup/sample-mode";
import { SampleCasePanel, type SampleCaseData } from "@/components/sheet/designer/sample-case";
import { SheetTasks, TasksDialog, TasksHeader, type TasksData, type TasksTab } from "@/components/sheet/designer/tasks";
import { TasksMarkup } from "@/components/sheet/markup/tasks";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock("@/modules/sheet/sample-actions", () => ({ recordSampleStep: async () => ({ ok: true }) }));

/**
 * The data-driven Designer components must produce the same HTML as the captured
 * Designer markup when they are given the Designer's own sample values. The sample
 * values live only in this test; the app never renders them.
 */
function region(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  expect(start, `missing ${open}`).toBeGreaterThanOrEqual(0);
  const end = html.indexOf(close, start);
  return html.slice(start, end + close.length);
}

const DESIGNER_SIDEBAR: SidebarData = {
  active: "/sheet",
  counts: { notifications: 5, drafts: 3, tasks: 7, inbox: 4, finance: 2, pipeline: 10, sourcesReview: 2 },
  pinned: [
    { href: "/sheet/matters/priya", name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png" },
    { href: "/sheet/matters?q=Kofi", name: "Kofi Mensah", avatarUrl: "/assets/av-kofi-client.png" },
  ],
  me: { name: "Amara Osei", role: "Licensed consultant", avatarUrl: "/assets/av-amara-consultant.png" },
  tiles: { documents: "/sheet/matters/priya?tab=documents", invoices: "/sheet/matters/priya?tab=billing" },
  newMatter: { href: "#", toast: "New matter", toastSub: "Starts from a versioned program template (prototype)." },
  createBoard: { href: "#", toast: "Create board", toastSub: "Saves the current filters as a board (prototype)." },
};

const AMARA = { name: "Amara Osei", avatarUrl: "/assets/av-amara-consultant.png" };

const DESIGNER_HOME: HomeData = {
  greeting: "Good morning, Amara.",
  summary: "Friday 16 October, Toronto. Two documents are waiting for you, and one deadline needs confirming before 2pm.",
  quick: {
    lead: "/sheet/pipeline",
    document: "/sheet/matters/priya?tab=documents",
    consultation: "/sheet/calendar",
    invoice: "/sheet/matters/priya?tab=billing",
    draft: "/sheet/drafts",
  },
  gauge: [
    { label: "Accepted by firm", count: 96, color: "#0075DE" },
    { label: "Awaiting review", count: 23, color: "#62aef0" },
    { label: "Requested", count: 11, color: "#d9d5d0" },
  ],
  needs: [
    { href: "/sheet/matters?view=due", count: 4, label: "tasks due today" },
    { href: "/sheet/matters?view=review", count: 23, label: "documents awaiting review" },
    { href: "/sheet/matters?view=blocked", count: 2, label: "blocked matters" },
    { href: "/sheet/matters/priya?tab=billing", count: 1, label: "financial exception" },
  ],
  byDeadline: [
    { href: "/sheet/matters/priya", name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png", date: "30 Oct" },
    { href: "/sheet/matters?q=Kofi", name: "Kofi Mensah", avatarUrl: "/assets/av-kofi-client.png", date: "2 Nov" },
    { href: "#", name: "Tom\u00e1s Duarte", avatarUrl: "/assets/av-tomas-client.png", date: "9 Nov" },
    { href: "#", name: "Grace Okafor", avatarUrl: "/assets/av-graceo-client.png", date: "14 Nov" },
    { href: "#", name: "Ana Ferreira", avatarUrl: "/assets/av-ana-client.png", date: "21 Nov" },
  ],
  tasks: [
    { href: "/sheet/matters/priya?tab=documents", title: "Review marriage certificate fields", who: "Priya Sharma", when: "Today 11:00", badge: { tone: "rev", label: "Awaiting review" }, owner: AMARA },
    { href: "/sheet/government", title: "Confirm biometrics deadline", who: "Kofi Mensah", when: "Today 14:00", badge: { tone: "chg", label: "Unverified" }, owner: AMARA },
    { href: "/sheet/matters/priya?tab=billing", title: "Approve earned-fee transfer (2nd approver)", who: "Kofi Mensah", when: "Money", badge: { tone: "bad", label: "Today" }, owner: { name: "Lena", avatarUrl: "/assets/av-lena-finance.png" } },
    { href: "/sheet/drafts", title: "Send proposal", who: "Tom\u00e1s Duarte", when: "Lead", badge: { tone: "gr", label: "Tue 20" }, owner: AMARA },
  ],
};

const DESIGNER_RBAR: RbarData = {
  month: "October 2026",
  // The capture shows four blanks, which puts 1 October 2026 on a Friday; it was a Thursday.
  // The live calendar computes the real offset (see sheet-home-present tests).
  leading: 4,
  days: Array.from({ length: 31 }, (_, index) => ({ day: index + 1, today: index + 1 === 16, marked: index + 1 === 20 || index + 1 === 30 })),
  today: [
    { time: "10:30", title: "Consultation", who: "Ana Ferreira", note: "Zoom (planned integration)", href: "/sheet/calendar" },
    { time: "14:00", title: "Confirm deadline", who: "Kofi Mensah", note: "OCR date, tentative", tentative: true, href: "/sheet/government" },
  ],
  notifications: [
    { title: "Rafael uploaded 3 photos", source: "Priya Sharma", ago: "8 min" },
    { title: "Agreement v2 signed by Tom\u00e1s", source: "DocuSign", ago: "1 h" },
    { title: "Advance received, CAD 1,500", source: "Pending reconciliation", ago: "2 h" },
  ],
  vo: { draft: "Reply to Sofia Reyes offering Tuesday 11:00 or Wednesday 15:00.", sources: "Sources: firm calendar, template T-04" },
};

const AV = (name: string, file: string) => ({ name, avatarUrl: `/assets/${file}.png` });
const AMARA_AV = AV("Amara Osei", "av-amara-consultant");
const DANIEL_AV = AV("Daniel Ruiz", "av-daniel-casemanager");

const DESIGNER_MATTERS: MattersData = {
  title: "Matters",
  counts: { active: 18, blocked: 2, mine: 4, everyone: 6 },
  rows: [
    { client: AV("Priya Sharma", "av-priya-applicant"), reference: "NL-2026-0142", program: "Spousal sponsorship", stage: { tone: "blue", label: "Evidence collection" }, government: { tone: "unv", label: "Not submitted" }, money: "Advance held", nextDeadline: "30 Oct", consultant: AMARA_AV },
    { client: AV("Kofi Mensah", "av-kofi-client"), reference: "NL-2026-0131", program: "Express Entry PR", stage: { tone: "blue", label: "Government processing" }, government: { tone: "ok", label: "Submitted", detail: "verified" }, money: "Paid", nextDeadline: "2 Nov", consultant: AMARA_AV },
    { client: AV("Tom\u00e1s Duarte", "av-tomas-client"), reference: "NL-2026-0150", program: "PR, family", stage: { tone: "blue", label: "Intake" }, government: { tone: "unv", label: "\u2014" }, money: "Invoice issued", nextDeadline: "9 Nov", consultant: DANIEL_AV },
    { client: AV("Grace Okafor", "av-graceo-client"), reference: "NL-2026-0128", program: "Study permit", stage: { tone: "blue", label: "Consultant review" }, government: { tone: "unv", label: "Not submitted" }, money: "Partially paid", nextDeadline: "14 Nov", consultant: AMARA_AV },
    { client: AV("Ana Ferreira", "av-ana-client"), reference: "NL-2026-0155", program: "Visitor record", stage: { tone: "blue", label: "Engagement pending" }, government: { tone: "unv", label: "\u2014" }, money: "Quote sent", nextDeadline: "21 Nov", consultant: DANIEL_AV },
    { client: { name: "Mei Tanaka" }, reference: "NL-2026-0119", program: "Work permit", stage: { tone: "blue", label: "Submitted" }, government: { tone: "chg", label: "Submission unverified" }, money: "Paid", nextDeadline: "\u2014", consultant: AMARA_AV },
  ],
  shown: 6,
  total: 18,
  more: "#",
  empty: null,
};

const DANIEL_ROW = { person: DANIEL_AV, label: "Daniel" };
const LENA_ROW = { person: AV("Lena Park", "av-lena-finance"), label: "Lena" };
const AMARA_ROW = { person: AMARA_AV, label: "Amara" };
const NORMAL = { tone: "gr", label: "Normal" } as const;

const DESIGNER_TASKS: TasksData = {
  tab: "internal",
  counts: { open: 7, escalated: 1 },
  internal: {
    alert: {
      title: "call Kofi Mensah about the bounced deadline notice",
      detail: "Overdue critical task, escalated to Amara Osei (consultant) and the owner.",
      href: "/sheet/inbox?tab=bounced",
    },
    rows: [
      { title: "Call Kofi about bounced notice", matter: "NL-2026-0131", owner: DANIEL_ROW, due: "Today 12:00 ET", priority: { tone: "bad", label: "Critical" }, dependsOn: "\u2014", state: { tone: "bad", label: "Escalated" } },
      { title: "Review marriage certificate v2", matter: "NL-2026-0142", owner: DANIEL_ROW, due: "Mon 19 Oct", priority: { tone: "chg", label: "High" }, dependsOn: "\u2014", state: { tone: "blue", label: "In progress" } },
      { title: "Approve earned-fee transfer CAD 300", matter: "NL-2026-0142", owner: LENA_ROW, due: "Mon 19 Oct", priority: NORMAL, dependsOn: "Amara approved \u2713", state: "Waiting for you" },
      { title: "Verify RBC-55102 payment", matter: "NL-2026-0131", owner: LENA_ROW, due: "Tue 20 Oct", priority: NORMAL, dependsOn: "\u2014", state: "Open" },
      { title: "Consultant review of package v3", matter: "NL-2026-0142", owner: AMARA_ROW, due: "Wed 28 Oct", priority: { tone: "chg", label: "High" }, dependsOn: "Police certificate accepted", state: { tone: "gr", label: "Blocked" } },
      { title: "Re-check Grace Lin\u2019s licence", matter: "\u2014", owner: AMARA_ROW, due: "Thu 22 Oct", priority: NORMAL, dependsOn: "\u2014", state: "Open" },
    ],
  },
  client: {
    rows: [
      { title: "Upload police certificate (India)", person: "Priya Sharma", due: { num: "Fri 30 Oct" }, reminders: { offsets: [14, 7, 3, 1], quietHours: true }, state: { tone: "rev", label: "Requested" } },
      { title: "Sign amendment 1", person: "Priya Sharma", due: { num: "Thu 29 Oct" }, reminders: { offsets: [3, 1], quietHours: false }, state: { tone: "blue", label: "Opened" } },
      { title: "Add dates to relationship photos", person: "Rafael Sharma", due: { num: "Wed 21 Oct" }, reminders: null, state: { tone: "chg", label: "Changes requested" } },
      { title: "Give consent for your own records", person: "Olena Sharma", due: "Done 10 Oct", reminders: null, state: { tone: "ok", label: "Done" } },
    ],
  },
  deadlines: {
    rows: [
      { label: "Respond to IRCC request", matter: "NL-2026-0142", source: "IRCC letter, received 12 Oct", local: { left: "Fri 30 Oct 17:00 ET", right: "same zone" }, verifiedBy: "Amara Osei, 13 Oct", state: { tone: "ok", label: "Verified" } },
      { label: "Medical exam", matter: "NL-2026-0131", source: "OCR from uploaded letter", local: { left: "Mon 2 Nov", right: "official time UTC" }, verifiedBy: "\u2014", state: { tone: "chg", label: "Tentative, confirm" } },
    ],
  },
  dialog: {
    owners: ["Daniel Ruiz", "Amara Osei", "Lena Park"],
    dependsOn: ["Police certificate accepted", "Agreement signed"],
    create: { toast: "Task created", kind: "ok" },
  },
};

function withoutPreloads(html: string): string {
  return html.replace(/<link rel="preload"[^>]*\/>/g, "");
}

describe("Designer fidelity", () => {
  it("renders the whole home page exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(IndexMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: DESIGNER_SIDEBAR,
          top: { firmName: "Northline Immigration", pills: ["Updated 2 min ago", "Your matters: 18"] },
          rbar: DESIGNER_RBAR,
          statusbar: {
            timezone: "America/Toronto",
            queue: { label: "Reminder queue healthy", detail: "0 retries" },
            sample: { label: "Demo data", detail: "fictional firm \u201cNorthline Immigration\u201d" },
          },
        }, createElement(SheetHome, { data: DESIGNER_HOME })),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 120, i + 160) + "\nGOT " + live.slice(i - 120, i + 160));
    }
    expect(live).toBe(captured);
  });

  it("renders the sidebar exactly as the captured Designer markup", () => {
    const captured = region(renderToStaticMarkup(createElement(IndexMarkup)), '<aside class="side"', "</aside>");
    const live = region(renderToStaticMarkup(createElement(SheetSidebar, { data: DESIGNER_SIDEBAR })), '<aside class="side"', "</aside>");
    expect(live).toBe(captured);
  });

  it("shows a new firm's own name and the Designer's empty states, with no sample people", () => {
    const html = renderToStaticMarkup(
      createElement(SheetFrame, {
        sidebar: {
          active: "/sheet",
          counts: {},
          pinned: [],
          me: { name: "Dana Lee", role: "Firm owner" },
          tiles: { documents: "/sheet/documents", invoices: "/sheet/finance" },
          newMatter: { href: "/sheet/matters?new=1" },
          createBoard: { href: "/sheet/queue" },
        },
        top: { firmName: "Maple Immigration", pills: ["Your matters: 0"] },
        rbar: { month: "October 2026", leading: 3, days: [{ day: 1 }], today: [], notifications: [], vo: null },
        statusbar: { timezone: "America/Toronto" },
      }, createElement(SheetHome, {
          data: {
            ...DESIGNER_HOME,
            greeting: "Good morning, Dana.",
            summary: "Saturday 17 October, Toronto. Nothing is waiting for your review.",
            gauge: DESIGNER_HOME.gauge.map((segment) => ({ ...segment, count: 0 })),
            needs: [],
            byDeadline: [],
            tasks: [],
          },
        })),
    );
    expect(html).toContain("Maple Immigration");
    expect(html).toContain("Nothing needs you today");
    expect(html).toContain("Nothing scheduled");
    expect(html).toContain("No new activity");
    expect(html).toContain('<span class="av" aria-hidden="true">DL</span>');
    expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Olena|Rafael|Tom\u00e1s|Tomás|DocuSign|prototype|Demo data/);
    expect(html).not.toContain('data-ai="ok"');
  });

  it("renders the Matters list exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(MattersMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/matters" },
          header: createElement(MattersTopBar, { counts: DESIGNER_MATTERS.counts }),
          statusbar: {
            timezone: "America/Toronto",
            queue: { label: "Reminder queue healthy", detail: "0 retries" },
            sample: { label: "Demo data", detail: "fictional firm \u201cNorthline Immigration\u201d" },
          },
        }, createElement(SheetMatters, { data: DESIGNER_MATTERS })),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 120, i + 160) + "\nGOT " + live.slice(i - 120, i + 160));
    }
    expect(live).toBe(captured);
  });

  it("renders the sample-mode content exactly as the captured Designer markup", () => {
    const sample: SampleCaseData = {
      applicant: "Priya",
      steps: [
        { key: "intake", image: "intake", title: "Send an intake form", note: "Priya fills in her history", href: "/sheet/matters/priya?tab=intake", done: true },
        { key: "agreement", image: "agreement", title: "Send a service agreement", note: "Signing order: Priya, then Rafael", href: "/sheet/portal-agreements", done: true },
        { key: "upload", image: "upload", title: "Request and review an upload", note: "Marriage certificate", href: "/sheet/matters/priya?tab=documents", done: false },
        { key: "reminder", image: "reminder", title: "Schedule a reminder", note: "Police certificate due in 14 days", href: "/sheet/automations", done: false },
        { key: "invoice", image: "invoice", title: "Issue an invoice", note: "From Northline to Priya", href: "/sheet/matters/priya?tab=billing", done: false },
        { key: "export", image: "export", title: "Export the file", note: "ZIP with the audit trail", href: "/sheet/two-step?step=6", done: false },
      ],
      licence: { holder: "Amara Osei", status: "waiting for review" },
    };
    const content = (html: string) => region(html, '<div id="content">', '<aside id="rbar"');
    const captured = withoutPreloads(content(renderToStaticMarkup(createElement(SampleModeMarkup))));
    const live = withoutPreloads(
      content(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: DESIGNER_SIDEBAR,
            top: { firmName: "Northline Immigration", pills: [] },
            rbar: DESIGNER_RBAR,
            statusbar: { timezone: "America/Toronto" },
          }, createElement(SheetHome, {
            data: {
              ...DESIGNER_HOME,
              greeting: "Welcome to Northline, Amara.",
              summary: "You\u2019re exploring with sample data. Everyone here is fictional, so nothing you send reaches a real person.",
            },
            lead: createElement(SampleCasePanel, { data: sample }),
          })),
        ),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
    }
    expect(live).toBe(captured);
  });

  for (const tab of ["internal", "client", "deadlines"] as TasksTab[]) {
    it(`renders the Tasks page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(TasksMarkup, { variant: `tab-${tab}` })));
      const data = { ...DESIGNER_TASKS, tab };
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/tasks" },
            header: createElement(TasksHeader, { tab, counts: data.counts }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm \u201cNorthline Immigration\u201d" },
            },
            overlay: createElement(TasksDialog, { data: data.dialog }),
          }, createElement(SheetTasks, { data })),
        ),
      );
      if (live !== captured) {
        let i = 0;
        while (i < live.length && live[i] === captured[i]) i++;
        console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
      }
      expect(live).toBe(captured);
    });
  }

  it("shows a firm without tasks the Designer's empty states, with no sample people", () => {
    for (const tab of ["internal", "client", "deadlines"] as TasksTab[]) {
      const html = renderToStaticMarkup(
        createElement(SheetTasks, { data: { tab, counts: { open: 0, escalated: 0 }, internal: { alert: null, rows: [] }, client: { rows: [] }, deadlines: { rows: [] }, dialog: { owners: ["Dana Lee"], dependsOn: [], create: { toast: "x", kind: "warn" } } } }),
      );
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Olena|Rafael|Daniel|Lena|NL-2026/);
    }
  });
});
