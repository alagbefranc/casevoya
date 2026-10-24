import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetSettingsSecurity } from "@/components/sheet/designer/settings";
import { queueEntry, scanChip, type VersionFacts } from "@/modules/sheet/documents-present";
import { effectiveUploadLimit, securityData } from "@/modules/sheet/settings-present";

// DOC-02 (#178): an honest scan label, and the per-file upload limit on Settings > Security.
// Synthetic records only.

const MB = 1024 * 1024;

const version = (engine: string | null | undefined): VersionFacts => ({
  id: "v1",
  documentId: "d1",
  versionNumber: 1,
  uploadState: "clean",
  scanResult: "passed",
  scanEngine: engine,
  reviewState: "pending",
  declaredMediaType: "application/pdf",
  expiresOn: null,
  supersededAt: null,
  intentExpiresAt: "2026-10-24T10:00:00Z",
  createdAt: "2026-10-24T09:00:00Z",
});

describe("scan label", () => {
  it("says Clean only when a scanner checked the file", () => {
    expect(scanChip("worker")).toEqual({ tone: "ok", label: "Clean" });
    expect(scanChip("structural_only")).toEqual({ tone: "unv", label: "Type checked, not virus-scanned" });
    expect(scanChip(null)).toEqual({ tone: "unv", label: "Type checked, not virus-scanned" });
    expect(queueEntry(version("structural_only"), "2026-10-24")?.scan).toEqual({ tone: "unv", label: "Type checked, not virus-scanned" });
    // The Designer's sample (no engine field) keeps its captured "Clean".
    expect(queueEntry(version(undefined), "2026-10-24")?.scan).toEqual({ tone: "ok", label: "Clean" });
  });
});

describe("upload limit", () => {
  it("follows app.document_max_bytes: 25 MB by default, above 25 MB only once larger uploads are validated, never above 100 MB", () => {
    expect(effectiveUploadLimit(null, false)).toBe(25 * MB);
    expect(effectiveUploadLimit(30 * MB, false)).toBe(25 * MB);
    expect(effectiveUploadLimit(30 * MB, true)).toBe(30 * MB);
    expect(effectiveUploadLimit(10 * MB, false)).toBe(10 * MB);
    expect(effectiveUploadLimit(200 * MB, true)).toBe(100 * MB);
  });

  const base = { members: 2, security: null, events: null, timeZone: "UTC", organizationId: "o1" };

  it("shows the limit to everyone and the Change limit dialog to the owner", () => {
    const owner = securityData({ ...base, owner: true, upload: { bytes: 25 * MB, largeAllowed: false } });
    const row = owner.rows.find((item) => item.title === "Upload limit per file");
    expect(row?.badge).toEqual({ tone: "gr", label: "25 MB" });
    expect(row?.detail).toBe("Each file can be up to 25 MB, checked on every upload. Above 25 MB stays off until Casevoya has validated storage for larger files.");
    expect(owner.uploadLimit).toEqual({ organizationId: "o1", mb: 25, max: 25 });
    const html = renderToStaticMarkup(createElement(SheetSettingsSecurity, { data: owner }));
    expect(html).toContain('data-open="dUpLimit"');
    expect(html).toContain('<dialog class="dlg" id="dUpLimit"');
    expect(html).toContain('data-upload-limit="1" data-org="o1" data-max="25"');

    const staff = securityData({ ...base, owner: false, upload: { bytes: 30 * MB, largeAllowed: true } });
    expect(staff.rows.find((item) => item.title === "Upload limit per file")?.action).toBeUndefined();
    expect(staff.uploadLimit).toBeNull();
    expect(renderToStaticMarkup(createElement(SheetSettingsSecurity, { data: staff }))).not.toContain("dUpLimit");

    const large = securityData({ ...base, owner: true, upload: { bytes: 30 * MB, largeAllowed: true } });
    expect(large.uploadLimit?.max).toBe(100);
    expect(large.rows.find((item) => item.title === "Upload limit per file")?.detail).toContain("You can set up to 100 MB.");
  });
});
