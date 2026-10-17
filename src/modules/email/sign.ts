const encoder = new TextEncoder();

export async function signPayload(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return bufferToHex(mac);
}

/** Accepts a signature for five minutes either side of the timestamp. */
export async function verifyPayload(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!/^\d+$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const skew = Math.abs(nowMs / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;
  const expected = await signPayload(secret, timestamp, body);
  return timingSafeEqual(expected.toLowerCase(), signature.toLowerCase());
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
