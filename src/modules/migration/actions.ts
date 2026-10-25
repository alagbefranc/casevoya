import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { loadSheetAccess } from "@/modules/sheet/load";
import { isMigrationKind, migrationError, needsMigrationStepUp, planCounts, type MigrationKind, type PlanCounts } from "@/modules/sheet/migration-present";
import { MIGRATION_CHUNK, MIGRATION_MAX_BYTES, readMigrationFile } from "./csv";
import { storeImportedFile, type ImportedFileRow } from "./documents";
import { describeZip, MIGRATION_ZIP_MAX_BYTES, sha256Bytes, zipFileBytes } from "./zip";

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
  default_consultant: uuid.nullable().optional(),
  // MIG-01: the default assignee (tasks), the default kind of date (key dates), and sensitive columns.
  default_owner: uuid.nullable().optional(),
  default_date_kind: z.enum(["legal", "correspondence", "internal"]).nullable().optional(),
  sensitivity: z.record(z.string().regex(/^\d{1,2}$/), z.enum(["identity", "narrative", "health", "financial"])).optional(),
  values: z.record(z.string().max(40), z.record(z.string().max(200), z.string().max(60))),
});

const SCHEMAS = {
  map: z.object({ org: uuid, batch: uuid, mapping: mappingSchema }),
  decide: z.object({ org: uuid, batch: uuid, row: z.number().int().min(2).max(5001), same: z.boolean() }),
  commit: z.object({ org: uuid, batch: uuid }),
  rollback: z.object({ org: uuid, batch: uuid }),
  discard: z.object({ org: uuid, batch: uuid }),
  review: z.object({ org: uuid, batch: uuid.optional(), id: uuid, approve: z.boolean(), note: z.string().max(500).nullable() }),
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

/**
 * Upload: parse on the server with limits, stage the batch, append rows in chunks, and verify.
 * MIG-01: the kind of records the file holds; a documents import also reads its ZIP here (each
 * entry's size, SHA-256 and real type are staged, the bytes are not kept).
 */
export async function uploadMigrationFile(
  organizationId: string,
  file: File | null,
  kindValue: string = "clients_matters",
  zip: File | null = null,
): Promise<MigrationResult> {
  const kind: MigrationKind | null = isMigrationKind(kindValue) ? kindValue : null;
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  if (!file || typeof file.arrayBuffer !== "function") return { error: "Choose a CSV file." };
  if (file.size > MIGRATION_MAX_BYTES) return { error: "The file is larger than 5 MB. Split it and import each part." };
  if (!kind) return { error: "Choose what the file holds." };
  if (kind === "documents" && (!zip || typeof zip.arrayBuffer !== "function")) return { error: "Choose the ZIP of files too." };
  if (zip && zip.size > MIGRATION_ZIP_MAX_BYTES) return { error: "The ZIP is larger than 25 MB. Split the files into smaller ZIPs." };
  const session = await owner(organizationId);
  if ("error" in session) return { error: session.error };
  const { supabase } = session;
  const read = await readMigrationFile(new Uint8Array(await file.arrayBuffer()));
  if ("error" in read) return { error: read.error };
  const zipBytes = kind === "documents" && zip ? new Uint8Array(await zip.arrayBuffer()) : null;
  const described = zipBytes ? describeZip(zipBytes) : null;
  if (described && "error" in described) return { error: described.error };
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
  if (kind !== "clients_matters") {
    const kindSet = await supabase.rpc("set_migration_kind", { p_org: organizationId, p_batch: batch, p_kind: kind });
    if (kindSet.error) {
      await supabase.rpc("discard_migration_batch", { p_org: organizationId, p_batch: batch });
      return refused(kindSet.error.message);
    }
  }
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
  if (described && zip) {
    const files = await supabase.rpc("stage_migration_files", {
      p_org: organizationId,
      p_batch: batch,
      p_name: (zip.name || "files.zip").replace(/[\\/]/g, "_").slice(0, 200),
      p_sha256: described.sha256,
      p_bytes: zip.size,
      p_files: described.files,
    });
    if (files.error) {
      await supabase.rpc("discard_migration_batch", { p_org: organizationId, p_batch: batch });
      return refused(files.error.message);
    }
  }
  return { ok: true, id: batch };
}

/**
 * MIG-01 documents import, signed off: the ZIP is sent again and must hash to the one read at upload.
 * Each file goes through the document upload path (see ./documents), then the batch finishes.
 */
export async function commitMigrationDocuments(organizationId: string, batchId: string, zip: File | null): Promise<MigrationResult> {
  if (!isUuid(organizationId) || !isUuid(batchId)) return { error: "Some details are missing. Reload the page and try again." };
  if (!zip || typeof zip.arrayBuffer !== "function") return { error: "Choose the same ZIP you uploaded." };
  if (zip.size > MIGRATION_ZIP_MAX_BYTES) return { error: "The ZIP is larger than 25 MB. Split the files into smaller ZIPs." };
  const session = await owner(organizationId);
  if ("error" in session) return { error: session.error };
  const { supabase } = session;
  const batch = await supabase
    .from("migration_batches")
    .select("status, plan_hash, kind, attachment_sha256")
    .eq("organization_id", organizationId)
    .eq("id", batchId)
    .maybeSingle();
  if (!batch.data) return { error: "That import isn’t there any more. Reload the page." };
  if (batch.data.kind !== "documents") return { error: "This import has moved on. Reload the page." };
  const bytes = new Uint8Array(await zip.arrayBuffer());
  if (sha256Bytes(bytes) !== batch.data.attachment_sha256) return { error: "That isn’t the ZIP you uploaded. Choose the same ZIP." };
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Sign in first." };
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { error: "Files can’t be stored right now. Try again later." };
  }
  if (batch.data.status === "checked") {
    const begun = await supabase.rpc("begin_migration_commit", { p_org: organizationId, p_batch: batchId, p_plan_hash: batch.data.plan_hash ?? "" });
    if (begun.error) return refused(begun.error.message);
    const result = (begun.data ?? {}) as { ok?: boolean };
    if (!result.ok) return { error: "Something changed since the preview. Check Preview and Row errors again, then sign off." };
  } else if (batch.data.status !== "committing") {
    return { error: "This import has moved on. Reload the page." };
  }
  const started = Date.now();
  const stop = async (message: string) => {
    if (!needsMigrationStepUp(message)) {
      await supabase.rpc("note_migration_commit_failure", { p_org: organizationId, p_batch: batchId, p_reason: message.slice(0, 120) });
    }
    return refused(message);
  };
  for (;;) {
    const next = await supabase.rpc("migration_document_rows", { p_org: organizationId, p_batch: batchId, p_limit: 5 });
    if (next.error) return stop(next.error.message);
    const rows = (((next.data ?? {}) as { rows?: ImportedFileRow[] }).rows ?? []) as ImportedFileRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const file = zipFileBytes(bytes, row.file_path, row.file_sha256);
      if (!file) return stop(`migration row ${row.row}: the stored file doesn't match the ZIP`);
      const stored = await storeImportedFile(supabase, service, { organizationId, batchId, userId, row, bytes: file });
      if ("error" in stored) return stop(stored.error);
    }
    if (Date.now() - started > COMMIT_BUDGET_MS) return { ok: true, remaining: 1, status: "committing" };
  }
  const finish = await supabase.rpc("commit_migration_kind_chunk", { p_org: organizationId, p_batch: batchId, p_limit: 200 });
  if (finish.error) return stop(finish.error.message);
  const state = (finish.data ?? {}) as { remaining?: number };
  const remaining = Number(state.remaining ?? 0);
  return remaining > 0 ? { ok: true, remaining, status: "committing" } : { ok: true, remaining: 0, status: "committed" };
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
    case "review": {
      const v = SCHEMAS.review.parse(body);
      const run = await supabase.rpc("review_opening_balance", { p_org: v.org, p_id: v.id, p_approve: v.approve, p_note: v.note ?? "" });
      if (run.error) return refused(run.error.message);
      return { ok: true };
    }
    case "commit": {
      const batch = await supabase.from("migration_batches").select("status, plan_hash, kind").eq("organization_id", input.org).eq("id", input.batch).maybeSingle();
      if (!batch.data) return { error: "That import isn’t there any more. Reload the page." };
      // MIG-01: a documents import signs off with its ZIP (commitMigrationDocuments).
      if (batch.data.kind === "documents") return { error: "Choose the same ZIP you uploaded to sign off." };
      const kindChunk = batch.data.kind !== "clients_matters";
      if (batch.data.status === "checked") {
        const begun = await supabase.rpc("begin_migration_commit", { p_org: input.org, p_batch: input.batch, p_plan_hash: batch.data.plan_hash ?? "" });
        if (begun.error) return refused(begun.error.message);
        const result = (begun.data ?? {}) as { ok?: boolean; reason?: string };
        if (!result.ok) return { error: "Something changed since the preview. Check Preview and Row errors again, then sign off." };
      } else if (batch.data.status !== "committing") {
        return { error: "This import has moved on. Reload the page." };
      }
      const started = Date.now();
      for (;;) {
        const chunk = kindChunk
          ? await supabase.rpc("commit_migration_kind_chunk", { p_org: input.org, p_batch: input.batch, p_limit: 100 })
          : await supabase.rpc("commit_migration_chunk", { p_org: input.org, p_batch: input.batch, p_limit: 25 });
        if (chunk.error) {
          if (!needsMigrationStepUp(chunk.error.message)) {
            await supabase.rpc("note_migration_commit_failure", { p_org: input.org, p_batch: input.batch, p_reason: chunk.error.message.slice(0, 120) });
          }
          return refused(chunk.error.message);
        }
        const state = (chunk.data ?? {}) as { remaining?: number; status?: string };
        const remaining = Number(state.remaining ?? 0);
        if (remaining <= 0) return { ok: true, remaining: 0, status: "committed" };
        if (Date.now() - started > COMMIT_BUDGET_MS) return { ok: true, remaining, status: "committing" };
      }
    }
  }
}
