/**
 * What a Vo document reading may read, as the requesting staff member (PRD AI-05): a Supabase
 * client built from THEIR short-lived access token and the publishable key, so Postgres RLS and
 * the document functions decide everything. The file itself is fetched exactly like the app's
 * "Open file": public.authorize_document_download (role, matter scope, fresh second factor,
 * audited document.download, a short-lived grant for this user and object), then a Storage
 * download that the storage policy allows only with that grant. No service-role key exists here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.types";
import type { VoDocSettings } from "../../../src/modules/vo/vo-doc";

export type VoDocVersion = {
  id: string;
  documentId: string;
  versionNumber: number;
  filename: string;
  /** What the upload check detected, else what the uploader declared. */
  mediaType: string;
  byteSize: number;
  uploadState: string;
  purpose: string;
  sensitivity: string;
};

/** The narrow surface the reading uses. Tests pass a fake; production uses supabaseVoDocData. */
export interface VoDocData {
  settings(): Promise<VoDocSettings | null>;
  version(versionId: string): Promise<VoDocVersion | null>;
  /** The file's bytes, after a fresh audited authorization as the staff member; null if refused. */
  download(versionId: string, maxBytes: number): Promise<Uint8Array | null>;
  rpc(name: "finish_vo_document_review", args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

export function supabaseVoDocData(input: { url: string; publishableKey: string; accessToken: string; organizationId: string }): VoDocData {
  const db: SupabaseClient<Database> = createClient<Database>(input.url, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${input.accessToken}`, "x-casevoya-org": input.organizationId } },
  });
  const org = input.organizationId;
  return {
    async settings() {
      const { data } = await db.from("vo_settings").select("*").eq("organization_id", org).maybeSingle();
      return (data as VoDocSettings | null) ?? null;
    },
    async version(versionId) {
      const { data: row } = await db
        .from("document_versions")
        .select("id, document_id, version_number, original_filename, declared_media_type, detected_media_type, byte_size, declared_byte_size, upload_state")
        .eq("organization_id", org)
        .eq("id", versionId)
        .maybeSingle();
      if (!row) return null;
      const { data: doc } = await db.from("documents").select("purpose, sensitivity").eq("organization_id", org).eq("id", row.document_id).maybeSingle();
      if (!doc) return null;
      return {
        id: row.id,
        documentId: row.document_id,
        versionNumber: row.version_number,
        filename: row.original_filename,
        mediaType: row.detected_media_type ?? row.declared_media_type,
        byteSize: Number(row.byte_size ?? row.declared_byte_size),
        uploadState: String(row.upload_state),
        purpose: doc.purpose,
        sensitivity: String(doc.sensitivity),
      };
    },
    async download(versionId, maxBytes) {
      const { data, error } = await db.rpc("authorize_document_download", { p_version_id: versionId });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
      const grant = data as { bucket?: unknown; storage_key?: unknown };
      if (grant.bucket !== "documents" || typeof grant.storage_key !== "string") return null;
      const file = await db.storage.from("documents").download(grant.storage_key);
      if (file.error || !file.data || file.data.size > maxBytes) return null;
      return new Uint8Array(await file.data.arrayBuffer());
    },
    async rpc(name, args) {
      const { data, error } = await db.rpc(name, args as never);
      return { data, error: error ? { message: error.message } : null };
    },
  };
}
