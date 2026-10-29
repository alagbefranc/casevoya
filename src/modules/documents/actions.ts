"use server";

import { createHash } from "node:crypto";
import { documentError } from "@/modules/documents/errors";
import { mediaTypeForFilename, UPLOAD_CEILING_BYTES } from "@/modules/documents/files";
import { redactDocument, RedactionError, type RedactionRegion } from "@/modules/documents/redact";
import { inspectDocumentBytes } from "@/modules/documents/verify";
import { runDocumentScans } from "@/modules/documents/scan-runner";
import { serviceScanDeps } from "@/modules/documents/scan-service";
import { verifyDocumentStream } from "@/modules/documents/verify";
import { TRANSLATE_MODEL } from "@/modules/i18n/translate";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import type { Database, Json } from "@/types/database.types";

type Sensitivity = Database["public"]["Enums"]["document_sensitivity"];
type Audience = Database["public"]["Enums"]["document_audience"];
type Decision = Database["public"]["Enums"]["document_review_decision"];

const SENSITIVITIES: readonly Sensitivity[] = ["ordinary", "narrative", "medical", "criminal"];
const AUDIENCES: readonly Audience[] = ["subject", "matter", "staff"];
const DECISIONS: readonly Decision[] = ["accepted", "changes_requested"];
const FORMATS = ["pdf", "jpeg", "png", "heic", "docx"] as const;

async function clientFor(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Sign in first." as const };
  if (code != null && code !== "") {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase, userId };
}

/**
 * Whether the file changed since the dialog read it. The review functions refuse a stale version
 * with a "serialization failure" (40001), which the database API may retry for minutes before
 * answering, so a plain read answers it first. Unreadable rows are left to the function to refuse.
 */
async function staleVersion(supabase: Awaited<ReturnType<typeof createClient>>, versionId: string, expected: number): Promise<boolean> {
  const { data } = await supabase.from("document_versions").select("version").eq("id", versionId).maybeSingle();
  return data != null && data.version !== expected;
}

const STALE = documentError("document version conflict");

function objectRecord(value: Json): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

export async function createUploadIntent(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  filename: string;
  byteSize: number;
  purpose: string;
  sensitivity?: string;
  audience?: string;
  documentId?: string | null;
  requestId?: string | null;
  translationOfVersionId?: string | null;
  languageTag?: string | null;
  code?: string | null;
}) {
  const filename = input.filename.trim();
  if (!isUuid(input.matterId) || !isUuid(input.personId)) return { error: "Choose a matter and a person." };
  if (input.documentId && !isUuid(input.documentId)) return { error: "Choose the document to replace." };
  if (input.requestId && !isUuid(input.requestId)) return { error: "Choose the request this file answers." };
  if (input.translationOfVersionId && !isUuid(input.translationOfVersionId)) return { error: "Choose the version this translates." };
  if (!mediaTypeForFilename(filename) || filename.includes("/") || filename.includes("\\") || filename.length > 300) {
    return { error: "Use a PDF, JPEG, PNG, HEIC, or DOCX file name." };
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > UPLOAD_CEILING_BYTES) {
    return { error: "That file is larger than 100 MB." };
  }
  const purpose = input.purpose.trim();
  if (purpose.length < 1 || purpose.length > 200) return { error: "Say what this file is for." };
  const sensitivity = (input.sensitivity ?? "ordinary") as Sensitivity;
  const audience = (input.audience ?? "subject") as Audience;
  if (!SENSITIVITIES.includes(sensitivity) || !AUDIENCES.includes(audience)) return { error: "Choose who may see this file." };
  const session = await clientFor(input.organizationId, input.code ?? null);
  if ("error" in session) return { error: session.error };

  const { data, error } = await session.supabase.rpc("create_upload_intent", {
    p_matter_id: input.matterId,
    p_person_id: input.personId,
    p_filename: filename,
    p_declared_byte_size: input.byteSize,
    p_purpose: purpose,
    p_sensitivity: sensitivity,
    p_audience: audience,
    p_document_id: input.documentId ?? null,
    p_translation_of_version_id: input.translationOfVersionId ?? null,
    p_language_tag: input.languageTag ?? null,
  });
  if (error && /above the upload limit/i.test(error.message)) {
    // DOC-02: name the firm's limit in the refusal.
    const { data: bytes } = await session.supabase.rpc("document_upload_limit", { p_organization_id: input.organizationId });
    if (typeof bytes === "number") return { error: `That file is above your firm’s limit of ${Math.round((bytes / 1024 / 1024) * 10) / 10} MB per file.` };
  }
  if (error) return { error: documentError(error.message) };
  const intent = objectRecord(data);
  const documentId = intent?.document_id;
  const versionId = intent?.version_id;
  const storageKey = intent?.storage_key;
  if (typeof documentId !== "string" || typeof versionId !== "string" || typeof storageKey !== "string") {
    return { error: "The upload could not be authorized." };
  }
  if (input.requestId) {
    const attached = await session.supabase.rpc("attach_upload_to_request", {
      p_version_id: versionId,
      p_request_id: input.requestId,
    });
    if (attached.error) return { error: documentError(attached.error.message) };
  }
  const signed = await session.supabase.storage.from("documents").createSignedUploadUrl(storageKey, { upsert: false });
  if (signed.error || !signed.data?.token) return { error: "The upload could not be authorized." };
  return {
    documentId,
    versionId,
    path: signed.data.path,
    token: signed.data.token,
  };
}

export async function completeDocumentUpload(input: { organizationId: string; versionId: string }) {
  if (!isUuid(input.versionId)) return { error: "Choose the upload to finish." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  // The caller's own session proves they can see this upload and that they started it.
  const { data: row, error: readError } = await session.supabase
    .from("document_versions")
    .select("storage_key, upload_state, scan_result, created_by")
    .eq("id", input.versionId)
    .maybeSingle();
  if (readError || !row || row.created_by !== session.userId) return { error: "That upload could not be found." };
  if (row.upload_state !== "uploading") {
    return { uploadState: row.upload_state as string, scanResult: row.scan_result ?? null };
  }

  // The bytes are read and checked here, on the server. Completion is service-role only,
  // so a browser cannot report its own hash or file header.
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { error: "Uploads cannot be checked right now. Try again later." };
  }
  const downloaded = await service.storage.from("documents").download(row.storage_key);
  if (downloaded.error || !downloaded.data) return { error: "The file did not finish uploading. Try again." };
  const verified = await verifyDocumentStream(downloaded.data.stream(), UPLOAD_CEILING_BYTES);
  if (!verified.ok) return { error: "That file is larger than 100 MB." };

  const { data, error } = await service.rpc("finish_verified_document_upload", {
    p_version_id: input.versionId,
    p_actor_user_id: session.userId,
    p_sha256: verified.sha256,
    p_byte_size: verified.byteSize,
    p_detected_media_type: verified.mediaType,
  });
  if (error) return { error: documentError(error.message) };
  const result = objectRecord(data);
  const uploadState = result?.upload_state;
  const scanResult = result?.scan_result;
  if (typeof uploadState !== "string") return { error: "The file could not be checked." };
  if (uploadState === "scanning") return scanJustUploaded(service, input.versionId);
  return {
    uploadState,
    scanResult: typeof scanResult === "string" ? scanResult : null,
  };
}

/** How long the upload waits for the virus scanner before leaving the file to the retry job. */
const INLINE_SCAN_TIMEOUT_MS = 20_000;

/**
 * #263-B: virus scanning is on, so the file is held as "scanning". Scan it now, so most people
 * see the answer before they leave the page. If the scanner is slow or down the file simply stays
 * held (fail closed) and the retry job (POST /api/documents/scan/run) tries again.
 */
async function scanJustUploaded(service: ReturnType<typeof createServiceClient>, versionId: string) {
  try {
    const summary = await runDocumentScans(serviceScanDeps(service, { timeoutMs: INLINE_SCAN_TIMEOUT_MS }), { limit: 1, versionId });
    const state = summary.states[versionId];
    if (state === "quarantined") return { uploadState: "quarantined", scanResult: "infected" };
    if (state === "clean") return { uploadState: "clean", scanResult: "clean" };
  } catch {
    // The claim failed: the scheduler picks the file up.
  }
  return { uploadState: "scanning", scanResult: "awaiting_scanner" };
}

export async function authorizeDocumentDownload(input: {
  organizationId: string;
  versionId: string;
  code?: string | null;
}) {
  if (!isUuid(input.versionId)) return { error: "Choose a file." };
  const session = await clientFor(input.organizationId, input.code ?? null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("authorize_document_download", {
    p_version_id: input.versionId,
  });
  if (error) return { error: documentError(error.message) };
  const grant = objectRecord(data);
  const bucket = grant?.bucket;
  const storageKey = grant?.storage_key;
  const seconds = grant?.seconds;
  if (typeof bucket !== "string" || typeof storageKey !== "string" || typeof seconds !== "number") {
    return { error: "That file cannot be downloaded." };
  }
  const signed = await session.supabase.storage.from(bucket).createSignedUrl(storageKey, seconds);
  if (signed.error || !signed.data?.signedUrl) return { error: "That file cannot be downloaded." };
  return { url: signed.data.signedUrl, seconds };
}

export async function createDocumentRequest(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  purpose: string;
  explanation: string;
  dueOn?: string | null;
  acceptableFormats: string[];
  reviewCriteria?: string | null;
  expiresOn?: string | null;
  audience?: string;
  sensitivity?: string;
  ruleVersionId?: string | null;
  ruleItemKey?: string | null;
  code: string;
}) {
  if (!isUuid(input.matterId) || !isUuid(input.personId)) return { error: "Choose a matter and a person." };
  if (input.ruleVersionId && !isUuid(input.ruleVersionId)) return { error: "Choose a published rule version." };
  const formats = input.acceptableFormats.filter((format) => (FORMATS as readonly string[]).includes(format));
  if (formats.length === 0) return { error: "Choose at least one accepted format." };
  const audience = (input.audience ?? "subject") as Audience;
  const sensitivity = (input.sensitivity ?? "ordinary") as Sensitivity;
  if (!AUDIENCES.includes(audience) || !SENSITIVITIES.includes(sensitivity)) return { error: "Choose who may see this request." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("create_document_request", {
    p_matter_id: input.matterId,
    p_person_id: input.personId,
    p_purpose: input.purpose,
    p_explanation: input.explanation,
    p_due_on: input.dueOn ?? null,
    p_acceptable_formats: formats,
    p_review_criteria: input.reviewCriteria ?? null,
    p_expires_on: input.expiresOn ?? null,
    p_audience: audience,
    p_sensitivity: sensitivity,
    p_rule_version_id: input.ruleVersionId ?? null,
    p_rule_item_key: input.ruleItemKey ?? null,
  });
  if (error) return { error: documentError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The request was not created." };
  return { id: data };
}

export async function reviewDocumentVersion(input: {
  organizationId: string;
  versionId: string;
  expectedVersion: number;
  decision: string;
  reason: string;
  annotations?: string | null;
  code: string;
  /** The reason in French, for a client who prefers French. Optional. */
  reasonFr?: string | null;
  /** The French started as a "Draft in French" machine draft. */
  reasonFrMachine?: boolean;
  /** The person saving confirmed they checked the machine-drafted French. */
  reasonFrReviewed?: boolean;
}) {
  if (!isUuid(input.versionId) || !DECISIONS.includes(input.decision as Decision)) {
    return { error: "Choose a file and a decision." };
  }
  const french = (input.reasonFr ?? "").trim();
  if (french && input.reasonFrMachine && input.reasonFrReviewed !== true) {
    return { error: "Check the machine-drafted French and confirm it before saving." };
  }
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  if (await staleVersion(session.supabase, input.versionId, input.expectedVersion)) return { error: STALE };
  if (french) {
    const { data, error } = await session.supabase.rpc("review_document_version_fr", {
      p_version_id: input.versionId,
      p_expected_version: input.expectedVersion,
      p_decision: input.decision as Decision,
      p_reason: input.reason,
      p_annotations: input.annotations ?? null,
      p_reason_fr: french,
      p_machine_drafted: input.reasonFrMachine === true,
      p_model: input.reasonFrMachine === true ? TRANSLATE_MODEL : null,
    });
    if (error) return { error: documentError(error.message) };
    return { version: data };
  }
  const { data, error } = await session.supabase.rpc("review_document_version", {
    p_version_id: input.versionId,
    p_expected_version: input.expectedVersion,
    p_decision: input.decision as Decision,
    p_reason: input.reason,
    p_annotations: input.annotations ?? null,
  });
  if (error) return { error: documentError(error.message) };
  return { version: data };
}

export async function waiveDocumentRequest(input: {
  organizationId: string;
  requestId: string;
  expectedVersion: number;
  reason: string;
  code: string;
}) {
  if (!isUuid(input.requestId)) return { error: "Choose a request." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("waive_document_request", {
    p_request_id: input.requestId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error) return { error: documentError(error.message) };
  return { version: data };
}

export async function setDocumentExpiry(input: {
  organizationId: string;
  versionId: string;
  expectedVersion: number;
  expiresOn: string | null;
  code: string;
}) {
  if (!isUuid(input.versionId)) return { error: "Choose a file." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  if (await staleVersion(session.supabase, input.versionId, input.expectedVersion)) return { error: STALE };
  const { data, error } = await session.supabase.rpc("set_document_expiry", {
    p_version_id: input.versionId,
    p_expected_version: input.expectedVersion,
    p_expires_on: input.expiresOn,
  });
  if (error) return { error: documentError(error.message) };
  return { version: data };
}

export async function recordDocumentCustody(input: {
  organizationId: string;
  versionId: string;
  receivedOn?: string | null;
  location?: string | null;
  purpose: string;
  recipient?: string | null;
  returnOn?: string | null;
  acknowledged: boolean;
  code: string;
}) {
  if (!isUuid(input.versionId)) return { error: "Choose a file." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_document_custody", {
    p_version_id: input.versionId,
    p_received_on: input.receivedOn ?? null,
    p_location: input.location ?? null,
    p_purpose: input.purpose,
    p_recipient: input.recipient ?? null,
    p_return_on: input.returnOn ?? null,
    p_acknowledged: input.acknowledged,
  });
  if (error) return { error: documentError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "Custody was not recorded." };
  return { id: data };
}

export async function unlinkDocumentMatter(input: {
  organizationId: string;
  refId: string;
  reason: string;
  code: string;
}) {
  if (!isUuid(input.refId)) return { error: "Choose the matter link." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("unlink_document_matter", {
    p_ref_id: input.refId,
    p_reason: input.reason,
  });
  if (error) return { error: documentError(error.message) };
  return { ok: true as const };
}

export async function setDocumentUploadLimit(input: { organizationId: string; bytes: number; code: string }) {
  if (!Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > UPLOAD_CEILING_BYTES) {
    return { error: "Choose a limit between 1 byte and 100 MB." };
  }
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("set_document_upload_limit", { p_bytes: input.bytes });
  if (error) return { error: documentError(error.message) };
  return { bytes: data };
}

/** DOC-06: uses a checked document on another matter of the same person (public.link_document_matter). */
export async function linkDocumentMatter(input: { organizationId: string; documentId: string; matterId: string }) {
  if (!isUuid(input.documentId) || !isUuid(input.matterId)) return { error: "Choose a matter." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("link_document_matter", { p_document_id: input.documentId, p_matter_id: input.matterId });
  if (error) return { error: documentError(error.message) };
  return { ok: true as const };
}

/** DOC-06: marks a version as the translation of another version of the same person's documents, or clears it. */
export async function setDocumentTranslation(input: { organizationId: string; versionId: string; expectedVersion: number; originalVersionId: string | null; languageTag: string | null }) {
  if (!isUuid(input.versionId) || (input.originalVersionId && !isUuid(input.originalVersionId))) return { error: "Choose the original document." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  if (await staleVersion(session.supabase, input.versionId, input.expectedVersion)) return { error: STALE };
  const { error } = await session.supabase.rpc("set_document_translation", {
    p_version_id: input.versionId,
    p_expected_version: input.expectedVersion,
    ...(input.originalVersionId ? { p_original_version_id: input.originalVersionId, p_language_tag: input.languageTag ?? "" } : {}),
  });
  if (error) return { error: documentError(error.message) };
  return { ok: true as const };
}

/** DOC-06: a document's type and sensitivity; a sensitivity change needs the six-digit code. */
export async function setDocumentClassification(input: { organizationId: string; documentId: string; expectedVersion: number; purpose: string; sensitivity: string; code: string }) {
  if (!isUuid(input.documentId)) return { error: "Choose a document." };
  if (!SENSITIVITIES.includes(input.sensitivity as Sensitivity)) return { error: "Choose how sensitive the document is." };
  const session = await clientFor(input.organizationId, input.code || null);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("set_document_classification", {
    p_document_id: input.documentId,
    p_expected_version: input.expectedVersion,
    p_purpose: input.purpose,
    p_sensitivity: input.sensitivity as Sensitivity,
  });
  if (error) return { error: documentError(error.message) };
  return { ok: true as const };
}

/** DOC-07: one custody step on a paper original (public.record_custody_step). */
export async function recordCustodyStep(input: { organizationId: string; versionId: string; kind: string; on: string | null; location: string | null; purpose: string | null; recipient: string | null }) {
  if (!isUuid(input.versionId)) return { error: "Choose the document." };
  if (!["received", "moved", "returned", "acknowledged"].includes(input.kind)) return { error: "Choose a custody step." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("record_custody_step", {
    p_version_id: input.versionId,
    p_kind: input.kind,
    p_on: input.on as string,
    p_location: input.location as string,
    p_purpose: input.purpose as string,
    p_recipient: input.recipient as string,
  });
  if (error) return { error: custodyError(error.message) };
  return { ok: true as const };
}

/** DOC-03: page turns and sources, recorded while the upload is still open. */
export async function recordCameraAssembly(input: {
  organizationId: string;
  versionId: string;
  pages: { rotation_degrees: 0 | 90 | 180 | 270; source: "camera" | "library" }[];
}) {
  if (!isUuid(input.versionId) || input.pages.length < 1 || input.pages.length > 40) return { error: "Add between 1 and 40 pages." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("record_camera_assembly", {
    p_version_id: input.versionId,
    p_pages: input.pages as unknown as Json,
  });
  if (error) return { error: documentError(error.message) };
  return { ok: true as const };
}

function redactedFilename(mediaType: string): string | null {
  if (mediaType === "application/pdf") return "redacted.pdf";
  if (mediaType === "image/png") return "redacted.png";
  if (mediaType === "image/jpeg") return "redacted.jpg";
  return null;
}

function regionRecord(region: RedactionRegion): { page_index: number; x: number; y: number; width: number; height: number } {
  const round = (value: number) => Math.round(value * 100000) / 100000;
  const x = round(Math.min(1, Math.max(0, region.x)));
  const y = round(Math.min(1, Math.max(0, region.y)));
  let width = round(region.width);
  let height = round(region.height);
  if (x + width > 1) width = round(1 - x);
  if (y + height > 1) height = round(1 - y);
  return { page_index: region.page, x, y, width, height };
}

/**
 * DOC-07: staff mark areas; the Worker removes the text and image samples and stores a new
 * document through the same check, virus-scan hold and retention path. The original is not written.
 */
export async function createRedactedCopy(input: {
  organizationId: string;
  sourceVersionId: string;
  matterId: string;
  regions: RedactionRegion[];
  code?: string | null;
}) {
  if (!isUuid(input.sourceVersionId) || !isUuid(input.matterId)) return { error: "Choose a document." };
  if (input.regions.length < 1 || input.regions.length > 40) return { error: "Mark between 1 and 40 areas." };
  const session = await clientFor(input.organizationId, input.code ?? null);
  if ("error" in session) return { error: session.error };
  const { data: row, error: readError } = await session.supabase
    .from("document_versions")
    .select("storage_key, upload_state, declared_media_type, detected_media_type")
    .eq("id", input.sourceVersionId)
    .maybeSingle();
  if (readError || !row || row.upload_state !== "clean") return { error: "Only a file that passed its check can be redacted." };
  const sourceType = row.detected_media_type ?? row.declared_media_type;
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { error: "The redacted copy could not be made right now." };
  }
  const downloaded = await service.storage.from("documents").download(row.storage_key);
  if (downloaded.error || !downloaded.data) return { error: "That file could not be read." };
  const sourceBytes = new Uint8Array(await downloaded.data.arrayBuffer());
  let output: Uint8Array;
  try {
    output = await redactDocument(sourceBytes, sourceType, input.regions);
  } catch (error) {
    if (error instanceof RedactionError) return { error: error.message };
    return { error: "The redacted copy could not be made." };
  }
  const detected = inspectDocumentBytes(output);
  const filename = detected ? redactedFilename(detected) : null;
  if (!detected || !filename) return { error: "The redacted copy could not be made." };
  const regions = input.regions.map(regionRecord);
  const { data, error } = await session.supabase.rpc("create_redacted_copy_intent", {
    p_source_version_id: input.sourceVersionId,
    p_matter_id: input.matterId,
    p_filename: filename,
    p_declared_byte_size: output.byteLength,
    p_regions: regions as unknown as Json,
  });
  if (error) return { error: documentError(error.message) };
  const intent = objectRecord(data);
  const documentId = intent?.document_id;
  const versionId = intent?.version_id;
  const storageKey = intent?.storage_key;
  if (typeof documentId !== "string" || typeof versionId !== "string" || typeof storageKey !== "string") {
    return { error: "The redacted copy could not be saved." };
  }
  const uploaded = await service.storage.from("documents").upload(storageKey, output, { contentType: detected, upsert: false });
  if (uploaded.error) return { error: "The redacted copy could not be saved." };
  const sha256 = createHash("sha256").update(output).digest("hex");
  const { data: finished, error: finishError } = await service.rpc("finish_verified_document_upload", {
    p_version_id: versionId,
    p_actor_user_id: session.userId,
    p_sha256: sha256,
    p_byte_size: output.byteLength,
    p_detected_media_type: detected,
  });
  if (finishError) return { error: documentError(finishError.message) };
  const result = objectRecord(finished);
  const uploadState = result?.upload_state;
  if (typeof uploadState !== "string") return { error: "The redacted copy could not be checked." };
  if (uploadState === "scanning") {
    const scanned = await scanJustUploaded(service, versionId);
    return { documentId, versionId, uploadState: scanned.uploadState, scanResult: scanned.scanResult };
  }
  return {
    documentId,
    versionId,
    uploadState,
    scanResult: typeof result?.scan_result === "string" ? result.scan_result : null,
  };
}

/** The custody function's own refusals are already plain; anything else goes through documentError. */
function custodyError(message: string): string {
  if (/^(say |record |the firm already|that original|the return was|the received date|choose )/i.test(message)) return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;
  return documentError(message);
}
