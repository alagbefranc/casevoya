/**
 * Pure presentation for the Lead pipeline and lead pages: rows from the database in, the Designer
 * components' data out. No I/O, no sample people. The database decides every write.
 */
import type {
  FilterSelect,
  LeadCard,
  PipelineColumn,
  PipelineData,
  PipelineRow,
  PipelineTab,
  TimelineItem,
} from "@/components/sheet/designer/pipeline";
import type { HistoryItem, LeadDlItem } from "@/components/sheet/designer/lead";
import { safeZone } from "@/modules/scheduling/format";
import { utcToLocal } from "@/modules/scheduling/slots";

export type StageRow = { id: string; key: string; label: string; kind: "open" | "converted" | "lost" | "archived"; position: number };

export type LeadRow = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  service_interest: string | null;
  source: string;
  source_detail: string | null;
  stage_id: string;
  owner_membership_id: string | null;
  proposed_fee_cents: number | null;
  same_person_lead_id: string | null;
  converted_at: string | null;
  lost_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  is_sample: boolean;
};

export type FollowUpRow = { id: string; lead_id: string; title: string; due_on: string | null; completed_at: string | null; owner_membership_id: string | null };
export type BookingRow = { lead_id: string; starts_at: string; status: string; title: string };
export type DecisionRow = { lead_id: string; other_lead_id: string; same_person: boolean };
export type Owner = { name: string; avatarUrl?: string | null };

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

export function pipelineTab(raw: string | undefined): PipelineTab {
  return raw === "list" || raw === "timeline" ? raw : "board";
}

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Website form",
  hosted_page: "Hosted page",
  booking_page: "Booking page",
  phone: "Phone",
  email: "Email",
  referral: "Referral",
  event: "Event",
  walk_in: "Walk-in",
  csv_import: "CSV import",
  other: "Other",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? "Other";
}

/** A label inside a sentence: "website form", "walk-in", but "CSV import" keeps its acronym. */
export function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

const BARS = ["#0075DE", "#111", "#62aef0", "#8c8781"];

/** The card's `.lbar` colour, the same for every lead with the same service interest. */
export function barColor(program: string | null): string {
  const text = (program ?? "").trim().toLowerCase();
  if (!text) return BARS[3];
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BARS[hash % 3];
}

/** The column ring: a quarter at zero, a fifth more per lead, full at four. */
export function ringOffset(count: number): string {
  return String(62.8 * (1 - Math.min(1, 0.25 + 0.2 * count)));
}

function groups(whole: number): string {
  return whole.toLocaleString("en-CA");
}

/** "CAD 2,400" on a card and a column ("CAD 2,400.50" when there are cents). */
export function cardFee(cents: number | null): string {
  if (cents == null) return "—";
  if (cents % 100 === 0) return `CAD ${groups(cents / 100)}`;
  return `CAD ${groups(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

export function columnTotal(cents: number): string {
  return cardFee(cents);
}

/** "2,400.00" in the List tab. */
export function listFee(cents: number | null): string {
  if (cents == null) return "—";
  return `${groups(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

/** Whole dollars or dollars and cents typed in a dialog, as cents; null when blank. */
export function feeCents(raw: string | null | undefined): number | null | "invalid" {
  const text = (raw ?? "").replace(/[\s,$]/g, "");
  if (!text) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return "invalid";
  const [whole, part = ""] = text.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

export function leadCount(n: number): string {
  return n === 1 ? "1 lead" : `${n} leads`;
}

/** "Sam Example" → "S. Example". */
function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name.trim();
  return `${words[0][0]}. ${words.slice(1).join(" ")}`;
}

// ---------------------------------------------------------------------------
// Duplicate suggestions (CRM-02): several attributes, never a shared email alone
// ---------------------------------------------------------------------------

export function matchName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchPhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

export type DuplicateMatch = { other: LeadRow; matched: ("name" | "date of birth" | "phone" | "email")[] };

/**
 * A possible duplicate: the same name plus a date of birth, phone or email in common, or a
 * date of birth and a phone number in common. A shared email alone is never a match (families
 * share inboxes). Pairs someone already answered, and leads already linked as one person, are left out.
 */
export function duplicateFor(lead: LeadRow, all: readonly LeadRow[], decisions: readonly DecisionRow[]): DuplicateMatch | null {
  const answered = new Set(decisions.map((row) => `${row.lead_id}:${row.other_lead_id}`));
  const root = (row: LeadRow) => row.same_person_lead_id ?? row.id;
  const name = matchName(lead.display_name);
  const phone = matchPhone(lead.phone);
  let best: DuplicateMatch | null = null;
  for (const other of all) {
    if (other.id === lead.id || root(other) === root(lead)) continue;
    const [a, b] = lead.id < other.id ? [lead.id, other.id] : [other.id, lead.id];
    if (answered.has(`${a}:${b}`)) continue;
    const sameName = Boolean(name) && matchName(other.display_name) === name;
    const sameBirth = Boolean(lead.date_of_birth) && lead.date_of_birth === other.date_of_birth;
    const samePhone = phone.length >= 7 && matchPhone(other.phone) === phone;
    const sameEmail = Boolean(lead.email) && lead.email === other.email;
    const matched: DuplicateMatch["matched"] = [];
    if (sameName) matched.push("name");
    if (sameBirth) matched.push("date of birth");
    if (samePhone) matched.push("phone");
    if (sameEmail) matched.push("email");
    const strong = (sameName && (sameBirth || samePhone || sameEmail)) || (sameBirth && samePhone);
    if (!strong) continue;
    if (!best || other.created_at < best.other.created_at) best = { other, matched };
  }
  return best;
}

function year(iso: string): string {
  return iso.slice(0, 4);
}

export function duplicateFlag(match: DuplicateMatch): string {
  return `Possible duplicate of ${shortName(match.other.display_name)} (${year(match.other.created_at)})`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The lead page alert: "Possible duplicate: Hamid Rahimi (2024 lead)". */
export function duplicateAlert(lead: LeadRow, match: DuplicateMatch): { title: string; copy: string } {
  const same = `Same ${joinWords(match.matched)}`;
  const differs: string[] = [];
  if (lead.email && match.other.email && lead.email !== match.other.email) differs.push("email");
  if (matchPhone(lead.phone) && matchPhone(match.other.phone) && matchPhone(lead.phone) !== matchPhone(match.other.phone)) differs.push("phone");
  return {
    title: `Possible duplicate: ${match.other.display_name} (${year(match.other.created_at)} lead)`,
    copy: `${same}${differs.length ? `; different ${joinWords(differs)}` : ""}. Nothing is merged until you confirm.`,
  };
}

// ---------------------------------------------------------------------------
// Next step: a follow-up or a consultation
// ---------------------------------------------------------------------------

export type NextStep = { at: number; overdueDays: number; label: string; what: string; dayOnly: boolean };

function localDayMs(isoDay: string): number {
  return Date.parse(`${isoDay}T00:00:00Z`);
}

function dayDiff(fromDay: string, toDay: string): number {
  return Math.round((localDayMs(toDay) - localDayMs(fromDay)) / DAY);
}

/** "Today", "Tomorrow" is not used by the Designer: "Today", "Thu", or "Thu 10:30". */
function whenLabel(day: string, today: string, weekday: number, time: string | null): string {
  if (day === today && !time) return "Today";
  const diff = dayDiff(today, day);
  const [, m, d] = day.split("-").map(Number);
  const named = diff >= 0 && diff < 7 ? WEEKDAY[weekday] : `${WEEKDAY[weekday]} ${d} ${MONTH[m - 1]}`;
  return time ? `${named} ${time}` : named;
}

function weekdayOf(isoDay: string): number {
  const day = new Date(localDayMs(isoDay)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The open follow-ups and upcoming consultations of one lead, soonest first, overdue first. */
export function nextSteps(
  leadId: string,
  followUps: readonly FollowUpRow[],
  bookings: readonly BookingRow[],
  now: Date,
  timeZone: string,
): NextStep[] {
  const tz = safeZone(timeZone);
  const today = utcToLocal(now.getTime(), tz).date;
  const steps: NextStep[] = [];
  for (const item of followUps) {
    if (item.lead_id !== leadId || item.completed_at || !item.due_on) continue;
    const overdue = Math.max(0, dayDiff(item.due_on, today));
    steps.push({
      at: localDayMs(item.due_on),
      overdueDays: overdue,
      label: overdue ? `${overdue}d` : whenLabel(item.due_on, today, weekdayOf(item.due_on), null),
      what: item.title,
      dayOnly: true,
    });
  }
  for (const booking of bookings) {
    if (booking.lead_id !== leadId || !["held", "pending_payment", "confirmed"].includes(booking.status)) continue;
    const ms = Date.parse(booking.starts_at);
    if (!Number.isFinite(ms) || ms < now.getTime()) continue;
    const local = utcToLocal(ms, tz);
    steps.push({ at: localDayMs(local.date) + local.minuteOfDay * 60_000, overdueDays: 0, label: whenLabel(local.date, today, local.weekday, local.time), what: "consultation", dayOnly: false });
  }
  return steps.sort((a, b) => b.overdueDays - a.overdueDays || a.at - b.at);
}

// ---------------------------------------------------------------------------
// The pipeline page
// ---------------------------------------------------------------------------

export type PipelineInput = {
  tab: PipelineTab;
  stages: readonly StageRow[];
  leads: readonly LeadRow[];
  followUps: readonly FollowUpRow[];
  bookings: readonly BookingRow[];
  decisions: readonly DecisionRow[];
  owners: ReadonlyMap<string, Owner>;
  filter: { stage: string | null; owner: string | null };
  organizationId: string;
  timeZone: string;
  now: Date;
};

/** Stages the board shows: every live stage but Archived, in the firm's order. */
export function boardStages(stages: readonly StageRow[]): StageRow[] {
  return stages.filter((stage) => stage.kind !== "archived").sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

function filterHref(stage: string | null, owner: string | null, tab: PipelineTab): string {
  const params = new URLSearchParams();
  if (tab !== "board") params.set("tab", tab);
  if (stage) params.set("stage", stage);
  if (owner) params.set("owner", owner);
  const query = params.toString();
  return `/sheet/pipeline${query ? `?${query}` : ""}`;
}

export function leadHref(id: string): string {
  return `/sheet/lead?id=${id}`;
}

/**
 * The List tab's "Next follow-up": the lead's earliest open follow-up with a due date, always with
 * its date ("Mon 19 Oct", "Mon 12 Oct, 7 days overdue"). Consultations are not follow-ups.
 */
export function nextFollowUp(leadId: string, followUps: readonly FollowUpRow[], now: Date, timeZone: string): string {
  const today = utcToLocal(now.getTime(), safeZone(timeZone)).date;
  const open = followUps.filter((item) => item.lead_id === leadId && !item.completed_at);
  const due = open
    .map((item) => item.due_on)
    .filter((day): day is string => Boolean(day))
    .sort()[0];
  if (!due) return open.length ? "No date" : "—";
  const late = dayDiff(due, today);
  if (late > 0) return `${dueLabel(due)}, ${late === 1 ? "1 day" : `${late} days`} overdue`;
  return due === today ? `Today, ${dueLabel(due)}` : dueLabel(due);
}

export function buildPipeline(input: PipelineInput): { data: PipelineData; pills: string[]; openCount: number } {
  const stages = boardStages(input.stages);
  const stageById = new Map(input.stages.map((stage) => [stage.id, stage]));
  const ownerName = (id: string | null) => (id ? input.owners.get(id)?.name ?? "Former staff" : "Unassigned");
  const stageFilter = input.filter.stage ? stages.find((stage) => stage.key === input.filter.stage) ?? null : null;
  const ownerFilter = input.filter.owner && (input.filter.owner === "none" || input.owners.has(input.filter.owner)) ? input.filter.owner : null;

  const onBoard = input.leads.filter((lead) => {
    const stage = stageById.get(lead.stage_id);
    return stage && stage.kind !== "archived";
  });
  const visible = onBoard.filter(
    (lead) =>
      (!stageFilter || lead.stage_id === stageFilter.id) &&
      (!ownerFilter || (ownerFilter === "none" ? !lead.owner_membership_id : lead.owner_membership_id === ownerFilter)),
  );

  const steps = new Map(visible.map((lead) => [lead.id, nextSteps(lead.id, input.followUps, input.bookings, input.now, input.timeZone)]));
  const duplicates = new Map(visible.map((lead) => [lead.id, duplicateFor(lead, input.leads, input.decisions)]));

  const card = (lead: LeadRow): LeadCard => {
    const next = steps.get(lead.id)?.[0];
    const match = duplicates.get(lead.id);
    const owner = lead.owner_membership_id ? input.owners.get(lead.owner_membership_id) : undefined;
    return {
      id: lead.id,
      bar: barColor(lead.service_interest),
      name: lead.display_name,
      chip: next ? { tone: next.overdueDays ? "od" : "dt", label: next.label } : null,
      program: lead.service_interest ?? "Service not given",
      source: sourceLabel(lead.source),
      flag: match ? duplicateFlag(match) : null,
      owner: owner ?? { name: ownerName(lead.owner_membership_id) },
      fee: cardFee(lead.proposed_fee_cents),
      data: { "data-version": String(lead.version), "data-href": leadHref(lead.id) },
    };
  };

  // The ‹ › buttons: back never lands on Converted (a lost lead goes back to the last open stage);
  // a converted lead stays where it is; nothing goes forward from Lost or past the last column.
  const moves = (index: number): { back: boolean; forward: boolean } => {
    const kind = stages[index].kind;
    if (kind === "converted") return { back: false, forward: false };
    const back = stages.slice(0, index).some((stage) => stage.kind === "open");
    return { back, forward: kind !== "lost" && index < stages.length - 1 };
  };

  const columns: PipelineColumn[] = stages.map((stage, index) => {
    const cards = visible.filter((lead) => lead.stage_id === stage.id);
    const total = cards.reduce((sum, lead) => sum + (lead.proposed_fee_cents ?? 0), 0);
    const move = moves(index);
    return {
      label: stage.label,
      total: columnTotal(total),
      count: leadCount(cards.length),
      offset: ringOffset(cards.length),
      cards: cards.map((lead) => ({ ...card(lead), moves: move })),
      data: { "data-stage-id": stage.id, "data-kind": stage.kind },
      // A Stage filter shows that stage's column only; the others would read "0 leads".
      hidden: Boolean(stageFilter && stageFilter.id !== stage.id),
    };
  });

  const order = new Map(stages.map((stage, index) => [stage.id, index]));
  const rows: PipelineRow[] = [...visible]
    .sort((a, b) => (order.get(a.stage_id) ?? 0) - (order.get(b.stage_id) ?? 0) || b.created_at.localeCompare(a.created_at))
    .map((lead) => ({
      href: leadHref(lead.id),
      name: lead.display_name,
      duplicate: Boolean(duplicates.get(lead.id)),
      stage: stageById.get(lead.stage_id)?.label ?? "",
      program: lead.service_interest ?? "—",
      source: sourceLabel(lead.source),
      owner: ownerName(lead.owner_membership_id),
      fee: listFee(lead.proposed_fee_cents),
      next: nextFollowUp(lead.id, input.followUps, input.now, input.timeZone),
    }));

  const timeline: TimelineItem[] = visible
    .flatMap((lead) => (steps.get(lead.id) ?? []).map((step) => ({ lead, step })))
    .sort((a, b) => b.step.overdueDays - a.step.overdueDays || a.step.at - b.step.at)
    .slice(0, 30)
    .map(({ lead, step }) => ({
      when: step.overdueDays ? `${step.overdueDays}d overdue` : step.label,
      who: lead.display_name,
      what: step.what,
      href: leadHref(lead.id),
    }));

  const stageCounts = new Map<string, number>();
  const ownerCounts = new Map<string, number>();
  for (const lead of onBoard) {
    stageCounts.set(lead.stage_id, (stageCounts.get(lead.stage_id) ?? 0) + 1);
    const key = lead.owner_membership_id ?? "none";
    ownerCounts.set(key, (ownerCounts.get(key) ?? 0) + 1);
  }
  const owners = [...ownerCounts.keys()]
    .filter((key) => key !== "none")
    .sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
  const filters: [FilterSelect, FilterSelect] = [
    {
      id: "gsS",
      listId: "gsstage",
      key: "Stage",
      value: stageFilter?.label ?? "All stages",
      options: [
        { label: "All stages", selected: !stageFilter, data: { "data-href": filterHref(null, ownerFilter, input.tab) } },
        ...stages.map((stage) => ({
          label: stage.label,
          count: String(stageCounts.get(stage.id) ?? 0),
          selected: stageFilter?.id === stage.id,
          data: { "data-href": filterHref(stage.key, ownerFilter, input.tab) },
        })),
      ],
    },
    {
      id: "gsO",
      listId: "gsowner",
      key: "Owner",
      value: ownerFilter ? ownerName(ownerFilter === "none" ? null : ownerFilter) : "Anyone",
      options: [
        { label: "Anyone", selected: !ownerFilter, data: { "data-href": filterHref(stageFilter?.key ?? null, null, input.tab) } },
        ...owners.map((id) => ({
          label: ownerName(id),
          count: String(ownerCounts.get(id) ?? 0),
          selected: ownerFilter === id,
          data: { "data-href": filterHref(stageFilter?.key ?? null, id, input.tab) },
        })),
        ...(ownerCounts.has("none")
          ? [{ label: "Unassigned", count: String(ownerCounts.get("none")), selected: ownerFilter === "none", data: { "data-href": filterHref(stageFilter?.key ?? null, "none", input.tab) } }]
          : []),
      ],
    },
  ];

  const open = onBoard.filter((lead) => stageById.get(lead.stage_id)?.kind === "open");
  const openFees = open.reduce((sum, lead) => sum + (lead.proposed_fee_cents ?? 0), 0);
  const pills = [open.length === 1 ? "1 open lead" : `${open.length} open leads`, `Proposed fees ${columnTotal(openFees)}`];

  return {
    data: {
      tab: input.tab,
      filters,
      columns,
      rows,
      timeline,
      board: { "data-org": input.organizationId },
      boardKey: boardKey(input.leads),
      empty: {
        list: onBoard.length
          ? { title: "No leads match", copy: "Clear the stage or owner filter to see every lead." }
          : { title: "No leads yet", copy: "Enquiries from your hosted page, bookings you link and leads you add appear here." },
        timeline: { title: "Nothing scheduled", copy: "Follow-ups with a due date and booked consultations appear here." },
      },
    },
    pills,
    openCount: open.length,
  };
}

// ---------------------------------------------------------------------------
// The lead page
// ---------------------------------------------------------------------------

/** "15 Oct" in the firm's zone. */
export function shortDay(iso: string, timeZone: string): string {
  const local = utcToLocal(Date.parse(iso), safeZone(timeZone));
  const [, m, d] = local.date.split("-").map(Number);
  return `${d} ${MONTH[m - 1]}`;
}

/** "15 Oct 2026, 14:05" in the firm's zone. */
export function stamp(iso: string, timeZone: string): string {
  const local = utcToLocal(Date.parse(iso), safeZone(timeZone));
  const [y, m, d] = local.date.split("-").map(Number);
  return `${d} ${MONTH[m - 1]} ${y}, ${local.time}`;
}

/** "Mon 19 Oct" for a due date. */
export function dueLabel(day: string | null): string {
  if (!day) return "No date";
  const [, m, d] = day.split("-").map(Number);
  return `${WEEKDAY[weekdayOf(day)]} ${d} ${MONTH[m - 1]}`;
}

export function leadSummary(lead: Pick<LeadRow, "service_interest" | "source">): { left: string; right: string } {
  return {
    left: lead.service_interest ?? "Service not given yet",
    right: `from ${inSentence(sourceLabel(lead.source))}. Passports and detailed histories wait until they’re needed.`,
  };
}

export type ConsentRow = { purpose: string; granted: boolean; captured_via: string; recorded_at: string };

const VIA: Record<string, string> = { web_form: "website form", hosted_page: "hosted page", staff: "recorded by staff", booking_page: "booking page" };

/** The latest answer per purpose, as the Contact panel's Consent and Marketing values. */
export function consentValues(rows: readonly ConsentRow[], timeZone: string): { reply: LeadDlItem["value"]; marketing: LeadDlItem["value"] } {
  const latest = (purpose: string) =>
    [...rows].filter((row) => row.purpose === purpose).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const reply = latest("enquiry_reply");
  const marketing = latest("marketing");
  return {
    reply: reply
      ? reply.granted
        ? { left: "Service messages", right: `${shortDay(reply.recorded_at, timeZone)}, ${VIA[reply.captured_via] ?? "recorded"}` }
        : { left: "Withdrawn", right: shortDay(reply.recorded_at, timeZone) }
      : "Not recorded",
    marketing: marketing
      ? marketing.granted
        ? { left: "Opted in", right: `${shortDay(marketing.recorded_at, timeZone)}, ${VIA[marketing.captured_via] ?? "recorded"}` }
        : { left: "Opted out", right: shortDay(marketing.recorded_at, timeZone) }
      : "Not given",
  };
}

export function marketingGranted(rows: readonly ConsentRow[]): boolean {
  const latest = [...rows].filter((row) => row.purpose === "marketing").sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  return Boolean(latest?.granted);
}

/** Whether the latest reply-consent answer is a yes. */
export function replyGranted(rows: readonly ConsentRow[]): boolean {
  const latest = [...rows].filter((row) => row.purpose === "enquiry_reply").sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  return Boolean(latest?.granted);
}

/** Sources a person records (Edit lead can change them). The others are recorded by the system. */
export const STAFF_SOURCES: ReadonlySet<string> = new Set(["phone", "email", "referral", "event", "walk_in", "other"]);

/**
 * Where Reopen puts a lost lead: the open stage it was closed from (the latest "lost" event's
 * from-stage), else Contacted, else the firm's first open stage.
 */
export function reopenStage(stages: readonly StageRow[], events: readonly Pick<EventRow, "kind" | "from_stage_id" | "created_at">[], currentStageId: string): StageRow | null {
  const open = boardStages(stages).filter((stage) => stage.kind === "open" && stage.id !== currentStageId);
  const closedFrom = [...events].filter((event) => event.kind === "lost").sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.from_stage_id;
  return open.find((stage) => stage.id === closedFrom) ?? open.find((stage) => stage.key === "contacted") ?? open[0] ?? null;
}

export function preferredLabel(preferred: string | null, email: string | null, phone: string | null): string {
  if (preferred === "phone") return email ? "Phone, then email" : "Phone";
  if (preferred === "email") return phone ? "Email, then phone" : "Email";
  return email && phone ? "Email or phone" : email ? "Email" : phone ? "Phone" : "Not given";
}

export const CONFLICT_STATE: Record<string, { tone: "ok" | "rev" | "bad" | "unv"; label: string }> = {
  not_checked: { tone: "unv", label: "Not checked yet" },
  clear: { tone: "ok", label: "No conflict" },
  possible_conflict: { tone: "rev", label: "Possible conflict" },
  conflict: { tone: "bad", label: "Conflict" },
};

export type EventRow = {
  kind: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  actor_user_id: string | null;
  created_at: string;
};

/** Newest first: what happened, who did it, when. */
export function historyItems(
  events: readonly EventRow[],
  stages: ReadonlyMap<string, string>,
  people: ReadonlyMap<string, string>,
  timeZone: string,
): HistoryItem[] {
  const stageName = (id: string | null) => (id ? stages.get(id) ?? "a stage" : "a stage");
  return [...events]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((event) => {
      const payload = event.payload ?? {};
      const reason = event.reason ? `: ${event.reason}` : "";
      let what: string;
      switch (event.kind) {
        case "created":
          what = `Created from ${inSentence(sourceLabel(String(payload.source ?? "other")))} in ${stageName(event.to_stage_id)}`;
          break;
        case "stage_changed":
          what = `Moved to ${stageName(event.to_stage_id)}${reason}`;
          break;
        case "reopened":
          what = `Reopened in ${stageName(event.to_stage_id)}${reason}`;
          break;
        case "lost":
          what = `Closed as lost${reason}`;
          break;
        case "converted":
          what = "Converted to a matter";
          break;
        case "conflict_checked":
          what = `Conflict check: ${(CONFLICT_STATE[String(payload.result)] ?? CONFLICT_STATE.not_checked).label.toLowerCase()}`;
          break;
        case "assigned":
          what = "Owner changed";
          break;
        case "updated":
          what = payload.source_to ? `Source changed to ${inSentence(sourceLabel(String(payload.source_to)))}` : "Details edited";
          break;
        case "booking_linked":
          what = "Consultation linked";
          break;
        case "duplicate_same":
          what = "Linked to another lead as the same person";
          break;
        case "duplicate_different":
          what = "Marked as a different person from a similar lead";
          break;
        case "consent_recorded":
          what = `${payload.purpose === "marketing" ? "Marketing" : "Reply"} consent ${payload.granted ? "given" : "withdrawn"}`;
          break;
        case "follow_up_added":
          what = "Follow-up added";
          break;
        case "follow_up_done":
          what = "Follow-up done";
          break;
        default:
          what = "Updated";
      }
      const who = event.actor_user_id ? people.get(event.actor_user_id) ?? "Staff" : "The enquiry form";
      return { what, who, when: stamp(event.created_at, timeZone) };
    });
}

/** User-facing copy for a refused lead action. Never passes a database message through. */
export function leadError(message: string): string {
  if (/changed by someone else/i.test(message)) return "This lead changed since you opened it. Reload and try again.";
  if (/step-up/i.test(message)) return "Confirm it’s you with your authenticator, then try again.";
  if (/staff access denied|sign in|permission denied/i.test(message)) return "Your role can’t change leads in this firm.";
  if (/sample mode/i.test(message)) return "This firm is still in sample mode, so a lead can only become a sample matter. Turn sample mode off to open a real client’s matter.";
  const known = [
    "use convert to matter to convert a lead",
    "close a lead as lost from the lead, with a reason",
    "a converted lead stays converted",
    "record a clear conflict check before converting",
    "reopen the lead before converting it",
    "this lead is already converted",
    "this lead is already closed as lost",
    "give a reason the lead was lost (3 to 500 characters)",
    "say what may conflict in a short note",
    "this booking already belongs to a lead",
    "this booking is for an existing client",
    "this pair was already answered",
    "choose active staff as the owner",
    "enter a valid email address",
    "enter a valid phone number",
    "add the person's name (up to 200 characters)",
    "keep an email address or a phone number",
    "date of birth is not plausible",
    "the proposed fee is out of range",
    "write a note (up to 4,000 characters)",
    "name the follow-up (up to 200 characters)",
    "choose a due date from today to two years ahead",
    "import up to 500 rows at a time",
    "the file has no rows to import",
    "choose where this lead came from",
    "this lead's source was recorded when it came in",
    "lead not found",
    "stage not found",
  ];
  const hit = known.find((text) => message.toLowerCase().includes(text));
  if (hit) return `${hit.charAt(0).toUpperCase()}${hit.slice(1).replace("person's", "person’s")}.`;
  return "That couldn’t be saved. Try again.";
}

/** A short fingerprint of the board's leads (id, stage, version), so the board is rebuilt when any changes. */
export function boardKey(leads: readonly Pick<LeadRow, "id" | "stage_id" | "version">[]): string {
  let hash = 0x811c9dc5;
  for (const lead of leads) {
    for (const char of `${lead.id}:${lead.stage_id}:${lead.version};`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `b${leads.length}-${hash.toString(36)}`;
}
