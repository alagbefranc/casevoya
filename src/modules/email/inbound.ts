import { createHash } from "node:crypto";

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

export type InboundDeps = {
  domain: string;
  begin: (input: InboundPayload & { domain: string }) => Promise<BeginResult>;
  createIntent: (input: {
    inboundId: string;
    ordinal: number;
    filename: string;
    byteSize: number;
  }) => Promise<StoredIntent>;
  completeUpload: (input: { inboundId: string; ordinal: number; sha256: string; headerHex: string }) => Promise<void>;
  openUnsorted: (input: {
    inboundId: string;
    ordinal: number;
    filename: string;
    byteSize: number;
  }) => Promise<StoredIntent>;
  finishUnsorted: (input: { inboundId: string; ordinal: number; sha256: string; headerHex: string }) => Promise<void>;
  putObject: (input: { key: string; bytes: Uint8Array; contentType: string }) => Promise<void>;
  finishMessage: (inboundId: string) => Promise<void>;
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

export function safeAttachmentName(filename: string | null | undefined, mimeType: string | null | undefined): string | null {
  const base = (filename ?? "").split(/[/\\]/).pop()?.trim() ?? "";
  const cleaned = base.replace(/[^\w.\- ]+/g, "").slice(0, 300);
  if (/\.(pdf|jpe?g|png|heic|heif|docx)$/i.test(cleaned)) return cleaned;
  const extension = mimeType ? EXTENSIONS[mimeType.toLowerCase()] : undefined;
  if (!extension) return null;
  return `attachment.${extension}`;
}

const STOP = new Set(["duplicate", "unknown_firm", "reserved", "bad_address", "rate_limited"]);

export async function processInboundEmail(payload: InboundPayload, deps: InboundDeps): Promise<{ status: string }> {
  const begun = await deps.begin({ ...payload, domain: deps.domain });
  if (STOP.has(begun.status) || !begun.inbound_email_id) return { status: begun.status };
  if (begun.attachments_done) return { status: "duplicate" };

  const attachments = (payload.attachments ?? []).slice(0, 20);
  let ordinal = 0;
  for (const attachment of attachments) {
    const filename = safeAttachmentName(attachment.filename, attachment.mimeType);
    if (!filename) continue;
    const bytes = decodeBase64(attachment.contentBase64);
    if (bytes.byteLength < 1) continue;
    const sha256 = sha256Hex(bytes);
    const header = headerHex(bytes);
    const linked = Boolean(begun.person_id && begun.matter_id);
    if (linked) {
      const intent = await deps.createIntent({
        inboundId: begun.inbound_email_id,
        ordinal,
        filename,
        byteSize: bytes.byteLength,
      });
      if (!intent.already_complete) {
        await deps.putObject({
          key: intent.storage_key,
          bytes,
          contentType: intent.declared_media_type ?? attachment.mimeType ?? "application/octet-stream",
        });
        await deps.completeUpload({ inboundId: begun.inbound_email_id, ordinal, sha256, headerHex: header });
      }
    } else {
      const opened = await deps.openUnsorted({
        inboundId: begun.inbound_email_id,
        ordinal,
        filename,
        byteSize: bytes.byteLength,
      });
      if (!opened.already_complete) {
        await deps.putObject({
          key: opened.storage_key,
          bytes,
          contentType: attachment.mimeType ?? "application/octet-stream",
        });
        await deps.finishUnsorted({ inboundId: begun.inbound_email_id, ordinal, sha256, headerHex: header });
      }
    }
    ordinal += 1;
  }
  await deps.finishMessage(begun.inbound_email_id);
  return { status: begun.status === "resume" ? "resumed" : "accepted" };
}
