/**
 * Pure helpers for the licence-suspended home: what the signed-in consultant sees when their own
 * CICC licence check recorded an adverse result (revoked, suspended, inactive, not entitled;
 * PRD ORG-05). What is paused is what the database locks for that consultant
 * (app.actor_licence_block_status): new matters, service agreements on matters they are
 * responsible for, and regulated stage changes such as releasing a submission.
 */
import type { HomeReveal } from "@/components/sheet/designer/home";
import type { SuspendedData } from "@/components/sheet/designer/licence-suspended";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, plusDays } from "@/modules/sheet/present";

/** The capture's reveal order: alert 0, greeting 1, panel 2, dialog 3, quick 4, practice 2, bar 6, tasks 7. */
export const SUSPENDED_REVEAL: HomeReveal = { ph: "1", quick: "4", panel: "2", bar: "6", tasks: "7" };

export const SUSPENDED_NEW_TITLE = "Paused while your licence check is reviewed";

const RESULT: Record<string, string> = {
  revoked: "revoked on the register",
  suspended: "suspended on the register",
  inactive: "inactive on the register",
  not_entitled: "not entitled to practise",
};

export type SuspendedInput = {
  organizationId: string;
  membershipId: string;
  timeZone: string;
  now: Date;
  credential: { status: string; collegeId: string; checkedAt: string | null };
  /** The viewer's open matters as responsible consultant or consultant party. */
  matters: { id: string; name: string; reference: string | null; nextDeadline: { label: string; dueOn: string } | null }[];
  /** Other active consultants or owners with a verified licence. */
  targets: { membershipId: string; name: string; licenceType: string; checkedAt: string | null }[];
};

export function suspendedSummary(): string {
  return "Your licence check recorded an adverse result, so some actions are paused. Your clients’ files, deadlines and history are safe.";
}

export function suspendedData(input: SuspendedInput): SuspendedData {
  const label = RESULT[input.credential.status] ?? "an adverse result";
  const checkedDay = input.credential.checkedAt ? dayMonth(isoDateInTimeZone(new Date(input.credential.checkedAt), input.timeZone)) : null;
  const today = isoDateInTimeZone(input.now, input.timeZone);
  const horizon = plusDays(today, 30);
  const soon = (matter: SuspendedInput["matters"][number]) => Boolean(matter.nextDeadline && matter.nextDeadline.dueOn >= today && matter.nextDeadline.dueOn <= horizon);
  const dueSoon = input.matters.filter(soon).length;
  const open = input.matters.length;
  const title =
    dueSoon > 0
      ? `${dueSoon} matter${dueSoon === 1 ? " has" : "s have"} deadlines in the next 30 days`
      : open > 0
        ? `You’re the consultant on ${open} open matter${open === 1 ? "" : "s"}`
        : "You have no open matters";
  return {
    alert: {
      title: checkedDay ? `Licence check on ${checkedDay}: ${label}` : `Licence check: ${label}`,
      body: `The recorded check of your CICC licence ${input.credential.collegeId} shows it as ${label}. New matters, service agreements and submission releases are paused for you until a new check confirms good standing. If this is wrong, report a change so a reviewer checks the register again.`,
      href: "/sheet/licence",
      action: "Update licence",
    },
    stillWorks: ["Opening your clients’ files and their history", "Deadline monitoring and reminders", "Messages and uploads from clients"],
    paused: ["Signing new service agreements", "Releasing submissions", "Taking on new matters"],
    footer: { title, note: "Reassign them to another licensed consultant so nothing is missed." },
    reassign: {
      organizationId: input.organizationId,
      fromMembershipId: input.membershipId,
      note:
        input.targets.length > 0
          ? "Only consultants with a verified licence appear here. The change is logged in the audit trail."
          : "No other consultant has a verified licence yet. Ask your firm owner to add one before reassigning.",
      targets: input.targets.map((target) => ({
        name: target.name,
        membershipId: target.membershipId,
        parts: [target.licenceType, target.checkedAt ? `verified ${dayMonth(isoDateInTimeZone(new Date(target.checkedAt), input.timeZone))}` : "verified"],
      })),
      matters: input.matters.map((matter) => ({
        matterId: matter.id,
        name: matter.name,
        reference: matter.reference ?? "no reference yet",
        note: matter.nextDeadline ? `${matter.nextDeadline.label} ${dayMonth(matter.nextDeadline.dueOn)}` : "No deadline recorded",
        checked: soon(matter),
      })),
      reason: "Temporary while my licence check is reviewed.",
    },
  };
}
