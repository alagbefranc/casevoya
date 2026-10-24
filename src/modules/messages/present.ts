/**
 * Pure presentation for matter messaging (PRD OPS-04): thread summaries, audience lines, day
 * grouping, read and acknowledgement state. No database access; the loaders hand rows in.
 */
import type { MessageTemplateOption } from "./templates";

export type ChatAttachment = {
  documentId: string;
  label: string;
  /** The clean current version a portal reader downloads through the existing permission check. */
  versionId: string | null;
  /** Staff open attachments from the matter's Documents tab (download there needs a step-up). */
  href: string | null;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  body: string;
  createdAt: string;
  mine: boolean;
  authorName: string;
  authorKind: "staff" | "client";
  requiresAck: boolean;
  /** For the reader: whether they acknowledged it (portal) or who did (staff). */
  acknowledged: boolean;
  acknowledgedBy: string[];
  /** Staff view: the addressed people who have read it. Portal view: whether staff read it. */
  readBy: string[];
  unread: boolean;
  attachments: ChatAttachment[];
  /** How it reached the firm: the portal or Sheet, or a WhatsApp message from the client. */
  channel?: "portal" | "whatsapp";
  /** Staff view (OPS-04): what happened to the email notice of a staff message, or null for none. */
  email?: string | null;
};

export type ChatThread = {
  id: string;
  matterId: string;
  matterTitle: string;
  title: string;
  audience: string[];
  audienceIds: string[];
  /** People on the matter who are NOT in this thread's audience (household boundary). */
  excluded: string[];
  lastAt: string;
  preview: string;
  unread: number;
  sample: boolean;
  /**
   * Staff: someone on this thread chose WhatsApp. `until` is when their 24-hour window closes
   * (a reply goes on WhatsApp until then); null when it is closed (the email notice goes instead).
   */
  whatsapp?: { until: string | null } | null;
};

/**
 * `portal`: they can sign in to the portal. `external` (OPS-04): on the matter only as employer or
 * sponsor, who can be in a conversation only with portal access (the database refuses otherwise).
 */
export type ChatAudienceOption = { personId: string; name: string; role: string; email: boolean; portal?: boolean; external?: boolean };

export type ChatDocument = { id: string; label: string; personId: string; audience: string; sensitivity: string };

export type ChatData = {
  mode: "portal" | "staff";
  organizationId: string;
  firmName: string;
  timezone: string;
  now: string;
  threads: ChatThread[];
  messages: ChatMessage[];
  selectedId: string | null;
  /** The page was opened on a specific thread (?thread=), so a phone shows it straight away. */
  opened: boolean;
  /** Staff: start a conversation with one or more people on the matter. Portal: their matters. */
  matters: { id: string; title: string }[];
  audienceOptions: ChatAudienceOption[];
  documents: ChatDocument[];
  /** Portal: the viewer's own person id (a client writes to the firm only). */
  selfPersonId: string | null;
  /** Staff: the matter whose messages these are. */
  matterId: string | null;
  /** Staff: "Draft with Vo" (src/modules/vo). Absent in the portal. */
  vo?: ChatVo;
  /** Staff (OPS-04): the firm's approved message templates for Insert template. */
  templates?: MessageTemplateOption[];
  /** Staff (OPS-04): merge values the composer knows; null ones stay a gap to fill. */
  merge?: { firmName: string; matterReference: string | null; consultantName: string | null };
};

export type ChatVo = {
  /** Vo is on for this firm and may read client messages. */
  enabled: boolean;
  /** The Vo agent service is reachable here. */
  available: boolean;
  /** Drafts waiting on this matter's threads (opened from Vo drafts with ?vo=). */
  drafts: { id: string; threadId: string; body: string; needsRule: boolean }[];
};

export const MAX_BODY = 4000;

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zoned(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** "Today", "Yesterday", or "Mon 12 Oct" (with the year when it isn't this year), in the reader's zone. */
export function dayLabel(iso: string, nowIso: string, timeZone: string): string {
  const zone = safeZone(timeZone);
  const day = zoned(iso, zone).date;
  const today = zoned(nowIso, zone).date;
  const diff = daysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(`${day}T12:00:00Z`);
  const label = `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${day.slice(0, 4)}`;
}

/** 24-hour clock time in the reader's zone. */
export function clockLabel(iso: string, timeZone: string): string {
  return zoned(iso, safeZone(timeZone)).time;
}

/** The day and clock, "Tue 20 Oct, 02:33": for a moment that may fall today or tomorrow. */
export function dayClockLabel(iso: string, timeZone: string): string {
  const { date, time } = zoned(iso, safeZone(timeZone));
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}, ${time}`;
}

/** A thread row's time: the clock today, else the short day. */
export function listTime(iso: string, nowIso: string, timeZone: string): string {
  const label = dayLabel(iso, nowIso, timeZone);
  if (label === "Today") return clockLabel(iso, timeZone);
  return label === "Yesterday" ? label : label.split(" ").slice(1, 3).join(" ");
}

export type DayGroup = { key: string; label: string; messages: ChatMessage[] };

/** Messages oldest first, grouped by the reader's calendar day. */
export function groupByDay(messages: ChatMessage[], nowIso: string, timeZone: string): DayGroup[] {
  const zone = safeZone(timeZone);
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const groups: DayGroup[] = [];
  for (const message of sorted) {
    const key = zoned(message.createdAt, zone).date;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(message);
    else groups.push({ key, label: dayLabel(message.createdAt, nowIso, zone), messages: [message] });
  }
  return groups;
}

/** Names joined for people: "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Who can read a thread, said before anything is sent. Portal: "You and {firm} staff on your
 * file", naming any other addressed person, then who can't. Staff: the addressed people and the
 * firm's staff on the matter.
 */
export function audienceLine(input: {
  mode: "portal" | "staff";
  firmName: string;
  audience: string[];
  excluded: string[];
  selfName?: string | null;
}): { visible: string; hidden: string | null } {
  if (input.mode === "portal") {
    const others = input.audience.filter((name) => name !== input.selfName);
    const visible = `You${others.length ? `, ${joinNames(others)}` : ""} and ${input.firmName} staff on your file`;
    return { visible, hidden: input.excluded.length ? `Not ${joinNames(input.excluded).replace(/ and /g, " or ")}` : null };
  }
  const visible = `${joinNames(input.audience)} and staff on this matter`;
  return { visible, hidden: input.excluded.length ? `Not ${joinNames(input.excluded).replace(/ and /g, " or ")}` : null };
}

/** The staff composer's WhatsApp line for a thread, or null when nobody on it chose WhatsApp. */
export function whatsappLine(thread: Pick<ChatThread, "whatsapp"> | null | undefined, timezone: string): string | null {
  const wa = thread?.whatsapp;
  if (!wa) return null;
  if (wa.until) return `Your reply also goes to them on WhatsApp (window open until ${dayClockLabel(wa.until, timezone)}).`;
  return "WhatsApp’s 24-hour reply window is closed: they get the usual email notice, and a WhatsApp notice to open the portal.";
}

/** Threads newest first; unread first among equals is not applied (time order is the contract). */
export function sortThreads(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(b.id));
}

export function totalUnread(threads: ChatThread[]): number {
  return threads.reduce((sum, thread) => sum + thread.unread, 0);
}

/** One line of text for a thread row. */
export function previewOf(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

/** First letter for an avatar. */
export function initialOf(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

/**
 * The database's refusals, said plainly. Never the database text itself.
 */
export function messageError(raw: string): string {
  if (/rate limit/i.test(raw)) return "You’ve sent a lot of messages in a short time. Please wait a few minutes and try again.";
  if (/not shared with everyone/i.test(raw)) return "One of the documents can’t be shared with everyone who can read this conversation. Remove it and try again.";
  if (/choose who can read/i.test(raw)) return "Choose who can read this message.";
  if (/must be on this matter/i.test(raw)) return "Everyone you write to must be on this matter.";
  if (/needs portal access/i.test(raw)) return "An employer or sponsor needs portal access to this matter before they can be in a conversation. Invite them to the portal first.";
  if (/1 to 4000/i.test(raw)) return "Write a message of up to 4,000 characters.";
  if (/at most 5/i.test(raw)) return "Attach up to 5 documents.";
  if (/clients write to the firm only/i.test(raw)) return "You can write to your firm only.";
  if (/addressed/i.test(raw)) return "Only the people this message is for can acknowledge it.";
  if (/does not ask/i.test(raw)) return "This message doesn’t need an acknowledgement.";
  return "That didn’t go through. Nothing was sent.";
}

/** Staff (OPS-04): an audience option that can't be chosen, and why; null when it can. */
export function audienceBlocked(option: ChatAudienceOption): string | null {
  return option.external && option.portal === false ? "No portal access" : null;
}

const EMAIL_RANK = ["bounced", "failed", "suppressed", "skipped", "queued_worker", "sent"] as const;

/**
 * Staff (OPS-04): the email notice of one staff message, from its outbox event and deliveries, in
 * the Inbox's words (outboundStatus). Null when no email went or will go (no event, or the worker
 * found nobody to email). With several recipients, the worst state is shown.
 */
export function messageEmailState(input: { eventStatus: string | null; deliveries: string[]; sample: boolean }): string | null {
  if (!input.eventStatus) return null;
  if (!input.deliveries.length) return input.eventStatus === "published" ? null : "Email queued";
  const normal = input.deliveries.map((status) => (status === "queued" ? "sent" : status === "pending" || status === "sending" ? "queued_worker" : status));
  const worst = EMAIL_RANK.find((status) => normal.includes(status)) ?? "sent";
  switch (worst) {
    case "bounced":
      return "Email failed: address bounced";
    case "failed":
      return "Email failed";
    case "suppressed":
      return "Email not sent: on the do-not-send list";
    case "skipped":
      return input.sample ? "Email not sent: sample client" : "Email not sent";
    case "queued_worker":
      return "Email queued";
    default:
      return "Email sent";
  }
}

/** Staff (OPS-04): a sent message's state: read by whom, else delivered to their portal. */
export function readState(readBy: string[]): string {
  return readBy.length ? `Read by ${readBy.join(", ")}` : "Delivered";
}
