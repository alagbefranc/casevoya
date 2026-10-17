/** PostgREST returns bytea as a `\x` hex string. A base64 body is accepted too. */
export function pdfBytes(value: string | null | undefined): Uint8Array | null {
  if (!value) return null;
  const bytes = value.startsWith("\\x") ? fromHex(value.slice(2)) : Buffer.from(value, "base64");
  if (!bytes || bytes.length < 5) return null;
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) return null;
  return Uint8Array.from(bytes);
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[index] = byte;
  }
  return bytes;
}
