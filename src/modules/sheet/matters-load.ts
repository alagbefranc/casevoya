import "server-only";
import type {
  MatterRow,
  MattersData,
} from "@/components/sheet/designer/matters";
import { createClient } from "@/lib/supabase/server";
import { isLicensedMembership, LICENCE_FACT_COLUMNS } from "@/lib/tenant/roles";
import { staffPerson } from "@/modules/sheet/avatar";
import {
  loadSheetChrome,
  matterNames,
  memberNames,
} from "@/modules/sheet/chrome-load";
import { isoDate, localNow } from "@/modules/sheet/home-present";
import { dayMonthYear } from "@/modules/sheet/matter-present";
import { moneyCell } from "@/modules/sheet/matter-billing";
import { todayIso } from "@/modules/sheet/birth-date";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  governmentBadge,
  MATTERS_PAGE,
  MATTERS_READ,
  pageLimit,
  programLabel,
} from "@/modules/sheet/matters-present";
import {
  consultantOptions,
  programChoices,
  programOptions,
  type NewMatterDialogData,
} from "@/modules/sheet/new-matter";
import {
  MATTER_STAGES,
  matterMatches,
  mattersTitle,
  plusDays,
  stageLabel,
  type SheetQuery,
} from "@/modules/sheet/present";

/** The Designer's Matters list for a firm, read as the signed-in staff member. */
export async function loadSheetMatters(
  staff: SheetStaff,
  query: SheetQuery,
  now: Date = new Date(),
) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const limit = pageLimit(query.limit);

  const [
    chrome,
    matters,
    deadlines,
    pending,
    newMatter,
    dueTasks,
    mineParties,
  ] = await Promise.all([
    loadSheetChrome(staff, "/sheet/matters"),
    supabase
      .from("matters")
      .select(
        "id, title, reference, stage, government_status, on_hold, program_pack_id, responsible_consultant_membership_id",
      )
      .eq("organization_id", org)
      .order("updated_at", { ascending: false })
      .limit(MATTERS_READ),
    supabase
      .from("deadlines")
      .select("matter_id, due_on")
      .eq("organization_id", org)
      .gte("due_on", today)
      .order("due_on", { ascending: true })
      .limit(MATTERS_READ),
    supabase
      .from("document_versions")
      .select("document_id")
      .eq("organization_id", org)
      .eq("upload_state", "clean")
      .eq("review_state", "pending")
      .is("superseded_at", null)
      .limit(MATTERS_READ),
    loadNewMatterDialog(supabase, staff),
    // Due this week counts open tasks due in the next 7 days as well as deadlines.
    supabase
      .from("tasks")
      .select("matter_id, due_on")
      .eq("organization_id", org)
      .in("status", ["open", "blocked"])
      .gte("due_on", today)
      .lte("due_on", plusDays(today, 7))
      .not("matter_id", "is", null)
      .limit(MATTERS_READ),
    // "Awaiting my review": the matters this member is on (responsible, or on the matter's team).
    supabase.from("matter_participants").select("matter_id").eq("organization_id", org).eq("membership_id", staff.membershipId).limit(MATTERS_READ),
  ]);
  const rows = matters.data ?? [];

  const nextDue = new Map<string, string>();
  for (const row of deadlines.data ?? []) {
    if (row.due_on && !nextDue.has(row.matter_id))
      nextDue.set(row.matter_id, row.due_on);
  }
  // The matters of the documents waiting for review. Read for those documents only: a capped
  // read of every reference in the firm missed them once a firm had more than 500 documents.
  const pendingDocuments = [...new Set((pending.data ?? []).map((row) => row.document_id))];
  const refChunks = await Promise.all(
    Array.from({ length: Math.ceil(pendingDocuments.length / 100) }, (_, index) =>
      supabase
        .from("document_matter_refs")
        .select("matter_id")
        .eq("organization_id", org)
        .is("removed_at", null)
        .in("document_id", pendingDocuments.slice(index * 100, index * 100 + 100)),
    ),
  );
  const reviewMatters = new Set(refChunks.flatMap((chunk) => (chunk.data ?? []).map((row) => row.matter_id)));
  const taskDue = new Map<string, string>();
  for (const row of dueTasks.data ?? []) {
    if (!row.matter_id || !row.due_on) continue;
    const known = taskDue.get(row.matter_id);
    if (!known || row.due_on < known) taskDue.set(row.matter_id, row.due_on);
  }
  const onMatter = new Set((mineParties.data ?? []).map((row) => row.matter_id));
  const isMine = (row: (typeof rows)[number]) => row.responsible_consultant_membership_id === staff.membershipId || onMatter.has(row.id);

  const matched = rows.filter((row) =>
    matterMatches(
      {
        onHold: row.on_hold,
        stage: row.stage,
        nextDue: nextDue.get(row.id) ?? null,
        nextTaskDue: taskDue.get(row.id) ?? null,
        pendingReview: reviewMatters.has(row.id),
        mine: isMine(row),
        title: row.title,
        reference: row.reference,
      },
      query.view,
      undefined,
      today,
    ),
  );
  // REP-01: `?stage=` (a Reports stage-ageing row or readiness card) narrows the list to one stage.
  const stage = (MATTER_STAGES as readonly string[]).includes(query.stage ?? "") ? (query.stage as string) : null;
  const visible = stage ? matched.filter((row) => row.stage === stage) : matched;
  const page = visible.slice(0, limit);

  const packIds = [
    ...new Set(
      page
        .map((row) => row.program_pack_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const pageIds = page.map((row) => row.id);
  const [name, members, packs, invoices, entries] = await Promise.all([
    matterNames(
      supabase,
      org,
      page.map((row) => row.id),
    ),
    memberNames(supabase, org),
    packIds.length
      ? supabase
          .from("rule_pack_versions")
          .select("id, program_key")
          .in("id", packIds)
      : null,
    // The Money column: what is owed on the matter's invoices and what client funds it holds,
    // as row-level security shows them (the firm owner and the matter's finance user).
    pageIds.length
      ? supabase.from("invoices").select("matter_id, amount_cents, paid_cents, credited_cents, status, currency").eq("organization_id", org).in("matter_id", pageIds).limit(MATTERS_READ * 4)
      : null,
    pageIds.length
      ? supabase.from("client_fund_entries").select("matter_id, kind, status, direction, amount_cents").eq("organization_id", org).in("matter_id", pageIds).limit(MATTERS_READ * 8)
      : null,
  ]);
  const program = new Map(
    (packs?.data ?? []).map((row) => [row.id, row.program_key]),
  );

  const tableRows: MatterRow[] = page.map((row) => {
    const consultant = row.responsible_consultant_membership_id
      ? members.get(row.responsible_consultant_membership_id)
      : undefined;
    const due = nextDue.get(row.id);
    return {
      href: `/sheet/matters/${row.id}`,
      mine: row.responsible_consultant_membership_id === staff.membershipId,
      client: { name: name(row.id) },
      reference: row.reference ?? "—",
      program: programLabel(
        row.program_pack_id ? program.get(row.program_pack_id) : null,
      ),
      stage: { tone: "blue", label: stageLabel(row.stage) },
      government: governmentBadge(row.government_status),
      money: moneyCell(
        (invoices?.data ?? []).filter((invoice) => invoice.matter_id === row.id),
        (entries?.data ?? []).filter((entry) => entry.matter_id === row.id),
      ),
      nextDeadline: due ? dayMonthYear(due, today) : "—",
      consultant: consultant ? staffPerson(consultant) : null,
    };
  });

  const active = rows.filter((row) => row.stage !== "closed");
  const viewTitle = stage ? stageLabel(stage) : mattersTitle(query.view);
  const data: MattersData = {
    title: viewTitle,
    counts: {
      active: active.length,
      blocked: rows.filter((row) => row.on_hold).length,
      mine: rows.filter(
        (row) =>
          row.responsible_consultant_membership_id === staff.membershipId,
      ).length,
      everyone: rows.length,
    },
    rows: tableRows,
    shown: tableRows.length,
    total: visible.length,
    more:
      visible.length > limit
        ? `?${new URLSearchParams({ ...(query.view ? { view: query.view } : {}), ...(stage ? { stage } : {}), limit: String(limit + MATTERS_PAGE) })}`
        : null,
    empty: matters.error
      ? { kind: "error" }
      : rows.length === 0
        ? { kind: "none" }
        : visible.length === 0
          ? {
              kind: "filtered",
              title: "No matches for these filters",
              copy: `Nothing is in ${viewTitle.toLowerCase()} right now. Clear the view to see every matter.`,
              clear: "/sheet/matters",
            }
          : null,
    live: {
      view: query.view === "due" || query.view === "review" || query.view === "blocked" ? query.view : null,
      chips: "Office, program and priority filters aren’t available yet. Search by client or reference instead.",
    },
  };
  return { chrome, matters: data, newMatter };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The New matter dialog's options: who can be responsible, and which program templates are
 * published. A firm owner always counts, like a licensed consultant (isLicensedMembership, like the
 * database; decision 2026-10-19). Matters and Clients both open this dialog.
 */
export async function loadNewMatterDialog(supabase: Client, staff: SheetStaff): Promise<NewMatterDialogData> {
  const org = staff.organizationId;
  const [consultants, credentials, published, members, catalogue] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, role")
      .eq("organization_id", org)
      .eq("status", "active")
      .in("role", ["licensed_consultant", "firm_owner"])
      .order("created_at"),
    supabase
      .from("consultant_credentials")
      .select(`membership_id, ${LICENCE_FACT_COLUMNS}`)
      .eq("organization_id", org),
    supabase
      .from("rule_pack_versions")
      .select("id, program_key, pack_version, status")
      .in("status", ["published", "review_due"])
      .limit(100),
    memberNames(supabase, org),
    // SRC-12: the support catalogue's programs, supported or not, as this firm's staff see it.
    supabase.rpc("support_catalogue", { p_org: org }),
  ]);
  const catalogueJson = !catalogue.error && catalogue.data && typeof catalogue.data === "object" && !Array.isArray(catalogue.data) ? (catalogue.data as { programs?: unknown }) : null;
  const choices = catalogueJson ? programChoices(catalogueJson.programs) : null;
  const credentialRows = credentials.data ?? [];
  const credentialStatus = new Map(
    credentialRows.map((row) => [row.membership_id, row.status as string]),
  );
  const credentialFacts = new Map(
    credentialRows.map((row) => [row.membership_id, row]),
  );
  return {
    organizationId: org,
    consultants: consultantOptions(
      (consultants.data ?? [])
        .filter((row) =>
          isLicensedMembership(row.role, credentialFacts.get(row.id)),
        )
        .map((row) => ({
          id: row.id,
          name: members.get(row.id) ?? "Unassigned",
          role: row.role,
        })),
      credentialStatus,
    ),
    programs: programOptions(published.data ?? []),
    ...(choices ? { programChoices: choices.options, programDefault: choices.defaultValue } : {}),
    sampleMode: staff.sampleMode,
    maxBirthDate: todayIso(),
  };
}
