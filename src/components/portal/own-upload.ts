"use client";

import { createClient } from "@/lib/supabase/client";
import { completeDocumentUpload, createUploadIntent } from "@/modules/documents/actions";

/**
 * The portal's ordinary upload flow (the same calls as Documents > Upload): an upload intent for the
 * person's own document on the matter, the file to storage, then the server's file check. The file
 * is a document of that person like any other; the firm still reviews it.
 */
export async function uploadOwnFile(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  purpose: string;
  file: File;
}): Promise<{ documentId: string; uploadState: string } | { error: string }> {
  const intent = await createUploadIntent({
    organizationId: input.organizationId,
    matterId: input.matterId,
    personId: input.personId,
    filename: input.file.name,
    byteSize: input.file.size,
    purpose: input.purpose.slice(0, 200),
    sensitivity: "ordinary",
    audience: "subject",
    documentId: null,
    requestId: null,
    code: null,
  });
  if ("error" in intent) return { error: intent.error ?? "The upload could not start." };
  const uploaded = await createClient().storage.from("documents").uploadToSignedUrl(intent.path, intent.token, input.file);
  if (uploaded.error) return { error: "The file did not finish uploading. Try again." };
  const done = await completeDocumentUpload({ organizationId: input.organizationId, versionId: intent.versionId });
  if ("error" in done) return { error: done.error ?? "The file could not be checked." };
  if (done.uploadState === "quarantined") return { error: "The file contents don’t match the file name, so it wasn’t accepted. Try another copy." };
  if (done.uploadState === "failed") return { error: "The file could not be checked, so it wasn’t accepted. Try again." };
  return { documentId: intent.documentId, uploadState: done.uploadState ?? "scanning" };
}
