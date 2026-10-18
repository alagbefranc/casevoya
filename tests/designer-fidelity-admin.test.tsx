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
