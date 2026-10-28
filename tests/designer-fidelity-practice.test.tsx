import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SheetFrame } from "@/components/sheet/designer/frame";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import {
  ReportsExportDialog,
  ReportsHeader,
  SheetReports,
  type ReportsData,
  type ReportsExportDialog as ReportsExportDialogData,
  type ReportsTab,
} from "@/components/sheet/designer/reports";
import { ReportsMarkup } from "@/components/sheet/markup/reports";
import { QueueHeader, SheetQueue, type QueueData } from "@/components/sheet/designer/queue";
import { QueueMarkup } from "@/components/sheet/markup/queue";
import { ExportsDialog, ExportsHeader, SheetExports, type ExportsData } from "@/components/sheet/designer/exports";
import { ExportsMarkup } from "@/components/sheet/markup/exports";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

/**
 * Designer fidelity for the Reports, Team queue and Client-file exports pages. Kept apart from
 * tests/designer-fidelity.test.tsx so parallel branches do not collide; the sidebar sample is the
 * same one that file uses. The sample values live only in this test.
 */
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

const STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

const SIGN_OUT = /<form [^>]*action="\/sign-out"[^>]*>[\s\S]*?<\/form>/g;

function withoutPreloads(html: string): string {
  return html.replace(/<link rel="preload"[^>]*\/>/g, "").replace(SIGN_OUT, "");
}

function same(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

const DESIGNER_REPORTS_DIALOG: ReportsExportDialogData = {
  filters: ["Last 90 days", "all offices", "all owners"],
  timezone: "America/Toronto",
  currency: "CAD",
  note: "The export is saved in Casevoya. You get a link, not an attachment.",
  toastSub: "Saved under Client-file exports › Reports.",
};

const DESIGNER_REPORTS: ReportsData = {
  tab: "ops",
  range: "90d",
  pills: ["1 Jul – 16 Oct 2026", "All offices"],
  ops: {
    leads: {
      bars: [
        { label: "New", count: 22, tone: "" },
        { label: "Consultation completed", count: 14, tone: "" },
        { label: "Proposal sent", count: 9, tone: "" },
        { label: "Converted", count: 6, tone: "" },
      ],
      note: "6 of 22 leads converted (27%). 4 lost: 2 price, 1 went elsewhere, 1 not eligible.",
    },
    ageing: {
      rows: [
        { stage: "Intake", matters: 3, median: "6", oldest: "14" },
        { stage: "Evidence collection", matters: 5, median: "18", oldest: "41" },
        { stage: "Preparation", matters: 2, median: "9", oldest: "12" },
        { stage: "Consultant review", matters: 1, median: "3", oldest: "3" },
      ],
    },
    workload: {
      rows: [
        { person: "Amara Osei", open: 12, overdue: 1, matters: 9 },
        { person: "Daniel Ruiz", open: 17, overdue: 2, matters: 11 },
        { person: "Grace Lin", open: 4, overdue: 0, matters: 3 },
      ],
    },
    documents: {
      bars: [
        { label: "Requested, not uploaded", count: 14, tone: "w" },
        { label: "Awaiting review", count: 6, tone: "" },
        { label: "Changes requested", count: 3, tone: "w" },
        { label: "Expired", count: 1, tone: "g" },
      ],
    },
    attendance: { booked: 28, attended: 24, rescheduled: 3, noShow: 1 },
  },
  money: {
    sync: { logo: "/assets/logos/integrations/quickbooks.svg", label: "QuickBooks export", detail: "degraded, retrying (last good sync 16 Oct 22:00)" },
    ageing: {
      rows: [
        { age: "Not due", invoices: 2, amount: "2,938.00" },
        { age: "1–30 days overdue", invoices: 1, amount: "791.00" },
        { age: "31–60 days", invoices: 0, amount: "0.00" },
        { age: "Over 60 days", invoices: 0, amount: "0.00" },
      ],
      total: { invoices: 3, amount: "3,729.00" },
    },
    months: {
      rows: [
        { month: "August", invoiced: "1,240.00", collected: "1,240.00" },
        { month: "September", invoiced: "1,352.00", collected: "600.00" },
        { month: "October to date", invoiced: "4,068.00", collected: "1,130.00" },
      ],
    },
    balances: {
      rows: [
        { client: "Priya Sharma", held: "1,500.00", pending: "—" },
        { client: "Kofi Mensah", held: "0.00", pending: "1,808.00" },
      ],
    },
    recon: { text: "1 open: CAD 1,808.00 bank deposit not yet in the ledger (Kofi Mensah).", href: "/sheet/finance?tab=recon" },
  },
  outcomes: {
    rows: [
      { program: "Spousal sponsorship, outland", cohort: "Submitted 2025", decided: 11, median: "312", pending: 4 },
      { program: "Study permit", cohort: "Submitted Jan–Jun 2026", decided: 18, median: "61", pending: 2 },
      { program: "Work permit (LMIA-based)", cohort: "Submitted 2025", decided: 7, median: "148", pending: 1 },
      { program: "Visitor record", cohort: "Submitted 2026", decided: 3, median: "—", pending: 0 },
    ],
    note: "Visitor record has only 3 decided files, so its median is hidden. Outcomes by type are on the Decisions tab of each matter.",
  },
  scheduled: {
    rows: [
      { report: "Monday workload", every: "Week", recipients: "Amara Osei, Daniel Ruiz", format: "Link only", next: "19 Oct 08:00" },
      { report: "Monthly receivables", every: "Month", recipients: "Lena Park", format: "CSV in Casevoya", next: "1 Nov 07:00" },
    ],
  },
  dialog: DESIGNER_REPORTS_DIALOG,
};

describe("Designer fidelity: Reports", () => {
  for (const tab of ["ops", "money", "outcomes", "scheduled"] as ReportsTab[]) {
    it(`renders the Reports page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutPreloads(renderToStaticMarkup(createElement(ReportsMarkup, { variant: `tab-${tab}` })));
      const data = { ...DESIGNER_REPORTS, tab };
      const live = withoutPreloads(
        renderToStaticMarkup(
          createElement(
            SheetFrame,
            {
              sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/reports" },
              header: createElement(ReportsHeader, { tab, pills: data.pills }),
              statusbar: STATUSBAR,
              after: createElement(ReportsExportDialog, { data: data.dialog }),
            },
            createElement(SheetReports, { data }),
          ),
        ),
      );
      same(live, captured);
    });
  }

  it("shows a firm without records empty states, definitions and freshness, and no Designer sample people", () => {
    const empty: ReportsData = {
      tab: "ops",
      range: "month",
      pills: ["1 Oct – 18 Oct 2026", "All offices"],
      rangeNav: { "90d": "/sheet/reports?tab=ops&view=90d", month: "/sheet/reports?tab=ops&view=month", year: "/sheet/reports?tab=ops&view=year" },
      ops: {
        leads: { bars: [{ label: "Consultations booked", count: 0, tone: "" }], note: "No consultations in this period.", definition: "Definition: bookings." },
        ageing: { rows: [] },
        workload: { rows: [] },
        documents: { bars: [{ label: "Requested, not uploaded", count: 0, tone: "w" }] },
        attendance: { booked: 0, attended: 0, rescheduled: 0, noShow: 0 },
      },
      money: null,
      outcomes: { rows: [], note: "No decided files yet.", firm: { rows: [], definition: "Firm work time definition." } },
      scheduled: { rows: [] },
      freshness: "Computed 18 Oct, 09:00 (America/Toronto) from live records.",
      dialog: { ...DESIGNER_REPORTS_DIALOG, wire: { href: "/api/reports/export?tab=ops&range=month" } },
    };
    for (const tab of ["ops", "outcomes", "scheduled"] as ReportsTab[]) {
      const html = renderToStaticMarkup(createElement(SheetReports, { data: { ...empty, tab } }));
      expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Daniel|Lena|Grace/);
      expect(html).toContain('class="emp"');
    }
    const ops = renderToStaticMarkup(createElement(SheetReports, { data: empty }));
    expect(ops).toContain("Definition: bookings.");
    expect(ops).toContain("Computed 18 Oct, 09:00");
    expect(ops).toContain('class="fchip on" aria-pressed="true" data-nav="/sheet/reports?tab=ops&amp;view=month">This month');
    const outcomes = renderToStaticMarkup(createElement(SheetReports, { data: { ...empty, tab: "outcomes" } }));
    expect(outcomes).toContain("Firm work time definition.");
    const money = renderToStaticMarkup(
      createElement(SheetReports, { data: { ...empty, tab: "money", denied: { title: "You don’t have permission to see money reports", copy: "Ask your firm owner." } } }),
    );
    // DES-04: the shared permission-denied view (the Designer's No permission panel).
    expect(money).toContain('data-no-access="1"');
    expect(money).toContain("You don’t have permission to see money reports");
    expect(money).not.toContain("Receivables ageing");
    const dialog = renderToStaticMarkup(createElement(ReportsExportDialog, { data: empty.dialog }));
    expect(dialog).toContain('data-report-export="/api/reports/export?tab=ops&amp;range=month"');
    expect(dialog).not.toContain("data-toast=");
  });
});

const DESIGNER_QUEUE: QueueData = {
  counts: { open: 14, overdue: 3, people: 4 },
  load: [
    { person: { name: "Amara Osei", avatarUrl: "/assets/av-amara-consultant.png" }, role: "Licensed consultant", bookedHours: 7, availableHours: 9 },
    { person: { name: "Daniel Ruiz", avatarUrl: "/assets/av-daniel-casemanager.png" }, role: "Case manager", bookedHours: 5, availableHours: 9 },
    { person: { name: "Lena Park", avatarUrl: "/assets/av-lena-finance.png" }, role: "Finance", bookedHours: 2, availableHours: 6 },
    { person: { name: "Joy Adeyemi" }, role: "Assistant", bookedHours: 0, availableHours: 6 },
  ],
  items: [
    { id: "rblt8jnt", title: "Review marriage certificate", who: "Priya Sharma", kind: "Review", owner: { name: "Amara", avatarUrl: "/assets/av-amara-consultant.png" }, due: { tone: "chg", label: "Today" } },
    { id: "rbld4ru0", title: "Approve earned-fee transfer (2nd approver)", who: "Kofi Mensah", kind: "Money", owner: { name: "Lena", avatarUrl: "/assets/av-lena-finance.png" }, due: { tone: "bad", label: "Today" } },
    { id: "rbl4nqbe", title: "Chase sponsor T4", who: "Priya Sharma", kind: "Request", owner: { name: "Daniel", avatarUrl: "/assets/av-daniel-casemanager.png" }, due: { tone: "rev", label: "Mon 19" } },
    { id: "rblpnry3", title: "Verify submission confirmation", who: "Mei Tanaka", kind: "Government", owner: { name: "Amara", avatarUrl: "/assets/av-amara-consultant.png" }, due: { tone: "bad", label: "Overdue 1 day" } },
    { id: "rbloh5zp", title: "Send proposal", who: "Tomás Duarte", kind: "Lead", owner: { name: "Daniel", avatarUrl: "/assets/av-daniel-casemanager.png" }, due: { tone: "gr", label: "Tue 20" } },
    { id: "rblxg460", title: "Check Vo draft: intake summary", who: "Grace Okafor", kind: "AI draft", owner: { name: "Amara", avatarUrl: "/assets/av-amara-consultant.png" }, due: { tone: "dk", label: "Tue 20" } },
  ],
};

describe("Designer fidelity: Team queue", () => {
  it("renders the Team queue exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(QueueMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/queue" },
            header: createElement(QueueHeader, { counts: DESIGNER_QUEUE.counts }),
            statusbar: STATUSBAR,
          },
          createElement(SheetQueue, { data: DESIGNER_QUEUE }),
        ),
      ),
    );
    same(live, captured);
  });

  it("shows an empty firm the empty states, and live items carry filter tokens and links", () => {
    const empty = renderToStaticMarkup(createElement(SheetQueue, { data: { counts: { open: 0, overdue: 0, people: 0 }, load: [], items: [] } }));
    expect(empty).toContain('class="emp"');
    expect(empty).not.toMatch(/Amara|Priya|Kofi|Daniel|Lena/);
    const live = renderToStaticMarkup(
      createElement(SheetQueue, {
        data: {
          counts: { open: 1, overdue: 1, people: 1 },
          load: [{ person: { name: "Dana Lee" }, role: "Firm owner", bookedHours: 0, availableHours: 0 }],
          items: [
            {
              id: "q-1",
              title: "Verify deposit",
              who: "Sam Client",
              kind: "Money",
              owner: null,
              due: { tone: "bad", label: "Overdue 2 days" },
              flags: ["overdue", "unassigned", "money"],
              href: "/sheet/finance?tab=funds",
            },
          ],
        },
      }),
    );
    expect(live).toContain('data-f="overdue unassigned money" data-href="/sheet/finance?tab=funds"');
    expect(live).toContain("No working hours set");
    expect(live).not.toContain('<img class="av"');
  });
});

const DESIGNER_EXPORTS: ExportsData = {
  header: {},
  job: {
    title: ["NL-2026-0142", "Priya Sharma", "running"],
    steps: [
      { label: "Collect 38 files", state: "done", time: "09:41" },
      { label: "Add audit trail and manifest", state: "done", time: "09:42" },
      { label: "Package and encrypt", state: "now", time: "about 1 minute" },
      { label: "Ready to download", state: "todo", time: "" },
    ],
    progress: 68,
    action: { kind: "cancel", toast: { label: "Export cancelled", sub: "Nothing was kept." } },
  },
  rows: [
    { key: "a", started: "17 Oct 09:41", matter: "NL-2026-0142", by: "Amara Osei", files: "38", size: "41.2 MB", state: { tone: "blue", label: "Running" } },
    { key: "b", started: "2 Oct 11:20", matter: "NL-2025-0388", by: "Amara Osei", files: "22", size: "18.4 MB", state: { tone: "ok", label: "Downloaded 2 Oct", detail: "link expired" } },
    { key: "c", started: "30 Sep 16:05", matter: "NL-2026-0129", by: "Daniel Ruiz", files: "—", size: "—", state: { tone: "bad", label: "Stopped", detail: "step-up not completed" } },
  ],
  note: "Each export includes documents, agreements, invoices and receipts, messages, tasks, the audit trail and a manifest. If the subscription ends, exports stay available for at least 90 days; nothing is deleted because of a cancelled plan.",
  dialog: {},
};

describe("Designer fidelity: Client-file exports", () => {
  it("renders the exports page exactly as the captured Designer markup", () => {
    const captured = withoutPreloads(renderToStaticMarkup(createElement(ExportsMarkup)));
    const live = withoutPreloads(
      renderToStaticMarkup(
        createElement(
          SheetFrame,
          {
            sidebar: { ...DESIGNER_SIDEBAR, active: "/sheet/exports" },
            header: createElement(ExportsHeader, { data: DESIGNER_EXPORTS.header }),
            statusbar: STATUSBAR,
            after: createElement(ExportsDialog, { data: DESIGNER_EXPORTS.dialog }),
          },
          createElement(SheetExports, { data: DESIGNER_EXPORTS }),
        ),
      ),
    );
    same(live, captured);
  });

  it("wires the live controls with data attributes only, and shows an empty history", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(ExportsHeader, { data: { newAttrs: { "data-export-act": "new" } } }),
        createElement(SheetExports, {
          data: {
            ...DESIGNER_EXPORTS,
            job: { ...DESIGNER_EXPORTS.job!, title: ["CA-2026-0001", "Sam Client", "ready"], action: { kind: "download", attrs: { "data-export-act": "download", "data-export": "e1" } } },
            rows: [],
            note: "Live note.",
          },
        }),
        createElement(ExportsDialog, { data: { matters: [{ value: "m1", label: "CA-2026-0001 · Sam Client" }], confirm: { "data-export-act": "confirm", "data-org": "o1" } } }),
      ),
    );
    expect(html).toContain('data-dlg="dlgX" data-fpd="1" data-export-act="new"');
    expect(html).toContain('data-export-act="download" data-export="e1">Download</button>');
    expect(html).toContain('class="emp"');
    expect(html).toContain('<select class="sel" id="xM"><option value="m1">');
    expect(html).toContain('<button class="btn p" data-export-act="confirm" data-org="o1">Confirm and export</button>');
    expect(html).not.toMatch(/Priya|Amara|Daniel/);
  });
});
