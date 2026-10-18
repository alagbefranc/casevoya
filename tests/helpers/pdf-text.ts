import { inflateSync } from "node:zlib";

// Windows-1252 0x80-0x9F (Node's TextDecoder may lack it without full ICU).
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const decoder = {
  decode: (bytes: Buffer) =>
    Array.from(bytes, (byte) => (byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte))).join(""),
};

/** Every string drawn in the PDF, page by page, decoded from WinAnsi. */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const out: string[] = [];
  let index = 0;
  while ((index = raw.indexOf("stream", index)) !== -1) {
    let start = index + "stream".length;
    if (raw[start] === 0x0d) start += 1;
    if (raw[start] === 0x0a) start += 1;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    const body = raw.subarray(start, end);
    let content: Buffer | null = null;
    try {
      content = inflateSync(body);
    } catch {
      content = body;
    }
    const text = content.toString("latin1");
    for (const match of text.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      out.push(decoder.decode(Buffer.from(match[1], "hex")));
    }
    for (const match of text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(match[1]);
    index = end + "endstream".length;
  }
  return out.join("\n");
}
