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
import { MatterDocuments } from "@/components/sheet/designer/matter";
import { MatterDocumentReview, type MatterDocumentReviewData } from "@/components/sheet/designer/vo-doc-review";
import { SheetSidebar, type SidebarData } from "@/components/sheet/designer/sidebar";
import { IndexMarkup } from "@/components/sheet/markup/index";
import { MatterMarkup } from "@/components/sheet/markup/matter";
import { MattersMarkup } from "@/components/sheet/markup/matters";
import { SampleModeMarkup } from "@/components/sheet/markup/sample-mode";
import { GoLiveSteps, SAMPLE_COPY, SampleCasePanel, type GoLiveData, type SampleCaseData } from "@/components/sheet/designer/sample-case";
import { GoLiveSwitch } from "@/components/sheet/designer/go-live-switch";
import { SetupBanner } from "@/components/sheet/designer/setup-banner";
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
import { NotificationsHeader, SheetNotifications, type NotificationsData, type NotificationsTab } from "@/components/sheet/designer/notifications";
import { NotificationsMarkup } from "@/components/sheet/markup/notifications";
import { DocumentReviewDialog, DocumentsHeader, SheetDocuments, type DocumentsData, type DocumentsTab } from "@/components/sheet/designer/documents";
import { DocumentsMarkup } from "@/components/sheet/markup/documents";
import { ComposeDialog, InboxHeader, SheetInbox, type ComposeData, type InboxData, type InboxTab } from "@/components/sheet/designer/inbox";
import { InboxMarkup } from "@/components/sheet/markup/inbox";
import { GOVERNMENT_CSS, GovernmentHeader, SheetGovernment, type GovernmentPageData } from "@/components/sheet/designer/government";
import { GovernmentMarkup } from "@/components/sheet/markup/government";
import {
  MatterDecisionsLive,
  MatterSubmissions,
  type MatterDecisionsData,
  type MatterSubmissionsData,
} from "@/components/sheet/designer/matter-government";
import {
  CsvDialog,
  NewLeadDialog,
  PipelineHeader,
  SheetPipeline,
  type CsvDialogData,
  type LeadCard,
  type PipelineColumn,
  type PipelineData,
  type PipelineRow,
  type PipelineTab,
} from "@/components/sheet/designer/pipeline";
import {
  ConflictPanel,
  ConvertDialog,
  DuplicateCompareDialog,
  LeadHeader,
  LostDialog,
  SheetLead,
  type ConvertDialogData,
  type DuplicateCompareData,
  type LeadData,
} from "@/components/sheet/designer/lead";
import { PipelineMarkup } from "@/components/sheet/markup/pipeline";
import { LeadMarkup } from "@/components/sheet/markup/lead";
import { barColor, buildPipeline, ringOffset, type LeadRow, type StageRow } from "@/modules/leads/present";
import { Review } from "@/components/portal/documents-live";
import {
  SettingsFirmHeader,
  SheetSettingsBranding,
  SheetSettingsFirm,
  SheetSettingsLanguage,
  SheetSettingsOffices,
  type BrandingData,
  type FirmData,
  type LanguageData,
  type OfficesData,
  type SettingsTab,
} from "@/components/sheet/designer/settings-firm";
import {
  IntegrationsSettingsHeader,
  SheetIntegrations,
  SheetNotificationPrefs,
  type IntegrationRow,
  type IntegrationsData,
  type NotificationPrefsData,
  type SettingsBell,
  type SettingsTab as IntegrationsSettingsTab,
} from "@/components/sheet/designer/settings-integrations";
import { ComposioDialog } from "@/components/sheet/designer/settings-integrations";
import { composioDialog, integrationsData, notificationPrefsData } from "@/modules/sheet/settings-integrations-present";
import { SettingsMarkup } from "@/components/sheet/markup/settings";
import { SettingsBillingHeader, SheetRetention, SheetSubscription, type RetentionData, type SettingsBillingTab, type SubscriptionData } from "@/components/sheet/designer/settings-billing";
import { retentionPage, subscriptionPage, subscriptionPill } from "@/modules/sheet/settings-billing-present";
import { SettingsHeader, SheetSettingsSecurity, SheetSettingsTeam, type SecurityData, type TeamData } from "@/components/sheet/designer/settings";
import { securityData, teamData } from "@/modules/sheet/settings-present";
import { OffboardDialog, type OffboardDialogData } from "@/components/sheet/designer/settings-staff-admin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

/**
 * The sample-case panel's copy changed on 2026-10-19 (the six steps are an optional tour and a
 * declared licence is enough to invite real clients): text only, same DOM and classes. The capture
 * is compared with those three strings swapped in.
 */
function withSampleCopy(captured: string): string {
  const swaps: [string, string][] = [
    ["When they’re done and your licence check passes, you can invite real clients.", SAMPLE_COPY.lead],
    ["4 sample steps left ", SAMPLE_COPY.left(4)],
    ["Opens after verification", SAMPLE_COPY.why],
  ];
  return swaps.reduce((html, [from, to]) => {
    expect(html).toContain(from);
    return html.replace(from, to);
  }, captured);
}

vi.mock("@/modules/sheet/sample-actions", () => ({ recordSampleStep: async () => ({ ok: true }), switchToLive: async () => ({ ok: true }) }));

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

  it("adds Request a document to the matter page without changing the captured Designer markup", () => {
    // Live only: the header's Request document opens #dReq (data-open) and the dialog sits with
    // the others. With both stripped, the page is exactly the capture.
    const captured = withoutPreloads(renderToStaticMarkup(createElement(MatterMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/matters/priya" },
          header: createElement(MatterTopBar, { data: { ...DESIGNER_MATTER_HEADER, request: true } }),
          aside: createElement(MatterRbar, { data: DESIGNER_MATTER_RBAR }),
          styles: MATTER_CSS,
          after: createElement(MatterDialogs, {
            data: {
              ...DESIGNER_MATTER_DIALOGS,
              request: { organizationId: "org-1", matterId: "m-1", people: [{ id: "p-1", label: "Priya Sharma · Applicant · Portal active" }], today: "2026-10-19", sampleMode: false },
            },
          }),
          statusbar: {
            timezone: "America/Toronto",
            queue: { label: "Reminder queue healthy", detail: "0 retries" },
            sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
          },
        }, createElement(MatterOverview, { data: DESIGNER_MATTER })),
      ),
    );
    expect(live).toContain('<button class="btn p sm" data-open="dReq">');
    expect(live).toContain('<dialog class="dlg wide" id="dReq" aria-labelledby="dReqT">');
    const stripped = live.replace(/<dialog class="dlg wide" id="dReq"[\s\S]*?<\/dialog>/, "").replace(' data-open="dReq"', "");
    expect(stripped).toBe(captured);
  });

  it("renders the sample-mode content exactly as the captured Designer markup (with the 2026-10-19 copy)", () => {
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
    const captured = withSampleCopy(withoutPreloads(content(renderToStaticMarkup(createElement(SampleModeMarkup)))));
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

  it("adds the Finish setup banner and the go-live checklist to the sample-mode page without changing the captured Designer markup", () => {
    // Live only (approved by Francis 2026-10-19): the sample-mode banner first in #content, the
    // licence steps row under the six steps, and Switch to live beside Invite a real client.
    // Each is a whole element; with each one's own markup removed, the page is exactly the capture.
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
    const golive: GoLiveData = {
      licence: { added: false, blocked: false, status: null },
      trialEnded: true,
      remaining: ["Add your CICC licence", "Your trial has ended: choose a plan"],
      owner: true,
    };
    const banner = { firmName: "Northline Immigration", progress: "Still to do: add your CICC licence, choose a plan (your trial has ended).", collapsed: false };
    const content = (html: string) => region(html, '<div id="content">', '<aside id="rbar"');
    const captured = withSampleCopy(withoutPreloads(content(renderToStaticMarkup(createElement(SampleModeMarkup)))));
    const live = withoutPreloads(
      content(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: DESIGNER_SIDEBAR,
            top: { firmName: "Northline Immigration", pills: [] },
            rbar: DESIGNER_RBAR,
            statusbar: { timezone: "America/Toronto", setup: banner },
          }, createElement(SheetHome, {
            data: {
              ...DESIGNER_HOME,
              greeting: "Welcome to Northline, Amara.",
              summary: "You’re exploring with sample data. Everyone here is fictional, so nothing you send reaches a real person.",
            },
            lead: createElement(SampleCasePanel, { data: { ...sample, live: golive } }),
          })),
        ),
      ),
    );
    const parts = [
      renderToStaticMarkup(createElement(SetupBanner, { data: banner })),
      renderToStaticMarkup(createElement(GoLiveSteps, { data: golive })),
      renderToStaticMarkup(createElement(GoLiveSwitch, { data: golive })),
    ];
    for (const part of parts) expect(live).toContain(part);
    expect(parts[0]).toMatch(/^<div class="alert warn" role="status" data-setup-banner="1">/);
    expect(live.indexOf(parts[0])).toBe('<div id="content">'.length);
    const stripped = parts.reduce((html, part) => html.replace(part, ""), live);
    expect(stripped).toBe(captured);
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

describe("Designer fidelity: Notifications", () => {
  const P = (name: string, file: string) => ({ name, avatarUrl: `/assets/${file}.png` });
  const DESIGNER_NOTIFICATIONS: Omit<NotificationsData, "tab"> = {
    unread: 5,
    groups: [
      {
        label: "Today",
        rows: [
          { lead: P("Priya Sharma", "av-priya-applicant"), parts: ["Priya uploaded ", { b: "Relationship photos" }, " (v2)"], time: "09:40", unread: true },
          { lead: "vo", parts: ["Vo drafted a reply to Rafael. It needs your review"], time: "09:12", unread: true },
          { lead: P("Kofi Mensah", "av-kofi-client"), parts: ["Deadline verified for ", { b: "Kofi Mensah" }, ": Fri 30 Oct, 17:00 ET"], time: "08:30", unread: true },
          { lead: "system", parts: ["QuickBooks sync degraded. Retrying, no action needed yet"], time: "07:55", unread: true },
        ],
      },
      {
        label: "Yesterday",
        rows: [
          { lead: P("Lena", "av-lena-finance"), parts: ["Lena approved an earned-fee transfer (1 of 2 approvals)"], time: "16:20", unread: true },
          { lead: P("Daniel", "av-daniel-casemanager"), parts: ["Daniel mentioned you on ", { b: "Tomás Duarte" }], time: "11:05", unread: false },
          { lead: "system", parts: ["DocuSign connection expired. Reconnect in Settings"], time: "10:00", unread: false },
        ],
      },
    ],
  };

  for (const tab of ["all", "mentions", "system"] as NotificationsTab[]) {
    it(`renders the Notifications page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(NotificationsMarkup, { variant: `tab-${tab}` })));
      const data: NotificationsData = { ...DESIGNER_NOTIFICATIONS, tab };
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/notifications" },
            header: createElement(NotificationsHeader, { data }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
          }, createElement(SheetNotifications, { data })),
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

  it("wires live rows and Mark all read by data attributes only, and shows an honest empty state", () => {
    const data: NotificationsData = {
      tab: "all",
      unread: 1,
      organizationId: "00000000-0000-4000-8000-000000000001",
      groups: [{ label: "Today", rows: [{ id: "n1", href: "/sheet/matters/m1?tab=messages&thread=t1", lead: { name: "Synthetic Client" }, parts: ["Synthetic sent a message about ", { b: "Synthetic Client" }], time: "09:40", unread: true }] }],
    };
    const header = renderToStaticMarkup(createElement(NotificationsHeader, { data }));
    expect(header).toContain('<button class="btn s sm" id="mar" data-org="00000000-0000-4000-8000-000000000001">Mark all read</button>');
    expect(header).toContain('<span class="pill">1 unread</span>');
    const view = renderToStaticMarkup(createElement(SheetNotifications, { data }));
    expect(view).toContain('<div class="li nfr rv" style="--i:2" data-notif="n1" data-nav="/sheet/matters/m1?tab=messages&amp;thread=t1"><span class="av" aria-hidden="true">SC</span>');
    // Stripping the live attributes leaves the Designer's row.
    expect(view.replace(/ data-(notif|nav)="[^"]*"/g, "")).toContain('<div class="li nfr rv" style="--i:2"><span class="av"');
    expect(view).not.toMatch(/Priya|Kofi|Northline|QuickBooks|DocuSign/);
    const empty = renderToStaticMarkup(createElement(SheetNotifications, { data: { tab: "mentions", unread: 0, groups: [] } }));
    expect(empty).toContain("No mentions");
    expect(empty).not.toContain("nfr");
  });
});

const RECORDS_STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

type DocChipT = { tone: "ok" | "rev" | "chg" | "bad" | "unv"; label: string };
const OK = (label: string): DocChipT => ({ tone: "ok", label });
const UPLOADED: DocChipT = { tone: "unv", label: "Uploaded" };
const BEING: DocChipT = { tone: "rev", label: "Being reviewed" };
const card = (doc: string, title: string, parts: string[], version: string, when: string, states: DocChipT[]) => ({
  title,
  thumb: { doc },
  meta: { parts, version, when },
  states,
});

const DESIGNER_DOCUMENTS: DocumentsData = {
  tab: "review",
  pills: ["6 to review", "1 quarantined"],
  firmName: "Northline",
  review: {
    rows: [
      { title: "Marriage certificate v2", link: { href: "/sheet/matters/priya?tab=documents" }, person: "Priya Sharma", matter: "NL-2026-0142", uploaded: "16 Oct", scan: OK("Clean"), review: { tone: "rev", label: "Awaiting review" } },
      { title: "Relationship photos (3)", person: "Rafael Sharma", matter: "NL-2026-0142", uploaded: "Today 08:41", scan: OK("Clean"), review: { tone: "rev", label: "Awaiting review" } },
      { title: "Bank statement.pdf.exe", person: "Kofi Mensah", matter: "NL-2026-0131", uploaded: "16 Oct", scan: { tone: "bad", pair: ["Quarantined", "not a PDF"] }, review: "Can’t open" },
      { title: "Employment letter", person: "Kofi Mensah", matter: "NL-2026-0131", uploaded: "15 Oct", scan: OK("Clean"), review: { tone: "rev", label: "Awaiting review" } },
      { title: "Language test report", person: "Ana Ferreira", matter: "NL-2026-0129", uploaded: "14 Oct", scan: OK("Clean"), review: { tone: "chg", label: "Expires in 20 days" } },
      { title: "Olena birth certificate v2", person: "Olena Sharma", matter: "NL-2026-0142", uploaded: "10 Oct", scan: OK("Clean"), review: { tone: "bad", label: "Expired" } },
    ],
  },
  all: {
    cards: [
      card("passport-bio-page", "Passport, bio page", ["Identity", "Priya"], "v1", "3 Oct", [UPLOADED, OK("Accepted")]),
      card("marriage-certificate", "Marriage certificate", ["Relationship", "Priya and Rafael"], "v2", "16 Oct", [UPLOADED, BEING]),
      { title: "Medical history", thumb: { locked: ["Private to Olena", "permission required to view"] }, states: [{ tone: "unv", label: "Locked" }] },
      card("bank-statement", "Bank statement, Aug–Sep", ["Funds and support", "Rafael"], "v1", "14 Oct", [UPLOADED, OK("Accepted")]),
      card("employment-letter", "Employment letter", ["Sponsor income", "Rafael"], "v1", "9 Oct", [UPLOADED, { tone: "chg", label: "Changes needed" }]),
      card("relationship-photos", "Relationship photos, 3 files", ["Relationship", "Rafael"], "v1", "17 Oct", [UPLOADED, BEING]),
      card("language-test", "Language test report", ["Language", "Priya"], "v1", "6 Oct", [UPLOADED, OK("Accepted")]),
      card("preview-checking", "Police certificate, India", ["Background", "Priya"], "v1", "Today 09:02", [{ tone: "unv", label: "Checking file" }]),
      card("police-certificate", "Police certificate, UAE", ["Background", "Priya"], "v1", "15 Oct", [UPLOADED, BEING]),
      card("fallback-heic", "Payslip September.heic", ["Sponsor income", "Rafael"], "v1", "16 Oct", [UPLOADED, BEING]),
      card("fallback-docx", "Letter of support.docx", ["Relationship", "Rafael"], "v1", "16 Oct", [UPLOADED, BEING]),
      card("preview-quarantined", "Scan 0412.pdf", ["Unsorted", "Priya"], "v1", "16 Oct", [{ tone: "bad", label: "Upload failed" }]),
      card("government-letter", "IRCC letter, request for documents", ["Government letter", "Priya"], "v1", "12 Oct", [UPLOADED, OK("Accepted")]),
      card("service-agreement", "Service agreement S-05 v2, signed", ["Agreement", "Priya and Rafael"], "v2", "4 Oct", [UPLOADED, OK("Accepted")]),
      card("receipt", "Receipt RC-0093", ["Payment", "Priya"], "v1", "8 Oct", [UPLOADED]),
      { title: "IRCC account screenshot.png", thumb: { icon: "file-png" }, meta: { parts: ["Government status", "Priya"], version: "v1", when: "15 Oct" }, states: [UPLOADED, BEING] },
      card("package-manifest", "Package manifest, v3 draft", ["Submission", "Daniel"], "v3", "16 Oct", [UPLOADED, BEING]),
    ],
  },
  custody: {
    rows: [
      { original: "Passport (Priya Sharma)", owner: "Priya Sharma", received: "3 Oct", location: ["Toronto office", "safe B, shelf 2"], purpose: "Certified copy", returnBy: ["10 Oct", "returned"], acknowledged: "Signed by Rafael, 10 Oct" },
      { original: "Marriage certificate (original)", owner: "Priya Sharma", received: "14 Oct", location: ["Toronto office", "safe B"], purpose: "Translation", returnBy: "28 Oct", acknowledged: { tone: "chg", label: "Waiting" } },
    ],
  },
};

const DESIGNER_COMPOSE: ComposeData = {
  to: [
    ["Priya Sharma", "NL-2026-0142"],
    ["Rafael Sharma", "NL-2026-0142"],
    ["Kofi Mensah", "NL-2026-0131"],
  ],
  templates: ["None", "Document request", "Appointment reminder", "Payment received"],
  send: { toast: "Message sent", kind: "ok" },
};

const THREAD = (file: string, name: string, line: [string, string], when: string, unread: boolean, selected = false) => ({
  href: "#",
  selected,
  person: { name, avatarUrl: `/assets/${file}.png` },
  unread,
  line,
  when,
});

const DESIGNER_INBOX: InboxData = {
  tab: "conv",
  conv: {
    filters: ["All", "Unread", "Needs a reply", "Critical, needs acknowledgement"],
    threads: [
      THREAD("av-rafael-sponsor", "Rafael Sharma", ["NL-2026-0142", "Uploaded 3 relationship photos. Do these need dates?"], "08:41", true, true),
      THREAD("av-priya-applicant", "Priya Sharma", ["NL-2026-0142", "Can I sign the amendment on my phone?"], "Yesterday", true),
      THREAD("av-kofi-client", "Kofi Mensah", ["NL-2026-0131", "I sent the transfer on Friday. Reference RBC-55102."], "16 Oct", true),
      THREAD("av-ana-client", "Ana Ferreira", ["NL-2026-0129", "The card didn’t go through, can I pay by e-Transfer?"], "12 Oct", true),
      THREAD("av-olena-dependant", "Olena Sharma", ["NL-2026-0142", "Thanks, consent saved."], "10 Oct", false),
    ],
    view: {
      title: ["Rafael Sharma", "NL-2026-0142"],
      role: { tone: "gr", label: "Sponsor" },
      mails: [{ meta: ["Rafael", "today 08:41", "via portal"], body: "I uploaded 3 relationship photos. Do these need dates?", files: ["3 photos", "opened by permissioned link only"] }],
      vo: { draft: "Draft reply: “Thanks Rafael. Please add a short note with the date and place for each photo, in the upload screen.”", sources: ["Sources: request DR-12", "checklist v3"] },
      audience: { title: "Audience: Rafael Sharma (sponsor) and Northline staff on this file", copy: "Priya’s private records can’t be attached to this message." },
      reply: {
        send: { label: "Send to Rafael", attrs: { "data-run": "ok", "data-done": "Sent to Rafael", "data-sub": "He gets an email with a portal link only.", "data-fpr": "1" } },
        note: { "data-toast": "Saved as a staff-only note", "data-sub": "Clients never see staff notes.", "data-fpb": "1" },
        acknowledge: "Ask Rafael to acknowledge",
      },
    },
  },
  triage: {
    copy: "Email imported from the inboxes you connected, limited to the labels you chose. Unknown threads wait here; forwarding an email doesn’t give its sender access to a case (OPS-06).",
    sources: [
      { logo: "/assets/logos/integrations/gmail-color.png", parts: ["amara@northline.example", "label “Clients”"] },
      { logo: "/assets/logos/integrations/microsoftoutlook-color.svg", parts: ["grace@northline.example", "not connected"] },
    ],
    rows: [
      {
        from: "h.rahimi@example.com",
        subject: "Re: work permit documents",
        attachments: [],
        suggestion: ["Lead L4", "Hamid Rahimi"],
        why: ["Email and name match", "2 attributes"],
        actions: [
          { label: "Confirm match", primary: true, attrs: { "data-toast": "Matched to Hamid Rahimi", "data-sub": "Attachments go to review. Sender access unchanged.", "data-fpb": "1" } },
          { label: "Not this person", attrs: { "data-toast": "Left in triage", "data-sub": "", "data-fpb": "1" } },
        ],
      },
      {
        from: "noreply@cic.gc.ca",
        subject: "Your account message (forwarded by Priya)",
        attachments: [{ label: "Attachment", name: "IRCC letter.pdf", doc: "government-letter", image: "government-letter" }],
        suggestion: "NL-2026-0142",
        why: "Forwarded by the client",
        actions: [{ label: "Record as government letter", href: "/sheet/matters/priya?dlg=letter" }],
      },
      {
        from: "family.sharma@example.com",
        subject: "Photos for the file",
        attachments: [],
        suggestion: "2 possible people",
        why: ["Shared family email", "can’t match on email alone"],
        actions: [{ label: "Choose person", attrs: { "data-toast": "Pick Priya, Rafael or Olena", "data-sub": "Never merged on a shared family email.", "data-fpb": "1" } }],
      },
      {
        from: "info@unknown-agency.example",
        subject: "Partnership proposal",
        attachments: [],
        suggestion: "No match",
        why: "—",
        actions: [{ label: "Not case mail", attrs: { "data-toast": "Removed from triage", "data-sub": "", "data-fpb": "1" } }],
      },
    ],
  },
  bounced: {
    alert: {
      title: "Deadline notice to Kofi Mensah bounced",
      parts: ["“A step is due on 30 Oct”", "mailbox full", "17 Oct 07:02. Task created for Daniel Ruiz: call Kofi and confirm by portal."],
      href: "/sheet/tasks",
    },
    rows: [
      { sent: "17 Oct 07:02", to: "Kofi Mensah", notice: "Deadline reminder (critical)", problem: ["Mailbox full", "soft bounce ×3"], followUp: ["Daniel Ruiz", "call today"], state: { tone: "bad", label: "Not delivered" } },
      { sent: "14 Oct 18:10", to: "Ana Ferreira", notice: "Invoice issued", problem: "SMS number unreachable", followUp: "Email delivered instead", state: { tone: "ok", label: "Delivered by email" } },
      { sent: "9 Oct 11:30", to: "Sofia Reyes", notice: "Agreement to sign", problem: "Address doesn’t exist", followUp: ["Lena Park", "confirmed new address"], state: { tone: "ok", label: "Resolved" } },
    ],
  },
  notes: {
    cards: [
      { title: "Office closed 11 Nov", audience: ["All clients", "Remembrance Day"], when: "Scheduled 4 Nov" },
      { title: "New portal sign-in", audience: "All clients with portal access", when: ["Sent 1 Oct", "41 read"] },
    ],
  },
};

describe("Designer fidelity: Documents and Inbox", () => {
  for (const tab of ["review", "all", "custody"] as DocumentsTab[]) {
    it(`renders the Documents page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(DocumentsMarkup, { variant: `tab-${tab}` })));
      const data = { ...DESIGNER_DOCUMENTS, tab };
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/documents" },
            header: createElement(DocumentsHeader, { tab, pills: data.pills }),
            statusbar: RECORDS_STATUSBAR,
          }, createElement(SheetDocuments, { data })),
        ),
      );
      sameMarkup(live, captured);
    });
  }

  for (const tab of ["conv", "triage", "bounced", "notes"] as InboxTab[]) {
    it(`renders the Inbox page (${tab} tab) and its New message dialog exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(InboxMarkup, { variant: `tab-${tab}` })));
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(SheetFrame, {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/inbox" },
            header: createElement(InboxHeader, { tab, pills: ["4 unread", "1 bounced notice"] }),
            statusbar: RECORDS_STATUSBAR,
            after: createElement(ComposeDialog, { data: DESIGNER_COMPOSE }),
          }, createElement(SheetInbox, { data: { ...DESIGNER_INBOX, tab } })),
        ),
      );
      sameMarkup(live, captured);
    });
  }

  it("shows a firm without documents or mail honest empty states, with no sample people", () => {
    for (const tab of ["review", "all", "custody"] as DocumentsTab[]) {
      const html = renderToStaticMarkup(createElement(SheetDocuments, { data: { tab, pills: [], firmName: "Maple Immigration", review: { rows: [] }, all: { cards: [] }, custody: { rows: [] } } }));
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Priya|Kofi|Olena|Rafael|Ana Ferreira|NL-2026/);
    }
    for (const tab of ["conv", "triage", "bounced", "notes"] as InboxTab[]) {
      const html = renderToStaticMarkup(
        createElement(SheetInbox, { data: { tab, conv: { filters: ["All"], threads: [], view: null }, triage: { copy: "x", sources: [], rows: [] }, bounced: { alert: null, rows: [] }, notes: { cards: [] } } }),
      );
      expect(html).toContain('class="emp"');
      expect(html).not.toMatch(/Northline|Priya|Kofi|Olena|Rafael|Ana Ferreira|NL-2026|amara@/);
    }
  });

  it("wires live review links, triage buttons and the review dialog by data attributes, with no Designer toast", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(SheetDocuments, {
          data: {
            tab: "review",
            pills: [],
            firmName: "Maple Immigration",
            review: { rows: [{ title: "Passport", link: { href: "/sheet/matters/m1?tab=documents", attrs: { "data-doc-review": "v1", "data-version": "2" } }, flags: ["review"], person: "Dana Lee", matter: "MI-1", uploaded: "2 Oct", scan: { tone: "ok", label: "Clean" }, review: { tone: "rev", label: "Awaiting review" } }] },
          },
        }),
        createElement(DocumentReviewDialog, { data: { organizationId: org, firmName: "Maple Immigration" } }),
        createElement(SheetInbox, {
          data: {
            tab: "triage",
            triage: {
              copy: "x",
              sources: [{ logo: null, parts: ["maple@docs.casevoya.ca", "firm address"] }],
              rows: [{ from: "dana@example.test", subject: "Files", attachments: [{ label: "Attachment", name: "scan.pdf", image: null }], suggestion: "Dana Lee", why: "x", actions: [{ label: "Confirm match", primary: true, attrs: { "data-inbox-file": "e1" } }, { label: "Not case mail", attrs: { "data-inbox-dismiss": "e1" } }] }],
            },
          },
        }),
      ),
    );
    expect(html).toContain('<tr data-f="review"><td><a href="/sheet/matters/m1?tab=documents" style="color:var(--blue)" data-doc-review="v1" data-version="2">Passport</a></td>');
    expect(html).toContain(`data-doc-review-submit="1" data-org="${org}"`);
    expect(html).toContain('<button class="btn p sm" data-inbox-file="e1">Confirm match</button> <button class="btn sm" data-inbox-dismiss="e1">Not case mail</button>');
    expect(html).toContain('<button type="button" class="doct" aria-label="Attachment · scan.pdf"><span>Attachment <span class="sep" aria-hidden="true"></span> scan.pdf</span></button>');
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Priya|NL-2026/);
  });

  // Inbox replies (live-only additions, no new markup): each New message "To" option carries its
  // matter and person as `value`, and Send carries `data-inbox-compose` + `data-org` instead of the
  // Designer's toast; the conversation's Send carries `data-inbox-reply` and the ids; a sent email
  // is one more `.fp-mail` with "by email" and its status as meta parts.
  it("keeps the New message dialog the Designer's once its live value and Send attributes are stripped", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const captured = withoutPreloads(renderToStaticMarkup(createElement(InboxMarkup, { variant: "tab-conv" })));
    const dialog = captured.slice(captured.indexOf('<dialog class="dlg" id="dlgMsg"'), captured.indexOf("</dialog>", captured.indexOf('id="dlgMsg"')) + "</dialog>".length);
    expect(dialog.length).toBeGreaterThan(100);
    const values = DESIGNER_COMPOSE.to.map((_, index) => `${"4".repeat(8)}-4444-4444-8444-44444444444${index}:${"5".repeat(8)}-5555-4555-8555-55555555555${index}`);
    const live = renderToStaticMarkup(createElement(ComposeDialog, { data: { ...DESIGNER_COMPOSE, toValues: values, send: { attrs: { "data-inbox-compose": "1", "data-org": org } } } }));
    expect(live).toContain(`<option value="${values[0]}">`);
    expect(live).toContain(`<button class="btn p" data-close="dlgMsg" data-inbox-compose="1" data-org="${org}">Send</button>`);
    const stripped = live
      .replace(/ value="[^"]*"/g, "")
      .replace(` data-inbox-compose="1" data-org="${org}"`, ' data-toast="Message sent" data-toast-kind="ok"');
    sameMarkup(stripped, dialog);
  });

  it("shows a sent email in the Designer's thread markup, and wires Send by attributes, with no Designer toast", () => {
    const view = DESIGNER_INBOX.conv!.view!;
    const attrs = { "data-inbox-reply": "e1", "data-org": "o1", "data-matter": "m1", "data-person": "p1", "data-name": "Dana" };
    const html = renderToStaticMarkup(
      createElement(SheetInbox, {
        data: {
          tab: "conv",
          conv: {
            filters: ["All"],
            threads: DESIGNER_INBOX.conv!.threads.slice(0, 1),
            view: {
              ...view,
              vo: null,
              mails: [view.mails[0], { meta: ["Sam", "today 09:12", "by email", "Sent"], body: "Synthetic: please add the dates.", files: null }],
              reply: { ...view.reply, send: { label: "Send to Dana", attrs } },
            },
          },
        },
      }),
    );
    expect(html).toContain(
      '<div class="fp-mail"><small style="color:var(--t2)">Sam <span class="sep" aria-hidden="true"></span> today 09:12 <span class="sep" aria-hidden="true"></span> by email <span class="sep" aria-hidden="true"></span> Sent</small><p style="margin-top:4px">Synthetic: please add the dates.</p></div>',
    );
    expect(html).toContain('<button class="btn p sm" data-inbox-reply="e1" data-org="o1" data-matter="m1" data-person="p1" data-name="Dana"><span class="lab">');
    expect(html).not.toContain("data-run");
  });
});

describe("Designer fidelity: Government status", () => {
  const DESIGNER_GOVERNMENT: GovernmentPageData = {
    intro: "What we know from IRCC, who recorded it, from what evidence, and when we last checked. This is a record kept by the firm, not a live feed.",
    alert: { copy: "The matter is at \u201cSubmitted\u201d in our stages, but no submission confirmation is on file. Upload the IRCC confirmation to verify it." },
    rows: [
      { item: "Submission", status: { tone: "unv", label: "Submission unverified" }, recordedBy: "Amara Osei", evidence: "No confirmation uploaded yet", verified: "\u2014", lastChecked: "Today 09:12" },
      { item: "Application number", status: { tone: "gr", label: "Not yet issued" }, recordedBy: "\u2014", evidence: "\u2014", verified: "\u2014", lastChecked: "\u2014" },
      { item: "Biometrics", status: { tone: "gr", label: "Not requested" }, recordedBy: "\u2014", evidence: "\u2014", verified: "\u2014", lastChecked: "\u2014" },
      {
        item: "Client-uploaded letter",
        status: { tone: "chg", label: "Received", detail: "unverified" },
        recordedBy: "Priya Sharma (client)",
        evidence: "PDF, \u201cIRCC request for info\u201d, 14 Oct",
        verified: "Not verified by staff",
        lastChecked: "14 Oct 18:40",
      },
    ],
    record: { options: [{ label: "Submitted" }, { label: "Application number issued" }, { label: "Biometrics requested" }] },
    history: [
      { text: "Amara checked the IRCC portal. No change.", when: "Today 09:12" },
      { text: "Priya uploaded a letter (unverified).", when: "14 Oct 18:40" },
      { text: "Stage moved to Submitted by Amara.", when: "12 Oct 11:05" },
    ],
  };

  it("renders the Government status page exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(GovernmentMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/government" },
            styles: GOVERNMENT_CSS,
            header: createElement(GovernmentHeader, {
              data: {
                back: "/sheet/matters/priya",
                client: { name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png" },
                pills: ["No live IRCC connection", "Every entry needs a source"],
              },
            }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm \u201cNorthline Immigration\u201d" },
            },
          },
          createElement(SheetGovernment, { data: DESIGNER_GOVERNMENT }),
        ),
      ),
    );
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 120, i + 160) + "\nGOT " + live.slice(i - 120, i + 160));
    }
    expect(live).toBe(captured);
  });

  it("wires live rows by data attributes only, with the Verify and Record status additions", () => {
    const html = renderToStaticMarkup(
      createElement(SheetGovernment, {
        data: {
          ...DESIGNER_GOVERNMENT,
          alert: null,
          rows: [{ ...DESIGNER_GOVERNMENT.rows[3], verify: { "data-gov": "verify-letter", "data-id": "l1", "data-version": "1", "data-org": "o1" } }],
          record: { options: [{ value: "acknowledgement", label: "Acknowledgement of receipt" }], save: { "data-gov": "status", "data-matter": "m1", "data-org": "o1" } },
        },
      }),
    );
    expect(html).not.toContain("Submission unverified");
    expect(html).toContain('<button class="btn s sm" data-gov="verify-letter" data-id="l1" data-version="1" data-org="o1">Verify</button>');
    expect(html).toContain('<input placeholder="Attach the IRCC letter or screenshot" readOnly="" data-gov-file="1"/>');
    expect(html).toContain('<button class="btn p" data-gov="status" data-matter="m1" data-org="o1">Record status</button>');
  });
});

describe("Designer fidelity: matter Submissions and Decisions tabs", () => {
  /** The captured tab's own content, from `#content` to the end of it. */
  function tabContent(variant: string): string {
    const html = renderToStaticMarkup(createElement(MatterMarkup, { variant }));
    const start = html.indexOf('<div id="content">');
    const end = html.indexOf('</div><aside id="rbar"', start);
    // `#content` ends where `#main` closes, just before the right column.
    return html.slice(start, end);
  }
  const content = (child: ReturnType<typeof createElement>) => withoutPreloads(renderToStaticMarkup(createElement("div", { id: "content" }, child)));
  function same(live: string, captured: string) {
    if (live !== captured) {
      let i = 0;
      while (i < live.length && live[i] === captured[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 160) + "\nGOT " + live.slice(i - 160, i + 160));
    }
    expect(live).toBe(captured);
  }
  const AMARA_AV = { name: "Amara Osei", avatarUrl: "/assets/av-amara-consultant.png" };
  const DANIEL_AV = { name: "Daniel Ruiz", avatarUrl: "/assets/av-daniel-casemanager.png" };
  const LENA_AV = { name: "Lena", avatarUrl: "/assets/av-lena-finance.png" };

  function submissions(ready: boolean): MatterSubmissionsData {
    const check = (title: string, done: boolean, note?: string) => ({ title, done, note: note ?? null });
    return {
      package: {
        title: ["Package v3", "draft"],
        badge: ready ? { tone: "blue", label: "Ready for consultant review" } : { tone: "chg", label: "Not ready to submit" },
        hash: "sha256 9be2…11c4",
        manifest: { title: "Manifest · package v3", label: ["Manifest", "package v3"] },
        checks: [
          check("Intake answers reviewed", true),
          check("All required documents accepted by firm", ready, ready ? undefined : "3 outstanding"),
          check("Forms filled from approved facts", ready, ready ? undefined : "IMM 5406 missing 2 facts"),
          check("Consultant review of package v3", false),
          check("Client confirmation, Priya and Rafael", false),
          check("Representative authority (IMM 5476) signed", true),
          check("Government fees recorded with source", true),
        ],
        approvals: [
          { person: AMARA_AV, title: "Consultant review", who: ["Amara Osei", "licensed consultant"], badge: { tone: "gr", label: "Waiting for checklist" } },
          { person: { name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png" }, title: "Client confirmation", who: ["Priya Sharma", "applicant"], badge: { tone: "gr", label: "Not sent" } },
          { person: { name: "Rafael Sharma", avatarUrl: "/assets/av-rafael-sponsor.png" }, title: "Client confirmation", who: ["Rafael Sharma", "sponsor"], badge: { tone: "gr", label: "Not sent" } },
        ],
        note: "Approvals are tied to this exact package hash. Changing a reviewed fact or document makes a new version and clears these approvals.",
        hold: ready ? {} : null,
        why: ready ? null : { text: "Opens when every checklist item is done", link: { href: "?tab=submissions&ready=1", label: "Preview a ready package" } },
        preview: "Package manifest, v3 draft",
      },
      records: [],
      record: null,
      earlier: [],
    };
  }

  it("renders the Submissions tab (not ready and ready) exactly as the captured Designer markup", () => {
    same(content(createElement(MatterSubmissions, { data: submissions(false) })), tabContent("tab-submissions"));
    same(content(createElement(MatterSubmissions, { data: submissions(true) })), tabContent("tab-submissions--ready-1"));
  });

  const PREVIEW_NOTE = "Sample previews. Priya’s real file has no decision yet.";

  it("renders the Decisions tab with no decision exactly as the captured Designer markup", () => {
    const data: MatterDecisionsData = {
      preview: { selected: "none", note: PREVIEW_NOTE },
      decision: null,
      letter: true,
      letters: [
        {
          dot: "#0075DE",
          title: ["IRCC request letter", "additional documents"],
          parts: ["Received 12 Oct by portal message", "recorded by Daniel", "created the 30 Oct deadline"],
          badge: { tone: "ok", label: "Deadline verified" },
          thumb: "IRCC request letter, 8 Oct",
        },
        { dot: "#2e9d5b", title: "Acknowledgement of receipt", parts: ["Received 20 Sep", "recorded by Daniel"], badge: { tone: "gr", label: "Filed" } },
      ],
    };
    same(content(createElement(MatterDecisionsLive, { data })), tabContent("tab-decisions"));
  });

  it("renders the approved, refused and withdrawn decisions exactly as the captured Designer markup", () => {
    const approved: MatterDecisionsData = {
      preview: { selected: "approved", note: PREVIEW_NOTE },
      letter: true,
      letters: [],
      decision: {
        outcome: "approved",
        heading: "Approved",
        milestoneLabel: "final approval",
        tint: { art: "post-decision", title: "Follow-ups after the decision", copy: "Renewal and expiry reminders are proposed here for your review." },
        badge: { tone: "ok", label: "Confirmed by Amara Osei, 3 Mar 2027" },
        evidence: { line: ["IRCC decision letter", "received 2 Mar 2027", "recorded by Daniel"], thumb: { title: "IRCC decision letter, 2 Mar 2027" } },
        milestones: [
          { label: "Approval in principle", badge: { tone: "ok", label: "18 Jan" } },
          { label: "Final approval", badge: { tone: "ok", label: "2 Mar" } },
          { label: "Documents issued", badge: { tone: "rev", label: "Waiting" } },
          { label: "Landing confirmed", badge: { tone: "gr", label: "Not yet" } },
          { label: "Status expiry", badge: { tone: "gr", label: "Add when issued" } },
        ],
        summary: { title: "Conditions summary", copy: "Draft by Vo from the letter. Amara must approve it before Priya sees it.", review: true },
        followUps: [
          { title: "Send consultant-approved conditions summary to Priya", note: "Due 6 Mar", owner: AMARA_AV },
          { title: "Record document delivery", note: "When issued", owner: DANIEL_AV },
          { title: "Add status expiry reminder", note: "When issued", owner: DANIEL_AV },
          { title: "Closure checklist", note: "After landing", owner: AMARA_AV },
        ],
      },
    };
    same(content(createElement(MatterDecisionsLive, { data: approved })), tabContent("tab-decisions--outcome-approved"));

    const decided = { art: "p3-decision", title: "Decision recorded from the letter", copy: "Any reconsideration or new-application deadline is proposed for your review, never set automatically." };
    const refused: MatterDecisionsData = {
      preview: { selected: "refused", note: PREVIEW_NOTE },
      letter: true,
      letters: [],
      decision: {
        outcome: "refused",
        heading: "Refused",
        tint: decided,
        badge: { tone: "bad", label: "Urgent consultant review" },
        record: { received: "2 Mar 2027", recordedBy: "Daniel Ruiz", confirmedBy: "Waiting for Amara" },
        reasons: "The officer is not satisfied that the relationship is genuine…",
        reasonsSource: "Quoted from the letter, page 1",
        interpretation: null,
        consultantFirst: "Amara",
        followUps: [
          { title: "Urgent: consultant review of refusal", note: "Due today", owner: AMARA_AV, urgent: true },
          { title: "Explain the decision to Priya and Rafael", note: "After review", owner: AMARA_AV },
          { title: "Decide next steps with the client (new linked matter if any)", note: "After meeting", owner: AMARA_AV },
          { title: "Reconcile the client account", note: "Within 7 days", owner: LENA_AV },
        ],
      },
    };
    same(content(createElement(MatterDecisionsLive, { data: refused })), tabContent("tab-decisions--outcome-refused"));

    const step = (title: string, note: string, done: boolean) => ({ title, note, done });
    const withdrawn: MatterDecisionsData = {
      preview: { selected: "withdrawn", note: PREVIEW_NOTE },
      letter: true,
      letters: [],
      decision: {
        outcome: "withdrawn",
        heading: "Withdrawal",
        tint: decided,
        badge: { tone: "chg", label: "In progress, 2 of 5" },
        steps: [
          step("Written instructions from Priya", "Signed in portal, 1 Feb", true),
          step("Consultant review", "Amara Osei, 2 Feb", true),
          step("Withdrawal request sent to IRCC", "Record the confirmation", false),
          step("IRCC acknowledgement received", "Add the letter when it arrives", false),
          step("Financial reconciliation", "Advance CAD 1,500 to refund or apply", false),
        ],
        followUps: [],
      },
    };
    same(content(createElement(MatterDecisionsLive, { data: withdrawn })), tabContent("tab-decisions--outcome-withdrawn"));
  });
});

describe("Designer fidelity: Lead pipeline", () => {
  const DANIEL = { name: "Daniel Ruiz", avatarUrl: "/assets/av-daniel-casemanager.png" };
  const card = (
    id: string,
    bar: string,
    name: string,
    program: string,
    source: string,
    owner: typeof AMARA,
    fee: string,
    extra: Partial<LeadCard> = {},
  ): LeadCard => ({ id, bar, name, program, source, owner, fee, ...extra });
  const columns: PipelineColumn[] = [
    {
      label: "New",
      total: "CAD 6,200",
      count: "2 leads",
      offset: "21.980000000000004",
      cards: [
        card("L1", "#0075DE", "Wei & Lin Zhang", "Study permit", "Website form", DANIEL, "CAD 2,400", { chip: { tone: "dt", label: "Today" } }),
        card("L2", "#111", "Kofi Mensah", "Express Entry", "Referral", AMARA, "CAD 3,800"),
      ],
    },
    {
      label: "Contacted",
      total: "CAD 7,100",
      count: "2 leads",
      offset: "21.980000000000004",
      cards: [
        card("L3", "#62aef0", "Sofia Reyes", "Spousal sponsorship", "Hosted page", AMARA, "CAD 4,200", { chip: { tone: "od", label: "3d" }, ai: "Send consultation booking link" }),
        card("L4", "#0075DE", "Hamid Rahimi", "Work permit", "Phone", DANIEL, "CAD 2,900", { flag: "Possible duplicate of H. Rahimi (2024)" }),
      ],
    },
    {
      label: "Consultation scheduled",
      total: "CAD 900",
      count: "1 lead",
      offset: "34.54",
      cards: [card("L5", "#8c8781", "Ana Ferreira", "Visitor record", "Website form", AMARA, "CAD 900", { chip: { tone: "dt", label: "Thu 10:30" } })],
    },
    {
      label: "Consultation completed",
      total: "CAD 5,200",
      count: "1 lead",
      offset: "34.54",
      cards: [card("L6", "#62aef0", "Tomás Duarte", "PR — family", "Referral", AMARA, "CAD 5,200", { ai: "Draft a proposal from consultation notes" })],
    },
    {
      label: "Qualified",
      total: "CAD 6,000",
      count: "2 leads",
      offset: "21.980000000000004",
      cards: [
        card("L7", "#0075DE", "Grace Okafor", "Study permit", "Event", DANIEL, "CAD 2,400", { chip: { tone: "od", label: "1d" } }),
        card("L8", "#111", "Yusuf Demir", "Express Entry", "Website form", AMARA, "CAD 3,600"),
      ],
    },
    {
      label: "Proposal sent",
      total: "CAD 3,100",
      count: "1 lead",
      offset: "34.54",
      cards: [card("L9", "#0075DE", "Mei Tanaka", "Work permit", "Referral", AMARA, "CAD 3,100", { ai: "Follow up on proposal sent 6 days ago" })],
    },
    {
      label: "Converted",
      total: "CAD 4,600",
      count: "1 lead",
      offset: "34.54",
      cards: [card("L10", "#62aef0", "Priya Sharma", "Spousal sponsorship", "Referral", AMARA, "CAD 4,600")],
    },
    { label: "Lost", total: "CAD 0", count: "0 leads", offset: "47.099999999999994", cards: [] },
  ];
  const row = (n: number, name: string, stage: string, program: string, source: string, owner: string, fee: string, next: string, duplicate = false): PipelineRow => ({
    href: `/sheet/lead?id=L${n}`,
    name,
    duplicate,
    stage,
    program,
    source,
    owner,
    fee,
    next,
  });
  const rows: PipelineRow[] = [
    row(1, "Wei & Lin Zhang", "New", "Study permit", "Website form", "Daniel Ruiz", "2,400.00", "Today"),
    row(2, "Kofi Mensah", "New", "Express Entry", "Referral", "Amara Osei", "3,800.00", "—"),
    row(3, "Sofia Reyes", "Contacted", "Spousal sponsorship", "Hosted page", "Amara Osei", "4,200.00", "3d"),
    row(4, "Hamid Rahimi", "Contacted", "Work permit", "Phone", "Daniel Ruiz", "2,900.00", "—", true),
    row(5, "Ana Ferreira", "Consultation scheduled", "Visitor record", "Website form", "Amara Osei", "900.00", "Thu 10:30"),
    row(6, "Tomás Duarte", "Consultation completed", "PR — family", "Referral", "Amara Osei", "5,200.00", "—"),
    row(7, "Grace Okafor", "Qualified", "Study permit", "Event", "Daniel Ruiz", "2,400.00", "1d"),
    row(8, "Yusuf Demir", "Qualified", "Express Entry", "Website form", "Amara Osei", "3,600.00", "—"),
    row(9, "Mei Tanaka", "Proposal sent", "Work permit", "Referral", "Amara Osei", "3,100.00", "—"),
    row(10, "Priya Sharma", "Converted", "Spousal sponsorship", "Referral", "Amara Osei", "4,600.00", "—"),
  ];
  const timeline = [
    { when: "Today", who: "Wei & Lin Zhang", what: "first reply due" },
    { when: "Thu 10:30", who: "Ana Ferreira", what: "consultation" },
    { when: "Fri", who: "Mei Tanaka", what: "proposal follow-up (6 days)" },
    { when: "Mon", who: "Grace Okafor", what: "qualified, send quote" },
  ];
  const STAGE_COUNTS: [string, string][] = [
    ["New", "2"],
    ["Contacted", "2"],
    ["Consultation scheduled", "1"],
    ["Consultation completed", "1"],
    ["Qualified", "2"],
    ["Proposal sent", "1"],
    ["Converted", "1"],
    ["Lost", "0"],
  ];
  const IDS: Record<PipelineTab, [string, string]> = { list: ["gsvh6uu", "gswwjna"], timeline: ["gsgnass", "gss4e7a"], board: ["gs0h2y1", "gszrsyz"] };
  const filters = (tab: PipelineTab): PipelineData["filters"] => [
    {
      id: "gsS",
      listId: IDS[tab][0],
      key: "Stage",
      value: "All stages",
      options: [{ label: "All stages", selected: true }, ...STAGE_COUNTS.map(([label, count]) => ({ label, count, selected: false }))],
    },
    {
      id: "gsO",
      listId: IDS[tab][1],
      key: "Owner",
      value: "Anyone",
      options: [
        { label: "Anyone", selected: true },
        { label: "Daniel Ruiz", count: "3", selected: false },
        { label: "Amara Osei", count: "7", selected: false },
      ],
    },
  ];
  const CSV: CsvDialogData = {
    file: { name: "leads-oct.csv", rows: "26 rows" },
    map: [
      { column: "Name", sample: "Mina Tehrani", field: "Name" },
      { column: "Contact", sample: "mina.t@example.com", field: "Email" },
      { column: "Phone", sample: "+1 416 555 0182", field: "Phone" },
      { column: "Interest", sample: "Study permit", field: "Service interest" },
      { column: "Heard via", sample: "Instagram", field: "Source" },
      { column: "Notes", sample: "“wants Jan intake”", field: "First note" },
    ],
    duplicates: { title: "2 possible duplicates", copy: "Matched on name and phone. You’ll compare each one before anything is linked." },
    submit: { label: "Import 26 leads", toast: { title: "26 leads imported", sub: "2 possible duplicates are waiting in New for you to compare." } },
  };
  const statusbar = {
    timezone: "America/Toronto",
    queue: { label: "Reminder queue healthy", detail: "0 retries" },
    sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
  };

  for (const tab of ["board", "list", "timeline"] as PipelineTab[]) {
    it(`renders the Lead pipeline (${tab} tab) and the CSV dialog exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(PipelineMarkup, { variant: `tab-${tab}` })));
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(
            SheetFrame,
            {
              sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/pipeline" },
              header: createElement(PipelineHeader, { data: { tab, pills: ["10 open leads", "Proposed fees CAD 33,100"] } }),
              statusbar,
              title: "Lead pipeline",
              trailing: createElement(CsvDialog, { data: CSV }),
            },
            createElement(SheetPipeline, { data: { tab, filters: filters(tab), columns, rows, timeline } }),
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
  }

  it("renders the board from real leads shaped like the Designer sample exactly as captured, apart from the documented live attributes", () => {
    // buildPipeline from database rows: one stage per Designer column, leads with the Designer's
    // names, owners and fees. The live-only attributes (data-org, data-stage-id, data-kind,
    // data-version, data-href) are stripped. What live data has differently from the sample is put
    // into the expected render: no Vo drafts (Vo is off), and no follow-up chips or duplicate flags
    // (these rows have none), the computed ring and bar colour, and this firm's filter ids.
    const now = new Date("2026-10-16T14:00:00Z");
    const stageKeys = ["new", "contacted", "consultation_scheduled", "consultation_completed", "qualified", "proposal_sent", "converted", "lost"];
    const stages: StageRow[] = STAGE_COUNTS.map(([label], index) => ({
      id: `s${index}`,
      key: stageKeys[index],
      label,
      kind: index === 6 ? "converted" : index === 7 ? "lost" : "open",
      position: index + 1,
    }));
    const owners = new Map([
      ["m-daniel", DANIEL],
      ["m-amara", AMARA],
    ]);
    const SOURCES: Record<string, string> = { "Website form": "web_form", Referral: "referral", "Hosted page": "hosted_page", Phone: "phone", Event: "event" };
    const leads: LeadRow[] = columns.flatMap((column, index) =>
      column.cards.map((c) => ({
        id: c.id,
        display_name: c.name,
        email: null,
        phone: null,
        date_of_birth: null,
        service_interest: c.program,
        source: SOURCES[c.source] ?? "other",
        source_detail: null,
        stage_id: `s${index}`,
        owner_membership_id: c.owner === DANIEL ? "m-daniel" : "m-amara",
        proposed_fee_cents: Number(c.fee.replace(/\D/g, "")) * 100,
        same_person_lead_id: null,
        converted_at: index === 6 ? "2026-10-10T00:00:00Z" : null,
        lost_at: null,
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
        version: 1,
        is_sample: false,
      })),
    );
    const built = buildPipeline({
      tab: "board",
      stages,
      leads,
      followUps: [],
      bookings: [],
      decisions: [],
      owners,
      filter: { stage: null, owner: null },
      organizationId: "org-1",
      timeZone: "America/Toronto",
      now,
    });
    const strip = (html: string) => html.replace(/ data-(org|stage-id|kind|version|href)="[^"]*"/g, "");
    const real = strip(renderToStaticMarkup(createElement(SheetPipeline, { data: built.data })));
    const designer = renderToStaticMarkup(
      createElement(SheetPipeline, {
        data: {
          tab: "board",
          filters: [
            { ...built.data.filters[0], options: built.data.filters[0].options.map((o) => ({ ...o, data: undefined })) },
            { ...built.data.filters[1], options: built.data.filters[1].options.map((o) => ({ ...o, data: undefined })) },
          ],
          columns: columns.map((column) => ({
            ...column,
            offset: ringOffset(column.cards.length),
            cards: column.cards.map((c) => ({ ...c, ai: null, flag: null, chip: null, bar: barColor(c.program) })),
          })),
          rows: [],
          timeline: [],
        },
      }),
    );
    expect(real).toBe(designer);
    // The Designer's own column totals and counts come out of the real rows unchanged.
    for (const column of columns) expect(real).toContain(`<span class="num">${column.total}</span> <span class="sep" aria-hidden="true"></span> ${column.count}`);
    expect(built.pills).toEqual(["9 open leads", "Proposed fees CAD 28,500"]);
    expect(real).not.toContain("aichip");
  });

  it("shows a firm without leads the Designer's empty columns and empty states, with no sample people", () => {
    const now = new Date("2026-10-16T14:00:00Z");
    const stages: StageRow[] = [
      { id: "a", key: "new", label: "New", kind: "open", position: 1 },
      { id: "b", key: "converted", label: "Converted", kind: "converted", position: 7 },
      { id: "c", key: "lost", label: "Lost", kind: "lost", position: 8 },
      { id: "d", key: "archived", label: "Archived", kind: "archived", position: 9 },
    ];
    for (const tab of ["board", "list", "timeline"] as PipelineTab[]) {
      const built = buildPipeline({ tab, stages, leads: [], followUps: [], bookings: [], decisions: [], owners: new Map(), filter: { stage: null, owner: null }, organizationId: "o", timeZone: "America/Toronto", now });
      const html = renderToStaticMarkup(createElement(SheetPipeline, { data: built.data }));
      expect(html).not.toMatch(/Northline|Amara|Daniel|Hamid|Priya|Wei &amp; Lin|demo/);
      expect(html).not.toContain("Archived");
      if (tab === "board") expect(html.match(/No leads here yet\./g)).toHaveLength(3);
      else expect(html).toContain('class="emp"');
      expect(built.pills).toEqual(["0 open leads", "Proposed fees CAD 0"]);
    }
  });

  it("wires the live header, board and CSV dialog by data attributes, with no Designer toast", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(PipelineHeader, { data: { tab: "board", pills: ["1 open lead"], csv: { "data-dlg": "dlgCsv", "data-fpd": "1" }, newLead: { "data-lead-open": "new" } } }),
        createElement(CsvDialog, { data: { file: null, map: [], submit: { label: "Import leads", data: { "data-lead-act": "import", "data-org": "o1" } }, input: createElement("input", { type: "file", id: "csvIn", hidden: true }) } }),
        createElement(NewLeadDialog, { data: { organizationId: "o1", owners: [{ value: "m1", label: "Kim Host" }], owner: "m1", sampleMode: false } }),
      ),
    );
    expect(html).toContain('<button class="btn s sm" data-dlg="dlgCsv" data-fpd="1">');
    expect(html).toContain('href="/sheet/lead?new=1" data-lead-open="new"');
    expect(html).toContain('<button class="btn p" data-lead-act="import" data-org="o1">Import leads</button>');
    expect(html).toContain('<h4 style="font-size:14px;font-weight:500;margin:14px 0 6px" id="csvName" hidden=""></h4>');
    expect(html).toContain('data-csv-choose="1"');
    expect(html).toContain('data-lead-act="create" data-org="o1"');
    // Reply consent and marketing consent are two separate boxes, neither ticked.
    expect(html).toContain('id="nlR"');
    expect(html).toContain('id="nlM"');
    expect(html).not.toMatch(/checked/);
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Mina Tehrani|leads-oct/);
  });
});

describe("Designer fidelity: Lead", () => {
  const LEAD: LeadData = {
    name: "Hamid Rahimi",
    summary: { left: "Work permit", right: "from phone. Passports and detailed histories wait until they’re needed (CRM-01)." },
    duplicate: { title: "Possible duplicate: Hamid Rahimi (2024 lead)", copy: "Same name and date of birth; different email. Nothing is merged until you confirm." },
    notes: [{ who: "Daniel Ruiz", when: "15 Oct", body: "Called. Works in Toronto on a closed work permit expiring Feb 2027. Wants to know about an LMIA-based renewal." }],
    followUps: [
      { task: "Send consultation link", owner: "Daniel Ruiz", due: "Mon 19 Oct" },
      { task: "Conflict check", owner: "Amara Osei", due: "Before booking" },
    ],
    contact: [
      { term: "Preferred contact", value: "Phone, then email" },
      { term: "Language", value: "English, Dari" },
      { term: "Country now", value: "Canada" },
      { term: "Consent", value: { left: "Service messages", right: "15 Oct, web form" } },
      { term: "Marketing", value: "Opted out" },
      { term: "Tags", value: "work permit, renewal" },
      { term: "Owner", value: "Daniel Ruiz" },
      { term: "Proposed fee", value: "CAD 2,900.00 (firm’s fee, demo)" },
    ],
  };
  const CONVERT: ConvertDialogData = {
    programs: [{ label: { left: "Work permit (LMIA-based)", right: "v2 draft" } }, { label: { left: "Visitor record", right: "v3" } }],
    consultants: [{ label: "Amara Osei" }, { label: "Grace Lin (licence check pending: can’t sign yet)" }],
    submit: { toast: { title: "Matter NL-2026-0151 created", sub: "Stage: Engagement pending." } },
  };
  const DUP: DuplicateCompareData = {
    other: "2024 lead",
    rows: [
      { label: "Name", other: "Hamid Rahimi", mine: "Hamid Rahimi" },
      { label: "Date of birth", other: "1990-06-02", mine: "1990-06-02" },
      { label: "Email", other: "h.rahimi@example.com", mine: "hamid.r@example.org" },
    ],
    different: {},
    same: { toast: { title: "Linked to the same person", sub: "Both leads stay, under one person." } },
  };

  it("renders the lead page and its Convert and Compare dialogs exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(LeadMarkup, {})));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/lead" },
            header: createElement(LeadHeader, { data: { name: "Hamid Rahimi", pills: ["Contacted", "Phone"], book: { href: "/sheet/consultations" } } }),
            statusbar: {
              timezone: "America/Toronto",
              queue: { label: "Reminder queue healthy", detail: "0 retries" },
              sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
            },
            after: createElement(Fragment, null, createElement(ConvertDialog, { data: CONVERT }), createElement(DuplicateCompareDialog, { data: DUP })),
          },
          createElement(SheetLead, { data: LEAD }),
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

  it("wires the live lead page by data attributes, with its live panels, and no Designer toast or sample values", () => {
    const wire = { "data-org": "o1", "data-lead": "l1", "data-version": "4" };
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(LeadHeader, { data: { name: "Sam Example", pills: ["New", "Phone"], book: { href: "/book/maple/initial" }, convert: {} } }),
        createElement(SheetLead, {
          data: {
            name: "Sam Example",
            summary: { left: "Study", right: "from phone." },
            notes: [],
            noteSave: { "data-lead-act": "note", ...wire },
            followUps: [{ task: "Call back", owner: "Kim Host", due: "Mon 19 Oct", done: { "data-lead-act": "follow-done", "data-follow-up": "f1", "data-org": "o1" } }],
            followUpLive: { add: { "data-lead-open": "follow-up" }, empty: "No follow-ups yet." },
            contact: [{ term: "Marketing", value: "Not given" }],
            leftAfter: createElement(ConflictPanel, { data: { state: { tone: "unv", label: "Not checked yet" }, checked: null, note: null, open: { "data-lead-open": "conflict", ...wire } } }),
          },
        }),
        createElement(ConvertDialog, {
          data: {
            programs: [{ label: "Choose later", value: "" }],
            consultants: [{ label: "Kim Host", value: "m1" }],
            warning: { title: "Run the conflict check first", copy: "A lead converts after a conflict check with no conflict is recorded." },
            submit: { data: { "data-lead-act": "convert", ...wire } },
          },
        }),
        createElement(DuplicateCompareDialog, {
          data: { other: "2025 lead", rows: [], different: { data: { "data-lead-act": "dup-different", "data-other": "l0", ...wire } }, same: { data: { "data-lead-act": "dup-same", "data-other": "l0", ...wire } } },
        }),
        createElement(LostDialog, { data: { "data-lead-act": "lost", ...wire } }),
      ),
    );
    expect(html).toContain('<a class="btn sm" href="/book/maple/initial">Book consultation</a>');
    expect(html).toContain('data-fpr="1" data-lead-act="note" data-org="o1" data-lead="l1" data-version="4"');
    expect(html).toContain('data-lead-act="follow-done" data-follow-up="f1"');
    expect(html).toContain('<button class="btn p" data-lead-act="convert" data-org="o1" data-lead="l1" data-version="4">Create matter</button>');
    expect(html).toContain("Run the conflict check first");
    expect(html).toContain('data-lead-act="dup-same" data-other="l0"');
    expect(html).toContain('data-lead-act="lost"');
    expect(html).toContain("Not checked yet");
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Hamid|Daniel|Amara|NL-2026|CRM-01/);
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


describe("Designer fidelity: Settings, Firm, Offices, Branding and Language and time", () => {
  const DESIGNER_FIRM: FirmData = {
    firmName: "Northline Immigration",
    rows: [
      { label: "Legal name", value: "Northline Immigration Services Inc. (fictional)" },
      { label: "Display name", value: "Northline Immigration" },
      { label: "Organisation ID", value: "org_7Q2KX", num: true },
      { label: "Jurisdictions", value: { parts: ["Canada", "IRCC"] } },
      { label: "Billing contact", value: "Lena Park" },
      { label: "Privacy contact", value: "Amara Osei" },
      { label: "Continuity contact", value: { parts: ["Grace Lin", "succession plan on file (ORG-06)"] } },
    ],
  };
  const DESIGNER_OFFICES: OfficesData = {
    intro: "Offices can limit what staff see.",
    rows: [
      { label: "Toronto", address: "100 Front St W, Suite 400 (fictional)", timezone: "America/Toronto", staff: "5" },
      { label: "Ottawa (remote)", address: "—", timezone: "America/Toronto", staff: "1" },
    ],
    empty: "",
    canEdit: false,
  };
  const DESIGNER_BRANDING: BrandingData = {
    firmName: "Northline",
    figures: [
      { box: "brd-l", images: [{ src: "/assets/firms/northline-lockup.svg", alt: "Northline Immigration logo, full colour", height: 36 }], caption: ["Logo", "light backgrounds"] },
      { box: "brd-d", images: [{ src: "/assets/firms/northline-lockup-white.svg", alt: "Northline Immigration logo, white", height: 36 }], caption: ["Logo", "portal header and dark emails"] },
      {
        box: "brd-s",
        images: [
          { src: "/assets/firms/northline-tile.svg", alt: "Northline square tile", width: 56, height: 56 },
          { picture: { srcSet: "/assets/firms/northline-mark.svg", type: "image/svg+xml" }, src: "/assets/firms/northline-mark-512.png", alt: "Northline mark, 512 pixel upload", width: 56, height: 56 },
          { src: "/assets/firms/northline-glyph-128.png", alt: "Northline glyph, favicon size", width: 28, height: 28 },
        ],
        caption: ["Square mark", "uploaded 512 × 512 PNG"],
      },
    ],
    colourTag: "Firm colour #0A4B93",
    replace: { label: "Replace logo" },
    note: "Portal buttons keep Casevoya’s accessible blue; the firm colour is used in the header and emails.",
    preview: { kind: "image", src: "/assets/email/header-firm.png", alt: "Northline Immigration email header" },
  };
  const DESIGNER_LANGUAGE: LanguageData = {
    rows: [
      { name: "Amara Osei", language: "English", timezone: "America/Toronto" },
      { name: "Priya Sharma", language: "English (Hindi spoken)", timezone: "Asia/Kolkata" },
      { name: "Olena Sharma", language: "English", timezone: "America/Toronto" },
    ],
    empty: "",
    alert: {
      title: "French is ready, not switched on",
      body: "Layouts allow 30% longer text. Translations are deferred until Francis decides; professional templates need their own review.",
    },
  };

  /** Live-only additions: the Client portal header link and the row/button dialog hooks. */
  function liveOnly(html: string): string {
    return html.replace(/<a class="btn sm" href="\/sheet\/settings\?tab=portal" data-live-link="portal">Client portal<\/a>/, "").replace(/ data-(dlg|office)="[^"]*"/g, "");
  }

  function page(tab: SettingsTab, body: ReturnType<typeof createElement>) {
    return liveOnly(
      withoutPreloads(
        renderToStaticMarkup(
          createElement(
            SheetFrame,
            {
              sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/settings" },
              header: createElement(SettingsFirmHeader, { data: { tab, firmName: "Northline Immigration", plan: "Plan: Practice (fictional)" } }),
              statusbar: {
                timezone: "America/Toronto",
                queue: { label: "Reminder queue healthy", detail: "0 retries" },
                sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
              },
            },
            body,
          ),
        ),
      ),
    );
  }

  /** The capture up to the frame's end: the Designer's Team-tab offboarding dialog follows on every tab and is not part of these pages. */
  function upToDialogs(html: string): string {
    const end = html.indexOf('<div class="scrimd" id="scrimd"></div>');
    expect(end).toBeGreaterThan(0);
    return html.slice(0, end);
  }

  const cases: [SettingsTab, string, ReturnType<typeof createElement>][] = [
    ["general", "tab-general", createElement(SheetSettingsFirm, { data: DESIGNER_FIRM })],
    ["offices", "tab-offices", createElement(SheetSettingsOffices, { data: DESIGNER_OFFICES })],
    ["branding", "tab-branding", createElement(SheetSettingsBranding, { data: DESIGNER_BRANDING })],
    ["language", "tab-language", createElement(SheetSettingsLanguage, { data: DESIGNER_LANGUAGE })],
  ];
  for (const [tab, variant, body] of cases) {
    it(`renders Settings (${variant}) exactly as the captured Designer markup`, () => {
      const captured = upToDialogs(withoutPreloads(renderToStaticMarkup(createElement(SettingsMarkup, { variant }))));
      const live = upToDialogs(page(tab, body));
      if (live !== captured) {
        let i = 0;
        while (i < live.length && live[i] === captured[i]) i++;
        console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
      }
      expect(live).toBe(captured);
    });
  }

  it("links every Designer Settings tab from the tab strip, in the Designer's order, and Client portal from the header", () => {
    const captured = renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-offices" }));
    const tabsOf = (html: string) => [...html.matchAll(/<button role="tab" data-t="([a-z]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
    const header = renderToStaticMarkup(createElement(SettingsFirmHeader, { data: { tab: "offices", firmName: "Synthetic Firm", plan: null } }));
    expect(tabsOf(header)).toEqual(tabsOf(captured));
    expect(header).toContain('href="/sheet/settings?tab=portal"');
    expect(header).toContain('<button role="tab" data-t="offices" class="on">Offices</button>');
    expect(header).not.toContain("Plan:");
    const withAct = renderToStaticMarkup(
      createElement(SettingsFirmHeader, { data: { tab: "general", firmName: "Synthetic Firm", plan: null, act: { label: "Edit details", icon: "edit", dialog: "dlgFirm" } } }),
    );
    expect(withAct).toContain('<span class="acts"><a class="btn sm" href="/sheet/settings?tab=portal" data-live-link="portal">Client portal</a><button class="btn p sm" data-dlg="dlgFirm">');
  });

  it("shows a firm's own values and honest empty states, never the Designer's sample firm", () => {
    const offices = renderToStaticMarkup(createElement(SheetSettingsOffices, { data: { intro: "Your offices.", rows: [], empty: "No offices saved yet.", canEdit: true } }));
    expect(offices).toContain('<tr><td colSpan="4">No offices saved yet.</td></tr>');
    const language = renderToStaticMarkup(createElement(SheetSettingsLanguage, { data: { ...DESIGNER_LANGUAGE, rows: [], empty: "No staff yet." } }));
    expect(language).toContain('<tr><td colSpan="3">No staff yet.</td></tr>');
    const branding = renderToStaticMarkup(
      createElement(SheetSettingsBranding, {
        data: {
          firmName: "Synthetic Firm",
          figures: [{ box: "brd-l", images: [], empty: "No logo yet", caption: ["Logo", "PNG or JPG"] }],
          colourTag: "No firm colour set",
          replace: { label: "Upload a logo", dialog: "dlgBrand" },
          note: "Saved for later.",
          preview: { kind: "html", html: "<table></table>", label: "Synthetic Firm email header" },
        },
      }),
    );
    expect(branding).toContain('<div class="brd-l"><span>No logo yet</span></div>');
    expect(branding).toContain('<button class="btn s sm" data-dlg="dlgBrand">');
    for (const html of [offices, language, branding]) expect(html).not.toMatch(/Northline|Amara|Priya|Olena|Grace Lin|Lena Park/);
  });
});
const SETTINGS_STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

const OK_ON = { badge: { tone: "ok", label: "On" } } as const;

const DESIGNER_SETTINGS_TEAM: TeamData = {
  summary: "6 of 10 seats used. Removing someone revokes their access and hands their work to someone else first.",
  rows: [
    { name: "Amara Osei", role: ["Owner", "Licensed consultant"], office: "Toronto", twoStep: OK_ON, seat: "Paid" },
    { name: "Grace Lin", role: "Licensed consultant", office: "Toronto", twoStep: OK_ON, seat: "Paid" },
    { name: "Daniel Ruiz", role: "Case manager", office: "Toronto", twoStep: OK_ON, seat: "Paid" },
    { name: "Lena Park", role: "Finance", office: "Toronto", twoStep: OK_ON, seat: "Paid" },
    { name: "M. Leblanc", role: "External collaborator", office: "—", twoStep: { text: "Email code" }, seat: ["Free", "expires 28 Oct"] },
  ],
  invite: true,
  offboard: true,
  continuity: {
    intro:
      "If Amara can’t practise (illness, suspension or death), this licensed consultant can take over client files after the firm confirms it. Clients see the handover notice in their portal. They are never moved without their agreement.",
    pairs: [
      { label: "Continuity consultant", value: ["Grace Lin", "RCIC R709876", "this firm"] },
      { label: "Backup outside the firm", value: ["Samir Gill", "Maple Pathways", "RCIC R701122", "agreement signed 2 Sep"] },
      { label: "Who can trigger it", value: "Amara Osei, or two of Grace Lin, Daniel Ruiz and Lena Park together" },
      { label: "Last confirmed", value: ["2 Sep 2026", "review due 2 Mar 2027"] },
    ],
    actions: { change: { toast: "Change saved as a draft · Amara approves it with two-step sign-in" }, preview: "Client notice preview" },
    note: "Required by the CICC Code of Professional Conduct for licensees who practise alone or lead a firm. Policy wording to confirm with Francis.",
  },
};

const DESIGNER_SETTINGS_SECURITY: SecurityData = {
  intro: "Staff sign-in, support access and session rules.",
  rows: [
    { title: "Staff multi-factor authentication", detail: "Required for every staff account", badge: { tone: "ok", label: "On" } },
    { title: "Support access grant", detail: "Time-limited to 60 minutes, approved by the firm owner", badge: { tone: "gr", label: "None active" } },
    { title: "Session timeout", detail: "30 minutes idle", badge: { tone: "gr", label: "30 min" } },
    { title: "Download audit", detail: "Every document download is logged", badge: { tone: "ok", label: "On" } },
  ],
};

/** The Designer's Offboard dialog (#dlgOff). The capture carries it on every Settings tab; only Team and seats renders it. */
const DLG_OFF = /<dialog class="dlg wide" id="dlgOff"[\s\S]*?<\/dialog>/;

/** The Designer's own Offboard dialog content, rendered by the live OffboardDialog. */
const DESIGNER_OFFBOARD: OffboardDialogData = {
  title: "Offboard Grace Lin",
  intro: "Work moves first, client authority is reviewed, then access closes. Nothing is deleted; Grace’s history stays in the audit trail.",
  people: [{ label: ["Grace Lin", "Licensed consultant"] }, { label: ["Daniel Ruiz", "Case manager"] }],
  receivers: [{ label: "Amara Osei" }, { label: "Daniel Ruiz" }],
  items: [
    { done: true, aria: "Will move", title: "3 open tasks", detail: "Review employment letter (Okafor), Call notes (Mensah), Prepare IMM 5406 (Sharma) → Amara Osei" },
    { done: true, aria: "Will move", title: "1 verified deadline", detail: ["Biometrics, Ferreira", "4 Nov", "source: IRCC letter, 12 Oct", "owner changes, the date and its source do not"] },
    {
      done: false,
      aria: "Needs a decision",
      title: "2 matters where Grace is the authorised representative",
      detail: "Okafor and Ferreira. A new IMM 5476 is needed before Amara can act; the clients are asked to sign it in their portal. Until then the matters stay with Grace’s name on file.",
    },
    { done: true, aria: "Will close", title: "Access closes last", detail: "2 sessions (Chrome, iPhone), 1 calendar connection and 0 active shares end when the steps above are done." },
  ],
  note: "Clients are told who now handles their file. Grace keeps no copies; her seat frees up at the end of the billing period.",
  hold: { toast: "Offboarding started", toastSub: "3 tasks and 1 deadline moved to Amara. 2 authority forms sent to clients. Access closes when they’re signed." },
};

function settingsPage(tab: "team" | "security", content: ReturnType<typeof createElement>, after?: ReturnType<typeof createElement>) {
  return withoutPreloads(
    renderToStaticMarkup(
      createElement(
        SheetFrame,
        {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/settings" },
          header: createElement(SettingsHeader, { data: { firmName: "Northline Immigration", plan: "Plan: Practice (fictional)", tab } }),
          statusbar: SETTINGS_STATUSBAR,
          after,
        },
        content,
      ),
    ),
  );
}

function expectSame(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

describe("Designer fidelity: Settings, Team and seats and Security", () => {
  it("renders the Team and seats tab exactly as the captured Designer markup, with its Offboard dialog", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-team" })));
    expect(captured).toContain('id="dlgOff"');
    expectSame(
      settingsPage("team", createElement(SheetSettingsTeam, { data: DESIGNER_SETTINGS_TEAM }), createElement(OffboardDialog, { data: DESIGNER_OFFBOARD })),
      captured,
    );
  });

  it("renders the Security tab exactly as the captured Designer markup (without the unbuilt Offboard dialog)", () => {
    // The capture carries the Team tab's #dlgOff on every Settings tab; it is not ported.
    const captured = withoutPreloads(renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-security" }))).replace(DLG_OFF, "");
    expectSame(settingsPage("security", createElement(SheetSettingsSecurity, { data: DESIGNER_SETTINGS_SECURITY })), captured);
  });

  it("keeps the Designer's tab strip: its eleven tabs in order, with the open tab marked", () => {
    for (const tab of ["team", "security"] as const) {
      const html = renderToStaticMarkup(createElement(SettingsHeader, { data: { firmName: "Maple", plan: null, tab } }));
      const tabs = [...html.matchAll(/data-t="([a-z]+)"/g)].map((match) => match[1]);
      expect(tabs).toEqual(["general", "team", "branding", "offices", "billing", "retention", "integrations", "notifications", "language", "ai", "security"]);
      expect(html).toContain(`data-t="${tab}" class="on"`);
      expect(html.match(/class="pill"/g)?.length).toBe(1);
    }
  });

  it("shows a real firm's team, invitations and honest gaps, with no Designer people, offboarding or prototype toasts", () => {
    const now = new Date("2026-10-18T15:00:00Z");
    const data = teamData({
      members: [
        { membershipId: "m1", name: "Dana Lee", email: "dana@maple.test", role: "firm_owner", status: "active", licensed: true, twoStep: true },
        { membershipId: "m2", name: "Kai Moss", email: "kai@maple.test", role: "case_manager", status: "suspended", licensed: false, twoStep: false },
      ],
      security: [
        { membershipId: "m1", secondFactor: true, passkeys: 0, activeSessions: 1, lastActiveAt: "2026-10-18T14:00:00Z" },
        { membershipId: "m2", secondFactor: false, passkeys: 1, activeSessions: 0, lastActiveAt: null },
      ],
      invites: [{ id: "i1", email: "new@maple.test", role: "assistant", expiresAt: "2026-10-24T15:00:00Z", createdAt: "2026-10-17T15:00:00Z" }],
      continuity: { name: null, email: null, succession: null },
      canInvite: true,
      now,
      timeZone: "America/Toronto",
    });
    const html = renderToStaticMarkup(createElement(SheetSettingsTeam, { data }));
    expect(html).toContain("1 staff seat in use, 1 suspended, 1 invitation waiting.");
    expect(html).toContain('<td>Dana Lee</td><td>Owner <span class="sep" aria-hidden="true"></span> Licensed consultant</td><td>All offices</td>');
    expect(html).toContain('<span class="bd ok"><i></i>Passkey</span>');
    expect(html).toContain("<td>Suspended</td>");
    expect(html).toContain('Invited <span class="sep" aria-hidden="true"></span> expires 24 Oct');
    expect(html).toContain('<a class="btn p sm" href="/sheet/invitations">Invite staff</a>');
    expect(html).toContain("Not named yet");
    expect(html).not.toContain("dlgOff");
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Northline|Amara|Grace|Daniel|Lena|Leblanc|Paid|of 10 seats/);

    const viewer = renderToStaticMarkup(createElement(SheetSettingsTeam, { data: { ...data, invite: false, rows: [] } }));
    expect(viewer).not.toContain("Invite staff");
    expect(viewer).toContain("No one to show yet");
  });

  it("states the firm's real security posture and adds owner-only counts as Designer rows", () => {
    const owner = securityData({
      owner: true,
      members: 2,
      security: [
        { membershipId: "m1", secondFactor: true, passkeys: 0, activeSessions: 2, lastActiveAt: "2026-10-18T14:00:00Z" },
        { membershipId: "m2", secondFactor: false, passkeys: 0, activeSessions: 0, lastActiveAt: null },
      ],
      events: 0,
      timeZone: "America/Toronto",
    });
    const html = renderToStaticMarkup(createElement(SheetSettingsSecurity, { data: owner }));
    expect(html).toContain("Required for every staff account · 1 of 2 set up");
    expect(html).toContain("No idle timeout yet");
    expect(html).toContain("Support grants aren’t built yet");
    expect(html).toContain('<span class="bd gr"><i></i>2 sessions</span>');
    expect(html).not.toMatch(/30 min|60 minutes/);
    // Live-only rows reuse the Designer's own row: no class beyond the captured Security tab's.
    const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]));
    expect([...classes].sort()).toEqual(["bd gr", "bd ok", "display", "li rv", "ph rv", "r"]);

    const staff = renderToStaticMarkup(
      createElement(SheetSettingsSecurity, { data: securityData({ owner: false, members: 3, security: null, events: null, timeZone: "America/Toronto" }) }),
    );
    expect(staff).not.toContain("Signed-in sessions");
    expect(staff).not.toContain("set up");
  });
});

describe("Designer fidelity: Settings, Integrations and Notifications tabs", () => {
  const SETTINGS_STATUSBAR = {
    timezone: "America/Toronto",
    queue: { label: "Reminder queue healthy", detail: "0 retries" },
    sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
  };
  // Every Settings capture ends with the Team tab's offboarding dialog; the live tabs here don't render it.
  const OFFBOARD = /<dialog class="dlg wide" id="dlgOff"[\s\S]*?<\/dialog>/;
  const PILLS = ["Northline Immigration", "Plan: Practice (fictional)"];

  function settingsPage(tab: IntegrationsSettingsTab, body: ReturnType<typeof createElement>, after?: ReturnType<typeof createElement>) {
    return withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/settings" },
            header: createElement(IntegrationsSettingsHeader, { tab, pills: PILLS }),
            statusbar: SETTINGS_STATUSBAR,
            after,
          },
          body,
        ),
      ),
    );
  }

  const NOT_CONNECTED = { tone: "gr", label: "Not connected" } as const;
  const demo = (name: string, logo: string, sub: IntegrationRow["sub"], state: NonNullable<IntegrationRow["state"]>, connected: boolean): IntegrationRow => ({
    logo: `/assets/logos/${logo}`,
    name,
    tag: "planned",
    sub,
    state,
    unlink: connected ? { "aria-label": `Disconnect ${name}`, "data-toast": `${name} disconnected (demo)`, "data-fpb": "1" } : null,
    action: { label: connected || state.tone === "bad" ? "Manage" : "Connect" },
  });
  const LATER_BELL = (name: string): SettingsBell => ({ label: `${name}: notify me`, off: "Notify me", on: "You'll be notified", pressed: false, width: "103px" });
  const DESIGNER_INTEGRATIONS: IntegrationsData = {
    title: "Settings",
    intro: "All integrations are planned for the prototype. The states show how each connection will report problems.",
    microsoft: { left: "One Microsoft 365 sign-in connects all three", right: "planned" },
    rows: [
      demo("Stripe", "stripe.svg", "Payments", { tone: "ok", label: "Connected" }, true),
      demo("QuickBooks", "quickbooks.svg", "Accounting", { tone: "chg", label: "Degraded", detail: "retrying" }, true),
      demo("Google Calendar", "googlecalendar.svg", "Calendar", { tone: "ok", label: "Connected" }, true),
      demo("DocuSign", "docusign.svg", "Agreements", { tone: "bad", label: "Expired", detail: "reconnect" }, false),
      demo("Gmail", "gmail.svg", "Email", { tone: "ok", label: "Connected" }, true),
      demo("Zoom", "zoom.svg", "Meetings", NOT_CONNECTED, false),
      demo("Dropbox", "dropbox.svg", "File import", NOT_CONNECTED, false),
      demo("Calendly", "calendly.svg", "Booking", NOT_CONNECTED, false),
      demo("Microsoft Outlook", "integrations/microsoftoutlook-color.svg", "Email", NOT_CONNECTED, false),
      demo("Microsoft 365 calendar", "integrations/microsoft365-color.svg", "Calendar", NOT_CONNECTED, false),
      demo("Microsoft Teams", "integrations/microsoftteams-color.svg", "Meetings", NOT_CONNECTED, false),
      demo("Google Meet", "googlemeet.svg", "Meetings", NOT_CONNECTED, false),
      demo("Twilio", "twilio.svg", { left: "SMS reminders", right: "optional" }, NOT_CONNECTED, false),
      { ...demo("Xero", "xero.svg", "Accounting export", { tone: "gr", label: "Later" }, false), action: null, bell: LATER_BELL("Xero") },
      { ...demo("WhatsApp", "whatsapp.svg", "Messaging", { tone: "gr", label: "Later", detail: "approved channel only" }, false), action: null, bell: LATER_BELL("WhatsApp") },
    ],
  };

  const sw = (id: string, on: boolean, sr: string) => ({ kind: "switch" as const, item: { id, on, sr } });
  const DESIGNER_NOTIFICATION_PREFS: NotificationPrefsData = {
    intro: "Choose what reaches you by email. Everything still appears in Notifications inside Casevoya.",
    sections: [
      {
        title: "Email me when",
        rows: [
          { label: "A client uploads a document", small: "Grouped into one email per hour", control: sw("swo0xc5", true, "A client uploads a document") },
          { label: "A deadline is 3 days away", small: "Includes the matter and who owns it", control: sw("swgx11a", true, "A deadline is 3 days away") },
          { label: "Vo has a draft for my review", small: "Never sends anything on its own", control: sw("sw4bsg2", true, "Vo has a draft for my review") },
          { label: "Someone mentions me", small: "On any matter or lead", control: sw("swmeuhm", true, "Someone mentions me") },
          { label: "An integration needs attention", small: "Expired or failing connections", control: sw("swz3ig3", false, "An integration needs attention") },
        ],
      },
      {
        title: "Weekly digest",
        rows: [
          {
            label: "Monday summary",
            small: "Open matters, due dates and unpaid invoices for your files",
            control: { kind: "bell", bell: { label: "Monday summary: notify me", off: "Send me the digest", on: "You'll get the digest", pressed: true, width: "155px" } },
          },
        ],
      },
      {
        title: "Service messages and marketing are separate",
        rows: [
          {
            label: "Service messages to clients",
            small: "Deadlines, requests, invoices. Clients can’t turn off critical notices; they choose email or SMS.",
            control: { kind: "badge", badge: { tone: "ok", label: "Always on" } },
          },
          { label: "Marketing to clients", small: "Only with separate, recorded consent (OPS-05)", control: sw("swhnm4a", false, "Marketing to clients") },
          {
            label: "Quiet hours for routine reminders",
            small: { left: "21:00–08:00 in each client’s timezone", right: "critical notices still go out" },
            art: true,
            control: sw("swkq9p5", true, "Quiet hours"),
          },
        ],
      },
    ],
  };

  it("renders the Integrations tab exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-integrations" }))).replace(OFFBOARD, "");
    sameMarkup(settingsPage("integrations", createElement(SheetIntegrations, { data: DESIGNER_INTEGRATIONS })), captured);
  });

  it("renders the Notifications tab exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-notifications" }))).replace(OFFBOARD, "");
    sameMarkup(settingsPage("notifications", createElement(SheetNotificationPrefs, { data: DESIGNER_NOTIFICATION_PREFS })), captured);
  });

  it("adds live-only rows and the disclosure dialog with the Designer's own classes only", () => {
    // Documented live-only additions: Casevoya email, Casevoya calendar and the connected-accounts
    // switch before the Microsoft 365 row; `data-*`, `disabled` and `title` on buttons; and the
    // owner's disclosure dialog, built from the Designer's offboarding dialog (.dlg wide, .ofl, .fp-note).
    const org = "00000000-0000-4000-8000-0000000000bb";
    const input = {
      organizationId: org,
      firmSlug: "synthetic-firm",
      fromAddress: "notices@casevoya.ca",
      inboundDomain: "docs.casevoya.ca",
      isOwner: true,
      composio: { configured: true, enabled: false, acceptedAt: null },
      connections: [],
      busySyncedAt: null,
      stripe: { canSee: true, isOwner: true, account: { cardPayments: "active", requirementsDue: 0 } },
      timeZone: "America/Toronto",
    };
    const capturedInt = renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-integrations" }));
    const capturedNot = renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-notifications" }));
    // Every class token the live tabs use appears in the Designer's own Settings captures.
    const classes = (html: string) => new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/).filter(Boolean)));
    const designer = new Set([...classes(capturedInt), ...classes(capturedNot)]);
    const live = settingsPage(
      "integrations",
      createElement(SheetIntegrations, { data: integrationsData(input) }),
      createElement(ComposioDialog, { data: composioDialog(input)! }),
    );
    const notifications = settingsPage(
      "notifications",
      createElement(SheetNotificationPrefs, { data: notificationPrefsData({ organizationId: org, isOwner: true, email: {}, quietHours: null }) }),
    );
    for (const cls of [...classes(live), ...classes(notifications)]) expect(designer.has(cls), cls).toBe(true);
    expect(region(live, '<div id="content">', "</main>")).not.toMatch(/Northline|\(demo\)|Degraded|Expired|fictional/);
    // Stripping the live attributes from a planned row leaves the Designer's "Not connected" row.
    const zoom = region(live, '<img src="/assets/logos/zoom.svg"', "</span></div>").replace(/ (disabled=""|title="[^"]*")/g, "");
    expect(capturedInt).toContain(zoom);
  });
});

describe("Designer fidelity: Settings, Subscription and Retention", () => {
  const DESIGNER_SUBSCRIPTION: SubscriptionData = {
    payer: "Northline",
    rows: [
      ["Plan", "Practice (prices aren’t set yet)"],
      ["State", "Active since 2 Sep 2026"],
      ["Seats", "6 of 10"],
      ["Storage", "6.2 of 50 GB"],
      ["Invoices from Casevoya", "Sent to Lena Park"],
      ["If you cancel", "New work stops after the paid period. Exports stay open for at least 90 days; records are kept as your contract says."],
    ],
    alert: null,
    note: null,
  };
  const DESIGNER_RETENTION: RetentionData = {
    intro: "How long closed files are kept. The Canada RCIC baseline is at least six years after closing; holds can make it longer (SEC-07).",
    slider: { value: 12, min: 6, max: 15 },
    rows: [
      ["Policy version", ["R-2", "approved by Amara Osei, 2 Sep 2026"]],
      ["Applies to", ["Matters closed after 2 Sep 2026"]],
      ["Legal holds", ["1 active", "NL-2025-0301"]],
    ],
    note: "Retention periods are demo settings to check against real policy before launch.",
    alert: null,
    save: null,
  };
  const STATUSBAR = {
    timezone: "America/Toronto",
    queue: { label: "Reminder queue healthy", detail: "0 retries" },
    sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
  };

  function page(tab: SettingsBillingTab, body: ReturnType<typeof createElement>) {
    return withoutPreloads(
      renderToStaticMarkup(
        createElement(SheetFrame, {
          sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/settings" },
          header: createElement(SettingsBillingHeader, { firmName: "Northline Immigration", pill: "Plan: Practice (fictional)", tab }),
          statusbar: STATUSBAR,
        }, body),
      ),
    );
  }

  /** The capture keeps the Team tab's Offboard dialog in the page; it belongs to that tab, not these. */
  function captured(variant: string) {
    return withoutPreloads(renderToStaticMarkup(createElement(SettingsMarkup, { variant }))).replace(
      /<dialog class="dlg wide" id="dlgOff"[\s\S]*?<\/dialog>/,
      "",
    );
  }

  function same(live: string, expected: string) {
    if (live !== expected) {
      let i = 0;
      while (i < live.length && live[i] === expected[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + expected.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
    }
    expect(live).toBe(expected);
  }

  it("renders the Subscription tab exactly as the captured Designer markup", () => {
    same(page("billing", createElement(SheetSubscription, { data: DESIGNER_SUBSCRIPTION })), captured("tab-billing"));
  });

  it("renders the Retention tab exactly as the captured Designer markup", () => {
    same(page("retention", createElement(SheetRetention, { data: DESIGNER_RETENTION })), captured("tab-retention"));
  });

  it("shows a trial firm its stored state and real counts, with no prices, plan amounts or sample firm", () => {
    const now = new Date("2026-10-18T15:00:00Z");
    const subscription = { status: "trial", trial_started_at: "2026-10-10T15:00:00Z", trial_ends_at: "2026-10-24T15:00:00Z" };
    const data = subscriptionPage({
      firmName: "Walk Test Immigration",
      subscription,
      usage: { seats_active: 2, seats_invited: 1, active_matters: 3, sample_matters: 3, storage_bytes: 0, vo_runs_month: 4, emails_month: 0, month_start: "2026-10-01" },
      timeZone: "America/Toronto",
      now,
    });
    expect(subscriptionPill(subscription, now)).toBe("Subscription: Trial");
    const html = renderToStaticMarkup(createElement(SheetSubscription, { data }));
    expect(html).toContain("What Walk Test Immigration pays Casevoya.");
    expect(html).toContain("<dt>State</dt><dd>Trial since 10 Oct 2026, ends 24 Oct 2026</dd>");
    expect(html).toContain("<dt>Seats</dt><dd>2 in use, 1 invited. No seat limit is set.</dd>");
    expect(html).toContain("<dt>Active matters</dt><dd>3 (3 sample). No limit is set.</dd>");
    expect(html).toContain("<dt>Vo runs this month</dt><dd>4 since 1 Oct</dd>");
    expect(html).not.toMatch(/Northline|Lena|Practice|\$|CAD|\b(129|299|599)\b|90 days/);
    // The live-only note is the Designer's .fp-note with its info icon.
    expect(html).toMatch(/<p class="fp-note rv" style="--i:2"><svg class="ic s" aria-hidden="true"><use href="[^"]*#i-info"><\/use><\/svg> Casevoya sets plans and prices/);
  });

  it("wires the owner's Save by data attributes, and states no statutory period", () => {
    const data = retentionPage({
      policy: { unit: "years", count: 7 },
      latest: null,
      setup: { at: "2026-10-10T15:00:00Z", by: "Synthetic Owner" },
      holds: { count: 0, references: [] },
      organizationId: "00000000-0000-4000-8000-000000000001",
      canSave: true,
      timeZone: "America/Toronto",
    });
    const html = renderToStaticMarkup(createElement(SheetRetention, { data }));
    expect(html).toContain(
      '<div class="fp-row" style="margin-top:12px"><button class="btn p sm" data-retention-save="" data-org="00000000-0000-4000-8000-000000000001" data-version="1">Save retention period</button></div>',
    );
    expect(html).toContain('aria-valuemin="1" aria-valuemax="15" aria-valuenow="7" aria-valuetext="7 years"');
    expect(html).toContain('<dd>R-1 <span class="sep" aria-hidden="true"></span> set in firm setup by Synthetic Owner, 10 Oct 2026</dd>');
    expect(html).toContain("<dt>Legal holds</dt><dd>None active</dd>");
    expect(html).not.toMatch(/six years|RCIC|SEC-07|demo settings|Amara|NL-2025/);
    // Without the live Save row, the panel is the Designer's.
    expect(html.replace(/<div class="fp-row"[\s\S]*?<\/div>/, "")).toMatch(/<\/dl><\/div><\/section><p class="fp-note rv" style="--i:2">/);

    const viewer = renderToStaticMarkup(
      createElement(SheetRetention, {
        data: retentionPage({ policy: null, latest: null, setup: null, holds: { count: 0, references: [] }, organizationId: "x", canSave: false, timeZone: "America/Toronto" }),
      }),
    );
    expect(viewer).not.toContain("data-retention-save");
    expect(viewer).toContain("No retention period is set");
    expect(viewer).toContain("<dt>Policy version</dt><dd>Not set</dd>");

  });
});

describe("Designer fidelity: matter Documents review panel (Vo document reading)", () => {
  const captured = () => withoutPreloads(renderToStaticMarkup(createElement(MatterMarkup, { variant: "tab-documents" })));
  function same(live: string, expected: string) {
    if (live !== expected) {
      let i = 0;
      while (i < live.length && live[i] === expected[i]) i++;
      console.log("DIFF@" + i + "\nEXP " + expected.slice(i - 160, i + 160) + "\nGOT " + live.slice(i - 160, i + 160));
    }
    expect(live).toBe(expected);
  }

  /** The Designer's own sample: Priya's marriage certificate. */
  const SAMPLE: MatterDocumentReviewData = {
    title: "Marriage certificate",
    badge: { tone: "rev", label: "Awaiting review" },
    pill: ["v1", "PDF", "2 pages", "sha256 4f1c…a90e"],
    paper: {
      title: ["Certificate of marriage", "page 1 of 2"],
      text: [
        "This certifies that ",
        { hl: "Priya Sharma", f: "0" },
        " and Rafael Sharma were married on ",
        { hl: "14 February 2024", f: "1" },
        " at Pune, Maharashtra. Registration no. ",
        { hl: "MH-PN-2024-0381", f: "2" },
        ".",
      ],
      note: ["Sample document, fictional", "preview is an inert render"],
    },
    heading: ["Extracted fields", "confirm before they become facts"],
    rows: [
      { f: "0", label: "Spouse name", value: "Priya Sharma", badge: { tone: "ok", label: "98%", detail: "p.1" }, check: "Confirm Spouse name" },
      { f: "1", label: "Date of marriage", value: "14 Feb 2024", badge: { tone: "ok", label: "91%", detail: "p.1" }, check: "Confirm Date of marriage" },
      { f: "2", label: "Registration no.", value: "MH-PN-2024-0381", badge: { tone: "chg", label: "72%", detail: "p.1" }, check: "Confirm Registration no." },
    ],
    note: "The 72% field is below the confirm threshold, so it stays unknown until you check it against the page.",
    accept: { label: "Accept document" },
    reject: { label: "Request changes" },
  };

  it("renders the review panel exactly as the captured #ocr panel", () => {
    const html = captured();
    const start = html.indexOf('<div class="panel rv" id="ocr"');
    expect(start).toBeGreaterThan(0);
    const live = renderToStaticMarkup(createElement(MatterDocumentReview, { data: SAMPLE }));
    same(live, html.slice(start, start + live.length));
    // The panel is the last thing in the tab's content.
    expect(html.slice(start + live.length).startsWith('</div></div><aside id="rbar"')).toBe(true);
  });

  it("renders the selected row's Review link exactly as captured", () => {
    const html = captured();
    const start = html.indexOf('<tr class="sel" aria-current="true"');
    expect(start).toBeGreaterThan(0);
    const row = html.slice(start, html.indexOf("</tr>", start) + 5);
    const live = renderToStaticMarkup(
      createElement(MatterDocuments, {
        checklist: null,
        people: [],
        rows: [
          {
            title: "Marriage certificate",
            kind: "Relationship",
            person: { name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png" },
            upload: { tone: "gr", label: "Uploaded", detail: "scanned" },
            review: { tone: "rev", label: "Awaiting review" },
            version: "v2",
            open: { href: "#ocr", label: "Review" },
          },
        ],
      }),
    );
    const liveStart = live.indexOf("<tr class=\"sel\"");
    same(live.slice(liveStart, live.indexOf("</tr>", liveStart) + 5), row);
  });

  it("adds only data attributes and an editable value live, and stays plain text", () => {
    const live = renderToStaticMarkup(
      createElement(MatterDocumentReview, {
        data: {
          ...SAMPLE,
          rows: [{ ...SAMPLE.rows[0], value: "<b>Priya</b>", editable: true, attrs: { "data-proposal": "p1", "data-kind": "field", "data-original": "Priya" } }],
          accept: { label: "Accept ticked", attrs: { "data-vo-doc-accept": "d1", "data-org": "o1" } },
        },
      }),
    );
    expect(live).toContain('<div class="fieldr" data-f="0" data-proposal="p1" data-kind="field" data-original="Priya">');
    expect(live).toContain('<b contentEditable="plaintext-only" data-vo-value="1">&lt;b&gt;Priya&lt;/b&gt;</b>');
    expect(live).toContain('<button class="btn p" id="acc" data-vo-doc-accept="d1" data-org="o1">Accept ticked</button>');
  });
});
