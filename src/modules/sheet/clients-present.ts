/** Pure helpers that turn person, matter and household records into the Designer Clients page's words. */
import type { ClientRow, ClientsTab, ClientsText, DuplicateData, FactRow } from "@/components/sheet/designer/clients";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { dayMonth } from "@/modules/sheet/home-present";
import { stageLabel } from "@/modules/sheet/present";
import { firstName } from "@/modules/sheet/tasks-present";

/** People read at once, so the filter chips and search see every row the viewer may read. */
export const CLIENTS_READ = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientsTab(raw: string | undefined): ClientsTab {
  return raw === "person" || raw === "household" ? raw : "dir";
}

/** A person id from the URL, or null. Only a well-formed id ever reaches a query. */
export function personParam(raw: string | undefined): string | null {
  return raw && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** The person's own tab ("?tab=person&person=<id>"). */
export function personHref(id: string): string {
  return `?${new URLSearchParams({ tab: "person", person: id })}`;
}

/** A client's role on a matter, in the Designer's words. A dependant is named adult or minor from the staff-recorded fact. */
export function partyRoleLabel(role: string, isMinor: boolean): string {
  switch (role) {
    case "applicant":
      return "Applicant";
    case "sponsor":
      return "Sponsor";
    case "dependant":
      return isMinor ? "Minor dependant" : "Adult dependant";
    case "employer":
      return "Employer contact";
    case "guardian":
      return "Guardian";
    default:
      return "";
  }
}

const ROLE_ORDER = ["applicant", "sponsor", "dependant", "guardian", "employer"];

/** "Applicant", "Applicant, Sponsor", or "—" for someone on no matter the viewer can see. */
export function rolesLabel(roles: readonly string[], isMinor: boolean): string {
  const ordered = [...new Set(roles)].filter((role) => ROLE_ORDER.includes(role)).sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  const labels = [...new Set(ordered.map((role) => partyRoleLabel(role, isMinor)))];
  return labels.length ? labels.join(", ") : "—";
}

/** Filter chip tokens for a person's roles. Leads are their own rows (leadRow), flagged "lead". */
export function roleFlags(roles: readonly string[]): string[] {
  return ["applicant", "sponsor", "dependant"].filter((role) => roles.includes(role));
}

/** "NL-2026-0142", "NL-2026-0142, NL-2026-0150", or "—". */
export function mattersLabel(references: readonly string[]): string {
  const unique = [...new Set(references.filter(Boolean))];
  return unique.length ? unique.join(", ") : "—";
}

export type InviteState = { expires_at: string; consumed_at: string | null; revoked_at: string | null; declined_at: string | null };

/** Whether an invitation can still be accepted. */
export function invitePending(invite: InviteState, now: Date): boolean {
  if (invite.consumed_at || invite.revoked_at || invite.declined_at) return false;
  const expires = new Date(invite.expires_at).getTime();
  return Number.isFinite(expires) && expires > now.getTime();
}

/** The Portal column: a linked login, an open invitation, or nothing yet. */
export function portalState(hasLogin: boolean, invites: readonly InviteState[], now: Date): ClientsText {
  if (hasLogin) return "Portal active";
  if (invites.some((invite) => invitePending(invite, now))) return "Invited";
  return "Not invited";
}

/** The same fact as a sentence part for the person's matters note. */
export function portalSentence(state: ClientsText): string {
  if (state === "Portal active") return "Portal active";
  if (state === "Invited") return "Portal invitation sent, not accepted yet";
  return "Not invited to the portal";
}

/** A birth date at the precision it was recorded: "1984-03-09", "1984-03" or "1984". */
export function birthDateLabel(date: string | null, precision: string | null): string | null {
  if (!date) return null;
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month") return date.slice(0, 7);
  return date.slice(0, 10);
}

/**
 * The facts the person record holds: the date of birth, then how to reach them (email and phone),
 * as the Designer's person view lists contact details. None of them carries a review state.
 */
export function personFacts(date: string | null, precision: string | null, contact: { email?: string | null; phone?: string | null } = {}): FactRow[] {
  const birth = birthDateLabel(date, precision);
  return [
    birth
      ? { fact: "Date of birth", value: { num: birth }, source: "Person record", review: "—" }
      : { fact: "Date of birth", value: { unknown: true }, source: "Not recorded", review: "—" },
    contact.email
      ? { fact: "Email", value: { text: contact.email }, source: "Person record", review: "—" }
      : { fact: "Email", value: { unknown: true }, source: "Not recorded", review: "—" },
    contact.phone
      ? { fact: "Phone", value: { num: contact.phone }, source: "Person record", review: "—" }
      : { fact: "Phone", value: { unknown: true }, source: "Not recorded", review: "—" },
  ];
}

/** An open lead on the People tab: the "Leads" chip shows it, and the row opens the lead. */
export function leadRow(lead: { id: string; display_name: string; language: string | null; is_sample: boolean }): ClientRow {
  return {
    href: `/sheet/lead?id=${lead.id}`,
    flags: ["lead"],
    person: { name: lead.display_name },
    role: "Lead",
    matter: lead.is_sample ? "Lead (sample)" : "Lead",
    language: lead.language || "—",
    timezone: "—",
    portal: "Not invited",
  };
}

/** A matter's firm stage as a badge. Closed reads as finished; everything else is in progress. */
export function matterStateBadge(stage: string): MatterBadge {
  return { tone: stage === "closed" ? "ok" : "blue", label: stageLabel(stage) };
}

/** "Applicant on NL-2026-0142." or a plain statement that no visible matter names them. */
export function personSummary(roles: string, references: readonly string[]): string {
  const matters = mattersLabel(references);
  if (roles === "—" || matters === "—") return "Not on a matter you’re assigned to.";
  return `${roles} on ${matters}.`;
}

/** "2 tasks open", "1 task open", "No open tasks". */
export function openTasksLabel(count: number): string {
  if (count === 0) return "No open tasks";
  return `${count} ${count === 1 ? "task" : "tasks"} open`;
}

/**
 * How a related person stands to the person shown. A relationship is read as
 * "from_person is <type> of to_person", so seen from the other side a parent is a child.
 */
export function relationshipLabel(type: string, personIsFrom: boolean): string {
  const forward: Record<string, string> = {
    spouse: "Spouse",
    parent: "Parent",
    child: "Child",
    payer: "Payer",
    sponsor: "Sponsor",
    household: "Same household",
    other: "Related",
  };
  const reverse: Record<string, string> = { ...forward, parent: "Child", child: "Parent", payer: "Paid for", sponsor: "Sponsored" };
  return (personIsFrom ? reverse : forward)[type] ?? "Related";
}

/** "Priya’s" — the Designer's possessive for a first name. */
export function possessive(name: string): string {
  return `${firstName(name)}’s`;
}

export type GrantFact = { grantee: string; subject: string; kind: string };

/**
 * One cell of the household's "Who can see what" grid: can `viewer` see `subject`'s private records?
 * Household membership never grants access; only the person themself or a live grant does.
 * When the viewer cannot read the firm's grants, other people's cells stay unknown ("—").
 */
export function householdCell(viewer: string, subject: string, grants: readonly GrantFact[] | null): ClientsText {
  if (viewer === subject) return "Yes";
  if (!grants) return "—";
  const grant = grants.find((row) => row.grantee === viewer && row.subject === subject);
  if (!grant) return { left: "No", right: "private" };
  return { left: "Yes", right: grant.kind === "guardian" ? "guardian" : "access granted" };
}

export type DuplicatePerson = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  precision: string | null;
  createdAt: string;
  reference: string | null;
};

function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

/** How the duplicate check tells two records apart: the matter, or the day it was added. */
function recordLabel(person: DuplicatePerson): string {
  if (person.reference) return person.reference;
  const day = person.createdAt.slice(0, 10);
  return `Added ${dayMonth(day)} ${day.slice(0, 4)}`;
}

/**
 * The first pair of people with the same name and the same full date of birth. A shared
 * email alone is never a match, and nobody is merged here: the page only points it out.
 */
export function findDuplicate(people: readonly DuplicatePerson[]): DuplicateData | null {
  const seen = new Map<string, DuplicatePerson & { dateOfBirth: string }>();
  const ordered = [...people].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const candidate of ordered) {
    const born = candidate.dateOfBirth;
    if (!born || candidate.precision !== "day") continue;
    const person = { ...candidate, dateOfBirth: born };
    const key = `${nameKey(person.name)}|${born.slice(0, 10)}`;
    const earlier = seen.get(key);
    if (!earlier) {
      seen.set(key, person);
      continue;
    }
    const left = recordLabel(earlier);
    const right = recordLabel(person);
    const emails = earlier.email && person.email ? (earlier.email === person.email ? ", same email" : ", different email") : "";
    return {
      title: `Possible duplicate: ${earlier.name} (${left}) and ${person.name} (${right})`,
      detail: `Same name and date of birth${emails}. Review before merging.`,
      columns: [left === right ? `${left} (earlier)` : left, right],
      rows: [
        { label: "Name", values: [earlier.name, person.name] },
        { label: "Date of birth", values: [earlier.dateOfBirth.slice(0, 10), person.dateOfBirth.slice(0, 10)] },
        { label: "Email", values: [earlier.email || "—", person.email || "—"] },
        { label: "Phone", values: [earlier.phone || "—", person.phone || "—"] },
      ],
      merge: { toast: "Merging isn’t connected yet", kind: "warn", sub: "Nothing was merged. Both records stay separate." },
    };
  }
  return null;
}
