import "server-only";
import type { MatterDocumentReviewData } from "@/components/sheet/designer/vo-doc-review";
import type { createClient } from "@/lib/supabase/server";
import { voAgentConfigured } from "@/modules/vo/agent-client";
import { readingPanel, type VoProposalRow } from "@/modules/sheet/vo-doc-present";
import { effectiveSettings, voCanReadDocuments, type VoReadingRow, type VoSource } from "@/modules/sheet/vo-present";

type Client = Awaited<ReturnType<typeof createClient>>;

function sources(value: unknown): VoSource[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ kind: String(item.kind ?? ""), id: String(item.id ?? ""), label: String(item.label ?? "") }))
        .filter((item) => item.label)
    : [];
}

/** Whether "Read with Vo" is offered: Vo on and available, and a document capability on. */
export async function voReadOffered(supabase: Client, org: string, sampleMode: boolean): Promise<boolean> {
  const { data } = await supabase.from("vo_settings").select("*").eq("organization_id", org).maybeSingle();
  return voCanReadDocuments(effectiveSettings(data ?? null, sampleMode), { agentReady: voAgentConfigured() });
}

/**
 * The matter Documents tab's review panel: the reading asked for (`?vo=`), else the newest one
 * still waiting on this matter. Read as the staff member (RLS: the matter and the document).
 */
export async function loadVoReadingPanel(
  supabase: Client,
  org: string,
  matterId: string,
  wanted: string | null,
): Promise<{ documentId: string; panel: MatterDocumentReviewData } | null> {
  const { data: drafts } = await supabase
    .from("vo_doc_drafts")
    .select("id, document_id, version_id, needs_rule, created_at")
    .eq("organization_id", org)
    .eq("matter_id", matterId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = drafts ?? [];
  const draft = rows.find((row) => row.id === wanted) ?? rows[0];
  if (!draft) return null;
  const [proposals, version, doc] = await Promise.all([
    supabase
      .from("vo_doc_proposals")
      .select("id, position, kind, label, value, detail, page, confidence, category, due_on, status")
      .eq("organization_id", org)
      .eq("draft_id", draft.id)
      .order("position", { ascending: true }),
    supabase.from("document_versions").select("version_number, detected_media_type, declared_media_type, checksum_sha256").eq("organization_id", org).eq("id", draft.version_id).maybeSingle(),
    supabase.from("documents").select("purpose").eq("organization_id", org).eq("id", draft.document_id).maybeSingle(),
  ]);
  if (!version.data || !doc.data) return null;
  const panel = readingPanel({
    id: draft.id,
    organizationId: org,
    purpose: doc.data.purpose,
    versionNumber: version.data.version_number,
    mediaType: version.data.detected_media_type ?? version.data.declared_media_type,
    sha256: version.data.checksum_sha256,
    needsRule: draft.needs_rule,
    proposals: (proposals.data ?? []).map(
      (row): VoProposalRow => ({
        id: row.id,
        position: row.position,
        kind: row.kind,
        label: row.label,
        value: row.value,
        detail: row.detail,
        page: row.page,
        confidence: row.confidence,
        category: row.category,
        dueOn: row.due_on,
        status: row.status,
      }),
    ),
  });
  return panel ? { documentId: draft.document_id, panel } : null;
}

/** Vo drafts page: document readings still waiting, with how many proposals are left. */
export async function loadVoReadings(supabase: Client, org: string): Promise<VoReadingRow[]> {
  const { data } = await supabase
    .from("vo_doc_drafts")
    .select("id, run_id, title, body, matter_id, version_id, sources, needs_rule, is_sample, created_at")
    .eq("organization_id", org)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = data ?? [];
  if (!rows.length) return [];
  const [runs, proposals] = await Promise.all([
    supabase.from("vo_runs").select("id, latency_ms").eq("organization_id", org).in("id", rows.map((row) => row.run_id)),
    supabase.from("vo_doc_proposals").select("draft_id").eq("organization_id", org).eq("status", "proposed").in("draft_id", rows.map((row) => row.id)),
  ]);
  const latency = new Map((runs.data ?? []).map((row) => [row.id, row.latency_ms]));
  const waiting = new Map<string, number>();
  for (const row of proposals.data ?? []) waiting.set(row.draft_id, (waiting.get(row.draft_id) ?? 0) + 1);
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    title: row.title,
    body: row.body,
    matterId: row.matter_id,
    versionId: row.version_id,
    sources: sources(row.sources),
    needsRule: row.needs_rule,
    isSample: row.is_sample,
    createdAt: row.created_at,
    latencyMs: latency.get(row.run_id) ?? null,
    waiting: waiting.get(row.id) ?? 0,
  }));
}
