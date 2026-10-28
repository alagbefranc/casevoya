/**
 * The portable client-file package (T040): record JSON files, document files, an audit trail,
 * a manifest (JSON, with the SHA-256 of every file and where it came from) and a PDF summary of
 * the manifest, in one ZIP. Pure: the server collects the inputs as the requesting staff member.
 */
import { reportPdf, type ReportFile } from "@/modules/sheet/reports-export";
import { buildZip, safeZipPath, type ZipEntry } from "./zip";

/** Built on request on Workers (no long-running jobs): keep each package small enough to build in one request. */
export const EXPORT_LIMITS = { maxDocumentBytes: 40 * 1024 * 1024, maxDocuments: 200, maxRowsPerSource: 2000 } as const;

export type ExportRecordSet = { path: string; source: string; rows: unknown[] };
export type ExportFile = {
  path: string;
  bytes: Uint8Array;
  source: string;
  sourceId: string;
  /** The checksum recorded when the file was uploaded, to compare with what was packaged. */
  storedSha256: string | null;
  mediaType: string | null;
};
export type ExportExcluded = { path: string; source: string; sourceId: string; reason: string };

export type ExportRulePin = {
  rulePackVersionId: string;
  programKey: string | null;
  packVersion: number | null;
  forms: { form_number: string; date_modified: string | null; source_url: string | null; content_hash: string | null }[];
};

/** "v2 (study_permit); forms IMM 5483 (date modified 2024-05-01)", or "None pinned". */
export function rulePinLine(pin: ExportRulePin | null): string {
  if (!pin) return "None pinned";
  const forms = pin.forms.map((form) => `${form.form_number} (date modified ${form.date_modified ?? "Unknown"})`);
  return `v${pin.packVersion ?? "?"}${pin.programKey ? ` (${pin.programKey})` : ""}${forms.length ? `; forms ${forms.join(", ")}` : "; no form versions"}`;
}

export type ExportMeta = {
  exportId: string;
  firm: string;
  matterReference: string;
  matterTitle: string;
  generatedAt: string;
  generatedBy: string;
  timezone: string;
  /**
   * SRC-05: the rule pack and IRCC form versions pinned on the matter when the export was requested
   * (null: none pinned). Absent (a privacy response), the manifest leaves it out.
   */
  rulePin?: ExportRulePin | null;
  /** SEC-06: a privacy access response reuses this package with its own format name, title and scope. */
  format?: string;
  title?: string;
  scope?: string;
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

export type BuiltPackage = {
  zip: Uint8Array;
  sha256: string;
  manifestSha256: string;
  fileCount: number;
  recordCount: number;
  contents: Record<string, number>;
  excluded: ExportExcluded[];
};

export async function buildExportPackage(meta: ExportMeta, records: ExportRecordSet[], files: ExportFile[], excluded: ExportExcluded[]): Promise<BuiltPackage> {
  const at = new Date(meta.generatedAt);
  const entries: ZipEntry[] = [];
  const listed: { path: string; bytes: number; sha256: string; source: string; source_id: string | null; stored_sha256: string | null; matches_stored: boolean | null }[] = [];
  const contents: Record<string, number> = {};
  let recordCount = 0;

  for (const set of records) {
    const bytes = json({ source: set.source, retrieved_at: meta.generatedAt, rows: set.rows });
    const path = safeZipPath(set.path);
    entries.push({ path, bytes, modified: at });
    listed.push({ path, bytes: bytes.length, sha256: await sha256Hex(bytes), source: set.source, source_id: null, stored_sha256: null, matches_stored: null });
    contents[set.source] = set.rows.length;
    recordCount += set.rows.length;
  }
  for (const file of files) {
    const path = safeZipPath(file.path);
    const sha = await sha256Hex(file.bytes);
    entries.push({ path, bytes: file.bytes, modified: at });
    listed.push({
      path,
      bytes: file.bytes.length,
      sha256: sha,
      source: file.source,
      source_id: file.sourceId,
      stored_sha256: file.storedSha256,
      matches_stored: file.storedSha256 ? file.storedSha256.toLowerCase() === sha : null,
    });
  }
  contents.documents = files.length;

  const manifest = {
    format: meta.format ?? "casevoya.client-file-export",
    format_version: 1,
    export_id: meta.exportId,
    firm: meta.firm,
    matter: { reference: meta.matterReference, title: meta.matterTitle },
    generated_at: meta.generatedAt,
    generated_by: meta.generatedBy,
    timezone: meta.timezone,
    scope: meta.scope ?? "Records and documents the requesting staff member could read when the export was made (row-level security).",
    hash: "SHA-256 of each file's exact bytes in this archive.",
    ...(meta.rulePin === undefined
      ? {}
      : {
          rule_pack: meta.rulePin
            ? { rule_pack_version_id: meta.rulePin.rulePackVersionId, program_key: meta.rulePin.programKey, pack_version: meta.rulePin.packVersion, forms: meta.rulePin.forms }
            : null,
        }),
    limits: EXPORT_LIMITS,
    files: listed,
    excluded,
  };
  const manifestBytes = json(manifest);
  const manifestSha256 = await sha256Hex(manifestBytes);
  entries.push({ path: "manifest.json", bytes: manifestBytes, modified: at });

  const summary: ReportFile = {
    title: meta.title ?? `Client-file export, ${meta.matterReference}`,
    meta: [
      ["Firm", meta.firm],
      ["Matter", `${meta.matterReference}: ${meta.matterTitle}`],
      ["Generated", `${meta.generatedAt} (UTC)`],
      ["Generated by", meta.generatedBy],
      ["Export", meta.exportId],
      ...(meta.rulePin === undefined ? [] : [["Rule pack and forms", rulePinLine(meta.rulePin)] as [string, string]]),
      ["manifest.json SHA-256", manifestSha256],
    ],
    sections: [
      { title: "Files", head: ["Path", "Bytes", "SHA-256"], rows: listed.map((file) => [file.path, String(file.bytes), file.sha256]) },
      ...(excluded.length ? [{ title: "Not included", head: ["Path", "Reason"], rows: excluded.map((file) => [file.path, file.reason]) }] : []),
    ],
  };
  entries.push({ path: "manifest.pdf", bytes: await reportPdf(summary), modified: at });

  const zip = buildZip(entries);
  return { zip, sha256: await sha256Hex(zip), manifestSha256, fileCount: entries.length, recordCount, contents, excluded };
}
