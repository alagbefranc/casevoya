import type { RoleCell, RoleMatrixData } from "@/components/sheet/designer/roles";

/**
 * What each role may do, as the server enforces it today (PRD §5). The Roles page renders this
 * in the Designer's table. Where the Designer's sample said more than is built, the cell says
 * what is true now:
 *   - Platform admin, View matter: No. There is no support-grant access path yet (SEC-09 is
 *     not built), so a platform admin reads no firm records at all.
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
    { permission: "View matter", cells: [N, Y, AS, AS, AS, AS, OWN, OWN, OWN, OWN] },
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
    "“Own” means the person only sees records they’re part of. “Assigned only” means the person works only on matters they’re assigned to (PRD §5): licensed consultants on their assigned matters, case managers on assigned intake, documents, tasks and drafts, assistants on explicitly assigned work, and finance users on the billing side of their assigned matters, with no default access to restricted records. A case manager can’t release a submission. Earned-fee transfers need a second approver; a firm owner may approve their own request after confirming it’s them. Platform admins can’t see firm data.",
  notes: {
    lock: "Sign representation is limited to licensed consultants by regulation. You can’t grant it to other roles.",
    shield: "Platform admins see firm configuration only. Casevoya support has no way to open a matter: support grants aren’t built yet, and there’s no hidden “log in as this firm” button.",
  },
  pills: [`${ROLES.length} roles`, "Changes are logged"],
};
