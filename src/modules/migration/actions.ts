import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { loadSheetAccess } from "@/modules/sheet/load";
import { migrationError, needsMigrationStepUp, planCounts, type PlanCounts } from "@/modules/sheet/migration-present";
import { MIGRATION_CHUNK, MIGRATION_MAX_BYTES, readMigrationFile } from "./csv";
import { pilotState } from "./report";

/**
 * Migration import writes (T044), as the signed-in firm owner. Each step is a database function
 * that checks the owner, MFA and (for sign-off and rollback) a fresh step-up, and audits it.
 * Nothing here decides access.
 */

export type MigrationResult =
  | { ok: true; id?: string; counts?: PlanCounts | null; remaining?: number; status?: string; reasons?: string[] }
  | { error: string; stepUp?: boolean; reasons?: string[] };

const uuid = z.string().refine(isUuid, "id");
const mappingSchema = z.object({
  columns: z.record(z.string().max(40), z.number().int().min(0).max(99).nullable()),
  date_order: z.enum(["dmy", "mdy", "ymd"]),
  default_consultant: uuid.nullable(),
  values: z.record(z.string().max(40), z.record(z.string().max(200), z.string().max(60))),
});

const SCHEMAS = {
  map: z.object({ org: uuid, batch: uuid, mapping: mappingSchema }),
  decide: z.object({ org: uuid, batch: uuid, row: z.number().int().min(2).max(5001), same: z.boolean() }),
  commit: z.object({ org: uuid, batch: uuid }),
  // MIG-02: the pilot (first matters, firm owner + step-up) and its sign-off with a note.
  pilot: z.object({ org: uuid, batch: uuid, size: z.number().int().min(1).max(50), system: z.string().trim().max(120).optional() }),
  signoff: z.object({ org: uuid, batch: uuid, note: z.string().trim().min(3).max(1000) }),
  rollback: z.object({ org: uuid, batch: uuid }),
  discard: z.object({ org: uuid, batch: uuid }),
} as const;

export type MigrationAction = keyof typeof SCHEMAS;

export function isMigrationAction(value: string): value is MigrationAction {
  return Object.hasOwn(SCHEMAS, value);
}

function refused(message: string): { error: string; stepUp?: boolean } {
  return { error: migrationError(message), ...(needsMigrationStepUp(message) ? { stepUp: true } : {}) };
}

/** The signed-in firm owner of this firm, with a client scoped to it; or why not. */
async function owner(organizationId: string): Promise<{ error: string } | { supabase: Awaited<ReturnType<typeof createClient>> }> {
  const access = await loadSheetAccess();
  if ((access.kind !== "live" && access.kind !== "sample") || access.staff.organizationId !== organizationId) return { error: "Sign in first." };
  if (access.staff.role !== "firm_owner") return { error: "Only the firm owner can import records." };
  return { supabase: await createClient({ organizationId }) };
}

/** Upload: parse on the server with limits, stage the batch, append rows in chunks, and verify. */
export async function uploadMigrationFile(organizationId: string, file: File | null): Promise<MigrationResult> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  if (!file || typeof file.arrayBuffer !== "function") return { error: "Choose a CSV file." };
  if (file.size > MIGRATION_MAX_BYTES) return { error: "The file is larger than 5 MB. Split it and import each part." };
  const session = await owner(organizationId);
  if ("error" in session) return { error: session.error };
  const { supabase } = session;
  const read = await readMigrationFile(new Uint8Array(await file.arrayBuffer()));
  if ("error" in read) return { error: read.error };
  const name = (file.name || "import.csv").replace(/[\\/]/g, "_").slice(0, 200);
  const staged = await supabase.rpc("stage_migration_batch", {
    p_org: organizationId,
    p_file_name: name,
    p_source_sha256: read.sha256,
    p_byte_size: read.bytes,
    p_row_count: read.rows.length,
    p_parsed_digest: read.digest,
    p_headers: read.headers,
  });
  if (staged.error || !staged.data) return refused(staged.error?.message ?? "");
  const batch = staged.data;
  for (let start = 0; start < read.rows.length; start += MIGRATION_CHUNK) {
    const appended = await supabase.rpc("append_migration_rows", {
      p_org: organizationId,
      p_batch: batch,
      p_first_row: start + 2,
      p_rows: read.rows.slice(start, start + MIGRATION_CHUNK),
    });
    if (appended.error) {
      await supabase.rpc("discard_migration_batch", { p_org: organizationId, p_batch: batch });
      return refused(appended.error.message);
    }
  }
  const sealed = await supabase.rpc("seal_migration_batch", { p_org: organizationId, p_batch: batch });
  if (sealed.error) return refused(sealed.error.message);
  const verified = sealed.data as { ok?: boolean } | null;
  if (!verified?.ok) return { error: "The rows didn’t arrive intact, so the upload was discarded. Try again." };
  return { ok: true, id: batch };
}

/** Commit chunks for up to this long in one request; the page asks again for the rest. */
const COMMIT_BUDGET_MS = 20_000;

export async function runMigrationAction(action: MigrationAction, body: unknown): Promise<MigrationResult> {
  const parsed = SCHEMAS[action].safeParse(body);
  if (!parsed.success) return { error: "Some details are missing. Reload the page and try again." };
  const input = parsed.data as { org: string; batch: string };
  const session = await owner(input.org);
  if ("error" in session) return { error: session.error };
  const { supabase } = session;

  switch (action) {
    case "map": {
      const v = SCHEMAS.map.parse(body);
      const saved = await supabase.rpc("save_migration_mapping", { p_org: v.org, p_batch: v.batch, p_mapping: v.mapping });
      if (saved.error) return refused(saved.error.message);
      const run = await supabase.rpc("run_migration_dry_run", { p_org: v.org, p_batch: v.batch });
      if (run.error) return refused(run.error.message);
      return { ok: true, counts: planCounts(run.data) };
    }
    case "decide": {
      const v = SCHEMAS.decide.parse(body);
      const run = await supabase.rpc("decide_migration_duplicate", { p_org: v.org, p_batch: v.batch, p_row: v.row, p_same: v.same });
      if (run.error) return refused(run.error.message);
      return { ok: true, counts: planCounts(run.data) };
    }
    case "discard": {
      const run = await supabase.rpc("discard_migration_batch", { p_org: input.org, p_batch: input.batch });
      if (run.error) return refused(run.error.message);
      return { ok: true };
    }
    case "rollback": {
      const run = await supabase.rpc("rollback_migration_batch", { p_org: input.org, p_batch: input.batch });
      if (run.error) return refused(run.error.message);
      const result = (run.data ?? {}) as { ok?: boolean; reasons?: string[] };
      if (!result.ok) return { error: "This import can’t be rolled back.", reasons: result.reasons ?? [] };
      return { ok: true };
    }
    case "pilot": {
      const v = SCHEMAS.pilot.parse(body);
      const batch = await supabase.from("migration_batches").select("status, plan_hash").eq("organization_id", v.org).eq("id", v.batch).maybeSingle();
      if (!batch.data) return { error: "That import isn’t there any more. Reload the page." };
      if (batch.data.status !== "checked") return { error: "This import has moved on. Reload the page." };
      const begun = await supabase.rpc("begin_migration_pilot", {
        p_org: v.org,
        p_batch: v.batch,
        p_plan_hash: batch.data.plan_hash ?? "",
        p_size: v.size,
        ...(v.system ? { p_source_system: v.system } : {}),
      });
      if (begun.error) return refused(begun.error.message);
      const result = (begun.data ?? {}) as { ok?: boolean; reason?: string };
      if (!result.ok) return { error: beginRefusal(result.reason) };
      return chunks(supabase, v.org, v.batch);
    }
    case "signoff": {
      const v = SCHEMAS.signoff.parse(body);
      const run = await supabase.rpc("sign_off_migration_pilot", { p_org: v.org, p_batch: v.batch, p_note: v.note });
      if (run.error) return refused(run.error.message);
      return { ok: true };
    }
    case "commit": {
      const batch = await supabase
        .from("migration_batches")
        .select("status, plan_hash, pilot_size, pilot_completed_at, pilot_signed_off_at, full_run_started_at")
        .eq("organization_id", input.org)
        .eq("id", input.batch)
        .maybeSingle();
      if (!batch.data) return { error: "That import isn’t there any more. Reload the page." };
      const state = pilotState(batch.data);
      if (state === "ready") return { error: "Run a pilot first. The full import waits for your sign-off of the pilot." };
      if (state === "review") return { error: "Sign off the pilot first. The full import waits for it." };
      if (state === "other") return { error: "This import has moved on. Reload the page." };
      if (state === "signed") {
        const begun = await supabase.rpc("begin_migration_commit", { p_org: input.org, p_batch: input.batch, p_plan_hash: batch.data.plan_hash ?? "" });
        if (begun.error) return refused(begun.error.message);
        const result = (begun.data ?? {}) as { ok?: boolean; reason?: string };
        if (!result.ok) return { error: beginRefusal(result.reason) };
      }
      return chunks(supabase, input.org, input.batch);
    }
  }
}

function beginRefusal(reason: string | undefined): string {
  return reason === "checksum_changed"
    ? "The staged rows no longer match the checksum taken at upload, so nothing was created. Discard or roll back this import and upload the file again."
    : "Something changed since the preview. Check Preview and Row errors again, then sign off.";
}

/** Commit chunks for up to COMMIT_BUDGET_MS; the page asks again for the rest. A pilot stops at its last matter. */
async function chunks(supabase: Awaited<ReturnType<typeof createClient>>, org: string, batch: string): Promise<MigrationResult> {
  const started = Date.now();
  for (;;) {
    const chunk = await supabase.rpc("commit_migration_chunk", { p_org: org, p_batch: batch, p_limit: 25 });
    if (chunk.error) {
      if (!needsMigrationStepUp(chunk.error.message)) {
        await supabase.rpc("note_migration_commit_failure", { p_org: org, p_batch: batch, p_reason: chunk.error.message.slice(0, 120) });
      }
      return refused(chunk.error.message);
    }
    const state = (chunk.data ?? {}) as { remaining?: number; status?: string };
    const remaining = Number(state.remaining ?? 0);
    if (remaining <= 0) return { ok: true, remaining: 0, status: state.status === "pilot_done" ? "pilot_done" : "committed" };
    if (Date.now() - started > COMMIT_BUDGET_MS) return { ok: true, remaining, status: "committing" };
  }
}
