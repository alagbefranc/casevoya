/**
 * Firm automations (2026-10-30): the parts the editor (a client component) and the page share,
 * with no imports from the page's components.
 */
import { safeAccessError } from "@/lib/auth/step-up";

/** "14, 7, 3, 1" (or "14 7 3 1") → [14, 7, 3, 1]; an error for anything else. Matches app.set_firm_reminder_offsets. */
export function readReminderDays(raw: string): { days: number[] } | { error: string } {
  const parts = raw.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { error: "Enter at least one reminder day, like 14, 7, 3, 1." };
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return { error: "Reminder days are whole numbers of days, like 14, 7, 3, 1." };
    const day = Number(part);
    if (day < 1 || day > 365) return { error: "Each reminder day is between 1 and 365 days before." };
    if (!days.includes(day)) days.push(day);
  }
  if (days.length > 12) return { error: "Choose at most 12 reminder days." };
  return { days: days.sort((a, b) => b - a) };
}

/** The kinds of deadline an automation can cover (public.deadline_kind). */
export const DEADLINE_KINDS = [
  { key: "legal", label: "Legal deadlines" },
  { key: "correspondence", label: "IRCC and other letters" },
  { key: "internal", label: "Internal deadlines" },
] as const;

export type DeadlineKindKey = (typeof DEADLINE_KINDS)[number]["key"];

/** One of the firm's own automations (public.firm_automations), as the page shows it. */
export type FirmAutomationView = {
  id: string;
  name: string;
  status: "active" | "paused";
  kinds: DeadlineKindKey[];
  days: number[];
  version: number;
  copiedFromBuiltIn: boolean;
};

/** The editor's check before saving: the same limits as public.save_firm_automation. */
export function automationProblem(input: { name: string; kinds: readonly string[]; days: string }): { days: number[] } | { error: string } {
  const name = input.name.trim();
  if (!name) return { error: "Give the automation a name." };
  if (name.length > 120) return { error: "Keep the name to 120 characters." };
  if (!input.kinds.length) return { error: "Choose at least one kind of deadline." };
  return readReminderDays(input.days);
}

/** User-facing copy for a refused automation save or pause. Never passes a database message through. */
export function automationError(message: string): string {
  if (/someone else changed/i.test(message)) return "Someone else changed this automation. Reload to see their version.";
  if (/kind of deadline/i.test(message)) return "Choose at least one kind of deadline.";
  if (/reminder day/i.test(message)) return "Reminder days are 1 to 12 whole numbers of days, each between 1 and 365.";
  if (/name of up to/i.test(message)) return "Give the automation a name of up to 120 characters.";
  if (/role|automation denied|permission denied/i.test(message)) return "Only a firm owner or licensed consultant can change automations.";
  return safeAccessError(message);
}
