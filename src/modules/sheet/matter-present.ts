/** Pure helpers that turn one matter's records into the Designer matter page's words. */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { ago, dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, MATTER_STAGES, plusDays } from "@/modules/sheet/present";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2 Sep 2026" from a `YYYY-MM-DD` date. */
export function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`;
}

/** "Fri 30 Oct" from a `YYYY-MM-DD` date. Calendar dates, so UTC noon avoids any shift. */
export function weekdayDayMonth(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return `${SHORT_DAYS[weekday]} ${day} ${SHORT_MONTHS[month - 1]}`;
}

/** "17:00 ET" for an instant in a zone. */
export function clockTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortGeneric",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("timeZoneName")}`.trim();
}

export function stageIndex(stage: string): number {
  const index = (MATTER_STAGES as readonly string[]).indexOf(stage);
  return index < 0 ? 0 : index;
}

/** The pills next to the client's name: when the file last changed and when it was opened. */
export function headerPills(updatedAt: string, createdAt: string, timeZone: string, now: Date): string[] {
  const since = ago(updatedAt, now);
  return [since === "now" ? "Updated just now" : `Updated ${since} ago`, `Opened ${longDate(isoDateInTimeZone(new Date(createdAt), timeZone))}`];
}

/** "Today 08:41" for today, otherwise "15 Oct", in the firm's timezone. */
export function eventWhen(iso: string, timeZone: string, today: string): string {
  const date = isoDateInTimeZone(new Date(iso), timeZone);
  if (date !== today) return dayMonth(date);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return `Today ${time}`;
}

export function daysUntil(date: string, today: string): number {
  const [a, b] = [date, today].map((value) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  });
  return Math.round((a - b) / 86400000);
}

/** "due in 6 days", "due tomorrow", "due today", "3 days overdue". */
export function dueIn(date: string, today: string): string {
  const days = daysUntil(date, today);
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

export type DocumentInput = {
  requestStatus: string | null;
  version: { uploadState: string; reviewState: string; versionNumber: number; expiresOn: string | null } | null;
};

export type DocumentState = {
  upload: MatterBadge;
  review: MatterBadge;
  version: string;
  /** Where the document counts in the completion gauge. Null when it no longer counts. */
  bucket: "accepted" | "review" | "outstanding" | null;
};

/** Upload state and firm review stay separate, as the Designer shows them. */
export function documentState(input: DocumentInput, today: string): DocumentState {
  const version = input.version;
  if (!version) {
    if (input.requestStatus === "waived") return { upload: { tone: "unv", label: "Not uploaded" }, review: { tone: "unv", label: "Waived" }, version: "—", bucket: null };
    return { upload: { tone: "unv", label: "Not uploaded" }, review: { tone: "gr", label: "Requested" }, version: "—", bucket: "outstanding" };
  }
  const label = `v${version.versionNumber}`;
  const upload: MatterBadge =
    version.uploadState === "clean"
      ? { tone: "gr", label: "Uploaded", detail: "scanned" }
      : version.uploadState === "scanning"
        ? { tone: "gr", label: "Uploaded", detail: "scanning" }
        : version.uploadState === "uploading"
          ? { tone: "gr", label: "Uploading" }
          : version.uploadState === "quarantined"
            ? { tone: "bad", label: "Held back" }
            : { tone: "bad", label: "Upload failed" };
  if (version.expiresOn && version.expiresOn < today) return { upload, review: { tone: "bad", label: "Expired" }, version: label, bucket: "outstanding" };
  if (version.reviewState === "accepted") return { upload, review: { tone: "ok", label: "Accepted by firm" }, version: label, bucket: "accepted" };
  if (version.reviewState === "rejected") return { upload, review: { tone: "chg", label: "Changes requested" }, version: label, bucket: "outstanding" };
  if (version.uploadState === "clean") return { upload, review: { tone: "rev", label: "Awaiting review" }, version: label, bucket: "review" };
  return { upload, review: { tone: "gr", label: "Requested" }, version: label, bucket: "outstanding" };
}

/** The next-deadline badge: the date, the time when one is set, and whether a consultant confirmed it. */
export function deadlineBadge(deadline: { dueOn: string | null; dueAt: string | null; timezone: string; verification: string } | null): MatterBadge {
  if (!deadline?.dueOn) return { tone: "unv", label: "Next deadline", detail: "—" };
  const time = deadline.dueAt ? `, ${clockTime(deadline.dueAt, deadline.timezone)}` : "";
  const confirmed = deadline.verification === "confirmed";
  return {
    tone: confirmed ? "ok" : "chg",
    label: "Next deadline",
    detail: `${weekdayDayMonth(deadline.dueOn)}${time} (${confirmed ? "verified" : "unverified"})`,
  };
}

const PARTY_ROLE: Record<string, string> = {
  applicant: "Applicant",
  dependant: "Dependant",
  sponsor: "Sponsor",
  employer: "Employer",
  guardian: "Guardian",
  consultant: "Licensed consultant",
  case_manager: "Case manager",
  assistant: "Assistant",
};

export function partyRole(role: string): string {
  return PARTY_ROLE[role] ?? role;
}

/** Applicant first, then the other clients, then staff. */
export const PARTY_ORDER = ["applicant", "sponsor", "dependant", "guardian", "employer", "consultant", "case_manager", "assistant"];

export function partyRank(role: string): number {
  const index = PARTY_ORDER.indexOf(role);
  return index < 0 ? PARTY_ORDER.length : index;
}

const RELATION: Record<string, string> = {
  spouse: "Spouse of",
  parent: "Parent of",
  child: "Child of",
  payer: "Pays invoices for",
  sponsor: "Sponsor of",
  household: "Lives with",
  other: "Related to",
};

export function relationLabel(kind: string): string {
  return RELATION[kind] ?? "Related to";
}

const AGREEMENT_STATE: Record<string, MatterBadge> = {
  draft: { tone: "gr", label: "Draft" },
  sent: { tone: "rev", label: "Waiting on signatures" },
  partially_signed: { tone: "rev", label: "Waiting on signatures" },
  completed: { tone: "ok", label: "Completed" },
  accepted: { tone: "ok", label: "Accepted" },
  declined: { tone: "bad", label: "Declined" },
  expired: { tone: "bad", label: "Expired" },
  voided: { tone: "unv", label: "Voided" },
  superseded: { tone: "unv", label: "Superseded" },
};

export function agreementState(status: string): MatterBadge {
  return AGREEMENT_STATE[status] ?? { tone: "gr", label: status };
}

/** The word after the agreement's title in the right column ("executed"). */
export function agreementWord(status: string): string {
  if (status === "completed") return "executed";
  if (status === "accepted") return "accepted";
  if (status === "sent" || status === "partially_signed") return "out for signature";
  return agreementState(status).label.toLowerCase();
}

export function reminderBadge(status: string): MatterBadge {
  if (status === "sent") return { tone: "ok", label: "sent" };
  if (status === "cancelled") return { tone: "unv", label: "cancelled" };
  return { tone: "gr", label: "scheduled" };
}

export function taskRowBadge(status: string, dueOn: string | null, today: string): MatterBadge {
  if (status === "done") return { tone: "ok", label: "Done" };
  if (status === "cancelled") return { tone: "unv", label: "Cancelled" };
  if (status === "blocked") return { tone: "bad", label: "Blocked" };
  if (dueOn && dueOn < today) return { tone: "bad", label: "Overdue" };
  return { tone: "gr", label: "Open" };
}

/** "due Today", "due 22 Oct" or nothing. */
export function taskDue(dueOn: string | null, today: string): string | null {
  if (!dueOn) return null;
  return dueOn === today ? "due Today" : `due ${dayMonth(dueOn)}`;
}

/** Firm activity on this matter as the Designer's recent events. Other actions are not shown. */
export const MATTER_EVENT: Record<string, { title: string; source: string; dot: string; badge: MatterBadge }> = {
  "matter.create": { title: "Matter opened", source: "Matters", dot: "#0075DE", badge: { tone: "blue", label: "Opened" } },
  "matter.stage_transition": { title: "Stage changed", source: "Matters", dot: "#0075DE", badge: { tone: "blue", label: "Stage" } },
  "matter.government_status_recorded": { title: "Government status recorded", source: "Government", dot: "#0075DE", badge: { tone: "blue", label: "Government" } },
  "document.request_created": { title: "Document requested", source: "Documents", dot: "#c9c5c0", badge: { tone: "gr", label: "Requested" } },
  "document.uploaded": { title: "Document uploaded", source: "Documents", dot: "#c9c5c0", badge: { tone: "unv", label: "Uploaded" } },
  "document.reviewed": { title: "Document reviewed", source: "Documents", dot: "#2e9d5b", badge: { tone: "ok", label: "Reviewed" } },
  "agreement.sent": { title: "Agreement sent for signature", source: "Agreements", dot: "#0075DE", badge: { tone: "gr", label: "Sent" } },
  "agreement.signed": { title: "Agreement signed", source: "Agreements", dot: "#2e9d5b", badge: { tone: "ok", label: "Signed" } },
  "agreement.executed": { title: "Agreement fully signed", source: "Agreements", dot: "#2e9d5b", badge: { tone: "ok", label: "Signed" } },
  "agreement.quote_accepted": { title: "Quote accepted", source: "Agreements", dot: "#2e9d5b", badge: { tone: "ok", label: "Accepted" } },
  "intake.submitted": { title: "Questionnaire submitted", source: "Intake", dot: "#0075DE", badge: { tone: "rev", label: "Submitted" } },
  "task.overdue": { title: "Task overdue", source: "Tasks", dot: "#c9c5c0", badge: { tone: "bad", label: "Overdue" } },
  "deadline.confirmed": { title: "Deadline confirmed", source: "Deadlines", dot: "#2e9d5b", badge: { tone: "ok", label: "Confirmed" } },
};

const ACTOR: Record<string, string> = { user: "Signed-in user", system: "Casevoya", service: "Casevoya" };

export function actorLabel(actorType: string): string {
  return ACTOR[actorType] ?? "Casevoya";
}

/** A hold's review date sits two weeks out unless the firm picks another. */
export function defaultReview(today: string): string {
  return plusDays(today, 14);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
