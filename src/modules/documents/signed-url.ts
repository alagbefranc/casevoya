/**
 * #302: browsers and staff tokens can no longer read or sign objects in the private "documents"
 * bucket (app.can_read_storage_object is false since 20261104100000). Every read goes through the
 * audited public.authorize_document_download first, as the person, and then the server signs or
 * downloads with the service role, for a lifetime the server chooses and no caller can stretch.
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/** The app's own download link: the lifetime the grant returns (documents.signed_url_seconds, 120 s), capped at 120 s. */
export const DOCUMENT_LINK_MAX_SECONDS = 120;
/** Vo's one-time read of the file it was asked to review: it fetches at once, so 60 s is plenty. */
export const VO_FILE_URL_SECONDS = 60;

export type DocumentGrant = { bucket: string; storageKey: string; seconds: number };

/** The bucket, key and lifetime from authorize_document_download's result; null if it isn't one. */
export function documentGrant(data: unknown): DocumentGrant | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.bucket !== "documents" || typeof record.storage_key !== "string" || !record.storage_key) return null;
  const seconds = typeof record.seconds === "number" && record.seconds > 0 ? record.seconds : DOCUMENT_LINK_MAX_SECONDS;
  return { bucket: record.bucket, storageKey: record.storage_key, seconds };
}

/** The short lifetime actually used: never longer than the grant, never longer than the cap. */
export function linkSeconds(grantSeconds: number, cap: number): number {
  return Math.max(1, Math.min(Math.floor(grantSeconds), cap));
}

/** A fresh signed URL for an authorized grant, signed by the server with its own short lifetime. */
export async function signDocumentGrant(grant: DocumentGrant, cap: number = DOCUMENT_LINK_MAX_SECONDS): Promise<{ url: string; seconds: number } | null> {
  const seconds = linkSeconds(grant.seconds, cap);
  const signed = await createServiceClient().storage.from(grant.bucket).createSignedUrl(grant.storageKey, seconds);
  if (signed.error || !signed.data?.signedUrl) return null;
  return { url: signed.data.signedUrl, seconds };
}

/** The bytes of an authorized grant, read by the server. */
export async function downloadDocumentGrant(grant: DocumentGrant): Promise<Blob | null> {
  const { data } = await createServiceClient().storage.from(grant.bucket).download(grant.storageKey);
  return data ?? null;
}
