import "server-only";
import { UPLOAD_CEILING_BYTES } from "@/modules/documents/files";
import { verifyDocumentStream } from "@/modules/documents/verify";
import type { createClient } from "@/lib/supabase/server";
import type { createServiceClient } from "@/lib/supabase/service";
import { mediaTypeForFilename } from "@/modules/documents/files";

/**
 * MIG-01 documents import: one file from the import's ZIP stored through the same path as any
 * document upload. The firm owner's session asks for the upload intent (public.create_upload_intent,
 * which checks who may upload for the person and matter, the firm's size limit and the file type by
 * name); the bytes are put at the intent's storage key; the server reads them back from storage and
 * checks them (size, SHA-256, real type; DOC-02), and public.finish_verified_document_upload records
 * the result as for any upload. Then public.record_migration_document ties the file to its row.
 */

type OwnerClient = Awaited<ReturnType<typeof createClient>>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export type ImportedFileRow = {
  row: number;
  person_id: string;
  matter_id: string;
  purpose: string;
  file_name: string;
  file_path: string;
  file_sha256: string;
  file_bytes: number;
};

export async function storeImportedFile(
  owner: OwnerClient,
  service: ServiceClient,
  input: { organizationId: string; batchId: string; userId: string; row: ImportedFileRow; bytes: Uint8Array },
): Promise<{ ok: true; uploadState: string } | { error: string }> {
  const { row, bytes } = input;
  const media = mediaTypeForFilename(row.file_name);
  if (!media) return { error: `Row ${row.row}: the file isn’t a PDF, JPEG, PNG, HEIC or DOCX.` };
  const intent = await owner.rpc("create_upload_intent", {
    p_matter_id: row.matter_id,
    p_person_id: row.person_id,
    p_filename: row.file_name,
    p_declared_byte_size: bytes.byteLength,
    p_purpose: row.purpose,
    p_sensitivity: "ordinary",
    p_audience: "subject",
    p_document_id: null,
    p_translation_of_version_id: null,
    p_language_tag: null,
  });
  const created = (intent.data ?? null) as { version_id?: string; storage_key?: string } | null;
  if (intent.error || !created?.version_id || !created.storage_key) return { error: intent.error?.message ?? "document upload denied" };
  const put = await service.storage.from("documents").upload(created.storage_key, bytes, { contentType: media, upsert: false });
  if (put.error) return { error: "the file could not be stored" };
  // Read back from storage and check, never trusting the ZIP's own description.
  const downloaded = await service.storage.from("documents").download(created.storage_key);
  if (downloaded.error || !downloaded.data) return { error: "the file could not be stored" };
  const verified = await verifyDocumentStream(downloaded.data.stream(), UPLOAD_CEILING_BYTES);
  if (!verified.ok) return { error: "file is above the upload limit" };
  const finished = await service.rpc("finish_verified_document_upload", {
    p_version_id: created.version_id,
    p_actor_user_id: input.userId,
    p_sha256: verified.sha256,
    p_byte_size: verified.byteSize,
    p_detected_media_type: verified.mediaType as string,
  });
  if (finished.error) return { error: finished.error.message };
  const recorded = await owner.rpc("record_migration_document", {
    p_org: input.organizationId,
    p_batch: input.batchId,
    p_row: row.row,
    p_version: created.version_id,
  });
  if (recorded.error) return { error: recorded.error.message };
  const state = (recorded.data ?? {}) as { upload_state?: string };
  return { ok: true, uploadState: state.upload_state ?? "scanning" };
}
