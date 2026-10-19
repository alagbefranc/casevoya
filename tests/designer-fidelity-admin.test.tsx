import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SheetFrame } from "@/components/sheet/designer/frame";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import { ROLES_CSS, RolesHeader, SheetRoles, type RoleMatrixData } from "@/components/sheet/designer/roles";
import { LicenceAfter, LicenceHeader, SheetLicences, type LicenceDialogsData, type LicencesData, type LicenceTab } from "@/components/sheet/designer/licence";
import { RolesMarkup } from "@/components/sheet/markup/roles";
import { LicenceMarkup } from "@/components/sheet/markup/licence";
import { ROLE_MATRIX } from "@/modules/staff/role-matrix";
import { SheetHome, type HomeData } from "@/components/sheet/designer/home";
import { SUSPENDED_CSS, SuspendedAlert, SuspendedPanel, SuspendedTopBar, type SuspendedData } from "@/components/sheet/designer/licence-suspended";
import { LicenceSuspendedMarkup } from "@/components/sheet/markup/licence-suspended";
import { SUSPENDED_REVEAL } from "@/modules/sheet/licence-suspended-present";
import { GrantDialog, GrantsHeader, SheetGrants, SupportDeclineDialog, type GrantDialogData, type GrantsData, type GrantsTab } from "@/components/sheet/designer/grants";
import { GrantsMarkup } from "@/components/sheet/markup/grants";
import { INTAKE_BUILDER_CSS, IntakeHeader, IntakeSettings, SheetIntakeBuilder, type IntakeBuilderData, type IntakeTab } from "@/components/sheet/designer/intake-builder";
import { IntakeBuilderMarkup } from "@/components/sheet/markup/intake-builder";
import { SheetTemplates, TemplatesHeader, type TemplatesData, type TemplatesTab } from "@/components/sheet/designer/templates";
import { TemplatesMarkup } from "@/components/sheet/markup/templates";
import { withoutRequirementCodes } from "./helpers/designer-copy";
import { AutomationsHeader, AutomationsSettings, SheetAutomations, type AutomationsData, type AutomationsTab } from "@/components/sheet/designer/automations";
import { AutomationsMarkup } from "@/components/sheet/markup/automations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

/**
 * Firm administration pages (branch sheet-firm-admin): the data-driven Designer components,
 * given the Designer's own sample values, produce exactly the captured markup. The sample values
 * live only in this test. Live-only data attributes are stripped before comparing; the list is
 * in LIVE_ATTRS. The captured reveal-script class `k2-in` is ignored (see designer/licence.tsx).
 */
const LIVE_ATTRS = / data-(licence-[a-z]+|membership|grant[a-z-]*|org|reassign[a-z-]*)="[^"]*"/g;

function clean(html: string): string {
  return html
    .replace(/<link rel="preload"[^>]*\/>/g, "")
    .replace(/<form [^>]*action="\/sign-out"[^>]*>[\s\S]*?<\/form>/g, "")
    .replace(LIVE_ATTRS, "")
    .replace(/ k2-in"/g, '"');
}

function same(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

const AV = (name: string, file: string) => ({ name, avatarUrl: `/assets/${file}.png` });

const SIDEBAR: SidebarData = {
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

function frame(active: string, header: ReactNode, body: ReactNode, extra: { after?: ReactNode; styles?: string[]; aside?: ReactNode } = {}) {
  return clean(
    renderToStaticMarkup(
      createElement(SheetFrame, { sidebar: { ...SIDEBAR, active }, header, statusbar: STATUSBAR, after: extra.after, styles: extra.styles, aside: extra.aside }, body),
    ),
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const Y = "yes" as const;
const N = "no" as const;
const AS = { tone: "rev" as const, label: "Assigned only" };
const OWN = { tone: "gr" as const, label: "Own" };
const DESIGNER_ROLES: RoleMatrixData = {
  roles: ["Platform admin", "Firm owner", "Licensed consultant", "Case manager", "Assistant", "Finance", "Client / adult dependant", "Sponsor / employer", "Guardian", "External collaborator"],
  rows: [
    { permission: "View matter", cells: [{ tone: "chg", label: "Support grant" }, Y, AS, AS, AS, OWN, OWN, OWN, OWN, OWN] },
    { permission: "Edit intake answers", cells: [N, Y, AS, AS, AS, N, OWN, OWN, OWN, N] },
    { permission: "Accept documents", cells: [N, Y, AS, AS, N, N, N, N, N, N] },
    { permission: "Record government status", cells: [N, Y, AS, AS, N, N, N, N, N, N] },
    { permission: "Sign representation", cells: [N, N, AS, N, N, N, N, N, N, N] },
    { permission: "Issue invoices", cells: [N, Y, N, N, N, Y, N, N, N, N] },
    { permission: "Approve earned-fee transfer", cells: [N, Y, N, N, N, Y, N, N, N, N] },
    { permission: "Approve AI drafts", cells: [N, Y, AS, AS, N, N, N, N, N, N] },
    { permission: "Manage users", cells: [N, Y, N, N, N, N, N, N, N, N] },
  ],
  intro:
    "“Own” means the person only sees records they’re part of. “Assigned only” means the person works only on matters they’re assigned to (PRD §5): licensed consultants on their assigned matters, case managers on assigned intake, documents, tasks and drafts, and assistants on explicitly assigned work, with no default access to restricted records or finance approvals. A case manager can’t release a submission. Earned-fee transfers always need two approvers. Platform admins need a time-limited support grant to see firm data.",
  notes: {
    lock: "Sign representation is limited to licensed consultants by regulation. You can’t grant it to other roles.",
    shield: "Platform admins see firm configuration only. Opening a matter needs a support grant the firm approves; it lasts 60 minutes by default and is revoked automatically.",
  },
  pills: ["10 roles", "Changes are logged"],
};

describe("Designer fidelity: Roles and permissions", () => {
  it("renders the Roles page exactly as the captured Designer markup", () => {
    const captured = clean(renderToStaticMarkup(createElement(RolesMarkup)));
    const live = frame("/sheet/roles", createElement(RolesHeader, { pills: DESIGNER_ROLES.pills }), createElement(SheetRoles, { data: DESIGNER_ROLES }), { styles: [ROLES_CSS] });
    same(live, captured);
  });

  it("states the live matrix in the Designer's shape: one cell per role, Designer labels only", () => {
    expect(ROLE_MATRIX.roles).toEqual(DESIGNER_ROLES.roles);
    expect(ROLE_MATRIX.rows.map((row) => row.permission)).toEqual(DESIGNER_ROLES.rows.map((row) => row.permission));
    for (const row of ROLE_MATRIX.rows) {
      expect(row.cells).toHaveLength(ROLE_MATRIX.roles.length);
      for (const cell of row.cells) {
        if (typeof cell === "string") expect(["yes", "no"]).toContain(cell);
        else expect(["Assigned only", "Own", "Support grant"]).toContain(cell.label);
      }
    }
    const html = renderToStaticMarkup(createElement(SheetRoles, { data: ROLE_MATRIX }));
    expect(html).not.toMatch(/always need two approvers/);
  });
});

// ---------------------------------------------------------------------------
// Licences
// ---------------------------------------------------------------------------
const DESIGNER_LICENCES: LicencesData = {
  firmName: "Northline Immigration",
  tab: "lic",
  intro:
    "Each consultant’s licence is checked by hand against the public register before they sign agreements or release submissions. We check again every month, and whenever a change is reported.",
  cards: [
    {
      person: AV("Amara Osei", "av-amara-consultant"),
      name: "Amara Osei",
      sub: { left: "Owner", right: "Licensed consultant" },
      art: "licence-card",
      state: { tone: "ok", label: "Verified" },
      rows: [
        { label: "Regulator", value: "College of Immigration and Citizenship Consultants (CICC)" },
        { label: "Licence number", value: { num: "R712345" } },
        { label: "Class", value: { left: "RCIC-IRB", right: "can appear before the IRB" } },
        { label: "Scope in Casevoya", value: "All programs Northline offers" },
        { label: "Last check", value: { num: "17 Oct 2026, 09:40", suffix: " Toronto" } },
        { label: "Next review", value: { num: "17 Nov 2026", after: "monthly, or sooner if a change is reported" } },
      ],
      proof: { kind: "file", name: "CICC register entry, Amara Osei.pdf", meta: ["Licence proof", "Amara", "v2"], date: "17 Oct", states: [{ tone: "unv", label: "Uploaded" }, { tone: "ok", label: "Accepted" }] },
      source: {
        publisher: "College of Immigration and Citizenship Consultants",
        url: "https://college-ic.ca/protecting-the-public/find-an-immigration-consultant",
        linkText: "CICC public register",
        appliesTo: "Licence R712345, class RCIC-IRB, status “Active”",
        version: "Register as shown on 17 Oct 2026",
        checked: "17 Oct 2026, 09:40",
        reviewer: "M. Tremblay, Casevoya verification",
        state: { tone: "ok", label: "Checked" },
      },
      footer: { report: "", note: { icon: "lock", text: "Changes ask you to confirm it’s you" } },
    },
    {
      person: AV("Grace Lin", "av-grace-consultant"),
      name: "Grace Lin",
      sub: { left: "Licensed consultant", right: "joined 15 Oct" },
      art: "licence-pending",
      state: { tone: "rev", label: "Waiting for check" },
      rows: [
        { label: "Regulator", value: "College of Immigration and Citizenship Consultants (CICC)" },
        { label: "Licence number", value: { num: "R705518" } },
        { label: "Class", value: "RCIC" },
        { label: "Submitted", value: { num: "15 Oct 2026, 16:12" } },
        { label: "Until checked", value: "Can work on files, can’t sign agreements or release submissions" },
      ],
      proof: { kind: "file", name: "Licence certificate, Grace Lin.pdf", meta: ["Licence proof", "Grace", "v1"], date: "15 Oct", states: [{ tone: "unv", label: "Uploaded" }, { tone: "rev", label: "Being reviewed" }] },
      source: null,
      footer: { note: { icon: "clock", text: "Usually checked within 1 business day" } },
    },
    {
      person: AV("Daniel Ruiz", "av-daniel-casemanager"),
      name: "Daniel Ruiz",
      sub: "Case manager",
      art: null,
      state: { tone: "gr", label: "No licence needed" },
      rows: [{ label: "Role", value: { left: "Case manager", right: "prepares files, can’t release submissions" } }],
      proof: { kind: "none", text: "Not required for this role." },
      source: null,
      footer: {},
    },
  ],
  log: [
    { at: "17 Oct 2026, 09:40", title: { left: "Register checked", right: "confirmed active" }, parts: ["Amara Osei", "R712345", "by M. Tremblay, Casevoya verification"] },
    { at: "15 Oct 2026, 16:12", title: "Licence submitted with proof", parts: ["R705518", "by Grace Lin"] },
    { at: "17 Sep 2026, 11:05", title: { left: "Monthly review", right: "confirmed active" }, parts: ["Amara Osei", "R712345", "by J. Roy, Casevoya verification"] },
    { at: "2 Sep 2026, 14:30", title: "Firm verified", parts: ["Northline Immigration", "by J. Roy, Casevoya verification"] },
  ],
};

const DESIGNER_LICENCE_DIALOGS: LicenceDialogsData = {
  consultants: [{ label: "Grace Lin" }],
  inviteLabel: "Invite someone new…",
  regulators: ["College of Immigration and Citizenship Consultants (CICC)", "Law society (lawyer or paralegal)", "Chambre des notaires du Québec"],
};

describe("Designer fidelity: Licences", () => {
  for (const tab of ["lic", "log"] as LicenceTab[]) {
    it(`renders the Licences page (${tab} tab) and its dialogs exactly as the captured Designer markup`, () => {
      const captured = clean(renderToStaticMarkup(createElement(LicenceMarkup, { variant: `tab-${tab}` })));
      const data = { ...DESIGNER_LICENCES, tab };
      const live = frame(
        "/sheet/licence",
        createElement(LicenceHeader, { firmName: data.firmName, tab }),
        createElement(SheetLicences, { data }),
        { after: createElement(LicenceAfter, { dialogs: DESIGNER_LICENCE_DIALOGS }) },
      );
      same(live, captured);
    });
  }

  it("wires live controls by data attributes only", () => {
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(SheetLicences, { data: { ...DESIGNER_LICENCES, cards: [{ ...DESIGNER_LICENCES.cards[0], footer: { report: "11111111-1111-4111-8111-111111111111" } }] } }),
        createElement(LicenceAfter, { dialogs: { ...DESIGNER_LICENCE_DIALOGS, consultants: [{ label: "Sam Lee", membershipId: "22222222-2222-4222-8222-222222222222" }] } }),
      ),
    );
    expect(html).toContain('data-licence-report="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('<option data-membership="22222222-2222-4222-8222-222222222222">Sam Lee</option>');
    expect(html).toContain('data-licence-add="save"');
    expect(html).toContain('data-licence-send="1"');
  });

  it("shows an empty review log honestly", () => {
    const html = renderToStaticMarkup(createElement(SheetLicences, { data: { ...DESIGNER_LICENCES, tab: "log", log: [] } }));
    expect(html).toContain("Nothing logged yet");
    expect(html).not.toMatch(/Northline|Amara|Tremblay/);
  });
});

// ---------------------------------------------------------------------------
// Licence-suspended home
// ---------------------------------------------------------------------------
const DESIGNER_SUSPENDED: SuspendedData = {
  alert: {
    title: "Licence check expired on 15 Oct",
    body: "We couldn’t confirm your CICC licence R712345 in the monthly review. New engagements and submission releases are paused until a reviewer confirms it. We emailed you and your continuity contact, Grace Lin.",
    href: "/sheet/licence?state=expired",
    action: "Update licence",
  },
  stillWorks: ["Opening every client file and its history", "Deadline monitoring and reminders", "Messages and uploads from clients", "Exporting a client’s file"],
  paused: ["Signing new service agreements", "Releasing submissions", "Taking on new matters"],
  footer: { title: "4 matters have deadlines in the next 30 days", note: "Reassign them to another licensed consultant so nothing is missed." },
  reassign: {
    note: "Only consultants with a verified licence appear here. Clients are told who now handles their file.",
    targets: [{ name: "Grace Lin", parts: ["RCIC", "verified 2 Oct"] }],
    matters: [
      { name: "Priya Sharma", reference: "NL-2026-0142", note: "Submission due 24 Oct", checked: true },
      { name: "Kofi Mensah", reference: "NL-2026-0131", note: "Biometrics follow-up 28 Oct", checked: true },
      { name: "Tomás Duarte", reference: "NL-2026-0150", note: "Agreement to sign", checked: true },
      { name: "Sofia Reyes", reference: "lead", note: "Consultation 21 Oct", checked: false },
    ],
    reason: "Temporary while my licence check is reviewed.",
  },
};

const HOME_STUB: HomeData = {
  greeting: "Good morning, Amara.",
  summary: "Your licence check has expired, so some actions are paused. Your clients’ files, deadlines and history are safe.",
  quick: { lead: "/sheet/pipeline", document: "/sheet/matters/priya?tab=documents", consultation: "/sheet/calendar", invoice: "/sheet/matters/priya?tab=billing", draft: "/sheet/drafts" },
  gauge: [],
  needs: [],
  byDeadline: [],
  tasks: [],
};

function region(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  expect(start, `missing ${open}`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf(close, start));
}

describe("Designer fidelity: licence-suspended home", () => {
  it("renders the top bar, alert, greeting, panel and Reassign work dialog exactly as the captured Designer markup", () => {
    const part = (html: string) => region(html, '<header class="top"', '<div style="display:flex;gap:10px');
    const captured = part(clean(renderToStaticMarkup(createElement(LicenceSuspendedMarkup))));
    const live = part(
      frame(
        "/sheet",
        createElement(SuspendedTopBar, { data: { firmName: "Northline Immigration", pills: ["Updated 2 min ago", "Your matters: 18"], newTitle: "Paused while your licence check is reviewed" } }),
        createElement(SheetHome, {
          data: HOME_STUB,
          before: createElement(SuspendedAlert, { data: DESIGNER_SUSPENDED }),
          lead: createElement(SuspendedPanel, { data: DESIGNER_SUSPENDED }),
          reveal: SUSPENDED_REVEAL,
        }),
        { styles: [SUSPENDED_CSS] },
      ),
    );
    same(live, captured);
    expect(renderToStaticMarkup(createElement(LicenceSuspendedMarkup))).toContain(SUSPENDED_CSS.slice(0, 80));
  });

  it("wires the dialog by data attributes only", () => {
    const html = renderToStaticMarkup(
      createElement(SuspendedPanel, {
        data: {
          ...DESIGNER_SUSPENDED,
          reassign: {
            ...DESIGNER_SUSPENDED.reassign,
            organizationId: "33333333-3333-4333-8333-333333333333",
            fromMembershipId: "44444444-4444-4444-8444-444444444444",
            targets: [{ name: "Sam Lee", parts: ["RCIC", "verified 2 Oct"], membershipId: "55555555-5555-4555-8555-555555555555" }],
            matters: [{ name: "Ana Diaz", reference: "CA-2026-0001", note: "Due 1 Nov", checked: true, matterId: "66666666-6666-4666-8666-666666666666" }],
          },
        },
      }),
    );
    expect(html).toContain('data-open="dlgRe"');
    expect(html).toContain('data-reassign-from="44444444-4444-4444-8444-444444444444" data-org="33333333-3333-4333-8333-333333333333"');
    expect(html).toContain('data-matter="66666666-6666-4666-8666-666666666666"');
    expect(html).toContain("Reassign 1 matter<");
    expect(html).not.toContain("Clients notified");
  });
});

// ---------------------------------------------------------------------------
// Access grants
// ---------------------------------------------------------------------------
const DESIGNER_GRANTS: GrantsData = {
  tab: "grants",
  pills: ["3 active", "1 support request"],
  grants: [
    { who: "M. Leblanc (translator, external)", canSee: "Marriage certificate v2 only", why: "Certified translation", grantedBy: "Amara Osei", expires: { num: "28 Oct 2026" }, state: { tone: "ok", label: "Active" } },
    { who: "Grace Lin", canSee: { left: "NL-2026-0142", right: "read only" }, why: "Cover while Amara is away", grantedBy: "Amara Osei", expires: { num: "2 Nov 2026" }, state: { tone: "ok", label: "Active" } },
    { who: "Rafael Sharma", canSee: "Shared application status", why: "Sponsor", grantedBy: "Priya Sharma (consent)", expires: "When Priya withdraws", state: { tone: "ok", label: "Active" } },
    { who: "Northline auditor", canSee: "Client-account ledgers, Sept", why: "Annual review", grantedBy: "Lena Park", expires: "Expired 30 Sep", state: { tone: "gr", label: "Expired" } },
  ],
  grantsNote: "External collaborators see only the named documents or tasks. They can’t browse the directory or export in bulk.",
  support: {
    alert: {
      title: "Support grant ends in 8 minutes",
      parts: ["Casevoya support (Jordan Reid)", "NL-2026-0131 documents only", "approved by Amara Osei at 09:04", "reason: “Upload keeps failing for Kofi”."],
    },
    request: {
      from: "Jordan Reid, Casevoya platform support",
      scope: "Upload settings and failed upload records for NL-2026-0131",
      notIncluded: "Document contents, messages, finance",
      duration: "60 minutes from approval",
      reason: { left: "Ticket CS-2291", right: "uploads time out over 20 MB" },
    },
    history: [
      { when: "17 Oct 09:04–10:04", who: "Jordan Reid", scope: "NL-2026-0131 documents", approvedBy: "Amara Osei", opened: "2 records, both listed in Audit" },
      { when: "2 Oct 15:10–16:10", who: "Jordan Reid", scope: "Firm settings only", approvedBy: "Amara Osei", opened: "Settings page" },
    ],
  },
  supportIntro: "Casevoya support can’t see your client files unless you approve a grant. It’s scoped, lasts 60 minutes by default and ends on its own (SEC-09).",
  limits: [
    { person: "Daniel Ruiz", role: "Case manager", office: "Toronto", team: "Family class" },
    { person: "Grace Lin", role: "Licensed consultant", office: "Toronto, Ottawa", team: "All" },
    { person: "Lena Park", role: "Finance", office: "All offices", team: { left: "Finance only", right: "no narratives or medical" } },
  ],
  limitsIntro: "Narrow any role to an office or a team.",
};

const DESIGNER_GRANT_DIALOG: GrantDialogData = {
  people: [{ label: "Grace Lin" }, { label: "External collaborator (email)…" }],
  scopes: [{ label: { left: "One matter", right: "read only" } }, { label: "Named documents" }, { label: "Named tasks" }],
};

describe("Designer fidelity: Access grants", () => {
  for (const [tab, variant] of [["grants", "default"], ["support", "tab-support"], ["limits", "tab-limits"]] as [GrantsTab, string][]) {
    it(`renders the Access grants page (${tab} tab) and its dialog exactly as the captured Designer markup`, () => {
      const captured = clean(renderToStaticMarkup(createElement(GrantsMarkup, { variant })));
      const data = { ...DESIGNER_GRANTS, tab };
      const live = frame("/sheet/grants", createElement(GrantsHeader, { tab, pills: data.pills }), createElement(SheetGrants, { data }), {
        after: createElement(GrantDialog, { data: DESIGNER_GRANT_DIALOG }),
      });
      same(live, captured);
    });
  }

  it("shows honest empty states and wires Create grant by data attributes", () => {
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(SheetGrants, { data: { ...DESIGNER_GRANTS, grants: [] } }),
        createElement(SheetGrants, { data: { ...DESIGNER_GRANTS, tab: "support", support: { alert: null, request: null, history: [] } } }),
        createElement(GrantDialog, {
          data: {
            organizationId: "33333333-3333-4333-8333-333333333333",
            people: [{ label: "Ana Diaz", personId: "11111111-1111-4111-8111-111111111111" }],
            scopes: [{ label: { left: "CA-2026-0001", right: "Ben Ito’s records, read only" }, matterId: "22222222-2222-4222-8222-222222222222", subjectId: "44444444-4444-4444-8444-444444444444" }],
          },
        }),
      ),
    );
    expect(html).toContain("No grants yet");
    expect(html).toContain("No support access");
    expect(html).not.toContain("Request waiting for you");
    expect(html).toContain('<option data-person="11111111-1111-4111-8111-111111111111">Ana Diaz</option>');
    expect(html).toContain('data-matter="22222222-2222-4222-8222-222222222222" data-subject="44444444-4444-4444-8444-444444444444"');
    expect(html).toContain('data-grant-create="1" data-org="33333333-3333-4333-8333-333333333333"');
  });

  it("wires the Support access tab's Designer buttons by data attributes only, with the request's real minutes", () => {
    const org = "33333333-3333-4333-8333-333333333333";
    const wire = (id: string) => ({ "data-support-id": id, "data-org": org });
    const support = {
      alert: { ...DESIGNER_GRANTS.support.alert!, wire: wire("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") },
      request: { ...DESIGNER_GRANTS.support.request!, approveLabel: "Approve for 45 minutes", wire: wire("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") },
      history: DESIGNER_GRANTS.support.history,
    };
    const html = renderToStaticMarkup(
      createElement("div", null, createElement(SheetGrants, { data: { ...DESIGNER_GRANTS, tab: "support", support } }), createElement(SupportDeclineDialog, { organizationId: org })),
    );
    for (const act of ["end", "extend"]) {
      expect(html).toContain(`data-fpb="1" data-support-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" data-org="${org}" data-support-act="${act}"`);
    }
    expect(html).toContain(`data-fpr="1" data-support-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-org="${org}" data-support-act="approve"><span class="lab">Approve for 45 minutes</span>`);
    expect(html).toContain(`data-support-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-org="${org}" data-support-act="decline">Decline</button>`);
    expect(html).toContain('<dialog class="dlg" id="dlgSX"');
    expect(html).toContain(`data-support-decline="1" data-org="${org}">Decline request</button>`);
    // The Designer's own classes only.
    const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]));
    for (const cls of classes) expect(["dlg", "dh", "x", "ic s", "db", "fld", "hint", "inp", "df", "btn", "btn p"].includes(cls) || !cls.startsWith("sx")).toBe(true);
    // Without the wire (the Designer's data) nothing is added.
    const designer = renderToStaticMarkup(createElement(SheetGrants, { data: { ...DESIGNER_GRANTS, tab: "support" } }));
    expect(designer).not.toContain("data-support");
    expect(designer).toContain("Approve for 60 minutes");
  });
});

// ---------------------------------------------------------------------------
// Intake form builder
// ---------------------------------------------------------------------------
const DESIGNER_INTAKE: IntakeBuilderData = {
  tab: "build",
  title: "Spousal sponsorship v3",
  pills: [{ left: "Draft", right: "autosaved 10 s ago" }, "Used by 4 matters"],
  publishLabel: "Publish v4",
  section: { left: "Section 1", right: "About you" },
  palette: ["Short text", "Long text", "Date", "Yes / No", "Choice", "Address", "File upload", "Repeating rows", "Section", "Signature"].map((label) => ({ label })),
  rows: [
    { label: "Full legal name", typeLabel: "Short text", note: "Required", conditional: false, badge: null, selected: false },
    { label: "Date of birth", typeLabel: "Date", note: "Required", conditional: false, badge: { tone: "gr", label: "Unknown allowed" }, selected: true },
    { label: "Have you been married before?", typeLabel: "Yes / No", note: "Required", conditional: false, badge: null, selected: false },
    { label: "Previous marriage details", typeLabel: "Section", note: "Shows if “Yes” above", conditional: true, badge: { tone: "blue", label: "Conditional" }, selected: false },
    { label: "Passport bio page", typeLabel: "File upload", note: "Required", conditional: false, badge: { tone: "gr", label: "OCR on" }, selected: false },
    { label: "Travel history, last 10 years", typeLabel: "Repeating rows", note: "Optional", conditional: false, badge: { tone: "gr", label: "N/A allowed" }, selected: false },
  ],
  settings: {
    label: "Date of birth",
    toggles: [
      { label: "Required", on: true },
      { label: "Allow “Unknown”", on: true },
      { label: "Allow “Not applicable”", on: false },
      { label: "Show to sponsor", on: false },
    ],
  },
  vo: { draft: "Suggest adding “Children from previous relationships” under previous marriage.", sources: "Sources: Based on IRCC guide 5525, staff-reviewed checklist v3" },
};

describe("Designer fidelity: Intake form builder", () => {
  for (const tab of ["build", "preview"] as IntakeTab[]) {
    it(`renders the Intake form builder (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = clean(renderToStaticMarkup(createElement(IntakeBuilderMarkup, { variant: tab === "build" ? "default" : "tab-preview" })));
      const data = { ...DESIGNER_INTAKE, tab };
      const live = frame("/sheet/intake-builder", createElement(IntakeHeader, { data }), createElement(SheetIntakeBuilder, { data }), {
        styles: [INTAKE_BUILDER_CSS],
        aside: createElement(IntakeSettings, { data }),
      });
      same(live, captured);
    });
  }

  it("wires the builder by data attributes only, and shows no Vo card without Vo", () => {
    const data: IntakeBuilderData = {
      ...DESIGNER_INTAKE,
      vo: null,
      rows: [{ ...DESIGNER_INTAKE.rows[0], key: "full_name" }],
      palette: [{ label: "Short text", type: "Short text" }],
      live: { organizationId: "33333333-3333-4333-8333-333333333333", stableKey: "about_you", title: "About you", templateId: null, version: null, status: "new", schema: "{\"fields\":[]}" },
    };
    const html = renderToStaticMarkup(createElement("div", null, createElement(IntakeHeader, { data }), createElement(SheetIntakeBuilder, { data }), createElement(IntakeSettings, { data })));
    expect(html).toContain('data-intake-org="33333333-3333-4333-8333-333333333333" data-intake-key="about_you"');
    expect(html).toContain('<div class="qq" data-key="full_name">');
    expect(html).toContain('data-intake-publish="1"');
    expect(html).toContain('data-goto-tab="preview"');
    expect(html).not.toContain('class="ai"');
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const CA = (right: string) => ({ left: "Canada", right });
const EN_FR = { left: "English", right: "French deferred" };
const DESIGNER_TEMPLATES: TemplatesData = {
  tab: "program",
  pills: ["2 sources need review"],
  reviewCount: 2,
  program: {
    rows: [
      { template: "Spousal sponsorship, outland", jurisdiction: CA("IRCC"), version: "v4", state: { tone: "ok", label: "Published" }, source: { left: "Casevoya central", right: "firm override on checklist" }, reviewer: "Amara Osei", effective: "2 Sep 2026", pinned: { left: "3 on v4", right: "1 on v3" } },
      { template: "Express Entry PR", jurisdiction: CA("IRCC"), version: "v3", state: { tone: "chg", label: "Source review required" }, source: "Casevoya central", reviewer: "—", effective: "1 Jul 2026", pinned: "2" },
      { template: "Study permit", jurisdiction: CA("IRCC"), version: "v5", state: { tone: "ok", label: "Published" }, source: "Casevoya central", reviewer: "Amara Osei", effective: "15 Aug 2026", pinned: "4" },
      { template: "Work permit (LMIA-based)", jurisdiction: CA("IRCC"), version: "v2", state: { tone: "gr", label: "Draft" }, source: "Firm template", reviewer: "Waiting", effective: "—", pinned: "0" },
    ],
    note: "Firm overrides are labelled so you can tell them apart from centrally reviewed content.",
  },
  messages: {
    rows: [
      { template: "Document requested", channel: "Email + portal", usedBy: "Automations, staff", languages: EN_FR, state: { tone: "ok", label: "Approved" } },
      { template: "Deadline reminder 14/7/3/1 days", channel: "Email, SMS", usedBy: "Automation “Deadline reminders”", languages: EN_FR, state: { tone: "ok", label: "Approved" } },
      { template: "Payment received", channel: "Email", usedBy: "Finance", languages: EN_FR, state: { tone: "ok", label: "Approved" } },
      { template: "Refusal next steps", channel: { left: "Portal only", right: "consultant sends" }, usedBy: "Consultant only, never automated", languages: "English", state: { tone: "rev", label: "Needs consultant wording" } },
    ],
  },
  checklists: {
    cards: [
      { title: { left: "Spousal sponsorship", right: "applicant" }, note: { left: "14 items", right: "conditional on marital history" }, tag: "v4" },
      { title: { left: "Spousal sponsorship", right: "sponsor" }, note: { left: "9 items", right: "income rules from source S-114" }, tag: "v4" },
      { title: "Dependant child 18+", note: { left: "6 items", right: "own consent required" }, tag: "v2" },
      { title: "Closure", note: { left: "8 items", right: "retention date set at closing" }, tag: "v1" },
    ],
  },
  sources: {
    kpis: [
      { label: "Review required", value: "2", count: 2, note: "1 overdue", warn: true, href: "?tab=sources" },
      { label: "Published rules", value: "46", count: 46, note: "in 4 templates", href: "#" },
      { label: "Next scheduled check", value: "21 Oct", note: "Study permit income rule", href: "#" },
      { label: "Affected matters", value: "3", count: 3, note: "by the 2 open reviews", href: "#" },
    ],
    rows: [
      { rule: "Proof of funds amount (S-071)", href: "?tab=rule", jurisdiction: CA("Express Entry"), state: { tone: "chg", label: "Review required" }, effective: "7 Jul 2026", reviewer: "Amara Osei (owner)", lastChecked: "1 Jul 2026", nextReview: { num: { left: "Overdue", right: "1 Oct" } }, affected: "2 matters" },
      { rule: "Police certificate validity (S-102)", jurisdiction: CA("all PR"), state: { tone: "rev", label: "Requested review" }, effective: "1 Jan 2026", reviewer: "Grace Lin", lastChecked: "12 Sep 2026", nextReview: "12 Oct 2026", affected: "1 matter" },
      { rule: "Sponsor income evidence (S-114)", jurisdiction: CA("spousal"), state: { tone: "ok", label: "Published" }, effective: "2 Sep 2026", reviewer: "Amara Osei", lastChecked: "12 Oct 2026", nextReview: "12 Nov 2026", affected: "3 matters" },
      { rule: "Biometrics requirement (S-033)", jurisdiction: CA("all temporary"), state: { tone: "gr", label: "Suspended" }, effective: "—", reviewer: "Amara Osei", lastChecked: "30 Sep 2026", nextReview: "—", affected: "0" },
    ],
  },
  rule: {
    title: { left: "Proof of funds amount", right: "S-071" },
    summary: "Express Entry template v3. The published table changed on 7 Jul 2026 and this rule still points to the older version.",
    claim: "“Applicants without a valid job offer must show settlement funds at the level in IRCC’s current table for their family size.”",
    note: "Interpretation note (Amara Osei): the amount comes from the table on the day of submission; we don’t copy numbers into client messages.",
    diff: [
      { label: "Source version", old: "table updated 2025", new: "table updated 7 Jul 2026" },
      { label: "Tests", old: "3 of 3 passing", new: { left: "1 of 3 failing", right: "family size 4 amount changed" } },
    ],
    tests: [
      { case: "Single applicant, no job offer", expected: "Shows the current table link", result: "Pass" },
      { case: "Family of 4", expected: "Uses amount from current table", result: { tone: "bad", label: "Fail" } },
      { case: "Valid job offer", expected: "Rule doesn’t apply", result: "Pass" },
    ],
    source: {
      publisher: "Immigration, Refugees and Citizenship Canada",
      url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents/proof-funds.html",
      linkText: "Express Entry: proof of funds",
      appliesTo: "Settlement funds table, by family size",
      version: "Page as captured 1 Jul 2026 (stale)",
      checked: "1 Jul 2026",
      reviewer: { left: "Amara Osei", right: "review overdue" },
      state: { tone: "unv", label: "Not yet checked" },
    },
    actions: { role: "licensed consultant" },
  },
};

describe("Designer fidelity: Templates", () => {
  for (const [tab, variant] of [["program", "default"], ["messages", "tab-messages"], ["checklists", "tab-checklists"], ["sources", "tab-sources"], ["rule", "tab-rule"]] as [TemplatesTab, string][]) {
    it(`renders the Templates page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = withoutRequirementCodes(clean(renderToStaticMarkup(createElement(TemplatesMarkup, { variant }))));
      const data = { ...DESIGNER_TEMPLATES, tab };
      const live = frame("/sheet/templates", createElement(TemplatesHeader, { data }), createElement(SheetTemplates, { data }));
      same(live, captured);
    });
  }

  it("shows honest empty states and no rule-review buttons without a workflow behind them", () => {
    const empty: TemplatesData = { ...DESIGNER_TEMPLATES, program: { ...DESIGNER_TEMPLATES.program, rows: [] }, checklists: { cards: [] }, sources: { ...DESIGNER_TEMPLATES.sources, rows: [] }, rule: null };
    const html = ["program", "checklists", "sources", "rule"].map((tab) => renderToStaticMarkup(createElement(SheetTemplates, { data: { ...empty, tab: tab as TemplatesTab } }))).join("");
    expect(html).toContain("No program templates yet");
    expect(html).toContain("No checklist templates yet");
    expect(html).toContain("No rules to review");
    expect(html).toContain("No rule chosen");
    const rule = renderToStaticMarkup(createElement(SheetTemplates, { data: { ...DESIGNER_TEMPLATES, tab: "rule", rule: { ...DESIGNER_TEMPLATES.rule!, actions: null } } }));
    expect(rule).not.toContain("Approve version");
  });
});

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------
const DESIGNER_AUTOMATIONS: AutomationsData = {
  tab: "builder",
  name: "Deadline reminders",
  pills: ["Active", "Last run 09:02", "0 retries"],
  actions: { test: "Test with sample matter", save: "Save version 4" },
  intro: "Automations create tasks, assign staff, request documents and send approved admin templates. Legal advice, refunds, bank details, outcomes and submissions always need a person.",
  steps: [
    { icon: "bell", title: "When", text: "A verified deadline is recorded on a matter", badge: { label: "Event" } },
    { icon: "filter", title: "If", text: { left: "The deadline is more than 14 days away", right: "Matter is not closed" }, badge: { label: "Conditions" } },
    { icon: "clock", title: "Then", text: "Propose client reminders at 14, 7, 3 and 1 days", badge: { label: "Action" } },
    { icon: "users", title: "And", text: "Create a task for the assigned consultant 3 days before", badge: { label: "Action" } },
    { icon: "shield", title: "Human approval", text: "Before any message reaches the client", badge: { tone: "chg", label: "Required" }, warn: true },
    { icon: "x-circle", title: "Stop when", text: "The task is completed or the deadline changes", badge: { label: "Stop rule" } },
  ],
  addStep: true,
  runs: [
    { title: { left: "Priya Sharma", right: "NL-2026-0142" }, note: { left: "Proposed 4 reminders", right: "approved by Amara" }, state: { tone: "ok", label: "Approved" }, when: "09:02" },
    { title: { left: "Kofi Mensah", right: "NL-2026-0131" }, note: { left: "Proposed 4 reminders", right: "waiting for approval" }, state: { tone: "rev", label: "Waiting" }, when: "Yesterday 16:40" },
    { title: { left: "Grace Okafor", right: "NL-2026-0128" }, note: "Stopped: deadline changed", state: { tone: "gr", label: "Stopped" }, when: "14 Oct" },
  ],
  settings: [
    { label: "Owner", value: "Amara", person: { name: "Amara Osei", avatarUrl: "/assets/av-amara-consultant.png" } },
    { label: "Quiet hours", value: "21:00–08:00", icon: "moon" },
    { label: "Delay", value: "None" },
    { label: "Critical exceptions", value: "Short-notice requests" },
  ],
  others: [
    { label: "Welcome pack after agreement signed", on: true },
    { label: "Chase overdue client tasks", on: true },
    { label: "Lead follow-up after 3 days", on: false },
  ],
  vo: { draft: "Suggested: add “Stop when the matter is put on hold”, with a review date.", sources: "Sources: your 3 most recent on-hold matters" },
};

describe("Designer fidelity: Automations", () => {
  for (const [tab, variant] of [["builder", "default"], ["runs", "tab-runs"]] as [AutomationsTab, string][]) {
    it(`renders the Automations page (${tab} tab) exactly as the captured Designer markup`, () => {
      const captured = clean(renderToStaticMarkup(createElement(AutomationsMarkup, { variant })));
      const data = { ...DESIGNER_AUTOMATIONS, tab };
      const live = frame("/sheet/automations", createElement(AutomationsHeader, { data }), createElement(SheetAutomations, { data }), {
        aside: createElement(AutomationsSettings, { data }),
      });
      same(live, captured);
    });
  }

  it("shows no editor buttons, other automations or Vo card on a real page, and an honest empty history", () => {
    const data: AutomationsData = { ...DESIGNER_AUTOMATIONS, tab: "runs", actions: null, addStep: false, others: [], vo: null, runs: [] };
    const html = renderToStaticMarkup(createElement("div", null, createElement(AutomationsHeader, { data }), createElement(SheetAutomations, { data }), createElement(AutomationsSettings, { data })));
    expect(html).toContain("No reminders yet");
    expect(html).not.toMatch(/Save version|Test with sample|Other automations|class="ai"/);
  });
});
