/** Pure helpers for the Team queue: due badges, stable item ids, load hours and ordering. */
import type { QueueItem, QueueTone } from "@/components/sheet/designer/queue";
import { dayMonth, weekdayDay } from "@/modules/sheet/home-present";
import { plusDays } from "@/modules/sheet/present";

const DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
}

/** "Overdue 2 days" (bad), "Today" (chg), "Mon 19" this week (rev), "4 Nov" later (gr), "No date" (gr). */
export function dueBadge(dueOn: string | null, today: string): { tone: QueueTone; label: string; overdue: boolean } {
  if (!dueOn) return { tone: "gr", label: "No date", overdue: false };
  const days = daysBetween(today, dueOn);
  if (days < 0) return { tone: "bad", label: `Overdue ${-days} ${days === -1 ? "day" : "days"}`, overdue: true };
  if (days === 0) return { tone: "chg", label: "Today", overdue: false };
  if (days <= 6) return { tone: "rev", label: weekdayDay(dueOn), overdue: false };
  return { tone: "gr", label: dayMonth(dueOn), overdue: false };
}

/** Money waiting on a second person has no due date: how long it has waited. */
export function waitingBadge(sinceOn: string, today: string): { tone: QueueTone; label: string } {
  const days = Math.max(0, daysBetween(sinceOn, today));
  if (days === 0) return { tone: "chg", label: "Today" };
  return { tone: days > 2 ? "bad" : "chg", label: `Waiting ${days} ${days === 1 ? "day" : "days"}` };
}

/** A stable list-item id ("rbl" and 5 base-36 characters), from the item's own key. */
export function queueItemId(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `rbl${(hash >>> 0).toString(36).padStart(7, "0").slice(-7)}`;
}

/** Monday to Sunday around a local date. */
export function weekOf(today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const from = plusDays(today, -((weekday + 6) % 7));
  return { from, to: plusDays(from, 6) };
}

/** Hours between two "HH:MM[:SS]" local times. */
export function ruleHours(start: string, end: string): number {
  const minutes = (time: string) => {
    const [h, mm] = time.split(":").map(Number);
    return h * 60 + (mm || 0);
  };
  return Math.max(0, minutes(end) - minutes(start)) / 60;
}

/** Hours to one decimal, without a trailing ".0". */
export function hours(value: number): number {
  return Math.round(value * 10) / 10;
}

export type QueueEntry = QueueItem & { mine: boolean; sortOn: string | null };

/** The signed-in person's own work first, then overdue and soonest; undated last. */
export function orderQueue(entries: QueueEntry[]): QueueItem[] {
  return [...entries]
    .sort((a, b) => Number(b.mine) - Number(a.mine) || (a.sortOn ?? "9999").localeCompare(b.sortOn ?? "9999") || a.title.localeCompare(b.title))
    .map((entry) => {
      const { mine, sortOn, ...item } = entry;
      void mine;
      void sortOn;
      return item;
    });
}
