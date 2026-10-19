/**
 * Pure helpers for the Sheet's Access grants page: the firm's explicit and guardian grants in the
 * Designer's words, the Support access tab from public.firm_support_access (SEC-09), the New
 * access grant dialog's choices, and the date it reads.
 */
import type { GrantDialogData, GrantRow, GrantsData, GrantsTab, SupportRequest } from "@/components/sheet/designer/grants";
import { dayMonth } from "@/modules/sheet/home-present";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";

export type SupportScope = "firm_settings" | "matter_documents" | "matter_records" | "matter_all" | "records_set";

export type SupportStatus = "pending" | "approved" | "declined" | "expired" | "ended" | "cancelled";

/** public.firm_support_access(org): the open grant, the waiting request, and the history. */
export type FirmSupportAccess = {
  alert: {
    id: string;
    requester_name: string;
    ticket_ref: string | null;
    scope: SupportScope;
    matter_reference: string | null;
    matter_title: string | null;
    reason: string;
    approved_by_name: string | null;
    approved_at: string | null;
    starts_at: string | null;
    ends_at: string;
    extension_count: number;
    uses: number;
  } | null;
  request: {
    id: string;
    requester_name: string;
    requester_email: string | null;
    ticket_ref: string | null;
    scope: SupportScope;
    matter_reference: string | null;
    matter_title: string | null;
    not_included: string | null;
    reason: string;
    requested_minutes: number;
    created_at: string;
  } | null;
  pending: number;
  history: {
    id: string;
    status: SupportStatus;
    requester_name: string;
    scope: SupportScope;
    matter_reference: string | null;
    approved_by_name: string | null;
    created_at: string;
    starts_at: string | null;
    ends_at: string | null;
    ended_at: string | null;
    decline_reason: string | null;
    uses: number;
  }[];
};

const SCOPES = new Set<string>(["firm_settings", "matter_documents", "matter_records", "matter_all", "records_set"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Only a well-formed answer from the database; anything else reads as "nothing" rather than a guess. */
export function readSupportAccess(raw: unknown): FirmSupportAccess | null {
  const root = record(raw);
  if (!root) return null;
  const alert = record(root.alert);
  const request = record(root.request);
  const okScope = (row: Record<string, unknown> | null) => Boolean(row && typeof row.id === "string" && SCOPES.has(String(row.scope)));
  return {
    alert: okScope(alert) && typeof alert!.ends_at === "string" ? (alert as FirmSupportAccess["alert"]) : null,
    request: okScope(request) && typeof request!.requested_minutes === "number" ? (request as FirmSupportAccess["request"]) : null,
    pending: typeof root.pending === "number" ? root.pending : 0,
    history: Array.isArray(root.history) ? (root.history.filter((row) => okScope(record(row))) as FirmSupportAccess["history"]) : [],
  };
}

function matterName(reference: string | null, title: string | null): string {
  return reference || title || "one matter";
}

/** A grant's scope in the Designer's words: the alert's clause, the request's Scope line, the history's cell. */
export function supportScopeLabel(scope: SupportScope, matterReference: string | null, matterTitle: string | null, form: "alert" | "request" | "history"): string {
  const matter = matterName(matterReference, matterTitle);
  switch (scope) {
    case "firm_settings":
      return form === "request" ? "Firm settings" : "Firm settings only";
    case "matter_documents":
      return form === "alert" ? `${matter} documents only` : form === "request" ? `Document records for ${matter}` : `${matter} documents`;
    case "matter_records":
      return form === "alert" ? `${matter} records only` : form === "request" ? `Parties, tasks and deadlines for ${matter}` : `${matter} records`;
    case "matter_all":
      return form === "alert" ? `${matter}, all records` : form === "request" ? `All records for ${matter}` : `${matter}, all records`;
    case "records_set":
      return form === "request" ? "A named set of records" : "A named set of records only";
  }
}

/** What a scope never opens, when the request did not say. */
export function supportNotIncluded(scope: SupportScope): string {
  switch (scope) {
    case "firm_settings":
      return "Client files, document contents, messages, finance";
    case "records_set":
      return "Everything the request doesn’t name";
    default:
      return "Document contents, messages, finance, other matters";
  }
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "2 records, both listed in Audit": how many records support opened under a grant. */
export function supportOpened(uses: number, status: SupportStatus): string {
  if (status === "declined" || status === "cancelled") return "Nothing";
  if (uses === 0) return "Nothing opened";
  if (uses === 1) return "1 record, listed in Audit";
  if (uses === 2) return "2 records, both listed in Audit";
  return `${uses} records, all listed in Audit`;
}

export function supportPill(pending: number): string {
  if (pending === 0) return "No support requests";
  return pending === 1 ? "1 support request" : `${pending} support requests`;
}

/** The Support access tab from the database's answer. `organizationId` wires the buttons (live only). */
export function supportData(raw: FirmSupportAccess | null, now: Date, timeZone: string, organizationId?: string): SupportRequest {
  if (!raw) return { alert: null, request: null, history: [] };
  const wire = (id: string) => (organizationId ? { "data-support-id": id, "data-org": organizationId } : undefined);
  const alert = raw.alert;
  const minutesLeft = alert ? Math.max(1, Math.ceil((new Date(alert.ends_at).getTime() - now.getTime()) / 60_000)) : 0;
  const request = raw.request;
  return {
    alert: alert
      ? {
          title: `Support grant ends in ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"}`,
          parts: [
            `Casevoya support (${alert.requester_name})`,
            supportScopeLabel(alert.scope, alert.matter_reference, alert.matter_title, "alert"),
            `approved by ${alert.approved_by_name || "a firm owner"}${alert.approved_at ? ` at ${clock(alert.approved_at, timeZone)}` : ""}`,
            `reason: “${alert.reason}”.`,
          ],
          wire: wire(alert.id),
        }
      : null,
    request: request
      ? {
          from: `${request.requester_name}, Casevoya platform support`,
          scope: supportScopeLabel(request.scope, request.matter_reference, request.matter_title, "request"),
          notIncluded: request.not_included || supportNotIncluded(request.scope),
          duration: `${request.requested_minutes} minutes from approval`,
          reason: request.ticket_ref ? { left: `Ticket ${request.ticket_ref}`, right: request.reason } : request.reason,
          approveLabel: `Approve for ${request.requested_minutes} minutes`,
          wire: wire(request.id),
        }
      : null,
    history: raw.history.map((row) => {
      const start = row.starts_at ?? row.created_at;
      const end = row.ended_at ?? row.ends_at;
      const day = dayMonth(isoDateInTimeZone(new Date(start), timeZone));
      return {
        when: row.starts_at && end ? `${day} ${clock(start, timeZone)}–${clock(end, timeZone)}` : `${day} ${clock(start, timeZone)}`,
        who: row.requester_name,
        scope: supportScopeLabel(row.scope, row.matter_reference, null, "history"),
        approvedBy: row.approved_by_name || (row.status === "declined" ? "Declined" : row.status === "cancelled" ? "Withdrawn by support" : "A firm owner"),
        opened: supportOpened(row.uses, row.status),
      };
    }),
  };
}

export type FirmGrant = {
  id: string;
  kind: string;
  granteeName: string;
  subjectName: string;
  matterReference: string | null;
  purpose: string;
  grantedByName: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type GrantChoice = { choice: string; personId: string; personName: string; matterId: string | null; matterReference: string | null };

export type GrantStaff = { name: string | null; role: string; status: string };

function possessive(name: string): string {
  return `${name}’s records`;
}

export function grantActive(grant: Pick<FirmGrant, "expiresAt" | "revokedAt">, now: Date): boolean {
  return !grant.revokedAt && (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime());
}

export function grantRow(grant: FirmGrant, now: Date, timeZone: string): GrantRow {
  // A grant ends at the next local midnight after its chosen day, so the day shown is the minute before.
  const lastDay = (iso: string) => isoDateInTimeZone(new Date(new Date(iso).getTime() - 60_000), timeZone);
  const canSee = grant.matterReference
    ? { left: grant.matterReference, right: `${possessive(grant.subjectName)}, read only` }
    : grant.kind === "guardian"
      ? { left: possessive(grant.subjectName), right: "as guardian" }
      : possessive(grant.subjectName);
  let expires: GrantRow["expires"];
  let state: GrantRow["state"];
  if (grant.revokedAt) {
    expires = `Revoked ${dayMonth(isoDateInTimeZone(new Date(grant.revokedAt), timeZone))}`;
    state = { tone: "gr", label: "Revoked" };
  } else if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= now.getTime()) {
    expires = `Expired ${dayMonth(lastDay(grant.expiresAt))}`;
    state = { tone: "gr", label: "Expired" };
  } else {
    expires = grant.expiresAt ? { num: longDate(lastDay(grant.expiresAt)) } : grant.kind === "guardian" ? "While the child is a minor" : "Until revoked";
    state = { tone: "ok", label: "Active" };
  }
  const scope = typeof canSee === "string" ? canSee : `${canSee.left}, ${canSee.right}`;
  return {
    who: grant.granteeName,
    canSee,
    why: grant.purpose,
    grantedBy: grant.grantedByName || "The firm",
    expires,
    state,
    attrs: grantActive(grant, now)
      ? { "data-grant-row": grant.id, "data-grant-label": `${grant.granteeName} can see ${scope}.`, tabIndex: "0", title: "Revoke this grant" }
      : undefined,
  };
}

export const SUPPORT_INTRO =
  "Casevoya support can’t see your client files unless you approve a request. Access is scoped, lasts 60 minutes by default, ends on its own, and every record support opens is logged.";

export const LIMITS_INTRO =
  "Casevoya doesn’t narrow a role to an office or team yet. Everyone works firm-wide within their role and the matters they’re assigned to.";

export const GRANTS_NOTE =
  "A grant opens one matter’s records for one person, read only, until the end date. They can’t browse your directory or see other matters.";

export function grantsData(
  tab: GrantsTab,
  grants: readonly FirmGrant[],
  staff: readonly GrantStaff[],
  now: Date,
  timeZone: string,
  support: FirmSupportAccess | null = null,
  organizationId?: string,
): GrantsData {
  const active = grants.filter((grant) => grantActive(grant, now)).length;
  return {
    tab,
    pills: [`${active} active`, supportPill(support?.pending ?? 0)],
    grants: grants.map((grant) => grantRow(grant, now, timeZone)),
    grantsNote: GRANTS_NOTE,
    support: supportData(support, now, timeZone, organizationId),
    supportIntro: SUPPORT_INTRO,
    limits: staff
      .filter((member) => member.status === "active")
      .map((member) => ({
        person: member.name || "Team member",
        role: member.role === "firm_owner" ? "Owner" : roleLabel(member.role),
        office: "All offices",
        team: member.role === "finance_user" ? { left: "Billing only", right: "no case narratives" } : "All",
      })),
    limitsIntro: LIMITS_INTRO,
  };
}

/**
 * The New access grant form's own checks, run in the page before anything is sent, so an empty or
 * wrong form is answered in place instead of after a step-up. The database checks again.
 */
export function grantDraftProblem(
  expires: string,
  reason: string,
  todayIso: string,
): { field: "gE" | "gR"; title: string; sub: string } | null {
  const end = readGrantDate(expires);
  if (!end) return { field: "gE", title: "Enter an end date", sub: "Use DD/MM/YYYY. Grants never last forever." };
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const chosen = Date.parse(`${end}T00:00:00Z`);
  if (chosen < today || chosen > today + 366 * 86_400_000) return { field: "gE", title: "Choose another end date", sub: "From today up to a year ahead." };
  const length = reason.trim().length;
  if (length < 3 || length > 500) return { field: "gR", title: "Give a reason", sub: "At least 3 characters. It is kept in the audit trail." };
  return null;
}

export function grantDialog(organizationId: string, choices: readonly GrantChoice[], today?: string): GrantDialogData {
  return {
    organizationId,
    today,
    people: choices.filter((row) => row.choice === "grantee").map((row) => ({ label: row.personName, personId: row.personId })),
    scopes: choices
      .filter((row) => row.choice === "scope" && row.matterId)
      .map((row) => ({
        label: { left: row.matterReference ?? "Matter without a reference", right: `${possessive(row.personName)}, read only` },
        matterId: row.matterId ?? undefined,
        subjectId: row.personId,
      })),
  };
}

/** "28/10/2026" → "2026-10-28"; null when it isn't a real calendar date. */
export function readGrantDate(raw: string | null | undefined): string | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(raw ?? "") ?? /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw ?? "");
  if (!match) return null;
  const [day, month, year] = match[1].length === 4 ? [Number(match[3]), Number(match[2]), Number(match[1])] : [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
