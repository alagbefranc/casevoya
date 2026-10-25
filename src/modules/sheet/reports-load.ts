import "server-only";
import type { ReportBar, ReportRange, ReportsData, ReportsMoney, ReportsOps, ReportsOutcomes, ReportsTab } from "@/components/sheet/designer/reports";
import { createClient } from "@/lib/supabase/server";
import { formatAmount, formatMoney } from "@/modules/finance/money";
import { ledgerTotals, type FundEntry } from "@/modules/finance/client-funds-present";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import { isoDate, localNow } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { MATTER_STAGES, STAFF_ROLES, isoDateInTimeZone, stageLabel, type SheetQuery } from "@/modules/sheet/present";
import { REPORT_LINKS, requestBars, stageHref } from "@/modules/sheet/reports-ops-more";
import { loadOpenRequests, loadOpsMore, sampleMatterIds } from "@/modules/sheet/reports-ops-more-load";
import { loadOutcomeSegments } from "@/modules/sheet/reports-outcomes-load";
import { NO_PROGRAM, programFilter, programName } from "@/modules/sheet/reports-outcomes";
import {
  DEFINITIONS,
  MONEY_ROLES,
  OPS_ROLES,
  RANGE_LABEL,
  freshness,
  leadFunnel,
  localMidnightIso,
  monthLabel,
  monthsBetween,
  rangeLabel,
  rangeStart,
  receivablesAgeing,
  reportRange,
  reportsTab,
  stageAgeing,
  workload,
} from "@/modules/sheet/reports-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Rows read per source. A firm past this sees a note on the page and in exports. */
export const REPORT_READ = 1000;

export type ReportContext = {
  supabase: Client;
  staff: SheetStaff;
  today: string;
  from: string;
  /** The period's first instant: midnight of `from` in the firm's timezone. */
  fromIso: string;
  nowIso: string;
  /** Leave sample records out unless the firm is exploring in sample mode. */
  live: boolean;
  /** Processing and outcomes: one program (a key, or "none"), or every program. */
  program?: string | null;
};

const DENIED = {
  ops: { title: "You don’t have permission to see operations reports", copy: "Your role doesn’t include this. Ask your firm owner if you need access." },
  money: { title: "You don’t have permission to see money reports", copy: "Money reports are for the firm owner and finance staff. Ask your firm owner if you need access." },
  outcomes: { title: "You don’t have permission to see processing reports", copy: "Your role doesn’t include this. Ask your firm owner if you need access." },
};

export function canSeeTab(role: string, tab: ReportsTab): boolean {
  if (tab === "money") return MONEY_ROLES.has(role);
  if (tab === "scheduled") return true;
  return OPS_ROLES.has(role);
}

/** Whether any source hit the read cap, so the page can say its figures are partial. */
type Capped = { capped: boolean };
function rows<T>(result: { data: T[] | null } | null, cap: Capped): T[] {
  const list = result?.data ?? [];
  if (list.length >= REPORT_READ) cap.capped = true;
  return list;
}

export async function loadOps(ctx: ReportContext, cap: Capped): Promise<ReportsOps> {
  const { supabase, staff, today, fromIso, nowIso, live } = ctx;
  const org = staff.organizationId;
  let mattersQuery = supabase
    .from("matters")
    .select("id, stage, created_at, responsible_consultant_membership_id, is_sample")
    .eq("organization_id", org)
    .neq("stage", "closed")
    .limit(REPORT_READ);
  if (live) mattersQuery = mattersQuery.eq("is_sample", false);
  let bookingsQuery = supabase
    .from("bookings")
    .select("id, status, matter_id")
    .eq("organization_id", org)
    .gte("starts_at", fromIso)
    .lte("starts_at", nowIso)
    .limit(REPORT_READ);
  if (live) bookingsQuery = bookingsQuery.eq("is_sample", false);

  const [matters, bookings, tasks, members, staffRows, sample] = await Promise.all([
    mattersQuery,
    bookingsQuery,
    supabase
      .from("tasks")
      .select("owner_membership_id, matter_id, due_on, due_at, status")
      .eq("organization_id", org)
      .eq("audience", "internal")
      .in("status", ["open", "blocked"])
      .limit(REPORT_READ),
    memberNames(supabase, org),
    supabase.from("memberships").select("id, role").eq("organization_id", org).eq("status", "active").in("role", [...STAFF_ROLES]),
    sampleMatterIds(supabase, org, live),
  ]);
  const notSample = (matterId: string | null) => !matterId || !sample.has(matterId);
  const openMatters = rows(matters, cap);
  const bookingRows = rows(bookings, cap);
  const taskRows = rows(tasks, cap).filter((row) => notSample(row.matter_id));

  // When each open matter entered its current stage.
  const matterIds = openMatters.map((row) => row.id);
  const bookingIds = bookingRows.map((row) => row.id);
  const linked = [...new Set(bookingRows.map((row) => row.matter_id).filter((id): id is string => Boolean(id)))];
  // REP-01: the open requests (the same rows as the Documents page's requests list) and the added cards.
  const [transitions, events, engagedRows, requests, more] = await Promise.all([
    matterIds.length
      ? supabase.from("matter_stage_transitions").select("matter_id, to_stage, created_at").eq("organization_id", org).in("matter_id", matterIds).order("created_at", { ascending: false }).limit(REPORT_READ)
      : null,
    bookingIds.length ? supabase.from("booking_events").select("booking_id").eq("organization_id", org).eq("kind", "rescheduled").in("booking_id", bookingIds).limit(REPORT_READ) : null,
    linked.length ? supabase.from("matters").select("id").eq("organization_id", org).eq("engagement_status", "engaged").in("id", linked) : null,
    loadOpenRequests(supabase, org, today, sample, cap),
    loadOpsMore(ctx, cap, sample),
  ]);

  const since = new Map<string, string>();
  const stageOf = new Map(openMatters.map((row) => [row.id, row.stage]));
  for (const row of rows(transitions, cap)) {
    if (since.has(row.matter_id) || stageOf.get(row.matter_id) !== row.to_stage) continue;
    since.set(row.matter_id, row.created_at);
  }

  const funnel = leadFunnel(
    bookingRows.map((row) => ({ id: row.id, status: row.status, matterId: row.matter_id })),
    new Set((events?.data ?? []).map((row) => row.booking_id)),
    new Set((engagedRows?.data ?? []).map((row) => row.id)),
  );

  const staffList = (staffRows.data ?? []).map((row) => ({ id: row.id, name: members.get(row.id) || "Unassigned" }));
  const documentBars: ReportBar[] = requestBars(requests);
  const stageKey = new Map(MATTER_STAGES.map((stage) => [stageLabel(stage), stage]));

  return {
    leads: { bars: funnel.bars, note: funnel.note, definition: DEFINITIONS.leads, link: REPORT_LINKS.leads },
    ageing: {
      rows: stageAgeing(
        openMatters.map((row) => ({ id: row.id, stage: row.stage, createdAt: row.created_at, stageSince: since.get(row.id) ?? null })),
        MATTER_STAGES,
        nowIso,
      ).map((row) => ({ ...row, href: stageHref(stageKey.get(row.stage) ?? "") })),
      definition: DEFINITIONS.ageing,
      link: REPORT_LINKS.ageing,
    },
    workload: {
      rows: workload(
        staffList,
        taskRows.map((row) => ({ ownerMembershipId: row.owner_membership_id, matterId: row.matter_id, dueOn: row.due_on, dueAt: row.due_at, status: row.status })),
        openMatters.map((row) => ({ id: row.id, consultantMembershipId: row.responsible_consultant_membership_id })),
        today,
        new Date(nowIso),
      ),
      definition: DEFINITIONS.workload,
      link: REPORT_LINKS.workload,
    },
    documents: { bars: documentBars, definition: DEFINITIONS.documents, link: REPORT_LINKS.documents },
    attendance: {
      ...funnel.attendance,
      cancelled: bookingRows.filter((row) => row.status === "cancelled").length,
      definition: `${DEFINITIONS.attendance} Cancelled: cancelled after booking.`,
      link: REPORT_LINKS.attendance,
    },
    more: {
      ...more,
      links: { overdue: REPORT_LINKS.overdue, intake: REPORT_LINKS.intake, readiness: REPORT_LINKS.readiness, renewals: REPORT_LINKS.renewals },
    },
  };
}

export async function loadMoney(ctx: ReportContext, cap: Capped): Promise<ReportsMoney> {
  const { supabase, staff, today, from, fromIso, live } = ctx;
  const org = staff.organizationId;
  const sampleFilter = <Q extends { eq: (column: string, value: boolean) => Q }>(query: Q) => (live ? query.eq("is_sample", false) : query);

  const [openInvoices, issued, payments, transfers, entries, ledgers, recons] = await Promise.all([
    sampleFilter(
      supabase.from("invoices").select("status, currency, amount_cents, paid_cents, credited_cents, due_on, issued_on").eq("organization_id", org).in("status", ["issued", "partially_paid"]).limit(REPORT_READ),
    ),
    sampleFilter(
      supabase
        .from("invoices")
        .select("amount_cents, currency, issued_on, status")
        .eq("organization_id", org)
        .gte("issued_on", from)
        .lte("issued_on", today)
        .not("status", "in", "(draft,voided)")
        .limit(REPORT_READ),
    ),
    supabase
      .from("invoice_payments")
      .select("amount_received_cents, currency, succeeded_at, invoice_id")
      .eq("organization_id", org)
      .eq("status", "succeeded")
      .gte("succeeded_at", fromIso)
      .limit(REPORT_READ),
    sampleFilter(
      supabase
        .from("client_fund_entries")
        .select("amount_cents, currency, approved_at")
        .eq("organization_id", org)
        .eq("kind", "transfer")
        .eq("status", "approved")
        .gte("approved_at", fromIso)
        .limit(REPORT_READ),
    ),
    sampleFilter(supabase.from("client_fund_entries").select("ledger_id, kind, status, direction, amount_cents").eq("organization_id", org).limit(REPORT_READ)),
    sampleFilter(supabase.from("client_fund_ledgers").select("id, person_id").eq("organization_id", org).limit(REPORT_READ)),
    sampleFilter(
      supabase
        .from("client_account_reconciliations")
        .select("status, statement_date, difference_cents, currency")
        .eq("organization_id", org)
        .in("status", ["exceptions", "pending_review"])
        .order("statement_date", { ascending: false })
        .limit(50),
    ),
  ]);

  const buckets = receivablesAgeing(
    rows(openInvoices, cap).map((row) => ({
      status: row.status,
      currency: row.currency,
      amountCents: row.amount_cents,
      paidCents: row.paid_cents,
      creditedCents: row.credited_cents,
      dueOn: row.due_on,
      issuedOn: row.issued_on,
    })),
    today,
  );

  // Payments of sample invoices are left out with their invoice.
  const paymentRows = rows(payments, cap);
  const sampleInvoices =
    live && paymentRows.length
      ? await supabase.from("invoices").select("id").eq("organization_id", org).eq("is_sample", true).in("id", [...new Set(paymentRows.map((row) => row.invoice_id))])
      : null;
  const sampleInvoice = new Set((sampleInvoices?.data ?? []).map((row) => row.id));
  const localMonth = (iso: string) => isoDateInTimeZone(new Date(iso), staff.timezone).slice(0, 7);
  const months = monthsBetween(from, today).map((month) => {
    const invoiced = rows(issued, cap)
      .filter((row) => row.currency.toUpperCase() === "CAD" && row.issued_on?.slice(0, 7) === month)
      .reduce((sum, row) => sum + row.amount_cents, 0);
    const card = paymentRows
      .filter((row) => row.currency.toUpperCase() === "CAD" && row.succeeded_at && !sampleInvoice.has(row.invoice_id) && localMonth(row.succeeded_at) === month)
      .reduce((sum, row) => sum + row.amount_received_cents, 0);
    const funds = rows(transfers, cap)
      .filter((row) => row.currency.toUpperCase() === "CAD" && row.approved_at && localMonth(row.approved_at) === month)
      .reduce((sum, row) => sum + row.amount_cents, 0);
    return { month: monthLabel(month, today, from), invoiced: formatAmount(invoiced, "CAD"), collected: formatAmount(card + funds, "CAD") };
  });

  // Client-account balances, per client across their ledgers.
  const ledgerRows = rows(ledgers, cap);
  const personOfLedger = new Map(ledgerRows.map((row) => [row.id, row.person_id]));
  const byPerson = new Map<string, Pick<FundEntry, "kind" | "status" | "direction" | "amountCents">[]>();
  for (const row of rows(entries, cap)) {
    const person = personOfLedger.get(row.ledger_id);
    if (!person) continue;
    byPerson.set(person, [...(byPerson.get(person) ?? []), { kind: row.kind, status: row.status, direction: row.direction === "in" ? "in" : "out", amountCents: row.amount_cents }]);
  }
  const personIds = [...byPerson.keys()];
  const people = personIds.length ? await supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null;
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const balances = personIds
    .map((id) => {
      const totals = ledgerTotals(byPerson.get(id) ?? []);
      return {
        client: personName.get(id) ?? "Client",
        held: formatAmount(totals.balanceCents, "CAD"),
        pending: totals.pendingInCents ? formatAmount(totals.pendingInCents, "CAD") : "—",
      };
    })
    .sort((a, b) => a.client.localeCompare(b.client));

  const reconRows = recons.data ?? [];
  const exceptions = reconRows.filter((row) => row.status === "exceptions");
  const waiting = reconRows.filter((row) => row.status === "pending_review");
  const parts: string[] = [];
  if (exceptions.length) {
    const first = exceptions[0];
    parts.push(
      `${exceptions.length} open: the reconciliation for ${first.statement_date} differs by ${formatMoney(Math.abs(first.difference_cents), first.currency)}${exceptions.length > 1 ? `, and ${exceptions.length - 1} more` : ""}.`,
    );
  }
  if (waiting.length) parts.push(`${waiting.length} ${waiting.length === 1 ? "reconciliation is" : "reconciliations are"} waiting for review.`);
  const text = parts.length ? parts.join(" ") : "No open exceptions.";

  return {
    sync: null,
    ageing: {
      rows: buckets.map((bucket) => ({ age: bucket.age, invoices: bucket.invoices, amount: formatAmount(bucket.cents, "CAD") })),
      total: {
        invoices: buckets.reduce((sum, bucket) => sum + bucket.invoices, 0),
        amount: formatAmount(buckets.reduce((sum, bucket) => sum + bucket.cents, 0), "CAD"),
      },
      definition: DEFINITIONS.receivables,
      link: REPORT_LINKS.receivables,
    },
    months: { rows: months, definition: DEFINITIONS.months, link: REPORT_LINKS.months },
    balances: { rows: balances, definition: DEFINITIONS.balances, link: REPORT_LINKS.balances },
    recon: { text, href: "/sheet/finance?tab=recon", definition: DEFINITIONS.recon },
  };
}

export async function loadOutcomes(ctx: ReportContext, cap: Capped): Promise<ReportsOutcomes> {
  return loadOutcomeSegments({
    supabase: ctx.supabase,
    organizationId: ctx.staff.organizationId,
    timeZone: ctx.staff.timezone,
    live: ctx.live,
    program: ctx.program ?? null,
    limit: REPORT_READ,
    cap,
  });
}

function stamp(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

const SOURCES: Record<ReportsTab, string> = {
  ops: "matters, stage history, tasks, document requests, bookings, intake requests and recorded renewals",
  money: "invoices, card payments, client-account ledgers and reconciliations",
  outcomes: "matters, stage history, recorded outcomes and licensed-approved IRCC estimates",
  scheduled: "scheduled report settings",
};

/** Everything one tab shows, as the signed-in staff member reads it (RLS decides the rows). */
export async function loadReportTab(staff: SheetStaff, tab: ReportsTab, range: ReportRange, now: Date = new Date(), options: { program?: string | null } = {}) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const from = rangeStart(range, today);
  const ctx: ReportContext = { supabase, staff, today, from, fromIso: localMidnightIso(from, staff.timezone), nowIso: now.toISOString(), live: !staff.sampleMode, program: tab === "outcomes" ? programFilter(options.program) : null };
  const cap: Capped = { capped: false };
  const allowed = canSeeTab(staff.role, tab);
  const [ops, money, outcomes] = await Promise.all([
    tab === "ops" && allowed ? loadOps(ctx, cap) : null,
    tab === "money" && allowed ? loadMoney(ctx, cap) : null,
    tab === "outcomes" && allowed ? loadOutcomes(ctx, cap) : null,
  ]);
  const scope = staff.role === "firm_owner" ? "All offices" : "Matters you can see";
  const stamped = stamp(now, staff.timezone);
  return {
    today,
    from,
    stamped,
    scope,
    allowed,
    capped: cap.capped,
    ops,
    money,
    outcomes,
    freshness: allowed
      ? `${freshness(stamped, staff.timezone, SOURCES[tab])}${cap.capped ? ` Some sources passed ${REPORT_READ.toLocaleString("en-CA")} rows, so these figures are partial.` : ""}${staff.sampleMode ? " Sample records are included while sample mode is on." : ""}`
      : null,
  };
}

/** The Designer's Reports page for a firm. */
export async function loadSheetReports(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const tab = reportsTab(query.tab);
  const range = reportRange(query.view);
  const program = tab === "outcomes" ? programFilter(query.program) : null;
  const [chrome, loaded] = await Promise.all([loadSheetChrome(staff, "/sheet/reports"), loadReportTab(staff, tab, range, now, { program })]);
  const nav = (key: ReportRange) => `/sheet/reports?tab=${tab}&view=${key}`;
  const exportHref = `/api/reports/export?tab=${tab}&range=${range}${program ? `&program=${encodeURIComponent(program)}` : ""}`;
  // Export can't run on Scheduled (there is nothing scheduled to export) or on a tab the role
  // can't see: the dialog says why instead of offering a dead button.
  const exportBlocked = !loaded.allowed
    ? "Your role can’t see this report, so there is nothing to export from it."
    : tab === "scheduled"
      ? "Scheduled reports aren’t set up yet, so there is nothing to export here. Export from Operations, Money or Processing and outcomes."
      : null;
  const reports: ReportsData = {
    tab,
    range,
    pills: [rangeLabel(loaded.from, loaded.today), loaded.scope],
    pillTitles: [
      `The period, in the firm’s timezone (${staff.timezone}), from midnight on its first day.`,
      staff.role === "firm_owner" ? "Every office is included. Reports can’t be narrowed to one office yet." : "Only the matters your role can open are counted.",
    ],
    rangeNav: { "90d": nav("90d"), month: nav("month"), year: nav("year") },
    ops: loaded.ops,
    money: loaded.money,
    outcomes: loaded.outcomes
      ? { ...loaded.outcomes, intro: "Descriptive history only. These numbers describe past files; they aren’t anyone’s chance of success." }
      : null,
    scheduled: { rows: [] },
    denied: loaded.allowed ? null : DENIED[tab as keyof typeof DENIED] ?? null,
    freshness: loaded.freshness,
    dialog: {
      filters:
        tab === "outcomes"
          ? [program ? programName(program === NO_PROGRAM ? null : program) : "All programs, by quarter submitted", loaded.scope.toLowerCase(), "all owners"]
          : [RANGE_LABEL[range], loaded.scope.toLowerCase(), "all owners"],
      timezone: staff.timezone,
      currency: "CAD",
      note: exportBlocked ?? "The file downloads to this device. Its first lines record the filters, when it was made, who made it and who can see this report.",
      toastSub: "Downloaded to this device.",
      // Nothing to export from a tab the role can't see, or from Scheduled (no schedules yet).
      wire: exportBlocked ? { href: "", disabled: true, reason: exportBlocked } : { href: exportHref },

    },
  };
  return { chrome, reports };
}
