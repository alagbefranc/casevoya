import "server-only";
import type { AiTab } from "@/components/sheet/designer/ai";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome, matterNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { voAgentConfigured } from "@/modules/vo/agent-client";
import { loadVoReadings } from "@/modules/sheet/vo-doc-load";
import {
  aiPage,
  draftsHeader,
  draftsPage,
  effectiveSettings,
  type ApprovedSourceRow,
  type VoDraftRow,
  type VoNames,
  type VoRunRow,
  type VoSource,
  type VoViewer,
  voDraftsWaiting,
} from "@/modules/sheet/vo-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const DRAFT_COLUMNS = "id, run_id, kind, title, body, sources, matter_id, thread_id, status, edited, needs_rule, is_sample, created_at, reviewed_at, reviewed_by";

function sources(value: unknown): VoSource[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ kind: String(item.kind ?? ""), id: String(item.id ?? ""), label: String(item.label ?? "") }))
        .filter((item) => item.label)
    : [];
}

type DraftDb = {
  id: string;
  run_id: string;
  kind: "message_reply" | "document_request";
  title: string;
  body: string;
  sources: unknown;
  matter_id: string;
  thread_id: string;
  status: "draft" | "sent" | "discarded";
  edited: boolean | null;
  needs_rule: boolean;
  is_sample: boolean;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

function draftRow(row: DraftDb, latency: Map<string, number | null>): VoDraftRow {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    sources: sources(row.sources),
    matterId: row.matter_id,
    threadId: row.thread_id,
    status: row.status,
    edited: row.edited,
    needsRule: row.needs_rule,
    isSample: row.is_sample,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    latencyMs: latency.get(row.run_id) ?? null,
  };
}

type RunDb = {
  id: string;
  kind: "message_reply" | "document_request" | "ask" | "document_review";
  version_id?: string | null;
  result: "running" | "drafted" | "answered" | "abstained" | "failed";
  matter_id: string;
  thread_id: string | null;
  user_id: string;
  model: string | null;
  prompt_version: string | null;
  source_count: number | null;
  tools_called: string[];
  cost_usd: number | null;
  failure: string | null;
  useful: boolean | null;
  created_at: string;
  latency_ms: number | null;
};

const RUN_COLUMNS = "id, kind, result, matter_id, thread_id, version_id, user_id, model, prompt_version, source_count, tools_called, cost_usd, failure, useful, created_at, latency_ms";

function runRow(row: RunDb, drafts: Map<string, NonNullable<VoRunRow["draft"]>>): VoRunRow {
  return {
    id: row.id,
    kind: row.kind,
    result: row.result,
    matterId: row.matter_id,
    threadId: row.thread_id,
    userId: row.user_id,
    model: row.model,
    promptVersion: row.prompt_version,
    sourceCount: row.source_count,
    tools: row.tools_called ?? [],
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    failure: row.failure,
    useful: row.useful,
    createdAt: row.created_at,
    draft: drafts.get(row.id) ?? null,
    versionId: row.version_id ?? null,
  };
}

/** Names for matters (applicant, reference) and people (staff display names by user id). */
async function names(supabase: Client, org: string, matterIds: string[], userIds: string[]): Promise<VoNames> {
  const ids = [...new Set(matterIds)];
  const users = [...new Set(userIds.filter(Boolean))];
  const [matterName, refs, profiles] = await Promise.all([
    matterNames(supabase, org, ids),
    ids.length ? supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", ids) : null,
    users.length ? supabase.from("profiles").select("id, display_name").in("id", users) : null,
  ]);
  const reference = new Map((refs?.data ?? []).map((row) => [row.id, row.reference || row.title]));
  const person = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  return {
    matter: (id) => matterName(id),
    reference: (id) => reference.get(id) ?? "—",
    person: (id) => (id ? person.get(id) || "A staff member" : "—"),
  };
}

async function viewerAndSettings(supabase: Client, staff: SheetStaff) {
  const { data } = await supabase.from("vo_settings").select("*").eq("organization_id", staff.organizationId).maybeSingle();
  const viewer: VoViewer = {
    organizationId: staff.organizationId,
    firmName: staff.organizationName,
    isOwner: staff.role === "firm_owner",
    sampleMode: staff.sampleMode,
    agentReady: voAgentConfigured(),
    timeZone: staff.timezone,
  };
  return { viewer, settings: effectiveSettings(data ?? null, staff.sampleMode) };
}

/** Matters the signed-in staff member can read, for Ask Vo's matter choice (open ones first). */
async function askMatters(supabase: Client, org: string) {
  const { data } = await supabase.from("matters").select("id, title, reference, stage").eq("organization_id", org).neq("stage", "closed").order("updated_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const name = await matterNames(supabase, org, rows.map((row) => row.id));
  return rows.map((row) => ({ id: row.id, label: `${name(row.id)}${row.reference ? ` · ${row.reference}` : ""}` }));
}

/** The Designer's Vo drafts page, read as the signed-in staff member (RLS). */
export async function loadSheetDrafts(staff: SheetStaff) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: claims } = await supabase.auth.getClaims();
  const me = String(claims?.claims?.sub ?? "");
  const [chrome, base, waiting, week, running, abstained, matters, readings] = await Promise.all([
    loadSheetChrome(staff, "/sheet/drafts"),
    viewerAndSettings(supabase, staff),
    supabase.from("vo_drafts").select(DRAFT_COLUMNS).eq("organization_id", org).eq("status", "draft").order("created_at", { ascending: false }).limit(30),
    supabase.from("vo_drafts").select(DRAFT_COLUMNS).eq("organization_id", org).gte("created_at", weekAgo).limit(500),
    supabase
      .from("vo_runs")
      .select(RUN_COLUMNS)
      .eq("organization_id", org)
      .eq("user_id", me)
      .eq("result", "running")
      .gte("created_at", new Date(Date.now() - 2 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("vo_runs").select(RUN_COLUMNS).eq("organization_id", org).eq("result", "abstained").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(1),
    askMatters(supabase, org),
    // Vo document readings waiting for review (vo_doc_drafts).
    loadVoReadings(supabase, org).catch(() => []),
  ]);
  const waitingRows = (waiting.data ?? []) as DraftDb[];
  const runIds = waitingRows.map((row) => row.run_id);
  const latencies = runIds.length ? await supabase.from("vo_runs").select("id, latency_ms").in("id", runIds) : null;
  const latency = new Map((latencies?.data ?? []).map((row) => [row.id, row.latency_ms]));
  const runningRow = ((running.data ?? []) as RunDb[])[0] ?? null;
  const abstainedRow = ((abstained.data ?? []) as RunDb[])[0] ?? null;
  const nm = await names(
    supabase,
    org,
    [
      ...waitingRows.map((row) => row.matter_id),
      ...readings.map((row) => row.matterId),
      ...(runningRow ? [runningRow.matter_id] : []),
      ...(abstainedRow ? [abstainedRow.matter_id] : []),
    ],
    [],
  );
  const empty = new Map();
  const data = draftsPage({
    viewer: base.viewer,
    settings: base.settings,
    waiting: waitingRows.map((row) => draftRow(row, latency)),
    week: ((week.data ?? []) as DraftDb[]).map((row) => draftRow(row, latency)),
    running: runningRow ? runRow(runningRow, empty) : null,
    abstained: abstainedRow ? runRow(abstainedRow, empty) : null,
    names: nm,
    readings,
  });
  return {
    chrome,
    header: draftsHeader(base.viewer, base.settings, voDraftsWaiting(waitingRows.length, readings.length)),
    data,
    ask: base.settings.enabled && base.settings.staff_answers ? { organizationId: org, matters } : null,
  };
}

/** The Designer's Vo and AI page, read as the signed-in staff member (RLS). */
export async function loadSheetAi(staff: SheetStaff, tab: AiTab) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, base] = await Promise.all([loadSheetChrome(staff, "/sheet/ai"), viewerAndSettings(supabase, staff)]);
  let runs: VoRunRow[] = [];
  let drafts: VoDraftRow[] = [];
  let approved: ApprovedSourceRow[] = [];
  let nm: VoNames = { matter: () => "Matter", reference: () => "—", person: () => "—" };
  if (tab === "runs") {
    const { data } = await supabase.from("vo_runs").select(RUN_COLUMNS).eq("organization_id", org).order("created_at", { ascending: false }).limit(100);
    const rows = (data ?? []) as RunDb[];
    const ids = rows.map((row) => row.id);
    const docIds = rows.filter((row) => row.kind === "document_review").map((row) => row.id);
    const [linked, readings] = await Promise.all([
      ids.length ? supabase.from("vo_drafts").select("run_id, status, edited").in("run_id", ids) : null,
      docIds.length ? supabase.from("vo_doc_drafts").select("run_id, status").in("run_id", docIds) : null,
    ]);
    const byRun = new Map<string, NonNullable<VoRunRow["draft"]>>((linked?.data ?? []).map((row) => [row.run_id, { status: row.status as VoDraftRow["status"], edited: row.edited }]));
    for (const row of readings?.data ?? []) byRun.set(row.run_id, { status: row.status as NonNullable<VoRunRow["draft"]>["status"], edited: null });
    runs = rows.map((row) => runRow(row, byRun));
    nm = await names(supabase, org, rows.map((row) => row.matter_id), rows.map((row) => row.user_id));
  }
  if (tab === "audit") {
    const { data } = await supabase.from("vo_drafts").select(DRAFT_COLUMNS).eq("organization_id", org).order("created_at", { ascending: false }).limit(100);
    const rows = (data ?? []) as DraftDb[];
    drafts = rows.map((row) => draftRow(row, new Map()));
    nm = await names(supabase, org, rows.map((row) => row.matter_id), rows.map((row) => row.reviewed_by ?? ""));
  }
  if (tab === "sources") {
    const { data } = await supabase
      .from("official_sources")
      .select("title, publisher, review_status, change_state, next_review_at, canonical_url")
      .or(`organization_id.is.null,organization_id.eq.${org}`)
      .neq("discovery_status", "archived")
      .order("title", { ascending: true })
      .limit(100);
    approved = (data ?? []).map((row) => ({
      title: row.title,
      publisher: row.publisher,
      reviewStatus: String(row.review_status),
      changeState: String(row.change_state),
      nextReviewAt: row.next_review_at,
      canonicalUrl: row.canonical_url,
    }));
  }
  return { chrome, data: aiPage({ tab, viewer: base.viewer, settings: base.settings, runs, drafts, sources: approved, names: nm }) };
}

/** For the matter Messages composer: whether Vo can draft here, and drafts waiting on its threads. */
export async function loadVoComposer(staff: SheetStaff, matterId: string) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const [base, drafts] = await Promise.all([
    viewerAndSettings(supabase, staff),
    supabase.from("vo_drafts").select("id, thread_id, body, needs_rule").eq("organization_id", staff.organizationId).eq("matter_id", matterId).eq("status", "draft").limit(20),
  ]);
  const can = base.settings.enabled && base.settings.reply_drafts && base.settings.read_client_messages;
  return {
    available: can && base.viewer.agentReady,
    enabled: can,
    drafts: (drafts.data ?? []).map((row) => ({ id: row.id, threadId: row.thread_id, body: row.body, needsRule: row.needs_rule })),
  };
}
