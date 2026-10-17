import "server-only";
import { processInboundEmail, type BeginResult, type InboundPayload, type StoredIntent } from "@/modules/email/inbound";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asBegin(value: unknown): BeginResult {
  const record = asRecord(value);
  return {
    status: typeof record.status === "string" ? record.status : "bad_address",
    inbound_email_id: typeof record.inbound_email_id === "string" ? record.inbound_email_id : undefined,
    organization_id: typeof record.organization_id === "string" ? record.organization_id : undefined,
    matter_id: typeof record.matter_id === "string" ? record.matter_id : null,
    person_id: typeof record.person_id === "string" ? record.person_id : null,
    attachments_done: record.attachments_done === true,
  };
}

function asIntent(value: unknown): StoredIntent {
  const record = asRecord(value);
  if (typeof record.storage_key !== "string") throw new Error("Upload did not return a storage key.");
  return {
    storage_key: record.storage_key,
    already_complete: record.already_complete === true,
    declared_media_type: typeof record.declared_media_type === "string" ? record.declared_media_type : undefined,
  };
}

export async function runInboundEmail(payload: InboundPayload) {
  const config = emailRuntimeConfig();
  const supabase = createServiceClient();
  return processInboundEmail(payload, {
    domain: config.inboundDomain,
    async begin(input) {
      const { data, error } = await supabase.rpc("begin_inbound_message", {
        p_to: input.to,
        p_from: input.from,
        p_message_id: input.messageId,
        p_subject: input.subject ?? "",
        p_text: input.text ?? "",
        p_html: input.html ?? "",
        p_domain: input.domain,
      });
      if (error) throw new Error(error.message);
      return asBegin(data);
    },
    async createIntent(input) {
      const { data, error } = await supabase.rpc("create_email_upload_intent", {
        p_inbound_id: input.inboundId,
        p_ordinal: input.ordinal,
        p_filename: input.filename,
        p_byte_size: input.byteSize,
      });
      if (error) throw new Error(error.message);
      return asIntent(data);
    },
    async completeUpload(input) {
      const { error } = await supabase.rpc("complete_email_upload", {
        p_inbound_id: input.inboundId,
        p_ordinal: input.ordinal,
        p_sha256: input.sha256,
        p_header_hex: input.headerHex,
      });
      if (error) throw new Error(error.message);
    },
    async openUnsorted(input) {
      const { data, error } = await supabase.rpc("open_unsorted_email_file", {
        p_inbound_id: input.inboundId,
        p_ordinal: input.ordinal,
        p_filename: input.filename,
        p_byte_size: input.byteSize,
      });
      if (error) throw new Error(error.message);
      return asIntent(data);
    },
    async finishUnsorted(input) {
      const { error } = await supabase.rpc("finish_unsorted_email_file", {
        p_inbound_id: input.inboundId,
        p_ordinal: input.ordinal,
        p_sha256: input.sha256,
        p_header_hex: input.headerHex,
      });
      if (error) throw new Error(error.message);
    },
    async putObject(input) {
      const { error } = await supabase.storage.from("documents").upload(input.key, Buffer.from(input.bytes), {
        contentType: input.contentType,
        upsert: false,
      });
      if (error) throw new Error(error.message);
    },
    async finishMessage(inboundId) {
      const { error } = await supabase.rpc("finish_inbound_attachments", { p_inbound_id: inboundId });
      if (error) throw new Error(error.message);
    },
  });
}
