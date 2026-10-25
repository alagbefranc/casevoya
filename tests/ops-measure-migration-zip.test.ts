import { describe, expect, it } from "vitest";
import { buildManifest, buildSyntheticZip, parseArgs, ZIP_LIMIT_BYTES } from "../scripts/ops/measure-migration-zip.mjs";
import { readMigrationFile } from "@/modules/migration/csv";
import { describeZip, zipFileBytes } from "@/modules/migration/zip";

// scripts/ops/measure-migration-zip.mjs (MIG decision 6): the synthetic ZIP is one the import's
// own reader accepts, every file is an obviously fake PDF, and the run is refused without a named
// test firm. Small sizes here; the 25 MB / 1,000-file run is the script's own (see the PR).

describe("measure-migration-zip: the synthetic ZIP", () => {
  for (const method of ["deflate", "stored"] as const) {
    it(`builds a ${method} ZIP the import reads: every entry a PDF, no problems, under the size asked`, () => {
      const { bytes, names } = buildSyntheticZip({ files: 12, targetBytes: 240 * 1024, method });
      expect(bytes.length).toBeLessThanOrEqual(240 * 1024);
      expect(bytes.length).toBeGreaterThan(200 * 1024);
      const described = describeZip(bytes);
      if ("error" in described) throw new Error(described.error);
      expect(described.files).toHaveLength(12);
      expect(described.files.every((file) => file.media_type === "application/pdf" && file.problem === null)).toBe(true);
      expect(described.files.map((file) => file.path)).toEqual(names);
      const first = zipFileBytes(bytes, names[0], described.files[0].sha256!);
      expect(Buffer.from(first!.subarray(0, 120)).toString("latin1")).toContain("SYNTHETIC TEST FILE - NOT A REAL DOCUMENT");
    });
  }

  it("writes a one-kind documents manifest the CSV reader accepts", async () => {
    const { names } = buildSyntheticZip({ files: 3, targetBytes: 30 * 1024, method: "stored" });
    const csv = buildManifest(names, { matter: "SYN-TEST-1", person: "synthetic.client@example.test" });
    const read = await readMigrationFile(new TextEncoder().encode(csv));
    if ("error" in read) throw new Error(read.error);
    expect(read.headers).toEqual(["File name", "Client", "Matter", "Document type", "Document date"]);
    expect(read.rows).toHaveLength(3);
    expect(read.rows[0]).toEqual([names[0], "synthetic.client@example.test", "SYN-TEST-1", "Synthetic test file", "2019-03-04"]);
  });

  it("stays within the import's limits", () => {
    expect(ZIP_LIMIT_BYTES).toBe(25 * 1024 * 1024);
    expect(() => parseArgs(["--mode", "local", "--files", "1001"])).toThrow(/1 to 1,000/);
    expect(() => parseArgs(["--mode", "local", "--mb", "26"])).toThrow(/at most 25/);
  });
});

describe("measure-migration-zip: who it runs against", () => {
  const base = ["--base-url", "https://test.example.test", "--credentials", "/tmp/synthetic-creds.env", "--matter", "SYN-TEST-1", "--person", "synthetic.client@example.test"];
  const firm = "00000000-0000-4000-8000-000000000001";

  it("needs the test firm named, credentials outside the repository, and the app (not the site)", () => {
    expect(() => parseArgs(base)).toThrow(/--confirm-test-firm/);
    expect(parseArgs([...base, "--confirm-test-firm", firm])).toMatchObject({ mode: "stage", baseUrl: "https://test.example.test", confirm: firm });
    expect(() => parseArgs([...base.slice(0, 2), "--credentials", "./creds.env", ...base.slice(4), "--confirm-test-firm", firm])).toThrow(/outside the repository/);
    expect(() => parseArgs(["--base-url", "https://casevoya.ca", ...base.slice(2), "--confirm-test-firm", firm])).toThrow(/not the casevoya.ca site/);
    expect(() => parseArgs(["--base-url", "http://test.example.test", ...base.slice(2), "--confirm-test-firm", firm])).toThrow(/https/);
  });
});
