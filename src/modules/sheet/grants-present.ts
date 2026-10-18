/**
 * Pure helpers for the Sheet's Access grants page: the firm's explicit and guardian grants in the
 * Designer's words, the New access grant dialog's choices, and the date it reads.
 */
import type { GrantDialogData, GrantRow, GrantsData, GrantsTab } from "@/components/sheet/designer/grants";
import { dayMonth } from "@/modules/sheet/home-present";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";

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
  return { who: grant.granteeName, canSee, why: grant.purpose, grantedBy: grant.grantedByName || "The firm", expires, state };
}

export const SUPPORT_INTRO =
  "Casevoya support can’t see your client files. Support grants (SEC-09) aren’t built yet, so there’s nothing to approve and no way for support to open a matter.";

export const LIMITS_INTRO =
  "Casevoya doesn’t narrow a role to an office or team yet. Everyone works firm-wide within their role and the matters they’re assigned to.";

export const GRANTS_NOTE =
  "A grant opens one matter’s records for one person, read only, until the end date. They can’t browse your directory or see other matters.";

export function grantsData(tab: GrantsTab, grants: readonly FirmGrant[], staff: readonly GrantStaff[], now: Date, timeZone: string): GrantsData {
  const active = grants.filter((grant) => grantActive(grant, now)).length;
  return {
    tab,
    pills: [`${active} active`, "No support requests"],
    grants: grants.map((grant) => grantRow(grant, now, timeZone)),
    grantsNote: GRANTS_NOTE,
    support: { alert: null, request: null, history: [] },
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

export function grantDialog(organizationId: string, choices: readonly GrantChoice[]): GrantDialogData {
  return {
    organizationId,
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
