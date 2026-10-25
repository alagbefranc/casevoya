/**
 * Pure: ADM-04 service notices for firm staff. The banner on every Sheet page (the most important
 * current notice the person hasn't dismissed: incidents above maintenance above information) and
 * the history on Settings > Security > Service notices. Times are shown in the firm's timezone.
 * Notices are posted by Casevoya platform staff by hand (scripts/ops/service-notice.mjs); nothing
 * here claims automatic monitoring.
 */
import type { MatterBadge } from "@/components/sheet/designer/matters";

export type NoticeKind = "maintenance" | "incident" | "info";
export type NoticeSeverity = "info" | "minor" | "major";
export type NoticeStatus = "draft" | "published" | "resolved";

export type ServiceNotice = {
  id: string;
  kind: NoticeKind;
  severity: NoticeSeverity;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string | null;
  status: NoticeStatus;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

/** The history page's address (Settings, next to Security). */
export const SERVICE_NOTICES_HREF = "/sheet/settings?tab=notices";

/** Rows as public.service_notices returns them; anything malformed is left out. */
export function readServiceNotices(rows: readonly Record<string, unknown>[] | null | undefined): ServiceNotice[] {
  const out: ServiceNotice[] = [];
  for (const row of rows ?? []) {
    const kind = row.kind;
    const severity = row.severity;
    const status = row.status;
    if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.body !== "string" || typeof row.starts_at !== "string") continue;
    if (kind !== "maintenance" && kind !== "incident" && kind !== "info") continue;
    if (severity !== "info" && severity !== "minor" && severity !== "major") continue;
    if (status !== "draft" && status !== "published" && status !== "resolved") continue;
    out.push({
      id: row.id,
      kind,
      severity,
      title: row.title,
      body: row.body,
      startsAt: row.starts_at,
      endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
      status,
      resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
      resolutionNote: typeof row.resolution_note === "string" ? row.resolution_note : null,
    });
  }
  return out;
}

const KIND_RANK: Record<NoticeKind, number> = { incident: 0, maintenance: 1, info: 2 };
const SEVERITY_RANK: Record<NoticeSeverity, number> = { major: 0, minor: 1, info: 2 };

function ms(iso: string): number {
  return new Date(iso).getTime();
}

/** Published and not past its end. A maintenance window shows from when it is posted. */
export function isCurrent(notice: ServiceNotice, now: Date): boolean {
  return notice.status === "published" && (notice.endsAt === null || ms(notice.endsAt) > now.getTime());
}

/** Incidents above maintenance above information; then the more severe; then the newest. */
export function byImportance(a: ServiceNotice, b: ServiceNotice): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || ms(b.startsAt) - ms(a.startsAt);
}

/** "25 Oct 2026, 22:00" in the firm's timezone. */
export function noticeTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

export const KIND_LABEL: Record<NoticeKind, string> = { incident: "Incident", maintenance: "Maintenance", info: "Information" };

/** When the notice applies, in words, e.g. "From 25 Oct 2026, 22:00 to 26 Oct 2026, 02:00". */
export function noticeWhen(notice: ServiceNotice, now: Date, timeZone: string): string {
  const start = noticeTime(notice.startsAt, timeZone);
  const end = notice.endsAt ? noticeTime(notice.endsAt, timeZone) : null;
  if (notice.kind === "maintenance" || (end && ms(notice.startsAt) > now.getTime())) return end ? `From ${start} to ${end}` : `From ${start}`;
  if (end) return `${start} to ${end}`;
  return `Since ${start}`;
}

export type ServiceNoticeBannerData = {
  id: string;
  organizationId: string;
  tone: "bad" | "warn" | "info";
  icon: "incident" | "clock" | "info";
  title: string;
  body: string;
  /** Other current notices the person hasn't dismissed (all are in the history). */
  more: number;
  href: string;
};

function bannerTone(notice: ServiceNotice, now: Date): ServiceNoticeBannerData["tone"] {
  if (notice.kind === "incident") return notice.severity === "major" ? "bad" : "warn";
  if (notice.kind === "maintenance") return ms(notice.startsAt) <= now.getTime() || notice.severity === "major" ? "warn" : "info";
  return notice.severity === "major" ? "warn" : "info";
}

function bannerLead(notice: ServiceNotice, now: Date): string {
  if (notice.kind === "incident") return "Service incident";
  if (notice.kind === "maintenance") return ms(notice.startsAt) <= now.getTime() ? "Maintenance in progress" : "Scheduled maintenance";
  return "Notice from Casevoya";
}

/** The banner for one staff member, or null when no current notice is left undismissed. */
export function serviceNoticeBanner(
  notices: readonly ServiceNotice[],
  dismissed: ReadonlySet<string>,
  input: { now: Date; timeZone: string; organizationId: string },
): ServiceNoticeBannerData | null {
  const open = notices.filter((notice) => isCurrent(notice, input.now) && !dismissed.has(notice.id)).sort(byImportance);
  const top = open[0];
  if (!top) return null;
  return {
    id: top.id,
    organizationId: input.organizationId,
    tone: bannerTone(top, input.now),
    icon: top.kind === "incident" ? "incident" : top.kind === "maintenance" ? "clock" : "info",
    title: `${bannerLead(top, input.now)}: ${top.title}`,
    body: ` ${top.body} ${noticeWhen(top, input.now, input.timeZone)} (${input.timeZone}).`,
    more: open.length - 1,
    href: SERVICE_NOTICES_HREF,
  };
}

export type ServiceNoticeHistoryRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  when: string;
  badge: MatterBadge;
  resolution: string;
};

export type ServiceNoticeHistoryData = {
  intro: string;
  rows: ServiceNoticeHistoryRow[];
  note: string;
  /** The notices couldn't be read; the page says so instead of "none yet". */
  unavailable?: boolean;
};

function stateBadge(notice: ServiceNotice, now: Date): MatterBadge {
  if (notice.status === "resolved") return { tone: "ok", label: "Resolved" };
  if (notice.endsAt && ms(notice.endsAt) <= now.getTime()) return { tone: "gr", label: "Ended" };
  if (ms(notice.startsAt) > now.getTime()) return { tone: "blue", label: "Scheduled" };
  return notice.kind === "incident" && notice.severity === "major" ? { tone: "bad", label: "Active" } : { tone: "chg", label: "Active" };
}

/** Every notice the firm was sent (current ones first, then the newest), with its resolution. */
export function serviceNoticeHistory(notices: readonly ServiceNotice[], input: { now: Date; timeZone: string }): ServiceNoticeHistoryData {
  const shown = notices.filter((notice) => notice.status !== "draft");
  const current = shown.filter((notice) => isCurrent(notice, input.now)).sort(byImportance);
  const past = shown.filter((notice) => !isCurrent(notice, input.now)).sort((a, b) => ms(b.startsAt) - ms(a.startsAt));
  return {
    intro: "Maintenance, incidents and other notices Casevoya sent to your firm, current and past.",
    rows: [...current, ...past].map((notice) => ({
      id: notice.id,
      kind: KIND_LABEL[notice.kind],
      title: notice.title,
      body: notice.body,
      when: noticeWhen(notice, input.now, input.timeZone),
      badge: stateBadge(notice, input.now),
      resolution:
        notice.status === "resolved" && notice.resolvedAt
          ? `${noticeTime(notice.resolvedAt, input.timeZone)}${notice.resolutionNote ? `: ${notice.resolutionNote}` : ""}`
          : "—",
    })),
    note: `Casevoya staff post these notices by hand when maintenance is planned or something goes wrong; they are not automatic status checks. Times in ${input.timeZone}. Dismissing the banner hides it for you only; the notice stays here.`,
  };
}

/** The Service notices row on Settings > Security: how many are current. */
export function serviceNoticeSecurityBadge(notices: readonly ServiceNotice[], now: Date): MatterBadge {
  const current = notices.filter((notice) => isCurrent(notice, now)).length;
  return current ? { tone: "chg", label: current === 1 ? "1 current" : `${current} current` } : { tone: "gr", label: "None current" };
}
