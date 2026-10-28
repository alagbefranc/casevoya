import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assemblePrivacyRecords, type ItemRows, type PackageItem } from "@/modules/compliance/privacy-package";
import { EXPORT_BUCKET, sealedPdfBytes } from "./build";
import { buildExportPackage, EXPORT_LIMITS, type ExportExcluded, type ExportFile } from "./package";

type UserClient = Awaited<ReturnType<typeof createClient>>;
type ServiceClient = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown>;

const AUDIT_COLUMNS = "occurred_at, actor_type, action, object_table, result";

function fileName(path: string): string {
  return path.split("/").pop() || "file";
}

/**
 * SEC-06: builds a privacy access response. Reads the scope search items and each record as the
 * requesting staff member (row-level security decides), removes what staff withheld, adds the
 * person's document files and the activity log of their record (service role: staff may not read
 * the firm's audit log), packages it with the client-file export code (ZIP, SHA-256 manifest, PDF
 * summary), stores it privately with the service role and marks the response ready. Any failure
 * marks it failed and keeps nothing.
 */
export async function buildPrivacyResponse(input: {
  supabase: UserClient;
  service: ServiceClient;
  organizationId: string;
  responseId: string;
  requestId: string;
  firm: string;
  requester: string;
  timezone: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, service, organizationId: org, responseId, requestId } = input;
  try {
    const request = await supabase.from("privacy_requests").select("id, reference, requester_name, person_id").eq("organization_id", org).eq("id", requestId).maybeSingle();
    if (!request.data?.person_id) throw new Error("request not readable");
    const items = await supabase
      .from("privacy_request_items")
      .select("id, source, source_id, label, decision, withheld_fields, reason")
      .eq("organization_id", org)
      .eq("request_id", requestId)
      .order("created_at");
    const list = (items.data ?? []) as PackageItem[];
    const wanted = (source: string) => list.filter((item) => item.source === source && item.decision !== "withhold").map((item) => item.source_id);
    const byId = <T extends Row>(rows: T[] | null | undefined) => new Map((rows ?? []).map((row) => [String(row.id), row]));
    const limit = EXPORT_LIMITS.maxRowsPerSource;

    const [person, matters, documents, threads, intake, invoices, consents, bookings, leads] = await Promise.all([
      supabase.from("persons").select("*").eq("organization_id", org).in("id", wanted("person")),
      supabase.from("matters").select("*").eq("organization_id", org).in("id", wanted("matter")),
      supabase.from("documents").select("*").eq("organization_id", org).in("id", wanted("document")),
      supabase.from("matter_messages").select("*").eq("organization_id", org).in("thread_id", wanted("message_thread")).order("created_at").limit(limit),
      supabase.from("intake_responses").select("*").eq("organization_id", org).in("id", wanted("intake_response")),
      supabase.from("invoices").select("*").eq("organization_id", org).in("id", wanted("invoice")),
      supabase.from("consent_records").select("*").eq("organization_id", org).in("id", wanted("consent")),
      supabase.from("bookings").select("*").eq("organization_id", org).in("id", wanted("booking")),
      supabase.from("leads").select("*").eq("organization_id", org).in("id", wanted("lead")),
    ]);
    const [answers, payments, versions] = await Promise.all([
      wanted("intake_response").length
        ? supabase.from("intake_answer_versions").select("*").eq("organization_id", org).in("response_id", wanted("intake_response")).order("created_at").limit(limit)
        : null,
      wanted("invoice").length ? supabase.from("invoice_payments").select("*").eq("organization_id", org).in("invoice_id", wanted("invoice")) : null,
      (documents.data ?? []).length
        ? supabase.from("document_versions").select("*").eq("organization_id", org).in("id", (documents.data ?? []).map((doc) => doc.current_version_id).filter((id): id is string => Boolean(id)))
        : null,
    ]);
    const personRow = (person.data ?? [])[0] as Row | undefined;
    // The activity log of their record and of what they did themselves.
    const userId = typeof personRow?.user_id === "string" ? personRow.user_id : null;
    const auditWanted = list.some((item) => item.source === "audit" && item.decision !== "withhold");
    const [onRecord, byThem] = auditWanted
      ? await Promise.all([
          service.from("audit_log").select(AUDIT_COLUMNS).eq("organization_id", org).eq("object_id", request.data.person_id).order("occurred_at").limit(limit),
          userId ? service.from("audit_log").select(AUDIT_COLUMNS).eq("organization_id", org).eq("actor_user_id", userId).order("occurred_at").limit(limit) : null,
        ])
      : [null, null];

    const maps: Record<string, Map<string, Row>> = {
      person: byId(person.data as Row[]),
      matter: byId(matters.data as Row[]),
      document: byId(documents.data as Row[]),
      intake_response: byId(intake.data as Row[]),
      invoice: byId(invoices.data as Row[]),
      consent: byId(consents.data as Row[]),
      booking: byId(bookings.data as Row[]),
      lead: byId(leads.data as Row[]),
    };
    const rowsByItem = new Map<string, ItemRows>();
    for (const item of list) {
      if (item.decision === "withhold") continue;
      if (item.source === "message_thread") {
        rowsByItem.set(item.id, { message_thread: ((threads.data ?? []) as Row[]).filter((row) => row.thread_id === item.source_id) });
      } else if (item.source === "audit") {
        if (onRecord || byThem) rowsByItem.set(item.id, { audit: [...((onRecord?.data ?? []) as Row[]), ...((byThem?.data ?? []) as Row[])] });
      } else {
        const row = maps[item.source]?.get(item.source_id);
        if (!row) continue;
        const sets: ItemRows = { [item.source]: [row] };
        if (item.source === "intake_response") sets.intake_answer = ((answers?.data ?? []) as Row[]).filter((answer) => answer.response_id === item.source_id);
        if (item.source === "invoice") sets.invoice_payment = ((payments?.data ?? []) as Row[]).filter((payment) => payment.invoice_id === item.source_id);
        rowsByItem.set(item.id, sets);
      }
    }
    const assembled = assemblePrivacyRecords(list, rowsByItem);

    // Document files: each included document's current clean version, inside the size limits. A
    // document with withheld fields is listed but its file is left out: Casevoya can't redact inside
    // a file, so the firm gives a redacted copy separately.
    const files: ExportFile[] = [];
    const excluded: ExportExcluded[] = [...assembled.excluded];
    let total = 0;
    const versionRows = (versions?.data ?? []) as Row[];
    const sealed = await sealedPdfBytes(service, org, versionRows.map((row) => String(row.id)));
    for (const item of list.filter((entry) => entry.source === "document" && entry.decision !== "withhold")) {
      const doc = maps.document.get(item.source_id);
      const version = versionRows.find((row) => row.id === doc?.current_version_id);
      if (!doc || !version) continue;
      const path = `documents/${String(doc.purpose ?? "document").slice(0, 60)}/v${version.version_number}-${fileName(String(version.original_filename))}`;
      if (item.decision === "redact") {
        excluded.push({ path, source: "public.document_versions", sourceId: String(version.id), reason: "Not included: part of this file is withheld. The firm gives you a redacted copy separately." });
        continue;
      }
      if (version.upload_state !== "clean") {
        excluded.push({ path, source: "public.document_versions", sourceId: String(version.id), reason: `Not included: upload is ${String(version.upload_state)}.` });
        continue;
      }
      const size = Number(version.byte_size ?? version.declared_byte_size ?? 0);
      if (files.length >= EXPORT_LIMITS.maxDocuments || total + size > EXPORT_LIMITS.maxDocumentBytes) {
        excluded.push({ path, source: "public.document_versions", sourceId: String(version.id), reason: "Not included: over this package's size limit. Ask the firm for it." });
        continue;
      }
      let bytes = sealed.get(String(version.id)) ?? null;
      if (!bytes) {
        const downloaded = await service.storage.from(String(version.storage_bucket)).download(String(version.storage_key));
        bytes = downloaded.error || !downloaded.data ? null : new Uint8Array(await downloaded.data.arrayBuffer());
      }
      if (!bytes) {
        excluded.push({ path, source: "public.document_versions", sourceId: String(version.id), reason: "Not included: the stored file could not be read." });
        continue;
      }
      total += bytes.length;
      files.push({ path, bytes, source: "public.document_versions", sourceId: String(version.id), storedSha256: (version.checksum_sha256 as string | null) ?? null, mediaType: (version.detected_media_type as string | null) ?? null });
    }

    const reference = request.data.reference;
    const built = await buildExportPackage(
      {
        exportId: responseId,
        firm: input.firm,
        matterReference: reference,
        matterTitle: `Response to ${request.data.requester_name}`,
        generatedAt: new Date().toISOString(),
        generatedBy: input.requester,
        timezone: input.timezone,
        format: "casevoya.privacy-access-response",
        title: `Privacy access response, ${reference}`,
        scope: "The person's own records in this firm that the staff member could read, with withheld records and fields removed (withheld.json lists each with its reason).",
      },
      assembled.records,
      files,
      excluded,
    );
    const key = `${org}/privacy/${requestId}/${responseId}-${reference.replace(/[^A-Za-z0-9-]/g, "_")}-response.zip`;
    const stored = await service.storage.from(EXPORT_BUCKET).upload(key, built.zip, { contentType: "application/zip", upsert: false });
    if (stored.error) throw new Error("upload failed");
    const done = await service.rpc("service_complete_privacy_response", {
      p_response_id: responseId,
      p_storage_key: key,
      p_sha256: built.sha256,
      p_byte_size: built.zip.length,
      p_file_count: built.fileCount,
      p_record_count: built.recordCount,
      p_manifest_sha256: built.manifestSha256,
      p_withheld_count: assembled.withheld.length,
      p_contents: built.contents,
      p_excluded: built.excluded,
    });
    if (done.error || done.data !== true) {
      await service.storage.from(EXPORT_BUCKET).remove([key]);
      return { ok: false, error: "The package could not be built. Nothing was kept." };
    }
    return { ok: true };
  } catch {
    await service.rpc("service_fail_privacy_response", { p_response_id: responseId, p_reason: "The package could not be built. Nothing was kept." });
    return { ok: false, error: "The package could not be built. Nothing was kept." };
  }
}
