"use client";

import { createClient } from "@/lib/supabase/client";
import { completeDocumentUpload, createUploadIntent } from "@/modules/documents/actions";
import { checkUploadFile, uploadFailure, type UploadFailure } from "@/modules/portal/upload-failure";

/** DES-04: the failure in one line for a form field: what happened, then what to do. */
function said(failure: UploadFailure): { error: string; failure: UploadFailure } {
  return { error: `${failure.title}. ${failure.copy}`, failure };
}

/**
 * The portal's ordinary upload flow (the same calls as Documents > Upload): an upload intent for the
 * person's own document on the matter, the file to storage, then the server's file check. The file
 * is a document of that person like any other; the firm still reviews it. A failure names its kind
 * (wrong type, too large, the check, an expired link, the connection) and what to do next.
 */
export async function uploadOwnFile(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  purpose: string;
  file: File;
}): Promise<{ documentId: string; uploadState: string } | { error: string; failure?: UploadFailure }> {
  const refused = checkUploadFile(input.file);
  if (refused) return said(refused);
  try {
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
    if ("error" in intent) return said(uploadFailure({ stage: "intent", message: intent.error ?? null }));
    const uploaded = await createClient().storage.from("documents").uploadToSignedUrl(intent.path, intent.token, input.file);
    if (uploaded.error) return said(uploadFailure({ stage: "transfer", message: uploaded.error.message }));
    const done = await completeDocumentUpload({ organizationId: input.organizationId, versionId: intent.versionId });
    if ("error" in done) return said(uploadFailure({ stage: "check", message: done.error ?? null }));
    if (done.uploadState === "quarantined" || done.uploadState === "failed") return said(uploadFailure({ stage: "check", state: done.uploadState, scanResult: done.scanResult }));
    return { documentId: intent.documentId, uploadState: done.uploadState ?? "scanning" };
  } catch {
    return said(uploadFailure({ stage: "transfer", thrown: true }));
  }
}
