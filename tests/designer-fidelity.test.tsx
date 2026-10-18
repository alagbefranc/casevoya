import { Fragment, createElement } from "react";
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
import {
  CreditNoteDialog,
  FinanceHeader,
  NewInvoiceDialog,
  RefundDialog,
  SheetFinance,
  SheetFinancePayments,
  SheetFinanceRefunds,
  type FinanceData,
  type NewInvoiceDialogData,
  type PaymentsData,
  type RefundsData,
} from "@/components/sheet/designer/finance";
import { CreditReviewDialog, SheetFinanceInvoice, VoidDialog, type InvoiceViewData } from "@/components/sheet/designer/invoice";
import { ReconDialogs, SheetFinanceRecon, type ReconData } from "@/components/sheet/designer/recon";
import { FinanceMarkup } from "@/components/sheet/markup/finance";
import {
  ApproveTransferDialog,
  FundsLiveDialogs,
  RecordPaymentDialog,
  SheetFinanceFunds,
  VerifyPaymentDialog,
  type FundsData,
  type RecordPaymentDialogData,
  type TransferDialogData,
  type VerifyDialogData,
} from "@/components/sheet/designer/funds";

import { BookPage, type BookPageData } from "@/components/sheet/designer/book";
import { BookMarkup } from "@/components/sheet/markup/book";
import { PRACTICE_NOTICE } from "@/modules/scheduling/format";
import {
  BookDialog,
  CancelDialog,
  ConsultationsHeader,
  RescheduleDialog,
  SheetConsultations,
  type BookDialogData,
  type CancelDialogData,
  type ConsultationsData,
  type ConsultationsTab,
  type RescheduleDialogData,
} from "@/components/sheet/designer/consultations";
import { ConsultationsMarkup } from "@/components/sheet/markup/consultations";
import {
  CalendarHeader,
  CalendarRbarView,
  SheetCalendar,
  type CalendarData,
  type CalendarRbar,
  type CalendarTab,
  type WeekBlock,
} from "@/components/sheet/designer/calendar";
import { CalendarMarkup } from "@/components/sheet/markup/calendar";
import { Review } from "@/components/portal/documents-live";

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
  // The Designer's sidebar has no way to sign out; the live one adds a button to its profile row.
  return html.replace(/<link rel="preload"[^>]*\/>/g, "").replace(SIGN_OUT, "");
}

const SIGN_OUT = /<form [^>]*action="\/sign-out"[^>]*>[\s\S]*?<\/form>/g;

function sidebar(html: string): string {
  return html.replace(SIGN_OUT, "");
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
    const live = sidebar(region(renderToStaticMarkup(createElement(SheetSidebar, { data: DESIGNER_SIDEBAR })), '<aside class="side"', "</aside>"));
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
            templates: [
              {
                value: "22222222-2222-4222-8222-222222222222",
                left: "Service · Service agreement",
                defaults: { fee: "1500.00", currency: "CAD", exclusions: "Appeals", refund: "Unearned advances", government: "Paid to IRCC." },
              },
            ],
            submit: "Create and send",
            live: {
              organizationId: org,
              sampleMode: false,
              currencies: ["CAD", "USD"],
              defaults: { fee: "1500.00", currency: "CAD", exclusions: "Appeals", refund: "Unearned advances", government: "Paid to IRCC." },
              blocked: null,
            },
          },
        }),
        createElement(TemplateDialog, {
          data: { organizationId: org, kinds: [{ value: "service", label: "Service agreement" }], drafts: [{ id: "44444444-4444-4444-8444-444444444444", name: "Fees", kind: "Service agreement" }], canApprove: true },
        }),
      ),
    );
    expect(html).toContain(`data-new-agreement="1" data-org="${org}"`);
    expect(html).not.toContain('data-goto-tab="quote"');
    // Live, the dialog is the Designer's landscape dialog with the agreement terms as its own fields.
    expect(html).toContain('<dialog class="dlg wide" id="dlgNewQ"');
    expect(html).toMatch(/<div class="g2"><div class="fld"><label for="nqF">Professional fee<\/label>[\s\S]*?<label for="nqCur">Currency<\/label><select class="sel" id="nqCur"/);
    for (const [id, label] of [["nqX", "Not included"], ["nqR", "Refund policy"], ["nqG", "Government fees"]]) {
      expect(html).toContain(`<label for="${id}">${label}</label>`);
      expect(html).toMatch(new RegExp(`<textarea class="ta" id="${id}"`));
    }
    expect(html).toMatch(/id="nqF" type="text" inputmode="decimal"/i);
    expect(html).toContain('data-fee="1500.00" data-currency="CAD"');
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

const AVF = (name: string, file: string) => ({ name, avatarUrl: `/assets/${file}.png` });
const PRIYA_F = AVF("Priya Sharma", "av-priya-applicant");

const DESIGNER_FINANCE: FinanceData = {
  intro:
    "Three kinds of money stay apart: Northline’s earned fees, advances held in the client account, and government fees the client pays to IRCC. A payment never changes a government status.",
  kpis: [
    { href: "?tab=invoices", label: "Owed to Northline", value: { money: "CAD 3,729.00" }, note: "3 open invoices" },
    { href: "?tab=invoices", label: "Overdue", value: { money: "CAD 791.00" }, note: { left: "Ana Ferreira", right: "8 days" }, tone: "bad" },
    { href: "?tab=funds", label: "Held in client account", value: { money: "CAD 1,500.00" }, note: { left: "Not earned", right: "1 client" } },
    { href: "?tab=payments", label: "Needs you", value: { count: 2 }, note: { left: "1 transfer approval", right: "1 bank payment to verify" }, tone: "warn" },
  ],
  rows: [
    { number: { href: "?tab=invoice", label: "INV-0222" }, client: PRIYA_F, matter: "NL-2026-0142", categories: ["Disbursement", "translation"], issued: "—", due: "—", total: "113.00", paid: "0.00", state: { tone: "gr", label: "Draft" } },
    { number: { href: "?tab=invoice", label: "INV-0221" }, client: AVF("Kofi Mensah", "av-kofi-client"), matter: "NL-2026-0131", categories: ["Professional fee", "HST"], issued: "9 Oct", due: "9 Nov", total: "1,808.00", paid: "0.00", state: { tone: "blue", label: "Issued" } },
    { number: { href: "?tab=invoice", label: "INV-0218" }, client: PRIYA_F, matter: "NL-2026-0142", categories: ["Professional fee", "HST 13%", "disbursement"], issued: "2 Oct", due: "6 Nov", total: "2,260.00", paid: "1,130.00", state: { tone: "chg", label: "Partially paid" } },
    { number: { href: "?tab=invoice", label: "INV-0214" }, client: AVF("Ana Ferreira", "av-ana-client"), matter: "NL-2026-0129", categories: ["Professional fee", "HST"], issued: "25 Sep", due: "9 Oct", total: "791.00", paid: "0.00", state: { tone: "bad", label: "Overdue" } },
    { number: { href: "?tab=invoice", label: "INV-0211" }, client: AVF("Tomás Duarte", "av-tomas-client"), matter: "Lead L6", categories: ["Consultation fee"], issued: "18 Sep", due: "18 Sep", total: "300.00", paid: "300.00", state: { tone: "ok", label: "Paid" } },
    { number: { href: "?tab=invoice", label: "INV-0205" }, client: AVF("Sofia Reyes", "av-sofia-client"), matter: "Lead L3", categories: ["Consultation fee"], issued: "10 Sep", due: "—", total: "300.00", paid: "0.00", state: { tone: "gr", label: "Voided" } },
    { number: { href: "?tab=invoice", label: "INV-0199" }, client: { name: "Hamid Rahimi" }, matter: "Lead L4", categories: ["Professional fee", "HST"], issued: "5 Sep", due: "—", total: "452.00", paid: "0.00", state: { tone: "gr", label: "Credited" } },
    { number: { href: "?tab=invoice", label: "INV-0197" }, client: PRIYA_F, matter: "NL-2026-0142", categories: ["Consultation fee"], issued: "2 Sep", due: "2 Sep", total: "300.00", paid: "300.00", state: { tone: "ok", label: "Paid" } },
  ],
  empty: null,
};

const DESIGNER_NEW_INVOICE: NewInvoiceDialogData = {
  matters: [
    { left: "NL-2026-0142", right: "Priya Sharma" },
    { left: "NL-2026-0131", right: "Kofi Mensah" },
  ],
  work: [
    { left: "Milestone 2", right: "package released (not delivered yet)" },
    { left: "Disbursement", right: "courier, 15 Oct" },
  ],
};

/** The capture's credit note dialog (`#dlgCN`), now ported. */
const DESIGNER_CREDIT_NOTE = createElement(CreditNoteDialog, { key: "cn", data: { designer: { invoice: "INV-0218", hint: "Up to CAD 1,130.00, the unpaid balance" } } });

const OK_RECONCILED = { tone: "ok", label: "Reconciled" } as const;
const RAFAEL_FOR_PRIYA = "Rafael Sharma for Priya";

const DESIGNER_PAYMENTS: PaymentsData = {
  intro:
    "Money received by Northline. Card payments are confirmed by the processor’s signed event; bank transfers stay “Pending verification” until they’re matched to the bank statement.",
  currency: "CAD",
  balance: null,
  rows: [
    { received: "16 Oct", from: "Kofi Mensah", method: "Bank transfer", reference: ["RBC-55102", "evidence uploaded"], goesTo: "Client account (advance)", amount: "1,808.00", state: { tone: "rev", label: "Pending verification" } },
    { received: "14 Oct", from: RAFAEL_FOR_PRIYA, method: "Bank transfer", reference: ["TD-88213"], goesTo: "Client account (advance)", amount: "500.00", state: OK_RECONCILED },
    { received: "12 Oct", from: "Ana Ferreira", method: "Card", reference: ["evt_5602", "declined by bank"], goesTo: "INV-0214", amount: "791.00", state: { tone: "bad", label: "Payment failed" } },
    { received: "8 Oct", from: RAFAEL_FOR_PRIYA, method: "Card", reference: ["evt_5530", "RC-0093"], goesTo: "INV-0218", amount: "1,130.00", state: OK_RECONCILED },
    { received: "3 Oct", from: RAFAEL_FOR_PRIYA, method: "Card", reference: ["evt_5488", "RC-0091"], goesTo: "Client account (advance)", amount: "1,000.00", state: OK_RECONCILED },
    { received: "18 Sep", from: "Tomás Duarte", method: "Card", reference: ["evt_5170", "RC-0088"], goesTo: "INV-0211", amount: "300.00", state: OK_RECONCILED },
    { received: "4 Sep", from: RAFAEL_FOR_PRIYA, method: "Card", reference: ["evt_5021", "duplicate of evt_5020"], goesTo: "Refund RF-0012", amount: "300.00", state: { tone: "chg", label: "Refund processing" } },
    { received: "4 Sep", from: RAFAEL_FOR_PRIYA, method: "Card", reference: ["evt_5020", "RC-0084"], goesTo: "INV-0197", amount: "300.00", state: OK_RECONCILED },
  ],
  empty: null,
  note: [
    "The same processor event arriving twice is counted once (provider",
    "connected account",
    "event ID). A CAD payment can’t pay a USD invoice. A failed or reversed transfer reopens the balance and creates a task; it never changes the matter stage.",
  ],
};

const DESIGNER_REFUNDS: RefundsData = {
  intro:
    "Refunding a payment isn’t the same as crediting an invoice; each keeps its own state and links (FIN-13). Disputes never hold back or delete a client’s records.",
  refunds: [
    { number: "RF-0013", client: "Sofia Reyes", from: ["Card", "consultation INV-0205"], amount: "300.00", requested: "11 Oct", state: { tone: "bad", label: "Failed", detail: "card closed" } },
    { number: "RF-0012", client: "Priya Sharma", from: ["Card", "duplicate evt_5021"], amount: "300.00", requested: "13 Oct", state: { tone: "rev", label: "Processing" } },
    { number: "RF-0011", client: "Mei Tanaka", from: ["Client account", "unearned advance"], amount: "500.00", requested: "24 Sep", state: { tone: "ok", label: "Completed 30 Sep" } },
  ],
  refundsEmpty: { title: "No refunds yet", copy: "" },
  failed: { title: "Refund RF-0013 failed", copy: "Sofia’s card was closed. A task was created for Lena to ask for bank details. Nothing was refunded twice." },
  creditNotes: [{ number: "CN-0007", invoice: ["INV-0199", "Hamid Rahimi"], amount: "452.00", reason: "Service cancelled before work started", issuedBy: "Lena Park, 8 Sep" }],
  creditNotesEmpty: { title: "No credit notes yet", copy: "" },
  disputes: [{ number: "DP-0003", client: "Grace Okafor", payment: ["Card", "consultation 2 Sep"], amount: "300.00", evidenceDue: "24 Oct", state: { tone: "chg", label: "Evidence needed" } }],
  disputesEmpty: { title: "No disputes", copy: "" },
  disputeFooter: {
    evidence: { toast: "Evidence added", sub: "Booking record, consultation notes summary and receipt." },
    note: "Grace keeps full access to her portal and records during the dispute.",
  },
};

describe("Designer fidelity: Finance", () => {
  it("renders the Finance page (Invoices) and its New invoice dialog exactly as the captured Designer markup", () => {
    // The capture also carries Record a bank payment (#dlgPay), Verify (#dlgVer) and Transfer (#dlgTr):
    // they live on the Client funds tab, so the Invoices tab renders without them. The credit note
    // dialog (#dlgCN) is ported.
    let captured = withoutPreloads(renderToStaticMarkup(createElement(FinanceMarkup)));
    for (const id of ["dlgPay", "dlgVer", "dlgTr"]) {
      captured = captured.replace(new RegExp(`<dialog class="dlg" id="${id}"[\\s\\S]*?</dialog>`), "");
      expect(captured).not.toContain(`id="${id}"`);
    }
    expect(captured).toContain('id="dlgInv"');
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/finance" },
            header: createElement(FinanceHeader, {
              data: { pills: ["CAD", { left: "Northline Immigration", right: "fictional" }], recordPayment: true, invoiceTab: "INV-0218", tab: "invoices" },
            }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: [DESIGNER_CREDIT_NOTE, createElement(NewInvoiceDialog, { key: "inv", data: DESIGNER_NEW_INVOICE })],
          },
          createElement(SheetFinance, { data: DESIGNER_FINANCE }),
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

  it("wires the live New invoice dialog by data attributes, with no Designer toast", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const html = renderToStaticMarkup(
      createElement(NewInvoiceDialog, {
        data: {
          matters: [{ value: "11111111-1111-4111-8111-111111111111", left: "Dana Lee · CV-2026-0001" }],
          work: [],
          live: { organizationId: org, sampleMode: false, currencies: ["CAD"], defaultDue: "2026-11-17", today: "2026-10-18", cardPaymentsReady: false, blocked: null },
        },
      }),
    );
    expect(html).toContain(`data-new-invoice="1" data-org="${org}" data-today="2026-10-18"`);
    expect(html).not.toContain("data-toast");
    expect(html).toMatch(/<div class="g2"><div class="fld"><label for="niA">Amount<\/label>[\s\S]*?<label for="niCur">Currency<\/label>/);
    expect(html).toContain('<input class="inp" id="niDue" type="date" min="2026-10-18" value="2026-11-17"/>');
    expect(html).toContain("Card payments aren’t set up yet");
    expect(html).toContain('<option value="11111111-1111-4111-8111-111111111111">Dana Lee · CV-2026-0001</option>');
  });

  it("renders the Finance page (Payments) exactly as the captured Designer markup", () => {
    // The Payments capture carries the same dialogs as the Invoices one; the bank-transfer flows
    // (#dlgPay record, #dlgVer verify, #dlgTr transfer approval) live on the Client funds tab. Its
    // "1 bank payment to verify" banner opens #dlgVer, so it is left out too: the live tab puts
    // the Stripe account banner in that slot only when Stripe needs something.
    let captured = withoutPreloads(renderToStaticMarkup(createElement(FinanceMarkup, { variant: "tab-payments" })));
    for (const id of ["dlgPay", "dlgVer", "dlgTr"]) {
      captured = captured.replace(new RegExp(`<dialog class="dlg" id="${id}"[\\s\\S]*?</dialog>`), "");
      expect(captured).not.toContain(`id="${id}"`);
    }
    const banner = /<div class="alert warn rv" style="--i:1"><svg class="ic" aria-hidden="true"><use href="[^"]*#i-bank"><\/use><\/svg><div><b>1 bank payment to verify<\/b>[\s\S]*?data-dlg="dlgVer"[\s\S]*?<\/div><\/div>/;
    expect(captured).toMatch(banner);
    captured = captured.replace(banner, "");
    expect(captured).not.toContain("bank payment to verify");
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/finance" },
            header: createElement(FinanceHeader, {
              data: { pills: ["CAD", { left: "Northline Immigration", right: "fictional" }], recordPayment: true, invoiceTab: "INV-0218", tab: "payments" },
            }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: [DESIGNER_CREDIT_NOTE, createElement(NewInvoiceDialog, { key: "inv", data: DESIGNER_NEW_INVOICE })],
          },
          createElement(SheetFinancePayments, { data: DESIGNER_PAYMENTS }),
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

  it("shows the Stripe balance as the Designer's KPI tiles, and a firm without payments an honest empty state", () => {
    const html = renderToStaticMarkup(
      createElement(SheetFinancePayments, {
        data: {
          intro: "Synthetic firm",
          currency: "CAD",
          balance: [
            { href: "?tab=payments", label: "Available in Stripe", value: { money: "—" }, note: "Balance unavailable" },
            { href: "?tab=payments", label: "Payouts", value: { money: "On" }, note: "Stripe" },
          ],
          rows: [],
          empty: { title: "No card payments yet", copy: "Payments appear here when Stripe confirms them." },
          note: ["Synthetic note"],
        },
        status: createElement("div", { className: "alert warn rv", "data-stripe": "1" }),
      }),
    );
    expect(html).toMatch(/<div class="ph rv"[\s\S]*?<div class="alert warn rv" data-stripe="1"><\/div><div class="fp-kpi rv" style="--i:1"><a class="fp-k k2-spot"/);
    expect(html).toContain("Balance unavailable");
    expect(html).toContain('class="emp"');
    expect(html).not.toContain("<table");
    expect(html).not.toMatch(/Northline|Priya|Kofi|Ana Ferreira|Rafael|evt_5|INV-02|RBC-|TD-882/);
  });

  it("renders the Finance page (Refunds and disputes) exactly as the captured Designer markup", () => {
    // The capture carries the Client funds tab's dialogs (#dlgPay, #dlgVer, #dlgTr), which this tab
    // doesn't render. Its Credit notes panel (--i:2) and the credit note dialog (#dlgCN) are ported.
    let captured = withoutPreloads(renderToStaticMarkup(createElement(FinanceMarkup, { variant: "tab-refunds" })));
    for (const id of ["dlgPay", "dlgVer", "dlgTr"]) {
      captured = captured.replace(new RegExp(`<dialog class="dlg" id="${id}"[\\s\\S]*?</dialog>`), "");
      expect(captured).not.toContain(`id="${id}"`);
    }
    expect(captured).toContain("Credit notes");
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/finance" },
            header: createElement(FinanceHeader, {
              data: { pills: ["CAD", { left: "Northline Immigration", right: "fictional" }], recordPayment: true, invoiceTab: "INV-0218", tab: "refunds" },
            }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: [DESIGNER_CREDIT_NOTE, createElement(NewInvoiceDialog, { key: "inv", data: DESIGNER_NEW_INVOICE })],
          },
          createElement(SheetFinanceRefunds, { data: DESIGNER_REFUNDS }),
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

  it("shows a firm without refunds or disputes honest empty panels, and no Add evidence button live", () => {
    const empty = renderToStaticMarkup(
      createElement(SheetFinanceRefunds, {
        data: {
          intro: "Synthetic firm",
          refunds: [],
          refundsEmpty: { title: "No refunds yet", copy: "Refund a received card payment from the Payments tab." },
          failed: null,
          creditNotes: [],
          creditNotesEmpty: { title: "No credit notes yet", copy: "Correct an issued invoice with a credit note from its own tab." },
          disputes: [],
          disputesEmpty: { title: "No disputes", copy: "Stripe reports disputes here." },
          disputeFooter: null,
        },
      }),
    );
    expect(empty.match(/class="emp"/g)).toHaveLength(3);
    expect(empty).not.toContain("<table");
    expect(empty).toContain("No credit notes yet");
    expect(empty).not.toMatch(/Northline|Sofia|Priya|Mei Tanaka|Grace|RF-001|DP-000|evt_5/);

    const live = renderToStaticMarkup(
      createElement(SheetFinanceRefunds, {
        data: {
          intro: "Synthetic firm",
          refunds: [{ number: "RF-0001", client: "Dana Lee", from: ["Card", "INV-0001"], amount: "100.00", requested: "18 Oct", state: { tone: "rev", label: "Processing" } }],
          refundsEmpty: { title: "x", copy: "x" },
          failed: null,
          creditNotes: [{ number: "CN-0001", href: "?tab=invoice&view=i1", invoice: ["INV-0001", "Dana Lee"], amount: "40.00", reason: "Duplicate line", issuedBy: "Draft by Sam Kim, waiting for review" }],
          creditNotesEmpty: { title: "x", copy: "x" },
          disputes: [{ number: "DP-0001", client: "Dana Lee", payment: ["Card", "INV-0001, fraudulent"], amount: "1,130.00", evidenceDue: "2 Nov", state: { tone: "chg", label: "Evidence needed" } }],
          disputesEmpty: { title: "x", copy: "x" },
          disputeFooter: { note: "Evidence can’t be submitted from Casevoya yet; contact Stripe support." },
        },
      }),
    );
    expect(live).toContain('<div class="fp-row"><span class="fp-note" style="margin:0">Evidence can’t be submitted from Casevoya yet; contact Stripe support.</span></div>');
    expect(live).not.toContain("Add evidence");
    expect(live).not.toContain("data-toast");
    expect(live).not.toMatch(/Respond in Stripe/i);
    expect(live).toContain('<td>DP-0001</td><td>Dana Lee</td><td>Card <span class="sep" aria-hidden="true"></span> INV-0001, fraudulent</td>');
    expect(live).toContain(
      '<td><a href="?tab=invoice&amp;view=i1" class="num" style="color:var(--blue)">CN-0001</a></td><td>INV-0001 <span class="sep" aria-hidden="true"></span> Dana Lee</td><td class="num" style="text-align:right">40.00</td><td>Duplicate line</td><td>Draft by Sam Kim, waiting for review</td>',
    );
  });

  it("puts a Refund button on a refundable Payments row and wires the refund dialog by data attributes", () => {
    const payment = "22222222-2222-4222-8222-222222222222";
    const org = "33333333-3333-4333-8333-333333333333";
    const html = renderToStaticMarkup(
      createElement(SheetFinancePayments, {
        data: {
          intro: "Synthetic firm",
          currency: "CAD",
          balance: null,
          rows: [
            {
              received: "18 Oct",
              from: "Dana Lee",
              method: "Card",
              reference: ["evt_…abc123"],
              goesTo: "INV-0001",
              amount: "1,130.00",
              state: { tone: "ok", label: "Received", detail: "CAD 100.00 refunded" },
              refund: { paymentId: payment, refundableCents: 103_000, refundable: "1030.00", label: "INV-0001 · Dana Lee · CAD 1,030.00 refundable" },
            },
            { received: "17 Oct", from: "Dana Lee", method: "Card", reference: ["evt_…def456"], goesTo: "INV-0002", amount: "50.00", state: { tone: "bad", label: "Payment failed" } },
          ],
          empty: null,
          note: ["Synthetic note"],
        },
      }),
    );
    expect(html).toContain(
      `<td><span class="fp-row"><span class="bd ok"><i></i><span>Received <span class="sep" aria-hidden="true"></span> CAD 100.00 refunded</span></span><button class="btn sm" data-refund-open="${payment}" data-refundable="103000" data-amount="1030.00" data-label="INV-0001 · Dana Lee · CAD 1,030.00 refundable">Refund</button></span></td>`,
    );
    expect(html.match(/data-refund-open=/g)).toHaveLength(1);
    expect(html).toContain('<td><span class="bd bad"><i></i>Payment failed</span></td>');

    const dialog = renderToStaticMarkup(createElement(RefundDialog, { data: { organizationId: org, blocked: null } }));
    expect(dialog).toMatch(/^<dialog class="dlg" id="dlgRefund" aria-labelledby="dlgRefundH"><div class="dh"><h2 id="dlgRefundH">Refund a card payment<\/h2><button class="x" aria-label="Close" data-close="dlgRefund">/);
    expect(dialog).toMatch(/<div class="g2"><div class="fld"><label for="rfA">Amount<\/label>[\s\S]*?<label for="rfR">Reason<\/label><select class="sel" id="rfR">/);
    for (const value of ["requested_by_customer", "duplicate", "fraudulent"]) expect(dialog).toContain(`<option value="${value}">`);
    expect(dialog).toContain(`<button class="btn p" data-refund-submit="1" data-org="${org}">Refund</button>`);
    expect(dialog).toContain("The matter stage and government status don’t change.");
    expect(dialog).not.toContain("data-toast");
    const blocked = renderToStaticMarkup(createElement(RefundDialog, { data: { organizationId: org, blocked: { title: "Billing staff only", copy: "x" } } }));
    expect(blocked).toContain(`data-refund-submit="1" data-org="${org}" disabled=""`);
    expect(blocked).toContain('<div class="alert warn">');
  });

  it("shows a firm without invoices an honest empty state, with no sample people", () => {
    const html = renderToStaticMarkup(
      createElement(SheetFinance, {
        data: {
          intro: "Synthetic firm",
          kpis: [{ href: "?tab=invoices", label: "Owed to Synthetic", value: { money: "CAD 0.00" }, note: "No open invoices" }],
          rows: [],
          empty: { title: "No invoices yet", copy: "Issue one from a matter.", action: { label: "New invoice", dialog: "dlgInv" } },
        },
      }),
    );
    expect(html).toContain('class="emp"');
    expect(html).toContain('data-dlg="dlgInv"');
    expect(html).not.toMatch(/Northline|Priya|Kofi|Ana Ferreira|NL-2026|INV-02/);
  });
});

const DESIGNER_FUNDS: FundsData = {
  intro: "Advances held in Northline’s client account, per client and per matter. They’re a liability, not revenue, until an approved earned-fee transfer (FIN-10, FIN-11).",
  kpis: [
    { href: "#", label: "Client account balance", value: { money: "CAD 1,500.00" }, note: { left: "Bank ••• 4410", right: "1 client" } },
    { href: "#", label: "Pending verification", value: { money: "CAD 1,808.00" }, note: { left: "Kofi Mensah", right: "not available yet" }, tone: "warn" },
    { href: "#", label: "Transfers waiting", value: { count: 1 }, note: { left: "CAD 300.00", right: "needs Lena’s approval" }, tone: "warn" },
    { href: "?tab=recon", label: "Last reconciliation", value: { money: "30 Sep" }, note: "Signed by Lena Park and Amara Osei" },
  ],
  panels: [
    {
      client: "Priya Sharma",
      matter: "NL-2026-0142",
      badge: { tone: "ok", label: "Reconciled 15 Oct" },
      rows: [
        { key: "a", date: "3 Oct", entry: ["Advance payment", "RC-0091"], evidence: ["Card", "evt_5488"], in: "1,000.00", out: "", balance: "1,000.00" },
        { key: "b", date: "14 Oct", entry: ["Advance deposit", "bank transfer"], evidence: ["TD-88213", "Lena"], in: "500.00", out: "", balance: "1,500.00" },
        { key: "c", date: "15 Oct", entry: ["Reconciled against the October statement"], evidence: ["Statement p.3"], in: "", out: "", balance: "1,500.00" },
        { key: "d", date: "—", entry: ["Proposed earned-fee transfer → INV-0218 milestone 1"], evidence: ["Needs 2 approvers"], in: "", out: "(300.00)", balance: "1,500.00" },
      ],
      footer: {
        actions: [{ label: "Review transfer", primary: true, attrs: { "data-dlg": "dlgTr", "data-fpd": "1" } }],
        note: "After approval: CAD 1,200.00 available. A ledger entry alone doesn’t move money; the bank transfer is recorded next.",
      },
    },
    {
      client: "Kofi Mensah",
      matter: "NL-2026-0131",
      badge: { tone: "rev", label: "Pending verification" },
      rows: [{ key: "e", date: "16 Oct", entry: ["Advance deposit", "bank transfer, recorded by hand"], evidence: ["RBC-55102", "screenshot"], in: "1,808.00", out: "", balance: "0.00 available" }],
      footer: null,
    },
  ],
  empty: null,
  alert: {
    title: "One client’s money never pays another client’s bill",
    copy: "Every journal balances by currency and can’t be edited once posted; mistakes are fixed with a reversing entry. Casevoya’s subscription and processor fees never come out of a client’s balance.",
  },
};


const DESIGNER_PAY: RecordPaymentDialogData = {
  designer: {
    amount: "1,808.00",
    methods: ["Bank transfer", "Interac e-Transfer", "Cheque", "Cash (receipt required)"],
    reference: "RBC-55102",
    received: "16/10/2026",
    destinations: ["Client account ••• 4410 (advances)", "Operating account ••• 2208 (earned fees)"],
    reviewers: ["Amara Osei", "Lena Park"],
  },
};

const DESIGNER_VERIFY: VerifyDialogData = {
  designer: {
    title: "Verify Kofi Mensah’s payment",
    rows: [
      { term: "Amount", parts: ["CAD 1,808.00"] },
      { term: "Reference", parts: ["RBC-55102"] },
      { term: "Bank line", parts: ["16 Oct", "“MENSAH K", "RBC-55102”", "CAD 1,808.00"] },
      { term: "Recorded by", parts: ["Lena Park"] },
      { term: "Destination", parts: ["Client account ••• 4410"] },
    ],
  },
};

const DESIGNER_TRANSFER: TransferDialogData = {
  designer: {
    rows: [
      { term: "From", parts: ["Priya Sharma’s client ledger", "CAD 1,500.00 available"] },
      { term: "To", parts: ["Operating account ••• 2208"] },
      { term: "For", parts: ["INV-0218", "milestone 1 (preparation delivered 1–15 Oct)"] },
      { term: "Amount", parts: ["CAD 300.00", "within available funds and eligible earned charges"] },
      { term: "Approvals", parts: ["1. Amara Osei", "approved 16 Oct, 14:05", "2. Lena Park", "waiting"] },
      { term: "Bank transfer", parts: ["Recorded after both approvals"] },
    ],
    note: "Two people approve by default. A solo practice records a self-approval with a reason.",
    approveLabel: "Approve as Lena Park",
  },
};

/** Every dialog in the Finance captures, in their order, from the Designer's values. */
function designerDialogs() {
  return [
    createElement(RecordPaymentDialog, { key: "pay", data: DESIGNER_PAY }),
    createElement(VerifyPaymentDialog, { key: "ver", data: DESIGNER_VERIFY }),
    createElement(ApproveTransferDialog, { key: "tr", data: DESIGNER_TRANSFER }),
    DESIGNER_CREDIT_NOTE,
    createElement(NewInvoiceDialog, { key: "inv", data: DESIGNER_NEW_INVOICE }),
  ];
}

describe("Designer fidelity: Finance, Client funds", () => {
  it("renders the Client funds tab and its payment, verify and transfer dialogs exactly as the captured Designer markup", () => {
    // Every dialog in the capture is ported, the credit note (#dlgCN) included.
    const captured = withoutPreloads(renderToStaticMarkup(createElement(FinanceMarkup, { variant: "tab-funds" })));
    for (const id of ["dlgPay", "dlgVer", "dlgTr", "dlgCN", "dlgInv"]) expect(captured).toContain(`id="${id}"`);
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/finance" },
            header: createElement(FinanceHeader, {
              data: { pills: ["CAD", { left: "Northline Immigration", right: "fictional" }], recordPayment: true, invoiceTab: "INV-0218", tab: "funds" },
            }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: designerDialogs(),
          },
          createElement(SheetFinanceFunds, { data: DESIGNER_FUNDS }),
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

  it("shows a firm without client funds an honest empty state, with no sample people", () => {
    const html = renderToStaticMarkup(
      createElement(SheetFinanceFunds, {
        data: {
          intro: "Synthetic firm",
          kpis: [{ href: "?tab=funds", label: "Client account balance", value: { money: "CAD 0.00" }, note: "No client account yet" }],
          panels: [],
          empty: { title: "No client account yet", copy: "The firm owner adds it first.", actions: [{ label: "Add the client account", primary: true, attrs: { "data-funds-open": "dlgAcct" } }] },
          alert: { title: "Synthetic", copy: "Synthetic" },
        },
      }),
    );
    expect(html).toContain('class="emp"');
    expect(html).toContain('data-funds-open="dlgAcct"');
    expect(html).not.toContain("<table");
    expect(html).toMatch(/<div class="alert lockd rv" style="--i:3">/);
    expect(html).not.toMatch(/Northline|Priya|Kofi|NL-2026|INV-02|RBC-|TD-882|Lena/);
  });

  it("wires the live dialogs by data attributes, with no Designer toast or sample values", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const ledger = "44444444-4444-4444-8444-444444444444";
    const html = renderToStaticMarkup(
      createElement("div", null, [
        createElement(RecordPaymentDialog, {
          key: "pay",
          data: {
            live: {
              organizationId: org,
              today: "2026-10-18",
              sampleMode: false,
              parties: [{ value: `${ledger}:${ledger}`, label: "Dana Lee · CV-2026-0001" }],
              accounts: [{ value: ledger, label: "Client account ••• 1234" }],
              blocked: null,
            },
          },
        }),
        createElement(VerifyPaymentDialog, { key: "ver", data: { live: { organizationId: org } } }),
        createElement(ApproveTransferDialog, { key: "tr", data: { live: { organizationId: org } } }),
        createElement(FundsLiveDialogs, {
          key: "more",
          data: { organizationId: org, today: "2026-10-18", ledgers: [{ value: ledger, label: "Dana Lee", data: { "data-matter": ledger, "data-available": "10000" } }], invoices: [], corrections: [], bankTransfers: [], isOwner: false },
        }),
      ]),
    );
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Priya|Kofi|Lena|Amara|RBC-|4410|2208/);
    expect(html).toContain(`data-funds-deposit="1" data-org="${org}" data-today="2026-10-18"`);
    expect(html).toContain('<input class="inp" id="mpD" type="date" max="2026-10-18" value="2026-10-18"/>');
    expect(html).toContain(`data-funds-verify="1" data-org="${org}"`);
    expect(html).toContain(`data-funds-reject="1" data-org="${org}"`);
    expect(html).toContain(`data-funds-approve="1" data-org="${org}"`);
    expect(html).toContain(`data-funds-decline="1" data-org="${org}"`);
    expect(html).toContain('<div class="alert warn" id="tSelf" hidden="">');
    expect(html).toContain(`<option value="${ledger}" data-matter="${ledger}" data-available="10000">Dana Lee</option>`);
    // Nothing to correct, and only the owner adds the client account.
    expect(html).toContain(`data-funds-correct="1" data-org="${org}" disabled=""`);
    expect(html).toContain(`data-funds-account="1" data-org="${org}" disabled=""`);
    expect(html).not.toContain('id="mpV"');
    // Second person to verify: the explanation is there, hidden until the recorder opens it.
    expect(html).toContain('<div class="alert warn" id="vSelf" hidden="">');
    expect(html).toContain('<div class="alert info" id="vOwn" hidden="">');
    // Record the bank transfer: #dlgInv's anatomy, nothing to record yet.
    expect(html).toMatch(/<dialog class="dlg" id="dlgBank" aria-labelledby="dlgBankH"><div class="dh"><h2 id="dlgBankH">Record the bank transfer<\/h2>/);
    expect(html).toContain(`data-funds-bank="1" data-org="${org}" data-today="2026-10-18" disabled=""`);
    expect(html).toContain("CICC Code s. 32(g)");
  });
});

describe("Designer fidelity: public booking page", () => {
  const DESIGNER_BOOK: BookPageData = {
    header: { logo: { src: "/assets/firms/northline-lockup.svg", alt: "Northline Immigration" } },
    title: "Book an initial consultation",
    lead: "45 minutes with a licensed consultant. Times are shown in your timezone (America/Toronto). You’ll sign a short consultation agreement before the meeting.",
    fee: {
      title: "About the fee",
      copy: "CAD 300.00 (Northline’s fee, demo). Paid before the meeting, it’s held in Northline’s client account until the consultation happens. Cancel 24 hours ahead for a full refund.",
    },
    slots: ["Tue 20 Oct · 11:00", "Thu 22 Oct · 13:30", "Thu 22 Oct · 15:00", "Tue 27 Oct · 10:30"].map((label) => ({ label, value: label, pressed: false })),
    meet: ["Video call", "Phone", "At the Toronto office"],
    note: "Next: check your answers, sign the consultation agreement, then pay.",
    submit: { label: "Check and continue" },
    footer: { firm: "Northline Immigration (fictional demo firm)", privacyHref: "/sheet/privacy" },
  };

  it("renders the booking page exactly as the captured Designer markup", () => {
    const captured = renderToStaticMarkup(createElement(BookMarkup));
    const live = renderToStaticMarkup(createElement(BookPage, { data: DESIGNER_BOOK }));
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
    }
    expect(live).toBe(captured);
  });

  it("wires a firm's free booking page: live form, zone picker, honeypot, no fee card, no sample firm", () => {
    // Documented additions on the live page (inside the same form): data-live="1" for the Sheet's
    // form guard, the visitor's time-zone picker (#bz), a phone field for phone consultations, a
    // hidden honeypot (#bw) and an error line. The fee card is left out for a free consultation
    // and the header is the firm's name (firm logos are private). No privacy link until the firm
    // has a public notice.
    const html = renderToStaticMarkup(
      createElement(BookPage, {
        data: {
          header: { name: "Maple Immigration" },
          title: "Initial consultation",
          lead: "30 minutes with Maple Immigration. Times are shown in your timezone (America/Vancouver).",
          fee: null,
          slots: [{ label: "Tue 20 Oct · 08:00", value: "1792508400000", pressed: true }],
          meet: ["Phone"],
          note: "This consultation is free.",
          submit: { label: "Book this time" },
          footer: { firm: "Maple Immigration", privacyHref: null },
          live: { zone: { value: "America/Vancouver", options: ["America/Vancouver", "America/Toronto"] }, phone: true, more: false, error: "Choose a time." },
        },
      }),
    );
    expect(html).toContain('<form id="f" data-live="1" noValidate="">');
    expect(html).toContain('aria-pressed="true" data-start="1792508400000"');
    expect(html).toContain('id="bz"');
    expect(html).toContain('id="bp"');
    expect(html).toContain('id="bw" tabindex="-1"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("About the fee");
    expect(html).not.toMatch(/Northline|CAD 300|Privacy notice|client account/);
    expect(html).not.toContain("Practice page");
  });

  it("marks a practice page (sample mode) with the Sheet's sample-mode line and who can open it", () => {
    // Documented live-only addition: on a sample-mode firm's practice page, a notice card between
    // the header and <main> (role="note"). The Designer render and real pages never have it.
    const html = renderToStaticMarkup(
      createElement(BookPage, {
        data: {
          header: { name: "Maple Immigration" },
          title: "Initial consultation",
          lead: "30 minutes with Maple Immigration.",
          fee: null,
          slots: [],
          meet: ["Phone"],
          note: "This consultation is free.",
          submit: { label: "Book this time" },
          footer: { firm: "Maple Immigration", privacyHref: null },
          practice: { ...PRACTICE_NOTICE },
          live: { zone: { value: "America/Toronto", options: ["America/Toronto"] }, phone: true, more: false, empty: "Loading times…" },
        },
      }),
    );
    expect(html).toMatch(/<\/header><div class="card" role="note"[^>]*><b class="demo"[^>]*>Sample mode · practice records are marked sample<\/b>/);
    expect(html).toContain("Practice page: only your team can open it until your firm is verified. Bookings made here are sample records.");
  });
});

describe("Designer fidelity: Consultations", () => {
  const DESIGNER_CONSULTATIONS: ConsultationsData = {
    tab: "upcoming",
    upcoming: {
      rows: [
        {
          when: "Thu 22 Oct 10:30 ET",
          client: "Ana Ferreira",
          with: { left: "Amara Osei", right: "Zoom (planned)" },
          agreement: "C-02 v3 signed",
          fee: { tone: "ok", label: "Held as advance" },
          state: { tone: "blue", label: "Confirmed" },
          actions: [{ label: "Reschedule", dlg: "dlgRes" }],
        },
        {
          when: "Fri 23 Oct 14:00 ET",
          client: "Wei & Lin Zhang",
          with: { left: "Daniel Ruiz", right: "office" },
          agreement: "Sent",
          fee: { tone: "rev", label: "Pending" },
          state: { tone: "rev", label: "Awaiting agreement" },
          actions: [{ label: "Remind", toast: "Reminder sent" }],
        },
        {
          when: "Tue 20 Oct 09:00 ET",
          client: "Hamid Rahimi",
          with: { left: "Amara Osei", right: "phone" },
          agreement: "C-02 v3 signed",
          fee: "No fee",
          state: { tone: "blue", label: "Confirmed" },
          actions: [{ label: "Cancel", dlg: "dlgCan" }],
        },
        {
          when: "Thu 15 Oct 16:00 ET",
          client: "Yusuf Demir",
          with: { left: "Amara Osei", right: "Zoom" },
          agreement: "C-02 v3 signed",
          fee: { tone: "ok", label: "Earned after meeting" },
          state: { tone: "bad", label: "No-show" },
          actions: [{ label: "Follow up", toast: "Follow-up task created", icon: "no-show" }],
        },
      ],
    },
    availability: {
      hosts: [
        {
          name: "Amara Osei",
          items: [
            { term: "Days", value: "Tue, Thu 09:00–17:00 ET" },
            { term: "Length", value: "45 minutes" },
            { term: "Buffer", value: "15 minutes before and after" },
            { term: "Capacity", value: "4 a day" },
            { term: "Timezone", value: { left: "America/Toronto", right: "clients see their own" } },
            { term: "Calendars read", value: { left: "Northline", right: "consultations (Google Calendar, planned)" } },
            { term: "Video meetings", value: "video-planned" },
          ],
        },
      ],
      calendar: { month: DESIGNER_RBAR.month, leading: DESIGNER_RBAR.leading, days: DESIGNER_RBAR.days },
    },
    booking: {
      preview: {
        logo: "/assets/firms/northline-glyph-128.png",
        firm: "Northline Immigration",
        title: "Book an initial consultation",
        note: "45 minutes with a licensed consultant. Times are in your timezone.",
        chips: ["Tue 20 Oct 11:00", "Thu 22 Oct 13:30", "Thu 22 Oct 15:00"],
        href: "/book",
      },
      share: { url: "northline.casevoya.example/book", embedNote: true },
    },
  };
  const DESIGNER_BOOK_DIALOG: BookDialogData = {
    clients: [{ label: "Tomás Duarte" }, { label: "Grace Okafor" }, { label: "New person…" }],
    times: [{ label: "Tue 20 Oct 11:00 ET" }, { label: "Thu 22 Oct 13:30 ET" }],
    agreements: ["Send consultation agreement C-02 v3", "Already signed"],
    submit: { toast: "Consultation booked", sub: "The slot is held. Agreement sent.", kind: "ok" },
  };
  const DESIGNER_RES: RescheduleDialogData = {
    title: "Reschedule Ana’s consultation",
    times: [{ label: "Tue 27 Oct 10:30 ET" }, { label: "Thu 29 Oct 14:00 ET" }],
    note: "Ana gets an email and a portal update. Her reminders move with it.",
    submit: { toast: "Rescheduled", kind: "ok" },
  };
  const DESIGNER_CAN: CancelDialogData = {
    body: "Hamid Rahimi is told by email and in his portal. No fee was paid, so there’s nothing to refund.",
    submit: { toast: "Consultation cancelled" },
  };

  for (const tab of ["upcoming", "availability", "booking"] as ConsultationsTab[]) {
    it(`renders the Consultations page (${tab} tab) and its dialogs exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(ConsultationsMarkup, { variant: `tab-${tab}` })));
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/consultations" },
            header: createElement(ConsultationsHeader, { tab, pills: ["3 this week", "Hosted booking page live (demo)"] }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: createElement(
              Fragment,
              null,
              createElement(BookDialog, { data: DESIGNER_BOOK_DIALOG }),
              createElement(RescheduleDialog, { data: DESIGNER_RES }),
              createElement(CancelDialog, { data: DESIGNER_CAN }),
            ),
          }, createElement(SheetConsultations, { data: { ...DESIGNER_CONSULTATIONS, tab } })),
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

  it("shows a firm without bookings the Designer's empty states, with no sample people", () => {
    for (const tab of ["upcoming", "availability", "booking"] as ConsultationsTab[]) {
      const html = renderToStaticMarkup(
        createElement(SheetConsultations, {
          data: {
            tab,
            upcoming: { rows: [], empty: { title: "No consultations yet", copy: "Bookings appear here." } },
            availability: { hosts: [], calendar: { month: "October 2026", leading: 3, days: [{ day: 1 }] }, empty: { title: "No working hours yet", copy: "Set your hours.", action: { "data-avail-open": "m1" } } },
            booking: { preview: null, share: null, types: { rows: [], create: null } },
          },
        }),
      );
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Amara|Ana Ferreira|Hamid|Yusuf|Daniel|C-02|demo/);
    }
  });

  it("says on the Booking page tab that a sample-mode firm's link is a practice page", () => {
    // Documented live-only addition: share.note, a line under the copy-link row (role="note").
    const link = "https://app.casevoya.ca/book/maple/initial";
    const html = renderToStaticMarkup(
      createElement(SheetConsultations, {
        data: {
          tab: "booking",
          booking: {
            preview: { logo: null, firm: "Maple Immigration", title: "Initial consultation", note: "30 minutes.", chips: [], href: "/book/maple/initial" },
            share: { url: link, copy: link, embedNote: false, note: PRACTICE_NOTICE.note },
            types: { rows: [{ title: "Initial consultation", detail: "30 min", state: { tone: "chg", label: "Practice page" } }], create: null },
          },
        },
      }),
    );
    expect(html).toContain(`<code style="font-size:13px">${link}</code>`);
    expect(html).toContain(`<p class="fp-note" role="note">${PRACTICE_NOTICE.note}</p>`);
    expect(html).toContain("Practice page");
  });

  it("wires live rows and dialogs by data attributes, with no Designer toast or sample values", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(SheetConsultations, {
          data: {
            tab: "upcoming",
            upcoming: {
              rows: [
                {
                  when: "Tue 20 Oct 10:00 EDT",
                  client: "Sam Example",
                  with: { left: "Kim Host", right: "video (link to follow)" },
                  agreement: "—",
                  fee: "No fee",
                  state: { tone: "blue", label: "Confirmed" },
                  actions: [
                    { label: "Reschedule", data: { "data-booking-open": "res", "data-booking": "b1", "data-version": "3", "data-name": "Sam Example" } },
                    { label: "Cancel", data: { "data-booking-open": "can", "data-booking": "b1", "data-version": "3", "data-name": "Sam Example" } },
                  ],
                },
              ],
            },
          },
        }),
        createElement(BookDialog, {
          data: { clients: [{ label: "Sam Example", value: "p1" }], times: [{ label: "Tue 20 Oct 10:00 EDT", value: "2026-10-20T14:00:00.000Z" }], submit: { data: { "data-booking-submit": "book", "data-org": "o1" } } },
        }),
        createElement(RescheduleDialog, { data: { title: "Reschedule this consultation", times: [], note: "They get an email with the new time.", submit: { data: { "data-booking-submit": "res", "data-org": "o1" } } } }),
        createElement(CancelDialog, { data: { body: "They get an email.", submit: { data: { "data-booking-submit": "can", "data-org": "o1" } } } }),
      ),
    );
    expect(html).toContain('data-booking-open="res" data-booking="b1" data-version="3"');
    expect(html).toContain('<button class="btn p" data-booking-submit="book" data-org="o1">Book</button>');
    expect(html).toContain('data-booking-submit="res"');
    expect(html).toContain('data-booking-submit="can"');
    expect(html).not.toContain("bkA");
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Amara|C-02|Held as advance/);
  });
});

describe("Designer fidelity: Calendar", () => {
  const empty = () => [[], [], [], [], []] as WeekBlock[][];
  const hours = [9, 10, 11, 12, 13, 14, 15, 16].map((h) => ({ label: `${h}:00`, cells: empty() }));
  const at = (hour: number, day: number, block: WeekBlock) => hours[hour - 9].cells[day].push(block);
  at(9, 1, { kind: "internal", title: { left: "Review OCR", right: "Priya Sharma" }, note: "Amara Osei", height: 56 });
  at(10, 0, { kind: "consultation", title: { left: "Consultation", right: "Ana Ferreira" }, note: "Zoom (planned)", height: 120 });
  at(10, 4, { kind: "internal", title: "Team queue review", note: "Daniel Ruiz", height: 56 });
  at(11, 3, { kind: "consultation", title: { left: "Proposal call", right: "Tomás Duarte" }, note: "Google Meet (planned)", height: 120 });
  at(13, 2, { kind: "tentative", title: { left: "Confirm deadline", right: "Kofi Mensah" }, note: "Source: IRCC letter, 13 Oct", height: 56 });
  at(14, 4, { kind: "deadline", title: { left: "Deadline: biometrics", right: "Mei Tanaka" }, note: { left: "Verified", right: "17:00 ET" }, height: 56 });
  const DESIGNER_CALENDAR: CalendarData = {
    tab: "week",
    heading: { title: "This week", copy: "Appointments and deadlines together. Each deadline shows its source and who verified it." },
    week: { days: ["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"].map((label) => ({ label, today: label === "Fri 16" })), hours },
    note: "Deadline reminders go out at 14, 7, 3 and 1 days. The applicant sees times in their own zone (Asia/Kolkata for Priya).",
  };
  const DESIGNER_CAL_RBAR: CalendarRbar = {
    calendar: { month: DESIGNER_RBAR.month, leading: DESIGNER_RBAR.leading, days: DESIGNER_RBAR.days },
    deadlines: [
      { date: "Fri 16 Oct", title: "Biometrics", who: "Mei Tanaka", chip: { tone: "bad", label: "Today" } },
      { date: "Tue 20 Oct", title: "Photo dates", who: "Priya Sharma", chip: { tone: "chg", label: "Verified" } },
      { date: "Fri 30 Oct", title: "Submission", who: "Priya Sharma", chip: { tone: "rev", label: "Verified" } },
    ],
    calendars: [
      { name: "Amara", tool: "Google Calendar", logo: "/assets/logos/integrations/googlecalendar-color.png", chip: { tone: "ok", label: "Synced 09:10" } },
      { name: "Grace", tool: "Outlook", logo: "/assets/logos/integrations/microsoftoutlook-color.svg", chip: { tone: "gr", label: "Not connected" } },
      { name: "Toronto office", tool: "Microsoft 365", logo: "/assets/logos/integrations/microsoft365-color.svg", chip: { tone: "gr", label: "Not connected" } },
    ],
  };

  for (const tab of ["week", "deadlines"] as CalendarTab[]) {
    it(`renders the Calendar page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(CalendarMarkup, { variant: `tab-${tab}` })));
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/calendar" },
            header: createElement(CalendarHeader, { tab, pills: ["Week of 12 Oct 2026", "Times in America/Toronto"] }),
            aside: createElement(CalendarRbarView, { data: DESIGNER_CAL_RBAR }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
          }, createElement(SheetCalendar, { data: { ...DESIGNER_CALENDAR, tab } })),
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

  it("shows an empty week and no sample people for a firm with nothing booked", () => {
    const html = renderToStaticMarkup(
      createElement(Fragment, null,
        createElement(SheetCalendar, {
          data: {
            tab: "week",
            heading: { title: "This week", copy: "Appointments and deadlines together." },
            week: { days: ["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23"].map((label) => ({ label, today: false })), hours: [9, 10].map((h) => ({ label: `${h}:00`, cells: empty() })) },
            note: "Clients see consultation times in their own zone.",
          },
        }),
        createElement(CalendarRbarView, { data: { calendar: { month: "October 2026", leading: 3, days: [{ day: 1 }] }, deadlines: [], calendars: [{ name: "Kim Host", tool: "no calendar connected", logo: null, chip: { tone: "gr", label: "Not connected" } }] } }),
      ),
    );
    expect(html).toContain("No deadlines this month");
    expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Mei Tanaka|Ana Ferreira|Synced/);
  });
});

const FINANCE_STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

function financePage(tab: "recon" | "invoice", body: ReturnType<typeof createElement>) {
  return withoutPreloads(
    renderToStaticMarkup(
      createElement(
        SheetFrame,
        {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/finance" },
          header: createElement(FinanceHeader, { data: { pills: ["CAD", { left: "Northline Immigration", right: "fictional" }], recordPayment: true, invoiceTab: "INV-0218", tab } }),
          statusbar: FINANCE_STATUSBAR,
          after: designerDialogs(),
        },
        body,
      ),
    ),
  );
}

function sameMarkup(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

const DESIGNER_RECON: ReconData = {
  period: "October 2026",
  intro:
    "Monthly three-way check: the adjusted bank balance, the control ledger and the total of all client ledgers must agree. Your accountant validates the chart of accounts before live use (FIN-12).",
  pending: {
    cards: [
      { title: "Adjusted bank balance", value: "CAD 3,308.00", note: "Statement to 16 Oct, bank ••• 4410" },
      { title: "Control ledger", value: "CAD 1,500.00", note: "Client account liability" },
      { title: "Client ledgers, total", value: "CAD 1,500.00", note: "2 clients" },
    ],
    alert: {
      tone: "warn",
      title: ["CAD 1,808.00 difference", "1 outstanding item"],
      copy: "The bank shows Kofi Mensah’s transfer (RBC-55102) that isn’t verified in the ledger yet. Verify it, or record why it’s outstanding, before signing.",
      action: { label: "Verify the payment", primary: true, attrs: { "data-dlg": "dlgVer", "data-fpd": "1" } },
    },
    items: [{ item: ["Deposit not in ledger", "Kofi Mensah"], bank: "16 Oct", ledger: "—", amount: "1,808.00", action: { label: "Verify", attrs: { "data-dlg": "dlgVer", "data-fpd": "1" } } }],
    itemsEmpty: "",
    steps: [
      { state: "now", title: "Prepared by Lena Park (finance)", note: ["Not yet", "waiting for the difference to clear"] },
      { state: "", title: "Reviewed by Amara Osei (practice reviewer)", note: ["After Lena"] },
    ],
    sign: { label: "Sign reconciliation", disabled: true, why: "The difference must be zero or explained first", attrs: {} },
  },
  start: null,
  history: [
    { month: "September 2026", bank: "0.00", control: "0.00", clients: "0.00", signed: "Lena Park and Amara Osei, 2 Oct" },
    { month: "August 2026", bank: "0.00", control: "0.00", clients: "0.00", signed: "Lena Park and Amara Osei, 3 Sep" },
  ],
  historyEmpty: { title: "", copy: "" },
  payouts: null,
};

const DESIGNER_INVOICE: InvoiceViewData = {
  number: "INV-0218",
  client: "Priya Sharma",
  intro: ["Matter NL-2026-0142", "spousal sponsorship. Billed to Priya Sharma; payer Rafael Sharma. Payee: Northline Immigration."],
  badge: { tone: "chg", label: "Partially paid" },
  tags: [
    { label: "Issued", value: "2 Oct 2026" },
    { label: "Balance due", value: "6 Nov 2026" },
  ],
  lock: ["Issued", "can’t be edited"],
  lines: [
    { category: { text: "Professional fee" }, description: { parts: ["Preparation stage, per service agreement S-05"] }, qty: "1", tax: "HST 13%", amount: { text: "1,900.00" } },
    { category: { icon: "percent", text: "Tax" }, description: { parts: ["HST 13% on the professional fee"] }, qty: "—", tax: "—", amount: { text: "247.00" } },
    { category: { text: "Disbursement" }, description: { parts: ["Certified translation, 3 pages (incurred 30 Sep)"] }, qty: "1", tax: "Included", amount: { text: "113.00" } },
    { category: null, description: { bold: true, parts: ["Total"] }, qty: null, tax: null, amount: { bold: true, text: "2,260.00" } },
    { category: null, description: { parts: ["Paid 8 Oct", "card", "RC-0093"] }, qty: null, tax: null, amount: { text: "−1,130.00" } },
    { category: null, description: { bold: true, parts: ["Balance due 6 Nov"] }, qty: null, tax: null, amount: { bold: true, text: "1,130.00" } },
  ],
  allocations: [
    { date: "8 Oct", source: "Card through Northline’s processor", evidence: ["Signed webhook evt_5530", "receipt RC-0093"], amount: "1,130.00", state: { tone: "ok", label: "Reconciled" } },
    { date: "—", source: "Proposed transfer from Priya’s client account", evidence: ["Milestone 1", "needs 2 approvers"], amount: "300.00", state: { tone: "chg", label: "Pending approval" } },
  ],
  allocationsEmpty: "",
  allocationsNote: "A successful checkout page isn’t proof of payment. Only the verified processor event or a reconciled bank line counts (FIN-08).",
  creditNotes: null,
  creditBalance: null,
  preview: {
    src: "/assets/docs/invoice-600.webp",
    srcSet: "/assets/docs/invoice-1200.webp 2x",
    alt: "Invoice INV-0218 from Northline Immigration: professional fee 1,900.00, HST 247.00, translation 113.00, total CAD 2,260.00, 1,130.00 paid, 1,130.00 due 6 November 2026",
  },
  history: [
    { state: "done", title: "Draft", note: ["Created by Lena Park, 1 Oct"] },
    { state: "done", title: "Issued", note: ["2 Oct", "emailed with a portal link only"] },
    { state: "now", title: "Partially paid", note: ["8 Oct", "CAD 1,130.00 allocated"] },
    { state: "", title: "Paid", note: ["When the balance is allocated"] },
  ],
  actions: [
    {
      label: "Send a reminder",
      run: true,
      icon: "bell",
      attrs: { "data-run": "ok", "data-done": "Reminder sent", "data-sub": "Minimal email with a portal link. No amounts in the preview.", "data-fpr": "1" },
    },
    { label: "Issue a credit note", attrs: { "data-dlg": "dlgCN", "data-fpd": "1" } },
    { label: "Record a payment", primary: true, attrs: { "data-dlg": "dlgPay", "data-fpd": "1" } },
  ],
};

describe("Designer fidelity: Finance, Reconciliation and the single invoice", () => {
  it("renders the Reconciliation tab and every dialog exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(FinanceMarkup, { variant: "tab-recon" })));
    sameMarkup(financePage("recon", createElement(SheetFinanceRecon, { data: DESIGNER_RECON })), captured);
  });

  it("renders the single-invoice tab and every dialog exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(FinanceMarkup, { variant: "tab-invoice" })));
    sameMarkup(financePage("invoice", createElement(SheetFinanceInvoice, { data: DESIGNER_INVOICE })), captured);
  });

  it("shows a firm without a reconciliation an honest start, links item actions to Client funds, and wires the dialogs", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const account = "44444444-4444-4444-8444-444444444444";
    const empty = renderToStaticMarkup(
      createElement(SheetFinanceRecon, {
        data: {
          period: null,
          intro: "Synthetic firm",
          pending: null,
          start: { title: "No reconciliation waiting for review", copy: "Prepare one.", action: { label: "Prepare a reconciliation", primary: true, attrs: { "data-dlg": "dlgRec" } } },
          history: [],
          historyEmpty: { title: "No signed reconciliations yet", copy: "x" },
          payouts: null,
        },
      }),
    );
    expect(empty.match(/class="emp"/g)).toHaveLength(2);
    expect(empty).toContain('<button class="btn p sm" data-dlg="dlgRec">Prepare a reconciliation</button>');
    expect(empty).toContain("<h1 class=\"display\">Reconciliation</h1>");
    expect(empty).not.toMatch(/Northline|Kofi|Lena|Amara|RBC-|4410|October 2026/);

    const pending = renderToStaticMarkup(
      createElement(SheetFinanceRecon, {
        data: {
          ...DESIGNER_RECON,
          pending: {
            ...DESIGNER_RECON.pending!,
            items: [{ item: ["Deposit not verified (CF-0003)", "Dana Lee"], bank: "16 Oct", ledger: "—", amount: "50.00", action: { label: "Verify", href: "?tab=funds" } }],
            sign: { label: "Sign reconciliation", disabled: false, why: null, attrs: { "data-dlg": "dlgRecSign" } },
          },
          payouts: { rows: [], empty: "Stripe payouts couldn’t be read right now.", note: "Read-only." },
        },
      }),
    );
    expect(pending).toContain('<td><a class="btn sm" href="?tab=funds">Verify</a></td>');
    expect(pending).toContain('<button class="btn p sm" data-dlg="dlgRecSign">Sign reconciliation</button>');
    expect(pending).not.toContain('class="why"');
    expect(pending).toContain("Card payouts (Stripe)");

    const dialogs = renderToStaticMarkup(
      createElement(ReconDialogs, {
        data: {
          organizationId: org,
          today: "2026-10-18",
          accounts: [{ value: account, label: "Client account ••• 1234", data: { "data-after": "2026-09-30" } }],
          blocked: null,
          pending: { id: account, difference: 500, summary: ["As of 16 October 2026", "difference CAD 5.00"], canSign: false, ownPreparation: false },
        },
      }),
    );
    expect(dialogs).toContain(`data-rec-prepare="1" data-org="${org}" data-today="2026-10-18"`);
    expect(dialogs).toContain(`<option value="${account}" data-after="2026-09-30">Client account ••• 1234</option>`);
    expect(dialogs).toContain(`data-rec-sign="1" data-org="${org}" data-rec="${account}" data-difference="500" disabled=""`);
    expect(dialogs).toContain(`data-rec-discard="1" data-org="${org}" data-rec="${account}"`);
    expect(dialogs).toContain('<option value="reconciled" disabled="">');
    expect(dialogs).toContain("Someone else signs it");
    expect(dialogs).not.toContain("data-toast");
  });

  it("wires the live credit note, review and void dialogs by data attributes, with no Designer toast", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const invoice = "55555555-5555-4555-8555-555555555555";
    const html = renderToStaticMarkup(
      createElement("div", null, [
        createElement(CreditNoteDialog, {
          key: "cn",
          data: { live: { organizationId: org, invoiceId: invoice, invoice: "INV-0001", maxCents: 11_300, hint: "Up to CAD 113.00, the amount not already credited", blocked: null } },
        }),
        createElement(CreditReviewDialog, { key: "cnr", data: { organizationId: org } }),
        createElement(VoidDialog, { key: "void", data: { organizationId: org, invoiceId: invoice, invoice: "INV-0001", blocked: null } }),
      ]),
    );
    expect(html).toContain('<h2 id="dlgCNH">Issue a credit note for INV-0001</h2>');
    expect(html).toContain('<small class="hint" id="cnA-h">Up to CAD 113.00, the amount not already credited</small>');
    expect(html).toContain(`data-cn-submit="1" data-org="${org}" data-invoice="${invoice}" data-max="11300"`);
    expect(html).toContain(`data-cn-issue="1" data-org="${org}"`);
    expect(html).toContain(`data-cn-decline="1" data-org="${org}"`);
    expect(html).toContain('<div class="alert warn" id="cnrSelf" hidden="">');
    expect(html).toContain(`data-void-submit="1" data-org="${org}" data-invoice="${invoice}"`);
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Priya|Lena|CN-0008/);

    const view = renderToStaticMarkup(
      createElement(SheetFinanceInvoice, {
        data: {
          ...DESIGNER_INVOICE,
          number: "INV-0001",
          client: "Dana Lee",
          preview: null,
          creditNotes: {
            rows: [
              { number: "CN-0001", amount: "40.00", reason: "Duplicate line", state: { tone: "ok", label: "Issued" }, pdf: "/api/invoices/credit-notes/x?organizationId=y" },
              { number: "CN-0002", amount: "10.00", reason: "Typo", state: { tone: "rev", label: "Draft", detail: "waiting for review" }, review: { "data-cn-review": "n2", "data-can-issue": "0" } },
            ],
            empty: "",
          },
          creditBalance: { title: "CAD 20.00 to refund to the client", copy: "Refund it separately." },
          actions: [{ label: "Void invoice", attrs: { "data-dlg": "dlgVoid" } }],
        },
      }),
    );
    expect(view).not.toContain("invoice-600.webp");
    expect(view).toContain('<a href="/api/invoices/credit-notes/x?organizationId=y" class="num" style="color:var(--blue)" data-credit-note="1">CN-0001</a>');
    expect(view).toContain('<button class="btn sm" data-cn-review="n2" data-can-issue="0">Review</button>');
    expect(view).toContain("CAD 20.00 to refund to the client");
    expect(view).toContain('<button class="btn sm" data-dlg="dlgVoid">Void invoice</button>');
  });
});

describe("Designer fidelity: portal document review, French reason (live-only addition)", () => {
  it("adds Draft in French with existing classes only and no new styles", () => {
    // Documented live-only addition (2026-10-18, docs/i18n/README.md): the portal Documents page's
    // firm review form (a live control, not Designer markup) gains a "Draft in French" button
    // (btn sm, in a kd-row), a French reason textarea (inp, lang="fr"), and after a machine draft
    // a "Machine draft: check before sending" note (lbl, role="note") with a required check box
    // (lbl). No class, colour, spacing, transition or style is new: the only inline style is the
    // form's existing margin-top. A client who chose French sees the saved French reason in the
    // existing "Why changes are needed" alert, inside <span lang="fr">; English is unchanged.
    const html = renderToStaticMarkup(
      createElement(Review, { organizationId: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", versionId: "v1", expectedVersion: 1 }),
    );
    const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]));
    expect([...classes].sort()).toEqual(["btn sm", "btn sm p", "inp", "kd-row", "lbl"]);
    expect([...html.matchAll(/style="([^"]*)"/g)].map((match) => match[1])).toEqual(["margin-top:12px"]);
    expect(html).toMatch(/<div class="kd-row"><button type="button" class="btn sm" disabled="">Draft in French<\/button><\/div>/);
    expect(html).toContain('lang="fr"');
    expect(html).toContain('aria-label="Reason in French, for a client who prefers French"');
    // The machine-draft note and its check box appear only once there is a machine draft.
    expect(html).not.toContain("Machine draft");
  });
});
