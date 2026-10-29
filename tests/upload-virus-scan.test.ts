/**
 * #263-B virus scanning for uploads: the app's scanner client (mocked transport), the scan runner
 * (mocked database, storage and scanner), the clamd protocol in services/av-scanner, the EICAR
 * test file, and the honest labels. The database side is tests/upload-virus-scan.rls.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { documentCardFlags, VIRUS_LABELS } from "@/modules/documents/present";
import { inspectDocumentBytes } from "@/modules/documents/verify";
import { readClaims, runDocumentScans, SCAN_MAX_BYTES, type ScanRunnerDeps } from "@/modules/documents/scan-runner";
import { avScannerTransport, readScanResponse, scanWithAvScanner, type ScanOutcome } from "@/modules/documents/virus-scan";
import { uploadFailure } from "@/modules/portal/upload-failure";
import { cardStates, queueEntry, scanChip, type VersionFacts } from "@/modules/sheet/documents-present";
import { documentState } from "@/modules/sheet/matter-present";
import { notificationParts, readItems, SYSTEM_KINDS, type NotificationItem } from "@/modules/sheet/notifications-present";
import { command, engineName, instreamFrames, parseScanReply, scanResponse } from "../services/av-scanner/src/clamd";
import { eicarString, eicarTestDocx } from "../scripts/make-eicar-test-docx.mjs";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-28";

function transport(respond: (init: RequestInit) => Promise<Response> | Response) {
  const calls: { path: string; init: RequestInit }[] = [];
  return {
    calls,
    send: async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      return respond(init);
    },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("scanner client (src/modules/documents/virus-scan.ts)", () => {
  it("posts the bytes and reads clean and infected answers", async () => {
    const clean = transport(() => json(200, { result: "clean", engine: "ClamAV 1.4.3/27800" }));
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    expect(await scanWithAvScanner(bytes, { transport: clean })).toEqual({ result: "clean", engine: "ClamAV 1.4.3/27800" });
    expect(clean.calls[0].path).toBe("/v1/scan");
    expect(clean.calls[0].init.method).toBe("POST");
    expect(clean.calls[0].init.body).toBe(bytes);

    const infected = transport(() => json(200, { result: "infected", signature: "Win.Test.EICAR_HDB-1", engine: "ClamAV 1.4.3/27800" }));
    expect(await scanWithAvScanner(bytes, { transport: infected })).toEqual({ result: "infected", signature: "Win.Test.EICAR_HDB-1", engine: "ClamAV 1.4.3/27800" });
  });

  it("never reads anything else as clean: down, slow, odd answers and no binding are errors", async () => {
    const bytes = new Uint8Array([1]);
    expect(await scanWithAvScanner(bytes, { transport: null })).toEqual({ result: "error", reason: "unavailable" });
    expect((await scanWithAvScanner(bytes, { transport: transport(() => json(503, { result: "error" })) })).result).toBe("error");
    expect((await scanWithAvScanner(bytes, { transport: transport(() => json(200, { result: "ok" })) })).result).toBe("error");
    expect((await scanWithAvScanner(bytes, { transport: transport(() => new Response("<html>", { status: 200 })) })).result).toBe("error");
    expect((await scanWithAvScanner(bytes, { transport: transport(() => json(200, { result: "infected" })) })).result).toBe("error");
    expect((await scanWithAvScanner(bytes, { transport: transport(() => json(200, { result: "infected", signature: "<script>" })) })).result).toBe("error");
    const thrown = transport(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await scanWithAvScanner(bytes, { transport: thrown })).toEqual({ result: "error", reason: "timeout" });
    const refused = transport(() => {
      throw new TypeError("fetch failed");
    });
    expect(await scanWithAvScanner(bytes, { transport: refused })).toEqual({ result: "error", reason: "unavailable" });
    expect(readScanResponse(413, { result: "error" })).toMatchObject({ result: "error", reason: "rejected" });
  });

  it("holds the file when the scanner is still starting or does not answer: never clean", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    // 503 is the cold container: clamd has not loaded yet. A body that says "clean" is still an error.
    expect(await scanWithAvScanner(bytes, { transport: transport(() => json(503, { result: "clean", engine: null })) })).toEqual({
      result: "error",
      reason: "unavailable",
      engine: null,
    });
    expect(await scanWithAvScanner(bytes, { transport: transport(() => json(503, { result: "error", reason: "starting" })) })).toMatchObject({
      result: "error",
      reason: "unavailable",
    });

    const busy = transport(
      (_init) =>
        new Promise((_resolve, reject) => {
          const signal = _init.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    expect(await scanWithAvScanner(bytes, { transport: busy, timeoutMs: 40 })).toEqual({ result: "error", reason: "timeout" });
  });

  it("uses the AV_SCANNER binding, then a dev URL, else nothing", async () => {
    const fetcher = { fetch: vi.fn(async (request: Request | string) => json(200, { result: "clean", url: typeof request === "string" ? request : request.url })) };
    const bound = avScannerTransport({ AV_SCANNER: fetcher });
    expect(bound).not.toBeNull();
    await bound?.send("/v1/scan", { method: "POST" });
    expect((fetcher.fetch.mock.calls[0][0] as Request).url).toBe("https://av-scanner/v1/scan");
    expect(avScannerTransport({ AV_SCANNER_URL: "http://localhost:8080" })).not.toBeNull();
    const saved = process.env.AV_SCANNER_URL;
    delete process.env.AV_SCANNER_URL;
    expect(avScannerTransport({})).toBeNull();
    if (saved !== undefined) process.env.AV_SCANNER_URL = saved;
  });
});

function deps(over: Partial<ScanRunnerDeps> & { claims?: unknown } = {}) {
  const recorded: { versionId: string; outcome: string; signature: string | null; engine: string | null }[] = [];
  const base: ScanRunnerDeps = {
    claim: async () => ({ data: over.claims ?? [], error: null }),
    download: async () => new Uint8Array([1, 2, 3]),
    scan: async (): Promise<ScanOutcome> => ({ result: "clean", engine: "ClamAV" }),
    record: async (input) => {
      recorded.push(input);
      const state = input.outcome === "clean" ? "clean" : input.outcome === "infected" ? "quarantined" : "scanning";
      return { data: { upload_state: state }, error: null };
    },
  };
  return { recorded, deps: { ...base, ...over } };
}

const claim = (id: string, extra: Record<string, unknown> = {}) => ({ version_id: id, storage_bucket: "documents", storage_key: `org/quarantine/${id}/k`, byte_size: 3, attempt: 1, backfill: false, ...extra });

describe("scan runner (src/modules/documents/scan-runner.ts)", () => {
  it("scans each claimed file and records the scanner's answer", async () => {
    const scan = vi.fn(async (bytes: Uint8Array): Promise<ScanOutcome> => (bytes[0] === 9 ? { result: "infected", signature: "Win.Test.EICAR_HDB-1", engine: "ClamAV" } : { result: "clean", engine: "ClamAV" }));
    const { deps: d, recorded } = deps({ claims: [claim(V1), claim(V2)], scan, download: async (_bucket, key) => new Uint8Array([key.includes(V2) ? 9 : 1]) });
    const summary = await runDocumentScans(d, { limit: 5 });
    expect(summary).toMatchObject({ claimed: 2, clean: 1, infected: 1, errors: 0, states: { [V1]: "clean", [V2]: "quarantined" } });
    expect(recorded).toEqual([
      { versionId: V1, outcome: "clean", signature: null, engine: "ClamAV" },
      { versionId: V2, outcome: "infected", signature: "Win.Test.EICAR_HDB-1", engine: "ClamAV" },
    ]);
  });

  it("holds a file when the scanner is cold or busy, and a later clean answer releases it", async () => {
    const scan = vi
      .fn<ScanRunnerDeps["scan"]>()
      .mockResolvedValueOnce({ result: "error", reason: "unavailable" })
      .mockResolvedValueOnce({ result: "error", reason: "timeout" })
      .mockResolvedValueOnce({ result: "clean", engine: "ClamAV 1.4.3/27800" });
    const first = deps({ claims: [claim(V1)], scan });
    expect(await runDocumentScans(first.deps, { versionId: V1 })).toMatchObject({ claimed: 1, clean: 0, errors: 1, states: { [V1]: "scanning" } });
    expect(first.recorded).toEqual([{ versionId: V1, outcome: "error", signature: null, engine: null }]);

    const second = deps({ claims: [claim(V1, { attempt: 2 })], scan });
    expect(await runDocumentScans(second.deps, { versionId: V1 })).toMatchObject({ errors: 1, states: { [V1]: "scanning" } });
    expect(second.recorded[0].outcome).toBe("error");

    const third = deps({ claims: [claim(V1, { attempt: 3 })], scan });
    expect(await runDocumentScans(third.deps, { versionId: V1 })).toMatchObject({ clean: 1, errors: 0, states: { [V1]: "clean" } });
    expect(third.recorded).toEqual([{ versionId: V1, outcome: "clean", signature: null, engine: "ClamAV 1.4.3/27800" }]);
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it("records an error (the database retries it) when the file can't be read or the scanner fails", async () => {
    const scan = vi.fn(async (): Promise<ScanOutcome> => {
      throw new Error("boom");
    });
    const { deps: d, recorded } = deps({ claims: [claim(V1), claim(V2, { byte_size: SCAN_MAX_BYTES + 1 })], download: async (_b, key) => (key.includes(V1) ? null : new Uint8Array([1])), scan });
    const summary = await runDocumentScans(d);
    expect(summary).toMatchObject({ claimed: 2, clean: 0, errors: 2 });
    expect(recorded.map((row) => row.outcome)).toEqual(["error", "error"]);
    // Too large to send: not even downloaded or scanned.
    expect(scan).not.toHaveBeenCalled();
  });

  it("passes the version and backfill choice to the claim, bounds the batch, and stops on a failed claim", async () => {
    const claimFn = vi.fn(async () => ({ data: [], error: null }));
    await runDocumentScans(deps({ claim: claimFn }).deps, { limit: 500, versionId: V1, backfill: true });
    expect(claimFn).toHaveBeenCalledWith({ limit: 10, versionId: V1, backfill: true });
    await expect(runDocumentScans(deps({ claim: async () => ({ data: null, error: { message: "denied" } }) }).deps)).rejects.toThrow(/claim failed/);
  });

  it("ignores claim rows that aren't the expected shape", () => {
    expect(readClaims(null)).toEqual([]);
    expect(readClaims([{ version_id: "nope", storage_bucket: "documents", storage_key: "k" }, claim(V1, { backfill: true })])).toEqual([
      { versionId: V1, bucket: "documents", storageKey: `org/quarantine/${V1}/k`, byteSize: 3, attempt: 1, backfill: true },
    ]);
  });
});

describe("clamd protocol (services/av-scanner/src/clamd.ts)", () => {
  it("frames INSTREAM as length-prefixed chunks ending with a zero length", () => {
    const frames = [...instreamFrames(new Uint8Array(5).fill(7), 2)];
    expect(frames.map((frame) => [...frame])).toEqual([[0, 0, 0, 2], [7, 7], [0, 0, 0, 2], [7, 7], [0, 0, 0, 1], [7], [0, 0, 0, 0]]);
    expect(new TextDecoder().decode(command("INSTREAM"))).toBe("zINSTREAM\0");
  });

  it("reads clean, infected and error replies; a limits heuristic is not a verdict", () => {
    expect(parseScanReply("stream: OK\0")).toEqual({ result: "clean" });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ result: "infected", signature: "Win.Test.EICAR_HDB-1" });
    expect(parseScanReply("stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0")).toEqual({ result: "error", reason: "limits" });
    expect(parseScanReply("INSTREAM size limit exceeded. ERROR\0")).toEqual({ result: "error", reason: "limits" });
    expect(parseScanReply("")).toEqual({ result: "error", reason: "clamd" });
    expect(engineName("ClamAV 1.4.3/27800/Tue Oct 28 08:20:00 2026\0")).toBe("ClamAV 1.4.3/27800");
    expect(scanResponse({ result: "error", reason: "clamd" }, null).status).toBe(503);
    // The service's answer is what the app's client reads.
    const answer = scanResponse({ result: "infected", signature: "Win.Test.EICAR_HDB-1" }, "ClamAV 1.4.3/27800");
    expect(readScanResponse(answer.status, answer.body)).toEqual({ result: "infected", signature: "Win.Test.EICAR_HDB-1", engine: "ClamAV 1.4.3/27800" });
  });
});

describe("EICAR test file (scripts/make-eicar-test-docx.mjs)", () => {
  it("passes the type check as a Word file, so it reaches the scanner, and carries the 68-byte test string", () => {
    const docx = new Uint8Array(eicarTestDocx());
    expect(inspectDocumentBytes(docx)).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(eicarString()).toHaveLength(68);
    expect(Buffer.from(docx).includes(Buffer.from(eicarString()))).toBe(true);
  });
});

function version(over: Partial<VersionFacts> = {}): VersionFacts {
  return {
    id: V1,
    documentId: "d1",
    versionNumber: 1,
    uploadState: "clean",
    scanResult: "structural_only",
    scanEngine: "structural_only",
    reviewState: "pending",
    declaredMediaType: "application/pdf",
    expiresOn: null,
    supersededAt: null,
    intentExpiresAt: "2026-10-28T13:00:00Z",
    createdAt: "2026-10-28T10:00:00Z",
    ...over,
  };
}

describe("honest labels (#263-B)", () => {
  it("portal cards: checking, blocked and couldn't be checked; none can be downloaded", () => {
    const base = { reviewState: "pending" as const, superseded: false, expired: false };
    expect(documentCardFlags({ ...base, uploadState: "scanning" })).toMatchObject({ labels: [VIRUS_LABELS.scanning], canDownload: false, needsYou: false });
    expect(documentCardFlags({ ...base, uploadState: "quarantined", scanResult: "infected" })).toMatchObject({ labels: ["Blocked: a virus was found"], canDownload: false, needsYou: true });
    expect(documentCardFlags({ ...base, uploadState: "quarantined", scanResult: "extension_mismatch" }).labels).toEqual(["Quarantined"]);
    expect(documentCardFlags({ ...base, uploadState: "scan_failed" })).toMatchObject({ labels: ["Couldn’t be checked yet"], canDownload: false, needsYou: false });
    expect(documentCardFlags({ ...base, uploadState: "uploading" }).labels).toEqual(["Checking file"]);
  });

  it("the client's upload is told plainly to send another file when a virus is found", () => {
    const failure = uploadFailure({ stage: "check", state: "quarantined", scanResult: "infected" });
    expect(failure).toMatchObject({ title: "Blocked: a virus was found", retry: "choose" });
    expect(failure.copy).toMatch(/upload another copy/);
    expect(uploadFailure({ stage: "check", state: "quarantined" }).title).toBe("We couldn’t accept this file");
  });

  it("staff Documents: blocked and couldn't-be-checked files are held in To review; older files say they weren't scanned", () => {
    expect(queueEntry(version({ uploadState: "quarantined", scanResult: "infected" }), TODAY)).toMatchObject({ scan: { tone: "bad", pair: ["Blocked", "a virus was found"] }, review: "Can’t open", reviewable: false });
    expect(queueEntry(version({ uploadState: "scan_failed", scanResult: "scanner_unavailable" }), TODAY)).toMatchObject({ scan: { tone: "chg", pair: ["Couldn’t be checked yet", "virus check didn’t run"] }, reviewable: false });
    expect(queueEntry(version({ uploadState: "scanning" }), TODAY)).toBeNull();
    expect(queueEntry(version(), TODAY, { scanningOn: true })?.scan).toEqual({ tone: "unv", label: "Not virus-scanned (uploaded before scanning)" });
    expect(queueEntry(version(), TODAY, { scanningOn: false })?.scan).toEqual({ tone: "unv", label: "Type checked, not virus-scanned" });
    expect(queueEntry(version({ scanEngine: "worker", scanResult: "clean" }), TODAY, { scanningOn: true })?.scan).toEqual({ tone: "ok", label: "Clean" });
    // A sealed agreement is Casevoya's own PDF, not an old upload.
    expect(scanChip("structural_only", { scanningOn: true, scanResult: "in_house_seal" }).label).toBe("Type checked, not virus-scanned");
    expect(cardStates(version({ uploadState: "scanning" }), TODAY)).toEqual([{ tone: "unv", label: "Checking for viruses…" }]);
    expect(cardStates(version({ uploadState: "quarantined", scanResult: "infected" }), TODAY)).toEqual([{ tone: "bad", label: "Blocked: a virus was found" }]);
    expect(cardStates(version({ uploadState: "scan_failed" }), TODAY)).toEqual([{ tone: "chg", label: "Couldn’t be checked yet" }]);
  });

  it("matter Documents: 'scanned' only after a virus scan", () => {
    const facts = { uploadState: "clean", reviewState: "pending", versionNumber: 1, expiresOn: null };
    expect(documentState({ requestStatus: null, version: { ...facts, scanEngine: "worker" } }, TODAY).upload).toEqual({ tone: "gr", label: "Uploaded", detail: "scanned" });
    expect(documentState({ requestStatus: null, version: { ...facts, scanEngine: "structural_only" } }, TODAY).upload).toEqual({ tone: "gr", label: "Uploaded", detail: "type checked" });
    expect(documentState({ requestStatus: null, version: { ...facts, uploadState: "scanning" } }, TODAY).upload).toEqual({ tone: "gr", label: "Uploaded", detail: "checking for viruses" });
    expect(documentState({ requestStatus: null, version: { ...facts, uploadState: "quarantined", scanResult: "infected" } }, TODAY).upload).toEqual({ tone: "bad", label: "Blocked", detail: "a virus was found" });
    expect(documentState({ requestStatus: null, version: { ...facts, uploadState: "scan_failed" } }, TODAY).upload).toEqual({ tone: "chg", label: "Couldn’t be checked yet" });
    // The Designer's sample (no engine given) keeps its words.
    expect(documentState({ requestStatus: null, version: facts }, TODAY).upload.detail).toBe("scanned");
  });

  it("staff notifications: a blocked file is a system notice naming the document and matter", () => {
    const row: NotificationItem = { id: V1, kind: "document_blocked", occurred_at: "2026-10-28T10:00:00Z", matter_id: "m1", actor_name: null, subject: "Passport bio page", detail: "infected", href: "/sheet/matters/m1?tab=documents", read: false };
    expect(readItems([row])).toHaveLength(1);
    expect(SYSTEM_KINDS.has("document_blocked")).toBe(true);
    const parts = notificationParts(row, () => "TOR-2026-0001");
    expect(parts[0]).toBe("Blocked: a virus was found in ");
    expect(parts).toContainEqual({ b: "Passport bio page" });
    expect(parts).toContainEqual({ b: "TOR-2026-0001" });
    expect(notificationParts({ ...row, detail: "scan_failed" }, () => "M")[0]).toBe("Couldn’t be checked yet: ");
  });
});
