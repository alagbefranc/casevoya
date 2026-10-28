import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspectDocumentBytes, verifyDocumentStream } from "@/modules/documents/verify";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORD_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const SHEET_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`;

function hex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

/** Minimal ZIP writer for fixtures. CRCs are not checked by the inspector. */
function zip(entries: { name: string; body: string; deflate?: boolean }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.body, "utf8");
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

function streamOf(bytes: Uint8Array, chunk = 7): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(position, position + chunk));
      position += chunk;
    },
  });
}

describe("server-side document byte checks", () => {
  it("recognises PDF, JPEG, PNG, and HEIC by their magic bytes", () => {
    expect(inspectDocumentBytes(hex("255044462d312e340d0a25e2"))).toBe("application/pdf");
    expect(inspectDocumentBytes(hex("ffd8ffe000104a4649460000"))).toBe("image/jpeg");
    expect(inspectDocumentBytes(hex("89504e470d0a1a0a0000000d"))).toBe("image/png");
    expect(inspectDocumentBytes(hex("000000186674797068656963"))).toBe("image/heic");
    expect(inspectDocumentBytes(hex("000000186674797061766966"))).toBeNull();
    expect(inspectDocumentBytes(hex("4d5a00000000000000000000"))).toBeNull();
    expect(inspectDocumentBytes(hex("2550"))).toBeNull();
  });

  it("accepts a DOCX only when [Content_Types].xml declares a wordprocessingml main document", () => {
    const stored = zip([
      { name: "[Content_Types].xml", body: WORD_TYPES },
      { name: "word/document.xml", body: "<w:document/>" },
    ]);
    expect(inspectDocumentBytes(stored)).toBe(DOCX);
    const deflated = zip([
      { name: "word/document.xml", body: "<w:document/>", deflate: true },
      { name: "[Content_Types].xml", body: WORD_TYPES, deflate: true },
    ]);
    expect(inspectDocumentBytes(deflated)).toBe(DOCX);

    expect(inspectDocumentBytes(zip([{ name: "[Content_Types].xml", body: SHEET_TYPES }]))).toBeNull();
    expect(inspectDocumentBytes(zip([{ name: "readme.txt", body: "wordprocessingml" }]))).toBeNull();
    expect(inspectDocumentBytes(zip([{ name: "payload.exe", body: "MZ" }]))).toBeNull();
    expect(inspectDocumentBytes(hex("504b03041400000008000000"))).toBeNull();
  });

  it("refuses a Word package that declares macros (DOC-02): never opened, never run", () => {
    const withVba = WORD_TYPES.replace(
      "</Types>",
      '<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>\n</Types>',
    );
    expect(inspectDocumentBytes(zip([{ name: "[Content_Types].xml", body: withVba }, { name: "word/document.xml", body: "<w:document/>" }]))).toBeNull();
    const docm = WORD_TYPES.replace("officedocument.wordprocessingml.document.main+xml", "ms-word.document.macroEnabled.main+xml");
    expect(inspectDocumentBytes(zip([{ name: "[Content_Types].xml", body: docm }]))).toBeNull();
  });

  it("hashes and sizes the whole stream and reports the verified type", async () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n% synthetic\n%%EOF\n", "latin1"));
    const result = await verifyDocumentStream(streamOf(pdf), 1024);
    expect(result).toEqual({
      ok: true,
      byteSize: pdf.length,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      mediaType: "application/pdf",
    });

    const docx = zip([{ name: "[Content_Types].xml", body: WORD_TYPES, deflate: true }]);
    const docxResult = await verifyDocumentStream(streamOf(docx, 5), 1024);
    expect(docxResult).toMatchObject({ ok: true, byteSize: docx.length, mediaType: DOCX });

    const other = zip([{ name: "[Content_Types].xml", body: SHEET_TYPES }]);
    expect(await verifyDocumentStream(streamOf(other), 1024)).toMatchObject({ ok: true, mediaType: null });

    expect(await verifyDocumentStream(streamOf(pdf), 10)).toEqual({ ok: false, reason: "too_large" });
  });
});
