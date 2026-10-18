/**
 * Pure helpers for the Sheet's Licences page: the firm's staff and their CICC credentials in the
 * Designer's words. A licence check is a manual check of the CICC public register recorded by a
 * reviewer (RULES.md, decision 2026-10-17); nothing here contacts the register.
 */
import type { LicenceCard, LicenceDialogsData, LicenceLogEntry, LicenceValue } from "@/components/sheet/designer/licence";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { staffPerson } from "@/modules/sheet/avatar";
import { dayMonth, zoneCity } from "@/modules/sheet/home-present";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";

export const CICC = "College of Immigration and Citizenship Consultants";
export const CICC_REGULATOR = `${CICC} (CICC)`;

/** The Add a licence dialog's regulator choices. Casevoya records CICC licences only. */
export const LICENCE_REGULATORS = [`${CICC_REGULATOR}, RCIC`, `${CICC_REGULATOR}, RISIA`] as const;

export function licenceTypeFor(label: string | null | undefined): "RCIC" | "RISIA" | null {
  if (label === LICENCE_REGULATORS[0]) return "RCIC";
  if (label === LICENCE_REGULATORS[1]) return "RISIA";
  return null;
}

export const INVITE_SOMEONE = "Invite someone new…";

export type LicenceMember = { membershipId: string; name: string | null; role: string; status: string; isSelf: boolean };

export type LicenceCredential = {
  id: string;
  membershipId: string;
  licenceType: string;
  collegeId: string;
  scopeNote: string | null;
  status: string;
  proofLocator: string | null;
  sourceUrl: string | null;
  registerStatus: string | null;
  entitlement: boolean | null;
  restricted: boolean;
  restrictionDetail: string | null;
  declaredAt: string;
  checkedAt: string | null;
  nextReviewAt: string | null;
  validUntil: string | null;
};

export type LicenceLogRow = {
  at: string;
  kind: string;
  result: string | null;
  credentialId: string;
  holderName: string | null;
  collegeId: string;
  actorName: string | null;
  actorIsPlatform: boolean;
};

export type LicenceContext = {
  timeZone: string;
  now: Date;
  /** licence.recheck_interval in months, when it is a whole number of months. */
  recheckMonths: number | null;
  /** licence.manual_check_target, "1 business day". */
  checkTarget: string | null;
  firmHasVerifiedLicence: boolean;
  viewerIsOwner: boolean;
};

const BLOCKED = new Set(["revoked", "suspended", "inactive", "not_entitled"]);

const RESULT_LABEL: Record<string, string> = {
  verified: "confirmed active",
  suspended: "suspended",
  revoked: "revoked",
  inactive: "inactive on the register",
  not_entitled: "not entitled to practise",
};

const STATE_LABEL: Record<string, string> = {
  revoked: "Revoked",
  suspended: "Suspended",
  inactive: "Inactive",
  not_entitled: "Not entitled to practise",
};

const ROLE_NOTE: Record<string, string> = {
  case_manager: "prepares files, can’t release submissions",
  assistant: "works on assigned tasks, can’t release submissions",
  finance_user: "handles billing, can’t release submissions",
};

/** "17 Oct 2026, 09:40" in the firm's zone. */
export function dateTimeLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${longDate(isoDateInTimeZone(date, timeZone))}, ${time}`;
}

export function credentialBlocks(credential: Pick<LicenceCredential, "status">): boolean {
  return BLOCKED.has(credential.status);
}

/** "The reviewer" for a platform reviewer reads "M. Tremblay, Casevoya verification". */
export function reviewerLabel(name: string | null, platform: boolean): string {
  const who = name || (platform ? "Casevoya reviewer" : "A firm owner");
  return platform ? `${who}, Casevoya verification` : who;
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function classValue(credential: LicenceCredential): LicenceValue {
  if (credential.scopeNote === "RCIC-IRB") return { left: "RCIC-IRB", right: "can appear before the IRB" };
  return credential.licenceType;
}

function stateOf(credential: LicenceCredential): MatterBadge {
  if (credential.status === "verified") return { tone: "ok", label: "Verified" };
  if (BLOCKED.has(credential.status)) return { tone: "bad", label: STATE_LABEL[credential.status] ?? "Check result" };
  return { tone: "rev", label: "Waiting for check" };
}

function untilChecked(context: LicenceContext): string {
  return context.firmHasVerifiedLicence
    ? "Can work on files. The check confirms good standing on the register."
    : "Can work on files. Your firm can’t invite real clients until one licence is checked.";
}

function nextReview(credential: LicenceCredential, context: LicenceContext): LicenceValue | null {
  if (!credential.nextReviewAt) return null;
  const due = new Date(credential.nextReviewAt).getTime() <= context.now.getTime();
  const cadence = context.recheckMonths === 1 ? "monthly, or sooner if a change is reported" : "or sooner if a change is reported";
  return { num: longDate(isoDateInTimeZone(new Date(credential.nextReviewAt), context.timeZone)), after: due ? "due now" : cadence };
}

function sourceOf(credential: LicenceCredential, reviewer: string, context: LicenceContext): LicenceCard["source"] {
  if (!credential.checkedAt || !credential.sourceUrl) return null;
  const checked = dateTimeLabel(credential.checkedAt, context.timeZone);
  const register = credential.registerStatus === "active" ? "Active" : credential.registerStatus === "inactive" ? "Inactive" : "not recorded";
  const entitled = credential.entitlement === false ? ", not entitled to practise" : "";
  return {
    publisher: CICC,
    url: credential.sourceUrl,
    linkText: "CICC public register",
    appliesTo: `Licence ${credential.collegeId}, class ${credential.scopeNote === "RCIC-IRB" ? "RCIC-IRB" : credential.licenceType}, status “${register}”${entitled}`,
    version: `Register as shown on ${longDate(isoDateInTimeZone(new Date(credential.checkedAt), context.timeZone))}`,
    checked,
    reviewer,
    state: credential.status === "verified" ? { tone: "ok", label: "Checked" } : { tone: "bad", label: STATE_LABEL[credential.status] ?? "Checked" },
  };
}

function proofOf(credential: LicenceCredential, holder: string, context: LicenceContext): LicenceCard["proof"] {
  if (!credential.proofLocator) {
    return { kind: "none", text: "No proof file yet. The reviewer keeps their own register evidence with the check." };
  }
  const when = credential.checkedAt ?? credential.declaredAt;
  const review: MatterBadge =
    credential.status === "verified"
      ? { tone: "ok", label: "Accepted" }
      : BLOCKED.has(credential.status)
        ? { tone: "bad", label: "Adverse result" }
        : { tone: "rev", label: "Being reviewed" };
  return {
    kind: "file",
    name: credential.checkedAt ? "Register check proof" : "Licence proof",
    meta: ["Licence proof", first(holder)],
    date: dayMonth(isoDateInTimeZone(new Date(when), context.timeZone)),
    states: [{ tone: "unv", label: "Uploaded" }, review],
  };
}

/** The reviewer of the credential's latest check, from the review log. */
function lastReviewer(credential: LicenceCredential, log: readonly LicenceLogRow[]): string {
  const check = log
    .filter((row) => row.kind === "check" && row.credentialId === credential.id)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return check ? reviewerLabel(check.actorName, check.actorIsPlatform) : "Not recorded";
}

export function licenceCard(member: LicenceMember, credential: LicenceCredential | null, log: readonly LicenceLogRow[], context: LicenceContext, viewerMayReport: boolean): LicenceCard {
  const name = member.name || "Team member";
  const owner = member.role === "firm_owner";
  const base = { person: staffPerson(name), name };
  if (!credential) {
    if (member.role === "licensed_consultant" || owner) {
      return {
        ...base,
        sub: owner ? "Owner" : "Licensed consultant",
        art: null,
        state: owner ? { tone: "gr", label: "No licence on file" } : { tone: "chg", label: "No licence on file" },
        rows: [
          {
            label: "Role",
            value: owner ? { left: "Owner", right: "add your licence if you practise" } : { left: "Licensed consultant", right: "add their licence so it can be checked" },
          },
        ],
        proof: { kind: "none", text: "Not added yet." },
        source: null,
        footer: {},
      };
    }
    return {
      ...base,
      sub: roleLabel(member.role),
      art: null,
      state: { tone: "gr", label: "No licence needed" },
      rows: [{ label: "Role", value: ROLE_NOTE[member.role] ? { left: roleLabel(member.role), right: ROLE_NOTE[member.role] } : roleLabel(member.role) }],
      proof: { kind: "none", text: "Not required for this role." },
      source: null,
      footer: {},
    };
  }

  const state = stateOf(credential);
  const blocked = BLOCKED.has(credential.status);
  const sub = owner ? { left: "Owner", right: "Licensed consultant" } : "Licensed consultant";
  const rows: LicenceCard["rows"] = [
    { label: "Regulator", value: CICC_REGULATOR },
    { label: "Licence number", value: { num: credential.collegeId } },
    { label: "Class", value: classValue(credential) },
  ];
  if (credential.validUntil) rows.push({ label: "Valid until", value: { num: longDate(credential.validUntil), after: "as declared, not checked" } });
  const reviewer = lastReviewer(credential, log);
  const report = viewerMayReport ? credential.id : undefined;
  const lock = { icon: "lock" as const, text: "Changes ask you to confirm it’s you" };

  if (credential.status === "declared" || !credential.checkedAt) {
    rows.push({ label: "Submitted", value: { num: dateTimeLabel(credential.declaredAt, context.timeZone) } });
    rows.push({ label: "Until checked", value: untilChecked(context) });
    return {
      ...base,
      sub,
      art: "licence-pending",
      state,
      rows,
      proof: proofOf(credential, name, context),
      source: null,
      footer: context.checkTarget ? { note: { icon: "clock", text: `Usually checked within ${context.checkTarget}` } } : {},
    };
  }

  rows.push({ label: "Last check", value: { num: dateTimeLabel(credential.checkedAt, context.timeZone), suffix: ` ${zoneCity(context.timeZone)}` } });
  if (credential.restricted && credential.restrictionDetail) rows.push({ label: "Register note", value: credential.restrictionDetail });
  if (blocked) {
    rows.push({ label: "Paused", value: "New matters, service agreements and regulated stage changes" });
  } else {
    const next = nextReview(credential, context);
    if (next) rows.push({ label: "Next review", value: next });
  }
  return {
    ...base,
    sub,
    art: blocked ? "licence-paused" : "licence-card",
    state,
    adverse: blocked,
    rows,
    proof: proofOf(credential, name, context),
    source: sourceOf(credential, reviewer, context),
    footer: report !== undefined ? { report, note: lock } : { note: lock },
  };
}

/** Owner first, then licensed consultants, then everyone else, in the directory's order. */
export function licenceCards(
  members: readonly LicenceMember[],
  credentials: readonly LicenceCredential[],
  log: readonly LicenceLogRow[],
  context: LicenceContext,
): LicenceCard[] {
  const byMembership = new Map(credentials.map((credential) => [credential.membershipId, credential]));
  const rank = (member: LicenceMember) => (member.role === "firm_owner" ? 0 : member.role === "licensed_consultant" ? 1 : 2);
  return [...members]
    .filter((member) => member.status === "active")
    .sort((a, b) => rank(a) - rank(b))
    .map((member) => {
      const credential = byMembership.get(member.membershipId) ?? null;
      const mayReport = Boolean(credential) && (context.viewerIsOwner || member.isSelf);
      return licenceCard(member, credential, log, context, mayReport);
    });
}

export function licenceIntro(context: LicenceContext): string {
  const cadence = context.recheckMonths === 1 ? "We check again every month" : "We check again on a set schedule";
  return `Each consultant’s licence is checked by hand against the CICC public register; Casevoya doesn’t connect to the register. Your firm can invite real clients once one licence is checked. ${cadence}, and whenever a change is reported.`;
}

export function licenceLog(rows: readonly LicenceLogRow[], timeZone: string): LicenceLogEntry[] {
  return rows.map((row) => {
    const by = `by ${reviewerLabel(row.actorName, row.actorIsPlatform)}`;
    const holder = row.holderName || "Team member";
    if (row.kind === "check") {
      return {
        at: dateTimeLabel(row.at, timeZone),
        title: { left: "Register checked", right: RESULT_LABEL[row.result ?? ""] ?? "result recorded" },
        parts: [holder, row.collegeId, by],
      };
    }
    if (row.kind === "change_reported") {
      return { at: dateTimeLabel(row.at, timeZone), title: "Change reported", parts: [holder, row.collegeId, by] };
    }
    return { at: dateTimeLabel(row.at, timeZone), title: "Licence added", parts: [row.collegeId, by] };
  });
}

/** Who Add a licence offers: the owner sees every licensed consultant without one (and themselves); a consultant sees only themselves. */
export function licenceDialogs(members: readonly LicenceMember[], credentials: readonly LicenceCredential[], viewerIsOwner: boolean): LicenceDialogsData {
  const held = new Set(credentials.map((credential) => credential.membershipId));
  const consultants = members
    .filter((member) => member.status === "active" && !held.has(member.membershipId))
    .filter((member) => (member.role === "licensed_consultant" && (viewerIsOwner || member.isSelf)) || (member.role === "firm_owner" && member.isSelf))
    .map((member) => ({ label: member.name || "Team member", membershipId: member.membershipId }));
  return { consultants, inviteLabel: INVITE_SOMEONE, regulators: [...LICENCE_REGULATORS] };
}

/** `{"unit":"months","count":1}` → 1; anything else → null. */
export function recheckMonths(value: unknown): number | null {
  const setting = value as { unit?: unknown; count?: unknown } | null;
  return setting?.unit === "months" && typeof setting.count === "number" ? setting.count : null;
}

/** `{"unit":"business_days","count":1}` → "1 business day". */
export function checkTargetLabel(value: unknown): string | null {
  const setting = value as { unit?: unknown; count?: unknown } | null;
  if (setting?.unit !== "business_days" || typeof setting.count !== "number") return null;
  return `${setting.count} business day${setting.count === 1 ? "" : "s"}`;
}
