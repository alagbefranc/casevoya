import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { SheetStaff } from "@/modules/sheet/load";
import { programLabel } from "@/modules/sheet/matters-present";
import { sourceStaleness, type PackFact, type RuleFact, type SourceFact, type StateAlertData } from "@/modules/sheet/states-present";

/**
 * DES-04: the stale-source banner's facts, read as the signed-in staff member (RLS decides what
 * they see): rule versions in use, the program packs, and the official pages behind them
 * (official_sources: review state, change state and the last check that source_check_attempts
 * recorded). Read only. Nothing is fetched from the government: a failed check is one a person
 * or the checker recorded.
 *
 * Scopes: the firm (Practice › Templates), one rule version (rule detail), or one matter (its
 * pinned program pack and the rules its deadlines came from).
 */
export type SourceScope = { kind: "firm" } | { kind: "rule"; ruleVersionId: string } | { kind: "matter"; matterId: string };

const READ = 200;
const IN_USE = ["published", "approved", "review_due"] as const;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function rulesAndSources(supabase: Supabase, versionIds: string[] | null): Promise<{ rules: RuleFact[]; sources: SourceFact[] }> {
  let query = supabase.from("rule_versions").select("id, definition_id, version_number, status, effective_to, next_review_at").in("status", IN_USE).limit(READ);
  if (versionIds) {
    if (!versionIds.length) return { rules: [], sources: [] };
    query = query.in("id", versionIds);
  }
  const versions = (await query).data ?? [];
  if (!versions.length) return { rules: [], sources: [] };
  const [definitions, evidence] = await Promise.all([
    supabase.from("rule_definitions").select("id, stable_key").in("id", [...new Set(versions.map((row) => row.definition_id))]),
    supabase.from("rule_evidence").select("rule_version_id, snapshot_id").in("rule_version_id", versions.map((row) => row.id)).limit(1000),
  ]);
  const keyOf = new Map((definitions.data ?? []).map((row) => [row.id, row.stable_key]));
  const rules = versions.map((row) => ({
    label: `${keyOf.get(row.definition_id) ?? "Rule"} v${row.version_number}`,
    status: row.status,
    effectiveTo: row.effective_to,
    nextReviewAt: row.next_review_at,
  }));
  const snapshotIds = [...new Set((evidence.data ?? []).map((row) => row.snapshot_id).filter((id): id is string => Boolean(id)))];
  const snapshots = snapshotIds.length ? await supabase.from("source_snapshots").select("id, source_id").in("id", snapshotIds) : null;
  const sourceIds = [...new Set((snapshots?.data ?? []).map((row) => row.source_id))];
  const pages = sourceIds.length
    ? await supabase
        .from("official_sources")
        .select("id, title, canonical_url, review_status, change_state, last_attempt_result, last_attempt_at, next_review_at")
        .in("id", sourceIds)
        .limit(READ)
    : null;
  const sources = (pages?.data ?? []).map((row) => ({
    label: row.title ?? row.canonical_url,
    reviewStatus: row.review_status,
    changeState: row.change_state,
    lastAttemptResult: row.last_attempt_result,
    lastAttemptAt: row.last_attempt_at,
    nextReviewAt: row.next_review_at,
  }));
  return { rules, sources };
}

/** The stale-source banner for a scope, or null when nothing behind it is stale. */
export async function loadSourceStaleness(staff: SheetStaff, scope: SourceScope, now: Date = new Date()): Promise<StateAlertData | null> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  let versionIds: string[] | null = null;
  let packs: PackFact[] = [];
  let subject = "The official content on this page";
  if (scope.kind === "rule") {
    if (!isUuid(scope.ruleVersionId)) return null;
    versionIds = [scope.ruleVersionId];
    subject = "This rule";
  } else if (scope.kind === "matter") {
    if (!isUuid(scope.matterId)) return null;
    const [matter, deadlines] = await Promise.all([
      supabase.from("matters").select("program_pack_id").eq("organization_id", org).eq("id", scope.matterId).maybeSingle(),
      supabase.from("deadlines").select("rule_version_id").eq("organization_id", org).eq("matter_id", scope.matterId).not("rule_version_id", "is", null).limit(50),
    ]);
    const packId = matter.data?.program_pack_id ?? null;
    const [pack, items] = await Promise.all([
      packId ? supabase.from("rule_pack_versions").select("program_key, pack_version, status, next_review_at").eq("id", packId).maybeSingle() : null,
      packId ? supabase.from("rule_pack_items").select("rule_version_id").eq("pack_id", packId).limit(READ) : null,
    ]);
    if (pack?.data) packs = [{ label: `${programLabel(pack.data.program_key)} program v${pack.data.pack_version}`, status: pack.data.status, nextReviewAt: pack.data.next_review_at }];
    versionIds = [
      ...new Set([
        ...(items?.data ?? []).map((row) => row.rule_version_id),
        ...(deadlines.data ?? []).map((row) => row.rule_version_id).filter((id): id is string => Boolean(id)),
      ]),
    ];
    subject = "This matter’s program rules and the deadlines derived from them";
  } else {
    const rows = await supabase.from("rule_pack_versions").select("program_key, pack_version, status, next_review_at").in("status", IN_USE).limit(READ);
    packs = (rows.data ?? []).map((row) => ({ label: `${programLabel(row.program_key)} program v${row.pack_version}`, status: row.status, nextReviewAt: row.next_review_at }));
    subject = "Program templates and rules";
  }
  const { rules, sources } = await rulesAndSources(supabase, versionIds);
  return sourceStaleness({ rules, packs, sources, now, timeZone: staff.timezone, subject });
}
