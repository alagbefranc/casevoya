/**
 * Pure helpers for Settings > Team and seats' staff admin (ORG-02, ORG-06, SEC-01): the Designer's
 * Offboard dialog (#dlgOff) filled from public.staff_offboarding_preview, and the live-only Change
 * role or access and Continuity contact dialogs. Used on the server and, for the Offboard dialog's
 * text when the person or receiver changes, in the browser. Nothing here invents a value.
 */
import type { ContinuityDialogData, MemberDialogData, OffboardDialogData, OffboardItem } from "@/components/sheet/designer/settings-staff-admin";
import { dayMonth } from "@/modules/sheet/home-present";
import { roleLabel } from "@/modules/sheet/present";
import type { ContinuityFacts } from "@/modules/sheet/settings-present";
import type { DirectoryMember } from "@/modules/sheet/staff-present";

export const OFFBOARD_DIALOG = "dlgOff";
export const MEMBER_DIALOG = "dlgMem";
export const CONTINUITY_DIALOG = "dlgCont";

/** What public.staff_offboarding_preview returns. */
export type OffboardFacts = {
  tasks: { title: string; matter: string | null }[];
  deadlines: {
    label: string;
    matter: string | null;
    dueOn: string | null;
    confirmed: boolean;
    sourceUrl: string | null;
    sourceRetrievedOn: string | null;
    rule: boolean;
  }[];
  authority: { matter: string | null; authorities: number }[];
  assignments: number;
  /** Null when the session inventory can't be read. */
  sessions: number | null;
  connections: number;
};

/** What public.offboard_staff_member returns. */
export type OffboardResult = {
  tasks: number;
  deadlines: number;
  assignments: number;
  authority: number;
  reviewTasks: number;
  connections: number;
  sessions: number;
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(obj) : [];
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseOffboardFacts(raw: unknown): OffboardFacts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = obj(raw);
  return {
    tasks: list(row.tasks).map((task) => ({ title: text(task.title) ?? "Task", matter: text(task.matter) })),
    deadlines: list(row.deadlines).map((deadline) => ({
      label: text(deadline.label) ?? "Deadline",
      matter: text(deadline.matter),
      dueOn: text(deadline.due_on),
      confirmed: deadline.confirmed === true,
      sourceUrl: text(deadline.source_url),
      sourceRetrievedOn: text(deadline.source_retrieved_on),
      rule: deadline.rule === true,
    })),
    authority: list(row.authority).map((matter) => ({ matter: text(matter.matter), authorities: count(matter.authorities) })),
    assignments: count(row.assignments),
    sessions: row.sessions === null || row.sessions === undefined ? null : count(row.sessions),
    connections: count(row.connections),
  };
}

export function parseOffboardResult(raw: unknown): OffboardResult {
  const row = obj(raw);
  return {
    tasks: count(row.tasks),
    deadlines: count(row.deadlines),
    assignments: count(row.assignments),
    authority: count(row.authority),
    reviewTasks: count(row.review_tasks),
    connections: count(row.connections),
    sessions: count(row.sessions),
  };
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A, B and C". */
function joined(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Dana" from "Dana Lee"; an email or a one-word name stays whole. */
export function firstName(name: string): string {
  if (name.includes("@")) return name;
  return name.trim().split(/\s+/)[0] || name;
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

export function memberName(member: Pick<DirectoryMember, "name" | "email">): string {
  return member.name || member.email || "Team member";
}

function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The four steps of the Designer's Offboard list, in its order. */
export function offboardItems(facts: OffboardFacts, leaver: string, receiver: string): OffboardItem[] {
  const first = firstName(leaver);
  const to = receiver || "the person you choose";

  const shown = facts.tasks.slice(0, 3).map((task) => (task.matter ? `${task.title} (${task.matter})` : task.title));
  const more = facts.tasks.length > shown.length ? ` and ${facts.tasks.length - shown.length} more` : "";
  const assignments = facts.assignments ? plural(facts.assignments, "matter assignment") + " move too" : null;
  const tasks: OffboardItem = facts.tasks.length
    ? {
        done: true,
        aria: "Will move",
        title: plural(facts.tasks.length, "open task"),
        detail: assignments ? [`${shown.join(", ")}${more} → ${to}`, assignments] : `${shown.join(", ")}${more} → ${to}`,
      }
    : { done: true, aria: "Will move", title: "No open tasks", detail: assignments ? `${assignments} → ${to}` : `Nothing to move to ${to}` };

  const head = facts.deadlines[0];
  let deadlines: OffboardItem;
  if (!head) {
    deadlines = { done: true, aria: "Will move", title: "No deadlines", detail: "None of their open tasks has a deadline" };
  } else {
    const verified = facts.deadlines.every((deadline) => deadline.confirmed) ? "verified " : "";
    const others = facts.deadlines.length > 1 ? ` and ${facts.deadlines.length - 1} more` : "";
    const parts = [`${head.label}${head.matter ? `, ${head.matter}` : ""}${others}`];
    if (head.dueOn) parts.push(dayMonth(head.dueOn));
    const host = head.sourceUrl ? sourceHost(head.sourceUrl) : null;
    if (host) parts.push(`source: ${host}${head.sourceRetrievedOn ? `, ${dayMonth(head.sourceRetrievedOn)}` : ""}`);
    else if (head.rule) parts.push("source: published rule");
    parts.push("owner changes, the date and its source do not");
    deadlines = { done: true, aria: "Will move", title: plural(facts.deadlines.length, `${verified}deadline`), detail: parts };
  }

  const matters = facts.authority.map((matter) => matter.matter ?? "A matter");
  const authority: OffboardItem = matters.length
    ? {
        done: false,
        aria: "Needs a decision",
        title: `${plural(matters.length, "matter")} where ${first} is the consultant of record`,
        detail: `${joined(matters)}. ${to} becomes the consultant of record and needs a verified licence. Each matter gets a task for ${to} to review the client’s representative authority and tell the client.`,
      }
    : { done: true, aria: "Nothing to review", title: `No matters where ${first} is the consultant of record`, detail: "Client authority doesn’t change." };

  const sessions = facts.sessions === null ? "Their sign-in sessions" : plural(facts.sessions, "session");
  const access: OffboardItem = {
    done: true,
    aria: "Will close",
    title: "Access closes last",
    detail: `${sessions}, ${plural(facts.connections, "connection")} and their access to this firm end when the steps above are done.`,
  };
  return [tasks, deadlines, authority, access];
}

export function offboardTitle(leaver: string): string {
  return `Offboard ${leaver}`;
}

export function offboardIntro(leaver: string): string {
  return `Work moves first, client authority is reviewed, then access closes. Nothing is deleted; ${possessive(firstName(leaver))} history stays in the audit trail.`;
}

export const OFFBOARD_NOTE = "Casevoya doesn’t message clients about the change yet: each review task is the reminder to tell them who now handles their file.";

/** Staff who may receive work: active, and not finance only (public.offboard_staff_member). */
export function receivesWork(member: DirectoryMember): boolean {
  return member.status === "active" && ["firm_owner", "licensed_consultant", "case_manager", "assistant"].includes(member.role);
}

function roleText(member: DirectoryMember): string {
  if (member.role === "firm_owner") return member.licensed ? "Owner, licensed consultant" : "Owner";
  return roleLabel(member.role);
}

/**
 * The Designer's Offboard dialog for a firm owner: everyone else on the team, the colleagues who
 * can take their work, and the first person's preview. Null when there's no one to offboard.
 */
export function offboardDialog(input: {
  organizationId: string;
  members: readonly DirectoryMember[];
  selfMembershipId: string;
  facts: OffboardFacts | null;
}): OffboardDialogData | null {
  const people = input.members.filter((member) => member.membershipId !== input.selfMembershipId);
  const leaver = people[0];
  if (!leaver) return null;
  const receivers = input.members.filter(receivesWork);
  const leaverName = memberName(leaver);
  const receiver = receivers.find((member) => member.membershipId !== leaver.membershipId);
  const facts = input.facts ?? { tasks: [], deadlines: [], authority: [], assignments: 0, sessions: null, connections: 0 };
  return {
    title: offboardTitle(leaverName),
    intro: offboardIntro(leaverName),
    people: people.map((member) => ({ label: [memberName(member), member.status === "suspended" ? `${roleText(member)} (suspended)` : roleText(member)], value: member.membershipId })),
    receivers: receivers.map((member) => ({ label: memberName(member), value: member.membershipId })),
    items: offboardItems(facts, leaverName, receiver ? memberName(receiver) : ""),
    note: OFFBOARD_NOTE,
    hold: { organizationId: input.organizationId },
    facts: input.facts ? JSON.stringify(input.facts) : undefined,
  };
}

/** The toast after offboarding: what moved and what closed. */
export function offboardDone(result: OffboardResult, leaver: string, receiver: string): { title: string; sub: string } {
  const to = firstName(receiver);
  const parts = [`${plural(result.tasks, "task")} and ${plural(result.deadlines, "deadline")} moved to ${to}.`];
  if (result.assignments) parts.push(`${plural(result.assignments, "matter assignment")} moved.`);
  if (result.authority) parts.push(`${plural(result.authority, "matter")} now ${result.authority === 1 ? "has" : "have"} ${to} as consultant of record, each with a review task.`);
  parts.push(`Access closed: ${plural(result.sessions, "session")} ended.`);
  return { title: `${leaver} is offboarded`, sub: parts.join(" ") };
}

/** Staff roles in the Designer's invitation order, with the firm owner. */
export const STAFF_ROLE_CHOICES = [
  ["Owner", "firm_owner"],
  ["Licensed consultant", "licensed_consultant"],
  ["Case manager", "case_manager"],
  ["Assistant", "assistant"],
  ["Finance", "finance_user"],
] as const;

export function memberDialog(input: { organizationId: string; members: readonly DirectoryMember[]; selfMembershipId: string }): MemberDialogData | null {
  const people = input.members.filter((member) => member.membershipId !== input.selfMembershipId);
  if (!people.length) return null;
  return {
    organizationId: input.organizationId,
    people: people.map((member) => ({
      label: `${memberName(member)} · ${roleText(member)}${member.status === "suspended" ? " · suspended" : ""}`,
      value: member.membershipId,
      role: member.role,
      suspended: member.status === "suspended",
    })),
    roles: STAFF_ROLE_CHOICES.map(([label, value]) => ({ label, value })),
  };
}

export function continuityDialog(organizationId: string, facts: ContinuityFacts): ContinuityDialogData {
  return { organizationId, name: facts.name ?? "", email: facts.email ?? "", succession: facts.succession ?? "" };
}

/** Plain words for a refusal from the staff admin functions. */
export function staffAdminError(message: string): { error: string; stepUp?: boolean } | null {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/your own/i.test(message)) return { error: "You can’t change your own access. Ask another firm owner." };
  if (/last firm owner/i.test(message)) return { error: "The firm needs at least one active owner. Make someone else an owner first." };
  if (/move their matters/i.test(message)) return { error: "They’re the consultant of record on open matters. Move those matters to another licensed consultant first." };
  if (/verified licence/i.test(message)) return { error: "The person receiving their work needs a verified licence: they become consultant of record on this person’s open matters." };
  if (/already hold that role|already have that role/i.test(message)) return { error: "They already have that role." };
  if (/active team member to receive/i.test(message)) return { error: "Choose an active colleague, other than this person, to receive their work." };
  if (/only an active team member/i.test(message)) return { error: "They’re already suspended." };
  if (/only a suspended team member/i.test(message)) return { error: "They aren’t suspended." };
  if (/no longer have access/i.test(message)) return { error: "They no longer have access." };
  if (/not found/i.test(message)) return { error: "That person isn’t on your team." };
  if (/email is not usable/i.test(message)) return { error: "Enter a full email address." };
  if (/needs a name/i.test(message)) return { error: "Add the continuity contact’s name, or clear both." };
  if (/too long/i.test(message)) return { error: "That’s too long. Shorten it and try again." };
  return null;
}
