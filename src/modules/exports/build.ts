import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildExportPackage, EXPORT_LIMITS, type ExportExcluded, type ExportFile, type ExportRecordSet } from "./package";

type UserClient = Awaited<ReturnType<typeof createClient>>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export const EXPORT_BUCKET = "matter-exports";

/** Matter-scoped sources, read as the requester (RLS decides the rows). */
const MATTER_SOURCES = [
  ["records/matter-participants.json", "matter_participants"],
  ["records/tasks.json", "tasks"],
  ["records/deadlines.json", "deadlines"],
  ["records/stage-history.json", "matter_stage_transitions"],
  ["records/stage-evidence.json", "matter_stage_evidence"],
  ["records/engagements.json", "matter_engagements"],
  ["records/agreements.json", "agreements"],
  ["records/representation-authorities.json", "representation_authorities"],
  ["records/intake-responses.json", "intake_responses"],
  ["records/document-requests.json", "document_requests"],
  ["records/invoices.json", "invoices"],
  ["records/client-fund-entries.json", "client_fund_entries"],
  ["records/consultations.json", "bookings"],
  ["records/closures.json", "matter_closures"],
  ["records/legal-holds.json", "matter_legal_holds"],
] as const;

function fileName(path: string): string {
  return path.split("/").pop() || "file";
}

/**
 * Collects a matter's records and documents as the requesting staff member, packages them, stores
 * the ZIP privately with the service role, and marks the job ready. Progress is written between
 * steps so the page shows where a build is. Any failure marks the job failed and keeps nothing.
 */
export async function buildMatterExport(input: {
  supabase: UserClient;
  service: ServiceClient;
  organizationId: string;
  exportId: string;
  matterId: string;
  firm: string;
  requester: string;
  timezone: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, service, organizationId: org, exportId, matterId } = input;
  const progress = (stage: string, value: number) => service.rpc("service_matter_export_progress", { p_export_id: exportId, p_stage: stage, p_progress: value });
  try {
    const matter = await supabase.from("matters").select("*").eq("organization_id", org).eq("id", matterId).maybeSingle();
    if (!matter.data) throw new Error("matter not readable");

    const records: ExportRecordSet[] = [{ path: "records/matter.json", source: "public.matters", rows: [matter.data] }];
    const sets = await Promise.all(
      MATTER_SOURCES.map(async ([path, table]) => {
        const rows = await supabase.from(table).select("*").eq("organization_id", org).eq("matter_id", matterId).limit(EXPORT_LIMITS.maxRowsPerSource);
        return { path, source: `public.${table}`, rows: (rows.data ?? []) as unknown[] };
      }),
    );
    records.push(...sets);

    const participants = (sets.find((set) => set.source === "public.matter_participants")?.rows ?? []) as { person_id: string | null }[];
    const personIds = [...new Set(participants.map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
    const people = personIds.length ? await supabase.from("persons").select("*").eq("organization_id", org).in("id", personIds) : null;
    records.push({ path: "records/people.json", source: "public.persons", rows: people?.data ?? [] });

    const invoiceIds = ((sets.find((set) => set.source === "public.invoices")?.rows ?? []) as { id: string }[]).map((row) => row.id);
    const payments = invoiceIds.length ? await supabase.from("invoice_payments").select("*").eq("organization_id", org).in("invoice_id", invoiceIds) : null;
    records.push({ path: "records/invoice-payments.json", source: "public.invoice_payments", rows: payments?.data ?? [] });

    const refs = await supabase.from("document_matter_refs").select("*").eq("organization_id", org).eq("matter_id", matterId);
    const documentIds = [...new Set((refs.data ?? []).map((row) => row.document_id))];
    const [documents, versions] = await Promise.all([
      documentIds.length ? supabase.from("documents").select("*").eq("organization_id", org).in("id", documentIds) : null,
      documentIds.length ? supabase.from("document_versions").select("*").eq("organization_id", org).in("document_id", documentIds) : null,
    ]);
    records.push({ path: "records/document-links.json", source: "public.document_matter_refs", rows: refs.data ?? [] });
    records.push({ path: "records/documents.json", source: "public.documents", rows: documents?.data ?? [] });
    records.push({ path: "records/document-versions.json", source: "public.document_versions", rows: versions?.data ?? [] });
    await progress("collect", 30);

    // Files: each clean version the requester can read, oldest first, inside the size limits.
    const files: ExportFile[] = [];
    const excluded: ExportExcluded[] = [];
    let total = 0;
    const purposeOf = new Map((documents?.data ?? []).map((row) => [row.id, row.purpose]));
    const clean = [...(versions?.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const version of clean) {
      const path = `documents/${(purposeOf.get(version.document_id) ?? "document").slice(0, 60)}/v${version.version_number}-${fileName(version.original_filename)}`;
      if (version.upload_state !== "clean") {
        excluded.push({ path, source: "public.document_versions", sourceId: version.id, reason: `Not included: upload is ${version.upload_state}.` });
        continue;
      }
      const size = version.byte_size ?? version.declared_byte_size;
      if (files.length >= EXPORT_LIMITS.maxDocuments || total + size > EXPORT_LIMITS.maxDocumentBytes) {
        excluded.push({ path, source: "public.document_versions", sourceId: version.id, reason: "Not included: over this export's size limit. Download it from the matter." });
        continue;
      }
      const downloaded = await service.storage.from(version.storage_bucket).download(version.storage_key);
      if (downloaded.error || !downloaded.data) {
        excluded.push({ path, source: "public.document_versions", sourceId: version.id, reason: "Not included: the stored file could not be read." });
        continue;
      }
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      total += bytes.length;
      files.push({ path, bytes, source: "public.document_versions", sourceId: version.id, storedSha256: version.checksum_sha256, mediaType: version.detected_media_type });
    }

    // The audit trail for the matter and the records in this export (service role: the requester may not read the firm's audit log).
    const objectIds = [
      matterId,
      ...records.flatMap((set) => (set.rows as { id?: unknown }[]).map((row) => (typeof row.id === "string" ? row.id : null))).filter((id): id is string => Boolean(id)),
    ].slice(0, 2000);
    const [byObject, byContext] = await Promise.all([
      service.from("audit_log").select("id, occurred_at, actor_user_id, actor_type, action, object_table, object_id, result, request_id").eq("organization_id", org).in("object_id", objectIds).order("occurred_at").limit(5000),
      service.from("audit_log").select("id, occurred_at, actor_user_id, actor_type, action, object_table, object_id, result, request_id").eq("organization_id", org).eq("context->>matter_id", matterId).order("occurred_at").limit(5000),
    ]);
    const audit = new Map<string, unknown>();
    for (const row of [...(byObject.data ?? []), ...(byContext.data ?? [])]) audit.set(row.id, row);
    records.push({ path: "audit/audit-trail.json", source: "public.audit_log", rows: [...audit.values()] });
    await progress("manifest", 60);

    const reference = (matter.data.reference as string | null) ?? matterId.slice(0, 8);
    const built = await buildExportPackage(
      {
        exportId,
        firm: input.firm,
        matterReference: reference,
        matterTitle: matter.data.title as string,
        generatedAt: new Date().toISOString(),
        generatedBy: input.requester,
        timezone: input.timezone,
      },
      records,
      files,
      excluded,
    );
    await progress("package", 85);

    const key = `${org}/${exportId}/${reference.replace(/[^A-Za-z0-9-]/g, "_")}-client-file.zip`;
    const stored = await service.storage.from(EXPORT_BUCKET).upload(key, built.zip, { contentType: "application/zip", upsert: false });
    if (stored.error) throw new Error("upload failed");
    const done = await service.rpc("service_complete_matter_export", {
      p_export_id: exportId,
      p_storage_key: key,
      p_sha256: built.sha256,
      p_byte_size: built.zip.length,
      p_file_count: built.fileCount,
      p_record_count: built.recordCount,
      p_manifest_sha256: built.manifestSha256,
      p_contents: built.contents,
      p_excluded: built.excluded,
    });
    if (done.error || done.data !== true) {
      // Cancelled while building: keep nothing.
      await service.storage.from(EXPORT_BUCKET).remove([key]);
      return { ok: false, error: "The export was cancelled." };
    }
    return { ok: true };
  } catch {
    await service.rpc("service_fail_matter_export", { p_export_id: exportId, p_reason: "The export could not be built. Nothing was kept." });
    return { ok: false, error: "The export could not be built. Nothing was kept." };
  }
}
