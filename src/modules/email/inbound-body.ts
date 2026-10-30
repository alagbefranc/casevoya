/**
 * Inbound webhook body limit: a 25 MB message is about 34 MB once base64-encoded in JSON, so
 * 36 MB is the cap. A declared content-length above it is refused before reading; without one the
 * stream is read only up to the cap.
 */
export const INBOUND_BODY_LIMIT_BYTES = 36 * 1024 * 1024;

export type LimitedBody = { ok: true; text: string } | { ok: false; status: 400 | 413 };

export async function readBodyWithLimit(request: Request, limit: number = INBOUND_BODY_LIMIT_BYTES): Promise<LimitedBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return { ok: false, status: 400 };
    if (length > limit) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value || next.value.byteLength === 0) continue;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/** HTTP status for a processed inbound message. Refusals that are not final are never 2xx. */
export function inboundResultStatus(status: string): number {
  if (status === "unknown_firm" || status === "reserved" || status === "bad_address") return 422;
  if (status === "rate_limited") return 429;
  if (status === "attachments_refused") return 413;
  return 200;
}
