/**
 * Pure helpers for the Sheet's "New task" dialog (`#dlgTask` on the Tasks page): its options,
 * what it sends, and how the database's refusals read. create_task decides every create.
 */
import { z } from "zod";
import { safeAccessError } from "@/lib/auth/step-up";
import { isUuid } from "@/lib/tenant/context";

export type TaskAudience = "internal" | "client";

/**
 * One `<option>` in the dialog. `value` is absent in the captured Designer form. `kind` and
 * `matter` say when an owner or a dependency applies, so the dialog shows only what the
 * database would accept for the chosen matter and kind.
 */
export type TaskDialogOption = { label: string; value?: string; kind?: TaskAudience; matter?: string };

/** What the Tasks page needs to save a task, beyond the options. */
export type NewTaskWire = {
  organizationId: string;
  /** The firm's timezone: a date-only due date is a calendar date there. */
  timezone: string;
  /** Matters the signed-in staff member can read (RLS decides), newest activity first. */
  matters: TaskDialogOption[];
  /** The owner selected when the dialog opens: the signed-in staff member. */
  owner: string;
};

export type NewTaskInput = {
  matterId: string;
  audience: TaskAudience;
  title: string;
  ownerMembershipId: string | null;
  ownerPersonId: string | null;
  dueOn: string | null;
  dependsOnTaskId: string | null;
};

/** "NL-2026-0142 · Ana Pereira", with "(sample)" on a sample matter. */
export function matterOptions(
  matters: readonly { id: string; reference: string | null; is_sample: boolean }[],
  name: (id: string) => string,
): TaskDialogOption[] {
  return matters.map((matter) => {
    const label = matter.reference ? `${matter.reference} · ${name(matter.id)}` : name(matter.id);
    return { value: matter.id, label: matter.is_sample ? `${label} (sample)` : label };
  });
}

/** Active staff who can own an internal task, by name. */
export function staffOptions(members: readonly { id: string; name: string }[]): TaskDialogOption[] {
  return [...members]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((member) => ({ value: member.id, label: member.name, kind: "internal" as const }));
}

/** The people on each matter, who can own a client task on it. */
export function clientOptions(participants: readonly { matterId: string; personId: string; name: string }[]): TaskDialogOption[] {
  const seen = new Set<string>();
  const options: TaskDialogOption[] = [];
  for (const row of participants) {
    const key = `${row.matterId}:${row.personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: row.personId, label: row.name, kind: "client", matter: row.matterId });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Tasks a new task can wait on: the same matter's tasks that are not cancelled. */
export function dependsOnOptions(tasks: readonly { id: string; title: string; matter_id: string | null }[]): TaskDialogOption[] {
  return tasks
    .filter((task): task is { id: string; title: string; matter_id: string } => Boolean(task.matter_id))
    .map((task) => ({ value: task.id, label: task.title, matter: task.matter_id }));
}

/** Whether an option fits the chosen matter and kind. Staff owners fit every matter. */
export function optionFits(option: { kind?: string; matter?: string }, matterId: string, kind: TaskAudience | null): boolean {
  if (option.kind && kind && option.kind !== kind) return false;
  if (option.matter && option.matter !== matterId) return false;
  return true;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The Kind select: its value when wired, or the Designer's own option words. */
export function taskAudience(raw: string | null | undefined): TaskAudience | null {
  const value = clean(raw).toLowerCase();
  if (value === "internal" || value.startsWith("internal (")) return "internal";
  if (value === "client" || value.startsWith("client task")) return "client";
  return null;
}

/** "30/10/2026" (the Designer's DD/MM/YYYY) or "2026-10-30" as an ISO date, or null when it is not a real date. */
export function dueDate(raw: string | null | undefined): string | null {
  const value = clean(raw);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [year, month, day] = dmy ? [dmy[3], dmy[2], dmy[1]].map(Number) : iso ? [iso[1], iso[2], iso[3]].map(Number) : [];
  if (!year || !month || !day) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const uuid = (message: string) => z.string().refine(isUuid, { message });

const schema = z.object({
  matterId: uuid("Choose a matter."),
  title: z.string().min(1, "Add what the task is.").max(200, "A task title can be up to 200 characters."),
  audience: z.enum(["internal", "client"], { message: "Choose whether the task is internal or for the client." }),
  owner: uuid("Choose an owner."),
  due: z.string(),
  dependsOn: z.union([z.literal(""), uuid("Choose a task it depends on, or Nothing.")]),
});

/** What the dialog sends, or the first thing to fix. The database checks all of it again. */
export function readNewTask(fields: {
  matter?: string | null;
  title?: string | null;
  kind?: string | null;
  owner?: string | null;
  due?: string | null;
  dependsOn?: string | null;
  /** The firm's today (`YYYY-MM-DD`). Given, a due date before it is refused. */
  today?: string | null;
}): { input: NewTaskInput } | { error: string } {
  const parsed = schema.safeParse({
    matterId: clean(fields.matter),
    title: clean(fields.title),
    audience: taskAudience(fields.kind) ?? "",
    owner: clean(fields.owner),
    due: clean(fields.due),
    dependsOn: clean(fields.dependsOn),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the task and try again." };
  const { matterId, title, audience, owner, due, dependsOn } = parsed.data;
  const dueOn = due ? dueDate(due) : null;
  if (due && !dueOn) return { error: "Enter the due date as DD/MM/YYYY." };
  if (dueOn && fields.today && dueOn < fields.today) return { error: "The due date can’t be in the past." };
  return {
    input: {
      matterId,
      audience,
      title,
      ownerMembershipId: audience === "internal" ? owner : null,
      ownerPersonId: audience === "client" ? owner : null,
      dueOn,
      dependsOnTaskId: dependsOn || null,
    },
  };
}

/** User-facing copy for a refused create. Never passes a database message through. */
export function newTaskError(message: string): string {
  if (/sample mode/i.test(message)) {
    return "This firm is still in sample mode, so new tasks can only go on sample matters. Turn sample mode off to add work to a real client’s matter.";
  }
  if (/task create denied/i.test(message)) return "You can only add tasks to matters you’re assigned to.";
  if (/staff access denied/i.test(message)) return "Your role can’t create tasks. Ask a firm owner.";
  if (/active staff owner/i.test(message)) return "Choose an active staff member as the owner.";
  if (/person on this matter/i.test(message)) return "A client task needs a person on this matter as its owner.";
  if (/task title/i.test(message)) return "Add what the task is.";
  if (/timezone/i.test(message)) return "The firm’s timezone isn’t usable. Check it in Settings.";
  return safeAccessError(message);
}

/** User-facing copy for a refused task change (complete, edit, reassign). Never passes a database message through. */
export function taskChangeError(message: string): string {
  if (/open dependency/i.test(message)) return "It waits on another task that is still open. Finish that one first.";
  if (/version conflict/i.test(message)) return "Someone changed this task since you opened it. Reload and try again.";
  if (/only an open task/i.test(message)) return "Only an open task can be edited.";
  if (/cannot be in the past/i.test(message)) return "The due date can’t be in the past.";
  if (/task title/i.test(message)) return "Add what the task is.";
  if (/active staff owner/i.test(message)) return "Choose an active staff member as the owner.";
  if (/person on this matter/i.test(message)) return "A client task stays with a person on this matter.";
  if (/blocker note/i.test(message)) return "Say what is blocking it.";
  if (/denied|staff access/i.test(message)) return "Your role can’t change this task.";
  return safeAccessError(message);
}

/** What the Task dialog saves, or the first thing to fix. The database checks all of it again. */
export function readTaskEdit(fields: { title?: string | null; due?: string | null }): { title: string; dueOn: string | null } | { error: string } {
  const title = clean(fields.title);
  if (!title) return { error: "Add what the task is." };
  if (title.length > 200) return { error: "A task title can be up to 200 characters." };
  const due = clean(fields.due);
  const dueOn = due ? dueDate(due) : null;
  if (due && !dueOn) return { error: "Enter the due date as DD/MM/YYYY." };
  return { title, dueOn };
}

/** Why a dependency was not added after the task was saved. */
export function dependencyError(message: string): string {
  if (/cycle/i.test(message)) return "That would make the tasks wait on each other.";
  if (/dependency denied/i.test(message)) return "A task can only wait on another task on the same matter.";
  return safeAccessError(message);
}
