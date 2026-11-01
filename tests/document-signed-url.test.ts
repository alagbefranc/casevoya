/**
 * #302: signed-in users can't sign documents objects; the server signs short links after
 * authorize_document_download, and Vo reads only the 60 s link the app signed for it.
 */
import { describe, expect, it } from "vitest";
import { DOCUMENT_LINK_MAX_SECONDS, VO_FILE_URL_SECONDS, documentGrant, linkSeconds } from "../src/modules/documents/signed-url";
import { isDocumentFileUrl, parseVoTaskRequest } from "../src/modules/vo/sign";
import { supabaseVoDocData } from "../services/vo-agent/src/vo-doc-data";

const SUPA = "https://abc.supabase.co";
const LINK = `${SUPA}/storage/v1/object/sign/documents/org/v1/file.pdf?token=t0k`;
const ID = "11111111-1111-4111-8111-111111111111";

describe("server-signed document links", () => {
  it("reads the grant and never signs longer than the grant or the cap", () => {
    expect(documentGrant({ bucket: "documents", storage_key: "k", seconds: 120 })).toEqual({ bucket: "documents", storageKey: "k", seconds: 120 });
    expect(documentGrant({ bucket: "other", storage_key: "k", seconds: 120 })).toBeNull();
    expect(documentGrant(null)).toBeNull();
    expect(linkSeconds(31_536_000, DOCUMENT_LINK_MAX_SECONDS)).toBe(120);
    expect(linkSeconds(120, VO_FILE_URL_SECONDS)).toBe(60);
    expect(linkSeconds(30, DOCUMENT_LINK_MAX_SECONDS)).toBe(30);
  });

  it("accepts only an https Storage sign link for the documents bucket, on this project", () => {
    expect(isDocumentFileUrl(LINK, SUPA)).toBe(true);
    expect(isDocumentFileUrl(LINK.replace("https:", "http:"), SUPA)).toBe(false);
    expect(isDocumentFileUrl(LINK.replace("/documents/", "/firm-logos/"), SUPA)).toBe(false);
    expect(isDocumentFileUrl(LINK.replace("?token=t0k", ""), SUPA)).toBe(false);
    expect(isDocumentFileUrl(LINK, "https://evil.example")).toBe(false);
    expect(isDocumentFileUrl("https://169.254.169.254/storage/v1/object/sign/documents/x?token=1", SUPA)).toBe(false);
  });
});

describe("Vo document_review request", () => {
  const base = {
    v: 1, runId: ID, organizationId: ID, membershipId: ID, userId: ID, matterId: ID, threadId: null, question: null,
    accessToken: "x".repeat(40), expiresAt: Date.now() + 60_000,
  };
  it("carries the app's link only on a document reading", () => {
    expect(parseVoTaskRequest({ ...base, task: "document_review", versionId: ID, fileUrl: LINK })).not.toBeNull();
    expect(parseVoTaskRequest({ ...base, task: "document_review", versionId: ID, fileUrl: null })).not.toBeNull();
    expect(parseVoTaskRequest({ ...base, task: "document_review", versionId: ID, fileUrl: "https://evil.example/x" })).toBeNull();
    expect(parseVoTaskRequest({ ...base, task: "ask", question: "q", fileUrl: LINK })).toBeNull();
  });

  it("downloads only that link, refuses others and oversized files, and never signs", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(String(url));
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
    }) as unknown as typeof fetch;
    const data = (fileUrl: string | null) => supabaseVoDocData({ url: SUPA, publishableKey: "pk", accessToken: "t", organizationId: ID, fileUrl, fetcher });
    expect(await data(LINK).download(ID, 1000)).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(await data(LINK).download(ID, 2)).toBeNull();
    expect(await data(null).download(ID, 1000)).toBeNull();
    expect(await data(LINK.replace(SUPA, "https://other.supabase.co")).download(ID, 1000)).toBeNull();
    expect(seen).toEqual([LINK, LINK]);
  });
});
