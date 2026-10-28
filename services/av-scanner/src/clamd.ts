/**
 * The clamd protocol, pure (no sockets), so it can be tested without ClamAV. Commands use the
 * "z" form (NUL-terminated); INSTREAM sends the file as chunks, each a 4-byte big-endian length
 * then the bytes, ended by a zero-length chunk. Reference: clamd(8), "COMMANDS"
 * (https://docs.clamav.net/manual/Usage/Scanning.html#clamd, read 2026-10-28).
 */

export type ClamdVerdict =
  | { result: "clean" }
  | { result: "infected"; signature: string }
  | { result: "error"; reason: "limits" | "clamd" };

/** The largest INSTREAM chunk sent at once. */
export const CHUNK_BYTES = 64 * 1024;

export function command(name: "PING" | "VERSION" | "INSTREAM"): Uint8Array {
  return new TextEncoder().encode(`z${name}\0`);
}

/** The INSTREAM body: length-prefixed chunks, then four zero bytes. */
export function* instreamFrames(bytes: Uint8Array, chunk = CHUNK_BYTES): Generator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
    const part = bytes.subarray(offset, Math.min(offset + chunk, bytes.byteLength));
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, part.byteLength, false);
    yield header;
    yield part;
  }
  yield new Uint8Array(4);
}

/** One reply, without its NUL terminator and surrounding space. */
export function replyText(raw: Uint8Array | string): string {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  return text.replace(/\0+$/g, "").trim();
}

/**
 * An INSTREAM reply: "stream: OK", "stream: <signature> FOUND", or an error such as
 * "INSTREAM size limit exceeded. ERROR". A limits heuristic (the file was too large or too deep
 * to scan fully) is not a virus and not clean: it is an error, so the file stays held.
 */
export function parseScanReply(raw: Uint8Array | string): ClamdVerdict {
  const text = replyText(raw);
  if (/^stream: OK$/.test(text)) return { result: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) {
    const signature = found[1].trim().slice(0, 200);
    if (/^Heuristics\.Limits\.Exceeded/i.test(signature)) return { result: "error", reason: "limits" };
    return { result: "infected", signature };
  }
  if (/size limit exceeded/i.test(text)) return { result: "error", reason: "limits" };
  return { result: "error", reason: "clamd" };
}

/** "ClamAV 1.4.3/27800/Tue Oct 28 08:20:00 2026" -> "ClamAV 1.4.3/27800": engine and signature database. */
export function engineName(raw: Uint8Array | string): string | null {
  const text = replyText(raw);
  const match = /^(ClamAV [^/\s]+(?:\/\d+)?)/.exec(text);
  return match ? match[1] : null;
}

/** The HTTP answer the app's scanner client reads (src/modules/documents/virus-scan.ts). */
export function scanResponse(verdict: ClamdVerdict, engine: string | null): { status: number; body: Record<string, unknown> } {
  if (verdict.result === "clean") return { status: 200, body: { result: "clean", engine } };
  if (verdict.result === "infected") return { status: 200, body: { result: "infected", signature: verdict.signature, engine } };
  return { status: verdict.reason === "limits" ? 413 : 503, body: { result: "error", reason: verdict.reason, engine } };
}
