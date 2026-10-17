import PostalMime from "postal-mime";
import { DEFAULT_INBOUND_EMAIL_DOMAIN, inboundDomain } from "../../../src/modules/email/addresses";
import { signPayload } from "../../../src/modules/email/sign";

export type InboundEnv = {
  INBOUND_WEBHOOK_URL: string;
  INBOUND_WEBHOOK_SECRET: string;
  INBOUND_EMAIL_DOMAIN?: string;
  /**
   * authserv-id that Cloudflare Email Routing stamps on Authentication-Results.
   * Unset means no sender is treated as verified, so every message goes to staff triage.
   * Set it only after a real delivered message shows the stamped header.
   */
  TRUSTED_AUTHSERV_ID?: string;
};

type HeaderLine = { key: string; value: string };

function domainOf(address: string): string {
  return address.split("@").pop()?.trim().toLowerCase() ?? "";
}

/**
 * True only for an aligned DMARC pass recorded by our receiving server. Only the topmost
 * Authentication-Results header is read: the receiver adds it last, and a sender can forge
 * any header below it.
 */
export function senderVerified(headers: HeaderLine[], fromAddress: string, trustedAuthservId?: string): boolean {
  const trusted = trustedAuthservId?.trim().toLowerCase();
  const fromDomain = domainOf(fromAddress);
  if (!trusted || !fromDomain) return false;
  const top = headers.find((header) => header.key.toLowerCase() === "authentication-results");
  if (!top) return false;
  const [authserv, ...results] = top.value.split(";");
  if (authserv.trim().split(/\s+/)[0]?.toLowerCase() !== trusted) return false;
  return results.some((result) => {
    const clause = result.trim().toLowerCase();
    if (!/^dmarc=pass\b/.test(clause)) return false;
    const aligned = clause.match(/header\.from=([^\s;]+)/);
    return aligned?.[1] === fromDomain;
  });
}

const MAX_BYTES = 25 * 1024 * 1024;

export type InboundEmailMessage = {
  to: string;
  from: string;
  rawSize: number;
  raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
};

export async function handleInboundEmail(message: InboundEmailMessage, env: InboundEnv, fetchImpl: typeof fetch = fetch): Promise<void> {
  const domain = inboundDomain(env.INBOUND_EMAIL_DOMAIN || DEFAULT_INBOUND_EMAIL_DOMAIN);
  const recipient = envelopeAddress(message.to);
  if (!recipient.endsWith(`@${domain}`)) {
    message.setReject("Unknown recipient domain");
    return;
  }
  if (message.rawSize > MAX_BYTES) {
    message.setReject("Message is too large");
    return;
  }
  const bytes = await readStreamOnce(message.raw);
  const parsed = await new PostalMime().parse(bytes);
  const messageId = parsed.messageId?.trim();
  if (!messageId) {
    message.setReject("Message id is required");
    return;
  }
  const attachments = [];
  for (const attachment of parsed.attachments ?? []) {
    const content = attachmentBytes(attachment.content);
    if (!content) continue;
    attachments.push({
      filename: attachment.filename ?? null,
      mimeType: attachment.mimeType ?? null,
      contentBase64: bytesToBase64(content),
    });
  }
  const from = mailboxAddress(parsed.from) || message.from;
  const body = JSON.stringify({
    from,
    senderVerified: senderVerified(parsed.headers ?? [], from, env.TRUSTED_AUTHSERV_ID),
    to: recipient,
    messageId,
    subject: parsed.subject ?? null,
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    attachments,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signPayload(env.INBOUND_WEBHOOK_SECRET, timestamp, body);
  const response = await fetchImpl(env.INBOUND_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-casevoya-timestamp": timestamp,
      "x-casevoya-signature": signature,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`inbound webhook failed: ${response.status}`);
  }
}

function mailboxAddress(from: { address?: string } | undefined): string {
  return from && typeof from.address === "string" ? from.address : "";
}

function envelopeAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

async function readStreamOnce(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) {
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function attachmentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array | null {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string" && content.length > 0) return new TextEncoder().encode(content);
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export default {
  async email(message: InboundEmailMessage, env: InboundEnv) {
    await handleInboundEmail(message, env);
  },
};
