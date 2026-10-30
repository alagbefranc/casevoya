import { createHash } from "node:crypto";
import { inspectDocumentBytes } from "@/modules/documents/verify";

export type InboundAttachment = {
  filename?: string | null;
  mimeType?: string | null;
  contentBase64: string;
};

export type InboundPayload = {
  from: string;
  to: string;
  messageId: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  /** Set by the inbound worker after an aligned DMARC pass. Unverified mail is never matched to a client. */
  senderVerified?: boolean;
  attachments?: InboundAttachment[];
};

export type BeginResult = {
  status: string;
  inbound_email_id?: string;
  organization_id?: string;
  matter_id?: string | null;
  person_id?: string | null;
  attachments_done?: boolean;
};

export type StoredIntent = {
  storage_key: string;
  already_complete?: boolean;
  declared_media_type?: string;
};

export type AbandonReason = "attachment_limit" | "attachment_error";

export type InboundDeps = {
  domain: string;
  /** contentDigest binds a repeated Message-ID to the same sender and content (see inboundContentDigest). */
  begin: (input: InboundPayload & { domain: string; contentDigest: string }) => Promise<BeginResult>;
  createIntent: (input: {
    inboundId: string;
    ordinal: number;
    filename: string;
    byteSize: number;
  }) => Promise<StoredIntent>;
  /** Completion with values measured here, on the server (DOCX package inspected), never header bytes alone. */
  completeUpload: (input: {
    inboundId: string;
    ordinal: number;
    sha256: string;
    byteSize: number;
    mediaType: string | null;
  }) => Promise<void>;
  openUnsorted: (input: {
    inboundId: string;
    ordinal: number;
    filename: string;
    byteSize: number;
  }) => Promise<StoredIntent>;
  finishUnsorted: (input: { inboundId: string; ordinal: number; sha256: string; headerHex: string }) => Promise<void>;
  putObject: (input: { key: string; bytes: Uint8Array; contentType: string }) => Promise<void>;
  finishMessage: (inboundId: string) => Promise<void>;
  /** Closes a message whose attachment step failed so it cannot be resumed. */
  abandonMessage: (inboundId: string, reason: AbandonReason) => Promise<void>;
};

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function headerHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.subarray(0, 32)).toString("hex");
}

export function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/** SHA-256 over the subject, text body and attachment SHA-256 list, computed by the app server. */
export function inboundContentDigest(subject: string | null | undefined, text: string | null | undefined, attachmentHashes: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([subject ?? "", text ?? "", attachmentHashes]))
    .digest("hex");
}

export function safeAttachmentName(filename: string | null | undefined, mimeType: string | null | undefined): string | null {
  const base = (filename ?? "").split(/[/\\]/).pop()?.trim() ?? "";
  const cleaned = base.replace(/[^\w.\- ]+/g, "").slice(0, 300);
  if (/\.(pdf|jpe?g|png|heic|heif|docx)$/i.test(cleaned)) return cleaned;
  const extension = mimeType ? EXTENSIONS[mimeType.toLowerCase()] : undefined;
  if (!extension) return null;
  return `attachment.${extension}`;
}

const STOP = new Set(["duplicate", "unknown_firm", "reserved", "bad_address", "rate_limited"]);
const ATTACHMENT_LIMIT = /inbound attachment limit/i;

export async function processInboundEmail(payload: InboundPayload, deps: InboundDeps): Promise<{ status: string }> {
  const decoded = (payload.attachments ?? []).map((attachment) => {
    const bytes = decodeBase64(attachment.contentBase64);
    return { attachment, bytes, sha256: sha256Hex(bytes) };
  });
  const contentDigest = inboundContentDigest(
    payload.subject,
    payload.text,
    decoded.map((item) => item.sha256),
  );
  const begun = await deps.begin({ ...payload, domain: deps.domain, contentDigest });
  if (STOP.has(begun.status) || !begun.inbound_email_id) return { status: begun.status };
  if (begun.attachments_done) return { status: "duplicate" };
  const inboundId = begun.inbound_email_id;
  const linked = Boolean(begun.person_id && begun.matter_id);

  try {
    let ordinal = 0;
    for (const { attachment, bytes, sha256 } of decoded.slice(0, 20)) {
      const filename = safeAttachmentName(attachment.filename, attachment.mimeType);
      if (!filename) continue;
      if (bytes.byteLength < 1) continue;
      if (linked) {
        const intent = await deps.createIntent({ inboundId, ordinal, filename, byteSize: bytes.byteLength });
        if (!intent.already_complete) {
          await deps.putObject({
            key: intent.storage_key,
            bytes,
            contentType: intent.declared_media_type ?? attachment.mimeType ?? "application/octet-stream",
          });
          await deps.completeUpload({
            inboundId,
            ordinal,
            sha256,
            byteSize: bytes.byteLength,
            mediaType: inspectDocumentBytes(bytes),
          });
        }
      } else {
        const opened = await deps.openUnsorted({ inboundId, ordinal, filename, byteSize: bytes.byteLength });
        if (!opened.already_complete) {
          await deps.putObject({
            key: opened.storage_key,
            bytes,
            contentType: attachment.mimeType ?? "application/octet-stream",
          });
          await deps.finishUnsorted({ inboundId, ordinal, sha256, headerHex: headerHex(bytes) });
        }
      }
      ordinal += 1;
    }
  } catch (error) {
    const limited = error instanceof Error && ATTACHMENT_LIMIT.test(error.message);
    await deps.abandonMessage(inboundId, limited ? "attachment_limit" : "attachment_error");
    if (limited) return { status: "attachments_refused" };
    throw error;
  }
  await deps.finishMessage(inboundId);
  return { status: begun.status === "resume" ? "resumed" : "accepted" };
}
