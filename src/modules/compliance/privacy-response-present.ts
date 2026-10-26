import type { Action, DlRow, Line, StateBadge } from "@/components/sheet/designer/compliance";
import type { Worklist } from "@/components/sheet/designer/privacy";
import { dayMonth, dayMonthYear, localDate } from "./format";
import { ITEM_DECISIONS, SOURCE_LABEL, shortHash } from "./privacy-response-format";

/**
 * SEC-06 on the Privacy requests page: legal time limits (official, reviewed) or the firm's own
 * dates, the extension and its notice, the records found and what is withheld, the response
 * package, and its delivery with the download proof. Pure, from the rows the loader read as the
 * signed-in staff member. No legal period is shown unless a licensed member of the firm approved it
 * from an official page; otherwise the date is labelled as the firm's own.
 */

export type TimeLimitRow = {
  id: string;
  kind: string;
  law_name: string;
  provision_text: string;
  days: number | null;
  source_url: string;
  source_section: string;
  checked_on: string;
  current_to: string | null;
  snapshot_sha256: string | null;
  status: string;
  reviewed_by_membership_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  page_attested_by_membership_id: string | null;
  page_attested_on: string | null;
  version: number;
};

export type ItemRow = {
  id: string;
  request_id: string;
  source: string;
  source_id: string;
  label: string;
  fields: string[];
  decision: string;
  withheld_fields: string[];
  third_party: string | null;
  reason: string | null;
  decided_by: string | null;
};

export type ResponseRow = {
  id: string;
  request_id: string;
  status: string;
  sha256: string | null;
  byte_size: number | null;
  file_count: number | null;
  record_count: number | null;
  withheld_count: number | null;
  ready_at: string | null;
  requested_at: string;
  failed_reason: string | null;
};

export type DeliveryRow = {
  id: string;
  request_id: string;
  response_id: string;
  delivered_at: string;
  expires_at: string;
  sha256: string;
  download_count: number;
  first_downloaded_at: string | null;
  last_downloaded_at: string | null;
};

/** The extension columns of a request (all optional: rows read before SEC-06 have none). */
export type ExtensionFields = {
  extended_due_on?: string | null;
  extension_basis?: string | null;
  extension_time_limit_id?: string | null;
  extension_reason?: string | null;
  extension_recourse?: string | null;
  extended_at?: string | null;
  extension_notice_channel?: string | null;
  extension_notice_method?: string | null;
  extension_notice_late?: boolean | null;
  extension_notice_seen_at?: string | null;
};

type RequestLike = ExtensionFields & {
  id: string;
  reference: string;
  kind: string;
  person_id: string | null;
  received_on: string;
  due_on: string | null;
  identity_verified_at: string | null;
  scope_at: string | null;
  redaction_at: string | null;
  reviewed_at: string | null;
  closed_at: string | null;
};

export type PrivacyExtras = {
  limits: TimeLimitRow[];
  /** The selected request's scope search items, packages and delivery. */
  items: ItemRow[];
  responses: ResponseRow[];
  delivery: DeliveryRow | null;
  /** The selected request's person has a portal login in this firm. */
  hasPortal: boolean;
  /** Owner or licensed consultant: may review legal time limits (the database checks the licence). */
  canReview: boolean;
};

type Ctx = { timezone: string; memberName: (membershipId: string) => string };

function addDays(date: string, days: number): string {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The latest approved legal time limit of a kind, if any. */
export function approvedLimit(limits: TimeLimitRow[], kind: string): TimeLimitRow | null {
  return (
    limits
      .filter((limit) => limit.status === "approved" && limit.kind === kind)
      .sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""))[0] ?? null
  );
}

/** The due date in force: the extended one, else the firm's target. */
export function effectiveDue(row: { due_on: string | null } & ExtensionFields): string | null {
  return row.extended_due_on ?? row.due_on;
}

function citation(limit: TimeLimitRow): string[] {
  return [`${limit.law_name}, ${limit.source_section}`, limit.current_to ? `current to ${dayMonthYear(limit.current_to)}` : "no current-to date on the page"];
}

function provenance(limit: TimeLimitRow, ctx: Ctx): string {
  if (limit.snapshot_sha256) return `page captured, SHA-256 ${shortHash(limit.snapshot_sha256)}`;
  if (limit.page_attested_on && limit.page_attested_by_membership_id) {
    return `page not captured by Casevoya, checked by ${ctx.memberName(limit.page_attested_by_membership_id)} on ${dayMonthYear(limit.page_attested_on)}`;
  }
  return "page not captured";
}

function extensionValue(row: RequestLike, limits: TimeLimitRow[], ctx: Ctx): Line {
  if (!row.extended_at || !row.extended_due_on) return row.kind === "access" || row.kind === "correction" ? "Not used" : "—";
  const limit = row.extension_time_limit_id ? limits.find((entry) => entry.id === row.extension_time_limit_id) : null;
  const basis = row.extension_basis === "official" && limit ? `${limit.law_name}, ${limit.source_section}` : "set by the firm";
  const notice =
    row.extension_notice_channel === "portal"
      ? row.extension_notice_seen_at
        ? `seen in the portal ${dayMonth(localDate(row.extension_notice_seen_at, ctx.timezone))}`
        : "posted in the portal, not seen yet"
      : `told by ${row.extension_notice_method ?? "another way"}`;
  const parts = [`To ${dayMonthYear(row.extended_due_on)}`, basis, row.extension_reason ?? "", notice];
  if (row.extension_notice_late) parts.push("notice after the original time limit");
  return parts.filter(Boolean);
}

export function latestResponse(responses: ResponseRow[]): ResponseRow | null {
  return [...responses].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0] ?? null;
}

function packageValue(response: ResponseRow | null, ctx: Ctx): Line {
  if (!response) return "Not built yet";
  if (response.status === "building") return "Building";
  if (response.status === "failed") return ["Last build failed", "nothing was kept"];
  return [
    `${response.file_count ?? 0} files`,
    `${response.withheld_count ?? 0} withheld`,
    `SHA-256 ${shortHash(response.sha256)}`,
    response.ready_at ? `built ${dayMonth(localDate(response.ready_at, ctx.timezone))}` : "",
  ].filter(Boolean);
}

/** The rows SEC-06 adds to "Deadline and delivery". */
export function responseRows(row: RequestLike, extras: PrivacyExtras, ctx: Ctx): DlRow[] {
  const rows: DlRow[] = [];
  const legal = approvedLimit(extras.limits, "response");
  if (legal) {
    rows.push({
      term: "Legal time limit",
      value: legal.days ? [`${legal.days} days from receipt`, dayMonthYear(addDays(row.received_on, legal.days)), ...citation(legal)] : ["No number of days stated", ...citation(legal)],
    });
  }
  if (row.kind === "access" || row.kind === "correction") rows.push({ term: "Extension", value: extensionValue(row, extras.limits, ctx) });
  if (row.kind === "access") {
    const latest = latestResponse(extras.responses);
    rows.push({ term: "Package", value: packageValue(latest, ctx) });
    const delivery = extras.delivery;
    if (delivery) {
      rows.push({ term: "Delivered", value: [`Portal download, ${dayMonthYear(localDate(delivery.delivered_at, ctx.timezone))}`, `available until ${dayMonthYear(localDate(delivery.expires_at, ctx.timezone))}`] });
      rows.push({
        term: "Proof",
        value: delivery.download_count
          ? [`Downloaded ${delivery.download_count === 1 ? "once" : `${delivery.download_count} times`}`, `first ${dayMonthYear(localDate(delivery.first_downloaded_at as string, ctx.timezone))}`, `SHA-256 ${shortHash(delivery.sha256)}`]
          : ["Not downloaded yet", `SHA-256 ${shortHash(delivery.sha256)}`],
      });
    } else if (!row.closed_at) {
      rows.push({ term: "Delivery", value: extras.hasPortal ? "Through the portal, after the review" : ["They have no portal login", "deliver another way and close the request"] });
    }
  }
  return rows;
}

/** The buttons SEC-06 adds for staff who work an open request. */
export function responseActions(row: RequestLike, extras: PrivacyExtras, org: string): Action[] {
  if (row.closed_at) return [];
  const actions: Action[] = [];
  const reachable = row.kind === "access" || row.kind === "correction";
  if (reachable && row.identity_verified_at && !row.redaction_at && row.person_id) {
    actions.push({ label: extras.items.length ? "Search again" : "Search their records", attrs: { "data-privacy-scope": row.id, "data-org": org } });
  }
  if (reachable && !row.extended_at) actions.push({ label: "Extend due date", attrs: { "data-dlg": "dlgPExt" } });
  if (row.kind === "access") {
    const latest = latestResponse(extras.responses);
    const ready = extras.responses.find((response) => response.status === "ready") ?? null;
    if (row.redaction_at && latest?.status !== "building") actions.push({ label: ready ? "Build again" : "Build response package", attrs: { "data-privacy-build": row.id, "data-org": org } });
    if (ready) actions.push({ label: "Preview package", attrs: { "data-privacy-preview": ready.id, "data-org": org } });
    if (ready && row.reviewed_at && extras.hasPortal) actions.push({ label: "Deliver through the portal", primary: true, attrs: { "data-dlg": "dlgPDel" } });
  }
  return actions;
}

const DECISION_BADGE: Record<string, StateBadge> = {
  include: { tone: "ok", label: "Included" },
  withhold: { tone: "bad", label: "Withheld" },
  redact: { tone: "chg", label: "Fields withheld" },
};

/** "Records found" for an access or correction request after the scope search. */
export function foundPanel(row: RequestLike, items: ItemRow[], editable: boolean): Worklist | null {
  if ((row.kind !== "access" && row.kind !== "correction") || items.length === 0) return null;
  return {
    icon: "search",
    title: ["Records found", row.reference],
    label: "Records found",
    columns: ["Record", "Kind", "Withheld", "Reason", "Decision"],
    rows: items.map((item) => ({
      cells: [
        { text: item.label },
        { text: SOURCE_LABEL[item.source] ?? item.source },
        { text: item.decision === "withhold" ? "Whole record" : item.withheld_fields.length ? item.withheld_fields.join(", ") : "—" },
        { text: item.reason ?? "—" },
        { badge: DECISION_BADGE[item.decision] ?? { tone: "gr", label: item.decision } },
      ],
      attrs:
        editable && row.kind === "access"
          ? {
              "data-item-edit": item.id,
              "data-fields": item.fields.join(","),
              "data-decision": item.decision,
              "data-withheld": item.withheld_fields.join(","),
              "data-party": item.third_party ?? "",
              "data-reason": item.reason ?? "",
            }
          : undefined,
    })),
  };
}

const LIMIT_BADGE: Record<string, StateBadge> = {
  pending_review: { tone: "chg", label: "Waiting for review" },
  approved: { tone: "ok", label: "Approved" },
  rejected: { tone: "bad", label: "Rejected" },
  retired: { tone: "gr", label: "Retired" },
};

/** The firm's legal time limits, each with its source, dates and review. */
export function limitsPanel(limits: TimeLimitRow[], canReview: boolean, ctx: Ctx): Worklist {
  return {
    icon: "clock",
    title: "Legal time limits",
    label: "Legal time limits",
    columns: ["Provision", "Days", "Source", "Checked", "State"],
    empty: "None entered. Due dates are the firm’s own until a licensed member approves a time limit from an official page.",
    rows: limits.map((limit) => ({
      cells: [
        { text: [limit.kind === "response" ? "Time to respond" : "Extension", `${limit.law_name}, ${limit.source_section}`, `“${limit.provision_text}”`] },
        { text: limit.days ? `${limit.days} days` : "No number stated" },
        { text: [limit.source_url, limit.current_to ? `current to ${dayMonthYear(limit.current_to)}` : "no current-to date"] },
        { text: [dayMonthYear(limit.checked_on), provenance(limit, ctx)] },
        {
          badge:
            limit.status === "approved" && limit.reviewed_by_membership_id
              ? { tone: "ok", label: "Approved", detail: ctx.memberName(limit.reviewed_by_membership_id) }
              : (LIMIT_BADGE[limit.status] ?? { tone: "gr", label: limit.status }),
        },
      ],
      attrs:
        canReview && (limit.status === "pending_review" || limit.status === "approved")
          ? { "data-limit-review": limit.id, "data-version": String(limit.version), "data-status": limit.status, "data-captured": limit.snapshot_sha256 ? "1" : "0" }
          : undefined,
    })),
  };
}

export type ResponseDialogsData = {
  extend: null | { requestId: string; reference: string; bases: (readonly [string, string])[]; hasPortal: boolean };
  item: null | { requestId: string; reference: string };
  deliver: null | { requestId: string; responseId: string; reference: string; withheld: number };
  limit: null | { today: string; captured: (readonly [string, string])[] };
  limitReview: boolean;
};

export function responseDialogs(input: {
  row: RequestLike | null;
  working: boolean;
  extras: PrivacyExtras;
  canRecord: boolean;
  today: string;
  captured: (readonly [string, string])[];
}): ResponseDialogsData {
  const { row, extras } = input;
  const open = row && input.working && !row.closed_at ? row : null;
  const reachable = open && (open.kind === "access" || open.kind === "correction") ? open : null;
  const ready = extras.responses.find((response) => response.status === "ready") ?? null;
  return {
    extend:
      reachable && !reachable.extended_at
        ? {
            requestId: reachable.id,
            reference: reachable.reference,
            bases: [
              ["firm", "Set by the firm"],
              ...extras.limits
                .filter((limit) => limit.status === "approved" && limit.kind === "extension")
                .map((limit) => [limit.id, `${limit.law_name}, ${limit.source_section}${limit.days ? ` (up to ${limit.days} days)` : ""}`] as const),
            ],
            hasPortal: extras.hasPortal,
          }
        : null,
    item: open && open.kind === "access" && open.scope_at && !open.redaction_at ? { requestId: open.id, reference: open.reference } : null,
    deliver: open && open.kind === "access" && open.reviewed_at && ready && extras.hasPortal ? { requestId: open.id, responseId: ready.id, reference: open.reference, withheld: ready.withheld_count ?? 0 } : null,
    limit: input.canRecord ? { today: input.today, captured: input.captured } : null,
    limitReview: extras.canReview,
  };
}

export { ITEM_DECISIONS };
