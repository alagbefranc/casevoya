import type { RoleCell, RoleMatrixData } from "@/components/sheet/designer/roles";

/**
 * What each role may do, as the server enforces it today (PRD §5). The Roles page renders this
 * in the Designer's table. Where the Designer's sample said more than is built, the cell says
 * what is true now:
 *   - Platform admin, View matter: Support grant. A platform admin reads a matter only through
 *     support_read_matter under a grant the firm owner approved (SEC-09, 20261020170100): scoped,
 *     60 minutes by default, 240 at most, ended by the owner or on its own, every read logged.
 *   - Finance, View matter: Assigned only. A finance user reads the billing projection of the
 *     matters they are assigned to (decision 2026-10-17), not other matters.
 *   - Earned-fee transfers need a second approver, except the firm owner, who may approve their
 *     own request after a fresh step-up (decision 2026-10-18).
 * Each change to an authorization rule should update this table in the same change.
 */
const Y: RoleCell = "yes";
const N: RoleCell = "no";
const AS: RoleCell = { tone: "rev", label: "Assigned only" };
const OWN: RoleCell = { tone: "gr", label: "Own" };
const SUPPORT: RoleCell = { tone: "chg", label: "Support grant" };

const ROLES = [
  "Platform admin",
  "Firm owner",
  "Licensed consultant",
  "Case manager",
  "Assistant",
  "Finance",
  "Client / adult dependant",
  "Sponsor / employer",
  "Guardian",
  "External collaborator",
];

export const ROLE_MATRIX: RoleMatrixData = {
  roles: ROLES,
  rows: [
    { permission: "View matter", cells: [SUPPORT, Y, AS, AS, AS, AS, OWN, OWN, OWN, OWN] },
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
    "“Own” means the person only sees records they’re part of. “Assigned only” means the person works only on matters they’re assigned to (PRD §5): licensed consultants on their assigned matters, case managers on assigned intake, documents, tasks and drafts, assistants on explicitly assigned work, and finance users on the billing side of their assigned matters, with no default access to restricted records. A case manager can’t release a submission. Earned-fee transfers need a second approver; a firm owner may approve their own request after confirming it’s them. Platform admins need a time-limited support grant you approve to see firm data.",
  notes: {
    lock: "Sign representation is limited to licensed consultants by regulation. You can’t grant it to other roles.",
    shield: "Platform admins see firm configuration only. Opening a matter needs a support grant the firm approves; it lasts 60 minutes by default and is revoked automatically. There’s no hidden “log in as this firm” button.",
  },
  pills: [`${ROLES.length} roles`, "Changes are logged"],
};
