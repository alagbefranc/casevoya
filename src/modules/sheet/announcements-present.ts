/**
 * Inbox > Announcements (PRD OPS-04): the sent announcements as the Designer's cards, the
 * audience choices with their counts, and plain words for the database's answers. Pure.
 */
import type { AnnouncementCard } from "@/components/sheet/designer/inbox";

export type AudienceCount = { recipients: number; emailed: number; withoutPortal: number };
export type AudienceOption = { value: string; label: string; count: AudienceCount };

export type AnnouncementRow = {
  title: string;
  audienceKind: string;
  programKey: string | null;
  recipients: number;
  emailed: number;
  seen: number;
  sample: boolean;
  createdAt: string;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "study_permit" → "Study permit". */
export function programLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function day(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${Number(get("day"))} ${MONTH[Number(get("month")) - 1]}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One sent announcement as the Designer's card: title; audience · people; "Sent 24 Oct · 3 read". */
export function announcementCard(row: AnnouncementRow, timeZone: string): AnnouncementCard {
  const audience = row.audienceKind === "program" && row.programKey ? `${programLabel(row.programKey)} clients` : "All active clients";
  const reach = row.sample ? `${plural(row.recipients, "sample client")}, no email` : `${plural(row.recipients, "client")}, ${row.emailed} by email`;
  return {
    title: row.title,
    audience: [audience, reach],
    when: [`Sent ${day(row.createdAt, timeZone)}`, `${row.seen} read`],
  };
}

function count(raw: unknown): AudienceCount {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
  return { recipients: n(item.recipients), emailed: n(item.emailed), withoutPortal: n(item.without_portal) };
}

/** The audience choices from public.announcement_audiences: all active clients, then each program. */
export function audienceOptions(raw: unknown): AudienceOption[] {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const options: AudienceOption[] = [{ value: "", label: "All active clients", count: count(data.all) }];
  for (const item of Array.isArray(data.programs) ? data.programs : []) {
    const key = item && typeof item === "object" ? (item as Record<string, unknown>).program_key : null;
    if (typeof key === "string" && key) options.push({ value: key, label: `${programLabel(key)} clients`, count: count(item) });
  }
  return options;
}

/** The line shown before sending: who gets it, how many by email, who is left out and why. */
export function audienceLine(count: AudienceCount, sampleMode: boolean): string {
  if (count.recipients === 0) return "No client in this audience has a portal account, so there is no one to send it to.";
  const parts = [`${plural(count.recipients, "client")} with a portal account ${count.recipients === 1 ? "sees" : "see"} it on their portal home`];
  parts.push(sampleMode ? "no email is sent while the firm is in sample mode" : `${count.emailed} also ${count.emailed === 1 ? "gets" : "get"} a short email with a portal link`);
  let line = `${parts.join("; ")}.`;
  if (count.withoutPortal) line += ` ${plural(count.withoutPortal, "client")} without a portal account won’t get it.`;
  return line;
}

/** The database's answers, said plainly. */
export function announcementError(raw: string): string {
  if (/approved announcement/i.test(raw)) return "Choose an approved announcement template.";
  if (/changed since/i.test(raw)) return "That template changed since this page loaded. Refresh and check it again.";
  if (/portal account/i.test(raw)) return "No client in this audience has a portal account. Nothing was sent.";
  if (/denied|42501/i.test(raw)) return "Only a firm owner or licensed consultant can send announcements.";
  return "The announcement wasn’t sent.";
}

export function rateLimitedMessage(retryAt: string | null, timeZone: string): string {
  if (!retryAt) return "Your firm sent an announcement in the last 10 minutes. Try again shortly.";
  try {
    const time = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(retryAt));
    return `Your firm sent an announcement in the last 10 minutes. You can send the next one after ${time}.`;
  } catch {
    return "Your firm sent an announcement in the last 10 minutes. Try again shortly.";
  }
}
