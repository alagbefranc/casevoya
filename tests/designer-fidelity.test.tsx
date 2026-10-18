import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SheetFrame, type RbarData } from "@/components/sheet/designer/frame";
import { SheetHome, type HomeData } from "@/components/sheet/designer/home";
import { MattersTopBar, SheetMatters, type MattersData } from "@/components/sheet/designer/matters";
import {
  MatterDialogs,
  MatterOverview,
  MatterRbar,
  MatterTopBar,
  type MatterDialogsData,
  type MatterHeaderData,
  type MatterOverviewData,
  type MatterRbarData,
} from "@/components/sheet/designer/matter";
import { MATTER_CSS } from "@/components/sheet/designer/matter-css";
import { SheetSidebar, type SidebarData } from "@/components/sheet/designer/sidebar";
import { IndexMarkup } from "@/components/sheet/markup/index";
import { MatterMarkup } from "@/components/sheet/markup/matter";
import { MattersMarkup } from "@/components/sheet/markup/matters";
import { SampleModeMarkup } from "@/components/sheet/markup/sample-mode";
import { SampleCasePanel, type SampleCaseData } from "@/components/sheet/designer/sample-case";
import { SheetTasks, TasksDialog, TasksHeader, type TasksData, type TasksTab } from "@/components/sheet/designer/tasks";
import { TasksMarkup } from "@/components/sheet/markup/tasks";
import { SheetStaffTab, StaffAfter, StaffHeader, type StaffData, type StaffInviteDialogData } from "@/components/sheet/designer/invitations";
import { InvitationsMarkup } from "@/components/sheet/markup/invitations";
import { ClientsHeader, DuplicateDialog, SheetClients, type ClientsData, type ClientsTab } from "@/components/sheet/designer/clients";
import { ClientsMarkup } from "@/components/sheet/markup/clients";
import {
  AgreementsHeader,
  NewAgreementDialog,
  SheetAgreements,
  TemplateDialog,
  type AgreementsData,
  type NewAgreementDialogData,
} from "@/components/sheet/designer/agreements";
import { AgreementsMarkup } from "@/components/sheet/markup/agreements";

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
    owners: [{ label: "Daniel Ruiz" }, { label: "Amara Osei" }, { label: "Lena Park" }],
    dependsOn: [{ label: "Police certificate accepted" }, { label: "Agreement signed" }],
    create: { toast: "Task created", kind: "ok" },
  },
};

const PRIYA = AV("Priya Sharma", "av-priya-applicant");
const RAFAEL = AV("Rafael Sharma", "av-rafael-sponsor");
const OLENA = AV("Olena Sharma", "av-olena-dependant");

const DESIGNER_MATTER_HEADER: MatterHeaderData = {
  client: PRIYA,
  pills: ["Updated 16 min ago", "Source checked 12 Oct", "Opened 2 Sep 2026"],
  hold: null,
  tab: "overview",
};

const DESIGNER_MATTER: MatterOverviewData = {
  client: PRIYA,
  facts: ["NL-2026-0142", "Spousal sponsorship, outland", "Consultant Amara Osei"],
  badges: [
    { tone: "blue", label: "Stage", detail: "Evidence collection" },
    { tone: "unv", label: "Government", detail: "Not submitted" },
    { tone: "ok", label: "Money", detail: "Advance held CAD 1,500" },
    { tone: "chg", label: "Next deadline", detail: "Fri 30 Oct, 17:00 ET (verified)" },
  ],
  stage: { index: 2, total: 12, label: "Evidence collection" },
  documents: { accepted: 7, review: 3, outstanding: 4 },
  requests: [
    { person: PRIYA, title: "Marriage certificate", badge: { tone: "rev", label: "Awaiting review" } },
    { person: RAFAEL, title: "Proof of relationship — photos", badge: { tone: "chg", label: "Changes requested" } },
    { person: RAFAEL, title: "Sponsor proof of income (T4)", badge: { tone: "gr", label: "Requested" } },
    { person: PRIYA, title: "Police certificate (India)", badge: { tone: "gr", label: "Requested" } },
    { person: OLENA, title: "Olena — birth certificate", badge: { tone: "bad", label: "Expired" } },
  ],
  blockers: [
    { blocking: true, text: "Photos lack dates and places" },
    { blocking: false, text: "Sponsor T4 due in 6 days" },
  ],
  people: [
    { person: PRIYA, role: "Applicant" },
    { person: RAFAEL, role: "Sponsor" },
    { person: OLENA, role: "Dependent", locked: true },
  ],
  events: [
    { dot: "#c9c5c0", title: "Rafael uploaded 3 relationship photos", parts: ["Client portal", "Rafael Sharma (sponsor)"], badge: { tone: "unv", label: "Unreviewed" }, when: "Today 08:41" },
    { dot: "#0075DE", title: "Amara opened passport (download audited)", parts: ["Request req_8if2", "role consultant"], badge: { tone: "gr", label: "Read" }, when: "Today 08:12" },
    { dot: "#2e9d5b", title: "Advance reconciled", parts: ["Bank statement", "Lena (finance)"], badge: { tone: "ok", label: "Reconciled" }, when: "15 Oct" },
  ],
};

const DESIGNER_MATTER_RBAR: MatterRbarData = {
  vo: {
    draft: "Rafael’s photos don’t show dates. Draft request: “Please add a short note with the date and place for each photo.”",
    sources: "Sources: request DR-12, checklist v3",
  },
  agreement: { title: "Service agreement v2", state: "executed", parts: ["2 of 2 signed", "28 Sep", "DocuSign (planned)"] },
  representation: { title: "Use of representative form on file", note: "Recorded separately from the agreement" },
  note: { text: "Rafael prefers WhatsApp but we only use the portal for documents.", parts: ["Staff only", "Daniel"] },
};

const DESIGNER_MATTER_DIALOGS: MatterDialogsData = {
  current: 2,
  target: 3,
  version: 12,
  evidence: [null, null, null, { tone: "ok", label: "Evidence ready" }, ...Array.from({ length: 8 }, () => ({ tone: "chg" as const, label: "Evidence missing" }))],
  reason: "Required facts reviewed; photo blocker tracked as a task.",
  owners: [{ name: "Amara Osei" }, { name: "Daniel Ruiz" }],
  reviewOn: "2026-10-30",
  receivedOn: "2026-10-17",
};

const DESIGNER_STAFF: StaffData = {
  firmName: "Northline Immigration",
  rows: [
    { person: AMARA_AV, name: "Amara Osei", email: "amara@northline.example", role: { left: "Owner", right: "Licensed consultant" }, state: { tone: "ok", label: "Accepted" }, note: "Two-step on", action: { kind: "more" } },
    { person: DANIEL_AV, name: "Daniel Ruiz", email: "daniel@northline.example", role: "Case manager", state: { tone: "ok", label: "Accepted" }, note: "Two-step on", action: { kind: "more" } },
    { person: AV("Lena Park", "av-lena-finance"), name: "Lena Park", email: "lena@northline.example", role: "Finance", state: { tone: "ok", label: "Accepted" }, note: "Two-step on", action: { kind: "more" } },
    { person: AV("Grace Lin", "av-grace-consultant"), name: "Grace Lin", email: "grace@northline.example", role: "Licensed consultant", state: { tone: "rev", label: "Sent", detail: "expires 23 Oct" }, note: "Single use", action: { kind: "revoke" } },
    { person: { name: "Joon Park" }, name: "Joon Park", email: "j.park@northline.example", role: "Assistant", state: { tone: "chg", label: "Expired 14 Oct" }, note: "Single use", action: { kind: "resend" } },
  ],
};

const DESIGNER_STAFF_DIALOG: StaffInviteDialogData = {
  placeholder: "name@northline.example",
  roles: ["Case manager", "Licensed consultant", "Assistant", "Finance", "Practice manager"],
  offices: ["Toronto", "All offices"],
  expires: "24 Oct",
};

const DESIGNER_CLIENTS: ClientsData = {
  tab: "dir",
  counts: { people: 6, households: 2 },
  add: { href: "/sheet/invitations", label: "Invite a client" },
  tabs: { person: "Priya Sharma", household: "Sharma household" },
  dir: {
    copy: "Everyone your firm works with, one record per person. Two people who share an email stay separate, and nobody is merged without your confirmation.",
    rows: [
      { href: "?tab=person", person: AV("Priya Sharma", "av-priya-applicant"), role: "Applicant", matter: "NL-2026-0142", language: "Hindi, English", timezone: "Asia/Kolkata", portal: "Portal active" },
      { href: "?tab=person", person: AV("Rafael Sharma", "av-rafael-sponsor"), role: "Sponsor", matter: "NL-2026-0142", language: "English", timezone: "America/Toronto", portal: "Portal active" },
      { href: "?tab=person", person: AV("Olena Sharma", "av-olena-dependant"), role: "Adult dependant", matter: "NL-2026-0142", language: "English, Ukrainian", timezone: "America/Toronto", portal: { left: "Own login", right: "own consent" } },
      { href: "?tab=person", person: AV("Kofi Mensah", "av-kofi-client"), role: "Applicant", matter: "NL-2026-0131", language: "English", timezone: "America/Toronto", portal: "Portal active" },
      { href: "?tab=person", person: AV("Tomás Duarte", "av-tomas-client"), role: "Lead", matter: "Lead L6", language: "Spanish, English", timezone: "America/Toronto", portal: "Not invited" },
      { href: "?tab=person", person: AV("Ana Ferreira", "av-ana-client"), role: "Applicant", matter: "NL-2026-0129", language: "Portuguese", timezone: "America/Toronto", portal: "Portal active" },
    ],
    duplicate: {
      title: "Possible duplicate: Hamid Rahimi (2024) and Hamid Rahimi (lead L4)",
      detail: "Same name and date of birth, different email. Review before merging.",
      columns: ["2024 record", "Lead L4"],
      rows: [
        { label: "Name", values: ["Hamid Rahimi", "Hamid Rahimi"] },
        { label: "Date of birth", values: ["1990-06-02", "1990-06-02"] },
        { label: "Email", values: ["h.rahimi@example.com", "hamid.r@example.org"] },
        { label: "Phone", values: ["—", "+1 416 555 0144"] },
      ],
      merge: { toast: "Merged with history kept", kind: "ok", sub: "Both records’ history stays visible." },
    },
  },
  person: {
    name: "Priya Sharma",
    summary: "Applicant on NL-2026-0142. Language and timezone are stored for her and used in every reminder.",
    facts: [
      { fact: "Date of birth", value: { num: "1984-03-09" }, source: { left: "Passport v1, page 1", right: "OCR confirmed by Daniel" }, review: "Approved" },
      { fact: "Passport number", value: { num: "•••• 4821", suffix: "(masked)" }, source: "Passport v1", review: "Approved" },
      { fact: "Previous name", value: { text: "Priya Kapoor" }, source: "Intake answer, 3 Oct", review: "Approved" },
      { fact: "Address 2019–2021", value: { unknown: true }, source: "Intake: “I don’t know the exact dates”", review: { tone: "chg", label: "Review item: gap in history" } },
    ],
    superseded: [{ fact: "Address", old: "12 Lake Rd, Pune", new: "4 Park St, Pune", when: { left: "10 Oct", right: "old kept in history" } }],
    relationships: {
      rows: [
        { person: AV("Rafael Sharma", "av-rafael-sponsor"), label: { left: "Spouse", right: "sponsor" } },
        { person: AV("Olena Sharma", "av-olena-dependant"), label: { left: "Daughter", right: "adult dependant" } },
      ],
      note: "Being in the same household doesn’t give anyone access to Priya’s private records.",
    },
    matters: {
      rows: [
        { href: "/sheet/matters/priya", reference: "NL-2026-0142", role: "Applicant", state: { tone: "blue", label: "Evidence collection" } },
        { reference: "NL-2019-0044", role: "Visitor record", state: { tone: "ok", label: "Closed 2019", detail: "approved" } },
      ],
      note: ["Last portal sign-in 16 Oct, 21:04 IST", "2 tasks open", "1 invoice due 6 Nov."],
    },
    preferences: [
      { label: "Language", value: { left: "Hindi, English", right: "portal in English" } },
      { label: "Timezone", value: "Asia/Kolkata" },
      { label: "Contact", value: { left: "Portal and email", right: "no SMS" } },
      { label: "Marketing", value: "Not subscribed (separate from service messages)" },
    ],
  },
  household: {
    name: "Sharma household",
    copy: "How the people on this file are related, and what each can see. Selecting a name never grants access.",
    members: ["Priya", "Rafael", "Olena"],
    rows: [
      { record: "Shared application status", cells: ["Yes", "Yes", "Yes"] },
      { record: "Priya’s medical history", cells: ["Yes", { left: "No", right: "private" }, { left: "No", right: "private" }] },
      { record: "Rafael’s income documents", cells: [{ left: "No", right: "private" }, "Yes", { left: "No", right: "private" }] },
      { record: "Olena’s consent and documents", cells: [{ left: "No", right: "private" }, { left: "No", right: "private" }, "Yes"] },
      { record: "Invoices (Rafael pays)", cells: ["Yes", { left: "Yes", right: "paying gives no extra access" }, "No"] },
    ],
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

  it("renders the matter overview exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(MatterMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/matters/priya" },
          header: createElement(MatterTopBar, { data: DESIGNER_MATTER_HEADER }),
          aside: createElement(MatterRbar, { data: DESIGNER_MATTER_RBAR }),
          styles: MATTER_CSS,
          after: createElement(MatterDialogs, { data: DESIGNER_MATTER_DIALOGS }),
          statusbar: {
            timezone: "America/Toronto",
            queue: { label: "Reminder queue healthy", detail: "0 retries" },
            sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
          },
        }, createElement(MatterOverview, { data: DESIGNER_MATTER })),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 120, i + 160) + "\nGOT " + live.slice(i - 120, i + 160));
    }
    expect(live).toBe(captured);
  });

  it("puts the matter hold bar between the top bar and the tabs, as the captured Designer markup does", () => {
    const captured = region(renderToStaticMarkup(createElement(MatterMarkup, { variant: "tab-overview--hold-1" })), '<header class="top"', '<div id="content">');
    const live = region(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/matters/priya" },
          header: createElement(MatterTopBar, {
            data: { ...DESIGNER_MATTER_HEADER, hold: { reason: "Waiting on client", parts: ["Owner Amara Osei", "review 30 Oct", "deadline alerts still on"] } },
          }),
          statusbar: { timezone: "America/Toronto" },
        }),
      ),
      '<header class="top"',
      '<div id="content">',
    );
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
            after: createElement(TasksDialog, { data: data.dialog }),
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

  it("renders the People and invitations Staff tab and its Invite staff dialog exactly as the captured Designer markup", () => {
    // The capture also carries the Clients and family tab's "Invite to the portal" dialog
    // (#dlgC). That tab is not ported, so the Staff tab renders without it.
    const captured = withoutPreloads(renderToStaticMarkup(createElement(InvitationsMarkup))).replace(
      /<dialog class="dlg" id="dlgC"[\s\S]*?<\/dialog>/,
      "",
    );
    expect(captured).toContain('id="dlgS"');
    expect(captured).not.toContain('id="dlgC"');
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/invitations" },
          header: createElement(StaffHeader, { firmName: DESIGNER_STAFF.firmName }),
          statusbar: {
            timezone: "America/Toronto",
            queue: { label: "Reminder queue healthy", detail: "0 retries" },
            sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
          },
          after: createElement(StaffAfter, { dialog: DESIGNER_STAFF_DIALOG }),
        }, createElement(SheetStaffTab, { data: DESIGNER_STAFF })),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
    }
    expect(live).toBe(captured);
  });

  it("wires the real Staff tab without changing anything but data attributes", () => {
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(SheetStaffTab, {
          data: {
            firmName: "Maple Immigration",
            rows: [
              { ...DESIGNER_STAFF.rows[3], action: { kind: "revoke", invitationId: "11111111-1111-4111-8111-111111111111" } },
              { ...DESIGNER_STAFF.rows[4], action: { kind: "resend", invitationId: "22222222-2222-4222-8222-222222222222" } },
            ],
          },
        }),
        createElement(StaffAfter, { dialog: { ...DESIGNER_STAFF_DIALOG, organizationId: "33333333-3333-4333-8333-333333333333" } }),
      ),
    );
    expect(html).toContain('data-hold="Invitation revoked" aria-label="Press and hold to revoke" data-invitation="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('data-t="Invitation sent again" data-invitation="22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('data-toast-kind="ok" data-org="33333333-3333-4333-8333-333333333333"');
  });

  it("shows a firm without tasks the Designer's empty states, with no sample people", () => {
    for (const tab of ["internal", "client", "deadlines"] as TasksTab[]) {
      const html = renderToStaticMarkup(
        createElement(SheetTasks, { data: { tab, counts: { open: 0, escalated: 0 }, internal: { alert: null, rows: [] }, client: { rows: [] }, deadlines: { rows: [] }, dialog: { owners: [{ label: "Dana Lee" }], dependsOn: [], create: { toast: "x", kind: "warn" } } } }),
      );
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Olena|Rafael|Daniel|Lena|NL-2026/);
    }
  });

  for (const tab of ["dir", "person", "household"] as ClientsTab[]) {
    it(`renders the Clients page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(ClientsMarkup, { variant: `tab-${tab}` })));
      const data = { ...DESIGNER_CLIENTS, tab };
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/clients" },
            header: createElement(ClientsHeader, { data }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: createElement(DuplicateDialog, { data: DESIGNER_CLIENTS.dir!.duplicate! }),
          }, createElement(SheetClients, { data })),
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

  it("shows a firm without clients the Designer's empty states, with no sample people", () => {
    for (const tab of ["dir", "person", "household"] as ClientsTab[]) {
      const html = renderToStaticMarkup(
        createElement(SheetClients, {
          data: {
            tab,
            counts: { people: 0, households: 0 },
            add: { href: "/sheet/matters?new=1", label: "Add a client" },
            tabs: { person: "Person", household: "Household" },
            dir: { copy: "People on matters you can see.", rows: [], duplicate: null },
            person: null,
            household: null,
          },
        }),
      );
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Olena|Rafael|Hamid|Sharma|NL-2026|Merged with history/);
    }
  });

  it("renders the Agreements page (All agreements) and its New quote dialog exactly as the captured Designer markup", () => {
    // The capture also carries the Void envelope (#dlgVoid) and Record representation authority
    // (#dlgAuth) dialogs. Their tabs are not ported, so the All agreements tab renders without them.
    const captured = withoutPreloads(renderToStaticMarkup(createElement(AgreementsMarkup)))
      .replace(/<dialog class="dlg" id="dlgVoid"[\s\S]*?<\/dialog>/, "")
      .replace(/<dialog class="dlg" id="dlgAuth"[\s\S]*?<\/dialog>/, "");
    expect(captured).toContain('id="dlgNewQ"');
    expect(captured).not.toContain('id="dlgVoid"');
    expect(captured).not.toContain('id="dlgAuth"');
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/agreements" },
          header: createElement(AgreementsHeader, { data: { records: 8, waiting: 2, create: "New quote" } }),
          statusbar: {
            timezone: "America/Toronto",
            queue: { label: "Reminder queue healthy", detail: "0 retries" },
            sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
          },
          after: createElement(NewAgreementDialog, { data: DESIGNER_NEW_QUOTE }),
        }, createElement(SheetAgreements, { data: DESIGNER_AGREEMENTS })),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
    }
    expect(live).toBe(captured);
  });

  it("wires the real Agreements dialogs by data attributes, apart from the New matter dialog", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(NewAgreementDialog, {
          data: {
            title: "New agreement",
            matterLabel: "Matter",
            templateLabel: "Approved template",
            matters: [{ value: "11111111-1111-4111-8111-111111111111", left: "Dana Lee · CV-2026-0001" }],
            templates: [{ value: "22222222-2222-4222-8222-222222222222", left: "Service · Service agreement" }],
            submit: "Create and send",
            live: { organizationId: org, sampleMode: false, blocked: null },
          },
        }),
        createElement(TemplateDialog, {
          data: { organizationId: org, kinds: [{ value: "service", label: "Service agreement" }], drafts: [{ id: "44444444-4444-4444-8444-444444444444", name: "Fees", kind: "Service agreement" }], canApprove: true },
        }),
      ),
    );
    expect(html).toContain(`data-new-agreement="1" data-org="${org}"`);
    expect(html).not.toContain('data-goto-tab="quote"');
    expect(html).toContain(`data-new-template="1" data-org="${org}"`);
    expect(html).toContain(`data-approve-template="44444444-4444-4444-8444-444444444444" data-org="${org}"`);
    // Never the New matter dialog's id or save attribute.
    expect(html).not.toContain('id="dlgNew"');
    expect(html).not.toContain("data-new-matter");
    expect(html).toContain('<option value="11111111-1111-4111-8111-111111111111">Dana Lee · CV-2026-0001</option>');
  });

  it("shows a firm without agreements an honest empty state, with no sample people", () => {
    const html = renderToStaticMarkup(
      createElement(SheetAgreements, {
        data: {
          kpis: [{ href: "#", dialog: "dlgTpl", label: "Approved templates", count: 0, warn: true, note: "None approved yet" }],
          rows: [],
          empty: { title: "No agreements yet", copy: "Agreements start from an approved template.", action: { label: "Add an agreement template", dialog: "dlgTpl" } },
        },
      }),
    );
    expect(html).toContain('class="emp"');
    expect(html).toContain('data-dlg="dlgTpl"');
    expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Tomás|Hamid|Sofia|Mei Tanaka|NL-2026|S-05|Q-0044/);
  });
});

const DESIGNER_AGREEMENTS: AgreementsData = {
  kpis: [
    { href: "?tab=envelope", label: "Waiting for signatures", count: 2, note: "Amara signed amendment 1" },
    { href: "?tab=editor", label: "Sent, not opened", count: 1, warn: true, note: { left: "Kofi Mensah", right: "3 days" } },
    { href: "?tab=quote", label: "Quotes out", count: 1, note: { left: "Tomás Duarte", right: "valid to 31 Oct" } },
    { href: "?tab=authority", label: "Authority missing", count: 1, warn: true, note: { left: "Kofi", right: "needed before submission" } },
  ],
  rows: [
    { client: PRIYA, matter: "NL-2026-0142", record: { href: "?tab=envelope", left: "Service agreement", right: "S-05 v2" }, state: { tone: "ok", label: "Executed" }, signed: "3 of 3", date: "4 Oct 2026" },
    { client: PRIYA, matter: "NL-2026-0142", record: { href: "?tab=envelope", left: "Amendment 1", right: "add Olena as dependant" }, state: { tone: "blue", label: "Partially signed" }, signed: "1 of 3", date: "Expires 29 Oct" },
    { client: AV("Kofi Mensah", "av-kofi-client"), matter: "NL-2026-0131", record: { href: "?tab=editor", left: "Service agreement", right: "S-05 v2" }, state: { tone: "rev", label: "Sent" }, signed: "0 of 2", date: "Expires 28 Oct" },
    { client: AV("Tomás Duarte", "av-tomas-client"), matter: "Lead L6", record: { href: "?tab=quote", left: "Quote Q-0044", right: "PR, family class" }, state: { tone: "gr", label: "Quote", detail: "not an agreement" }, signed: "—", date: "Valid to 31 Oct" },
    { client: AV("Ana Ferreira", "av-ana-client"), matter: "Lead L5", record: { href: "?tab=list", left: "Consultation agreement", right: "C-02 v3" }, state: { tone: "ok", label: "Executed" }, signed: "2 of 2", date: "12 Oct 2026" },
    { client: AV("Sofia Reyes", "av-sofia-client"), matter: "Lead L3", record: { href: "?tab=list", left: "Service agreement", right: "S-05 v1" }, state: { tone: "bad", label: "Declined" }, signed: "0 of 2", date: { left: "9 Oct", right: "history kept" } },
    { client: { name: "Hamid Rahimi" }, matter: "Lead L4", record: { href: "?tab=compare", left: "Service agreement", right: "S-05 v1 → v2" }, state: { tone: "gr", label: "Voided", detail: "fees changed" }, signed: "1 of 2", date: { left: "6 Oct", right: "replaced by v2" } },
    { client: { name: "Mei Tanaka" }, matter: "Lead L9", record: { href: "?tab=list", left: "Quote Q-0041", right: "work permit" }, state: { tone: "gr", label: "Expired" }, signed: "—", date: "10 Oct 2026" },
  ],
  empty: null,
};

const DESIGNER_NEW_QUOTE: NewAgreementDialogData = {
  title: "New quote",
  matterLabel: "Client or lead",
  templateLabel: "Start from",
  matters: [
    { left: "Tomás Duarte", right: "Lead L6" },
    { left: "Mei Tanaka", right: "Lead L9" },
    { left: "Grace Okafor", right: "Lead L7" },
  ],
  templates: [
    { left: "Program template", right: "PR family class v4" },
    { left: "Program template", right: "Work permit v3" },
    { left: "Blank quote" },
  ],
  submit: "Create quote",
};
