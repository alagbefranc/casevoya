/**
 * GOV-04: the letter dialog's live fields, the firm's issuer list on the Decisions tab, and the
 * issuer and tasks shown on each recorded letter. Pure, so tests can check the words.
 */
import type { IssuerListData, LetterFormData } from "@/components/sheet/designer/letter-form";
import { issuerSourceParts, issuerState, LETTER_TASK_ROWS, ownerValue, type IssuerRow } from "@/modules/government/letters";
import { dayMonthYear } from "@/modules/sheet/matter-present";

/** A task linked to a letter (public.correspondence_work_links), as read for the Decisions tab. */
export type LetterTaskRow = {
  correspondence_id: string;
  title: string;
  audience: string;
  status: string;
  due_on: string | null;
  owner_membership_id: string | null;
  owner_person_id: string | null;
};

/** The letter's issuer line: the name as recorded, then its official source when it came from the list. */
export function letterIssuerParts(
  issuer: string | null | undefined,
  issuerId: string | null | undefined,
  issuers: readonly IssuerRow[],
  memberName?: (membershipId: string | null) => string,
): string[] | null {
  if (!issuer) return null;
  const listed = issuerId ? issuers.find((row) => row.id === issuerId) : undefined;
  if (!listed) return [`From ${issuer}`, "typed by staff, no official source on file"];
  return [`From ${issuer}`, ...issuerSourceParts(listed, memberName)];
}

const STATUS: Record<string, string> = { done: "done", cancelled: "cancelled", blocked: "blocked" };

/** One line per task the letter created: "Client task for Ana: Upload the passport, due 31 Oct". */
export function letterTaskLines(
  tasks: readonly LetterTaskRow[],
  names: { member: (id: string | null) => string; person: (id: string | null) => string },
  today: string,
): string[] {
  return tasks.map((task) => {
    const who = task.audience === "client" ? `Client task for ${names.person(task.owner_person_id)}` : `Task for ${names.member(task.owner_membership_id)}`;
    const due = task.due_on ? `, due ${dayMonthYear(task.due_on, today)}` : "";
    const state = STATUS[task.status] ? ` (${STATUS[task.status]})` : "";
    return `${who}: ${task.title}${due}${state}`;
  });
}

type Wire = Record<`data-${string}`, string>;

/** The issuer list on the Decisions tab: approved and waiting first, then rejected and retired. */
export function issuerList(input: {
  organizationId: string;
  today: string;
  issuers: readonly IssuerRow[];
  canAdd: boolean;
  canReview: boolean;
  memberName?: (membershipId: string | null) => string;
}): IssuerListData {
  const order: Record<string, number> = { pending_review: 0, approved: 1, rejected: 2, retired: 3 };
  const rows = [...input.issuers]
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name))
    .slice(0, 60)
    .map((issuer) => {
      const act = (decision: string): Wire => ({
        "data-issuer": decision,
        "data-org": input.organizationId,
        "data-id": issuer.id,
        "data-version": String(issuer.version),
      });
      const pending = issuer.status === "pending_review";
      const approved = issuer.status === "approved";
      return {
        id: issuer.id,
        name: issuer.name,
        source: issuerSourceParts(issuer, input.memberName),
        badge: issuerState(issuer.status),
        note: issuer.review_note ? `Review note: ${issuer.review_note}` : null,
        approve: input.canReview && pending ? act("approved") : null,
        // The page wasn't read: approving needs the reviewer's attestation (decided 2026-10-24).
        attest: input.canReview && pending && !issuer.snapshot_sha256 ? { today: input.today } : null,
        reject: input.canReview && pending ? act("rejected") : null,
        retire: input.canReview && approved ? act("retired") : null,
      };
    });
  return {
    rows,
    add: input.canAdd ? { wire: { "data-issuer": "propose", "data-org": input.organizationId }, today: input.today } : null,
  };
}

/** The Record a government letter dialog's live fields. Only approved issuers are offered. */
export function letterForm(input: {
  today: string;
  issuers: readonly IssuerRow[];
  staff: readonly { id: string; name: string }[];
  clients: readonly { id: string; name: string }[];
  me: string | null;
  filed: readonly { versionId: string; filename: string; subject: string | null; receivedOn: string }[];
  memberName?: (membershipId: string | null) => string;
}): LetterFormData {
  const owners = [
    ...input.staff.map((row) => ({ value: ownerValue("staff", row.id), label: row.name })),
    ...input.clients.map((row) => ({ value: ownerValue("client", row.id), label: `${row.name} (client, shows in their portal)` })),
  ];
  const mine = input.me && input.staff.some((row) => row.id === input.me) ? ownerValue("staff", input.me) : (owners[0]?.value ?? "");
  return {
    today: input.today,
    issuers: input.issuers
      .filter((row) => row.status === "approved")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({ id: row.id, name: row.name, source: issuerSourceParts(row, input.memberName) })),
    owners,
    defaultOwner: mine,
    filed: input.filed.map((file) => ({
      versionId: file.versionId,
      label: `${file.filename}${file.subject ? `, from “${file.subject.slice(0, 60)}”` : ""}, ${dayMonthYear(file.receivedOn, input.today)}`,
    })),
    rows: LETTER_TASK_ROWS,
  };
}
