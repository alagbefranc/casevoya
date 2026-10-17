/** File-type checks for DOC-02. The database repeats these checks and is authoritative. */

export const DOCUMENT_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type DocumentMediaType = (typeof DOCUMENT_MEDIA_TYPES)[number];

export const DEFAULT_UPLOAD_BYTES = 25 * 1024 * 1024;
export const UPLOAD_CEILING_BYTES = 100 * 1024 * 1024;

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

export function detectMediaType(bytes: Uint8Array): DocumentMediaType | null {
  if (bytes.length < 8) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (bytes.length >= 12) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (box === "ftyp" && HEIC_BRANDS.has(brand)) return "image/heic";
  }
  return null;
}

export function mediaTypeForFilename(filename: string): DocumentMediaType | null {
  const ext = filename.trim().split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "heic":
    case "heif":
      return "image/heic";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return null;
  }
}

export function headerHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.subarray(0, 32)).toString("hex");
}
