import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { detectMediaType, headerHex, mediaTypeForFilename } from "@/modules/documents/files";

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

describe("document file types", () => {
  it("recognises the allowed signatures and ignores the filename", () => {
    expect(detectMediaType(bytes("255044462d312e340d0a25e2"))).toBe("application/pdf");
    expect(detectMediaType(bytes("ffd8ffe000104a4649460000"))).toBe("image/jpeg");
    expect(detectMediaType(bytes("89504e470d0a1a0a0000000d"))).toBe("image/png");
    expect(detectMediaType(bytes("504b03041400000008000000"))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(detectMediaType(bytes("000000186674797068656963"))).toBe("image/heic");
    expect(detectMediaType(bytes("4d5a00000000000000000000"))).toBeNull();
    expect(mediaTypeForFilename("passport.PDF")).toBe("application/pdf");
    expect(mediaTypeForFilename("photo.jpeg")).toBe("image/jpeg");
    expect(mediaTypeForFilename("notes.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mediaTypeForFilename("archive.zip")).toBeNull();
    expect(headerHex(bytes("25504446"))).toBe("25504446");
    expect(createHash("sha256").update(bytes("25504446")).digest("hex")).toHaveLength(64);
  });
});
