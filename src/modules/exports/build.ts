import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { pdfBytes } from "@/modules/agreements/pdf";
import { buildExportPackage, EXPORT_LIMITS, type ExportExcluded, type ExportFile, type ExportRecordSet, type ExportRulePin } from "./package";

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

async function storedBytes(service: ServiceClient, bucket: string, key: string): Promise<Uint8Array | null> {
  const downloaded = await service.storage.from(bucket).download(key);
  if (downloaded.error || !downloaded.data) return null;
  return new Uint8Array(await downloaded.data.arrayBuffer());
}

/**
 * Executed agreements and completion certificates are sealed in the database: app.store_sealed_pdf
 * registers a storage object row for their document version but the bytes live only in
 * signature_envelopes.sealed_pdf / certificate_pdf. Reading them from the bucket always fails, so
 * the export reads those versions' bytes from the envelope instead (service role; the requester
 * already read the version row under RLS). Keyed by document version id.
 */
export async function sealedPdfBytes(service: ServiceClient, org: string, versionIds: string[]): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>();
  if (!versionIds.length) return found;
  const list = versionIds.join(",");
  const envelopes = await service
    .from("signature_envelopes")
    .select("sealed_document_version_id, certificate_document_version_id, sealed_pdf, certificate_pdf")
    .eq("organization_id", org)
    .or(`sealed_document_version_id.in.(${list}),certificate_document_version_id.in.(${list})`);
  for (const row of envelopes.data ?? []) {
    const sealed = pdfBytes(row.sealed_pdf);
    if (row.sealed_document_version_id && sealed) found.set(row.sealed_document_version_id, sealed);
    const certificate = pdfBytes(row.certificate_pdf);
    if (row.certificate_document_version_id && certificate) found.set(row.certificate_document_version_id, certificate);
  }
  return found;
}

/** The rule pack and form versions stamped on the export job when it was requested (SRC-05). */
async function exportRulePin(supabase: UserClient, org: string, exportId: string): Promise<ExportRulePin | null> {
  const job = await supabase.from("matter_exports").select("rule_pack_version_id, form_versions").eq("organization_id", org).eq("id", exportId).maybeSingle();
  const packId = job.data?.rule_pack_version_id;
  if (!packId) return null;
  const pack = await supabase.from("rule_pack_versions").select("program_key, pack_version").eq("id", packId).maybeSingle();
  const forms = Array.isArray(job.data?.form_versions) ? (job.data.form_versions as Record<string, unknown>[]) : [];
  const str = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    rulePackVersionId: packId,
    programKey: pack.data?.program_key ?? null,
    packVersion: pack.data?.pack_version ?? null,
    forms: forms
      .filter((form) => typeof form.form_number === "string")
      .map((form) => ({ form_number: form.form_number as string, date_modified: str(form.date_modified), source_url: str(form.source_url), content_hash: str(form.content_hash) })),
  };
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
}): Promise<{ ok: true; excluded: number } | { ok: false; error: string }> {
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
    const sealed = await sealedPdfBytes(service, org, clean.map((version) => version.id));
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
      const bytes = sealed.get(version.id) ?? (await storedBytes(service, version.storage_bucket, version.storage_key));
      if (!bytes) {
        excluded.push({ path, source: "public.document_versions", sourceId: version.id, reason: "Not included: the stored file could not be read." });
        continue;
      }
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

    // SRC-05: the versions this export was requested under (stamped on the job, never changed).
    const rulePin = await exportRulePin(supabase, org, exportId);
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
        rulePin,
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
    return { ok: true, excluded: excluded.length };
  } catch {
    await service.rpc("service_fail_matter_export", { p_export_id: exportId, p_reason: "The export could not be built. Nothing was kept." });
    return { ok: false, error: "The export could not be built. Nothing was kept." };
  }
}
