/**
 * Reads a request body with a byte limit. A declared Content-Length above the limit is refused
 * before anything is read; without one, reading stops (and the stream is cancelled) as soon as
 * the count passes the limit.
 */
export type LimitedBody = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: "too_large" | "bad_length" };

/** The declared Content-Length: null when absent, "invalid" when not a plain byte count. */
export function declaredContentLength(headers: Headers): number | null | "invalid" {
  const raw = headers.get("content-length");
  if (raw === null) return null;
  const value = raw.trim();
  if (!/^\d{1,15}$/.test(value)) return "invalid";
  return Number(value);
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = declaredContentLength(request.headers);
  if (declared === "invalid") return { ok: false, reason: "bad_length" };
  if (declared !== null && declared > maxBytes) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
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
  return { ok: true, bytes };
}
