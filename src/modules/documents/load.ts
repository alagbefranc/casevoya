import "server-only";

import { documentCardFlags, INFECTED_CLIENT_NOTE, progressLine, VIRUS_LABELS, type ReviewState, type UploadState } from "@/modules/documents/present";
import { textForViewer, type ShownText } from "@/modules/i18n/display";
import type { PortalViewer } from "@/modules/portal/load";
import { todayIso } from "@/modules/sheet/birth-date";
import { createClient } from "@/lib/supabase/server";
import { claimSourcesFrom, type ClaimSourceContext } from "@/modules/content-governance/claim-source-present";

const REVIEW_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager"]);

export type PortalDocumentCard = {
  key: string;
  title: string;
  personName: string;
  meta: string;
  versionLabel: string;
  when: string;
  labels: string[];
  needsYou: boolean;
  countsAsAccepted: boolean;
  canDownload: boolean;
  alert: string | null;
  /** The language of `alert`: "fr" when a French-preferring viewer sees the reviewed French. */
  alertLang: "en" | "fr";
  versionId: string | null;
  expectedVersion: number | null;
  requestId: string | null;
  requestVersion: number | null;
  /** SRC-07: official link and date checked when this file answers a claim. */
  source?: ClaimSourceContext;
  documentId: string | null;
  matterId: string;
  personId: string;
  refId: string | null;
  purpose: string;
  sensitivity: string;
  audience: string;
  canReview: boolean;
  /** #263-B, live only: the plain line under a file the virus scanner blocked. */
  note?: string;
};

export type PortalOpenRequest = {
  id: string;
  matterId: string;
  personId: string;
  personName: string;
  purpose: string;
  explanation: string;
  documentId: string | null;
  formats: string[];
  sensitivity: string;
  audience: string;
  /** SRC-07: official link and date checked when the request cites a claim. */
  source?: ClaimSourceContext;
};

export type PortalDocuments = {
  cards: PortalDocumentCard[];
  requests: PortalOpenRequest[];
  progressLine: string;
  canReview: boolean;
  people: { id: string; displayName: string }[];
  /** DOC-02: the firm's per-file upload limit in bytes (public.document_upload_limit). */
  maxBytes?: number;
  /** DES-04: parts that couldn't be read (a partial page); absent when everything loaded. */
  unavailable?: "review notes"[];
};

const UPLOADS = new Set<UploadState>(["uploading", "scanning", "quarantined", "clean", "failed", "scan_failed"]);
const REVIEWS = new Set<ReviewState>(["pending", "accepted", "rejected"]);

function asUpload(value: string): UploadState | null {
  return UPLOADS.has(value as UploadState) ? (value as UploadState) : null;
}

function asReview(value: string): ReviewState | null {
  return REVIEWS.has(value as ReviewState) ? (value as ReviewState) : null;
}

function formatWhen(value: string | null, timeZone: string): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", timeZone }).format(date);
}

/**
 * Who each request is for, by person id: the people the viewer can read, then (#272) the names of
 * others on their matter whose requests they can see (public.portal_request_person_names), so a
 * sponsor sees "Elias Lindqvist", never "Person", on a co-applicant's request.
 */
export function portalPersonNames(
  people: readonly { id: string; displayName: string }[],
  requestNames: readonly { person_id: string; display_name: string }[] | null | undefined,
): Map<string, string> {
  const names = new Map(people.map((person) => [person.id, person.displayName]));
  for (const row of requestNames ?? []) {
    if (row.person_id && row.display_name && !names.has(row.person_id)) names.set(row.person_id, row.display_name);
  }
  return names;
}

/** Past its expiry on the firm's today, as app.request_version_satisfies counts it. */
function expired(expiresOn: string | null, timeZone: string): boolean {
  if (!expiresOn) return false;
  return expiresOn < todayIso(new Date(), timeZone);
}

export async function loadPortalDocuments(viewer: PortalViewer): Promise<PortalDocuments> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const canReview = REVIEW_ROLES.has(viewer.role);
  const matterId = viewer.matters[0]?.id ?? null;
  const [{ data: requests, error: requestsError }, { data: documents, error: documentsError }, { data: versions, error: versionsError }, { data: refs }, { data: reviews, error: reviewsError }, { data: translations }, progress, limit, sources, { data: requestNames }] =
    await Promise.all([
      supabase
        .from("document_requests")
        .select("id, matter_id, person_id, document_id, purpose, explanation, acceptable_formats, status, audience, sensitivity, version, expires_on")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(80),
      supabase.from("documents").select("id, person_id, purpose, sensitivity, audience, current_version_id").limit(80),
      supabase
        .from("document_versions")
        .select("id, document_id, request_id, version_number, original_filename, upload_state, scan_result, review_state, expires_on, superseded_at, created_at, version")
        .order("version_number", { ascending: false })
        .limit(160),
      supabase.from("document_matter_refs").select("id, document_id, matter_id, removed_at").is("removed_at", null).limit(160),
      supabase.from("document_reviews").select("id, version_id, reason, created_at").order("created_at", { ascending: false }).limit(160),
      // The French a staff member reviewed and saved with a review (RLS: readable where the review is).
      supabase.from("document_review_translations").select("review_id, reason").eq("language", "fr-CA").limit(160),
      matterId
        ? supabase.rpc("document_request_progress", { p_matter_id: matterId })
        : Promise.resolve({ data: null }),
      supabase.rpc("document_upload_limit", { p_organization_id: viewer.organizationId }),
      supabase.rpc("portal_claim_sources"),
      // #272: persons RLS hides another adult on the matter (a co-applicant without a login) from
      // the sponsor; this narrow read gives only the names on requests the viewer can already see.
      supabase.rpc("portal_request_person_names"),
    ]);
  const sourceByRequest = claimSourcesFrom(sources.error ? null : sources.data);
  // DES-04: unreadable is not "no documents requested"; the page shows its couldn't-load state.
  if (requestsError || documentsError || versionsError) throw new Error("portal documents unreadable");

  const names = portalPersonNames(viewer.people, requestNames);
  const docs = new Map((documents ?? []).map((row) => [row.id, row]));
  const frenchByReview = new Map((translations ?? []).map((row) => [row.review_id, row.reason]));
  const reasonByVersion = new Map<string, ShownText>();
  for (const review of reviews ?? []) {
    if (!reasonByVersion.has(review.version_id)) {
      reasonByVersion.set(review.version_id, textForViewer(review.reason, frenchByReview.get(review.id), viewer.prefs?.locale));
    }
  }
  const alertFor = (versionId: string | null | undefined, changes: boolean) => {
    const shown = changes && versionId ? reasonByVersion.get(versionId) : undefined;
    return { alert: shown?.text ?? null, alertLang: shown?.lang ?? ("en" as const) };
  };
  const refByDocument = new Map<string, { id: string; matterId: string }>();
  for (const ref of refs ?? []) {
    if (!refByDocument.has(ref.document_id)) refByDocument.set(ref.document_id, { id: ref.id, matterId: ref.matter_id });
  }
  const latestByRequest = new Map<string, NonNullable<typeof versions>[number]>();
  const latestByDocument = new Map<string, NonNullable<typeof versions>[number]>();
  for (const version of versions ?? []) {
    if (version.request_id && !latestByRequest.has(version.request_id)) latestByRequest.set(version.request_id, version);
    if (!latestByDocument.has(version.document_id)) latestByDocument.set(version.document_id, version);
  }

  const cards: PortalDocumentCard[] = [];
  const seenDocuments = new Set<string>();

  for (const request of requests ?? []) {
    const version = latestByRequest.get(request.id) ?? null;
    if (version) seenDocuments.add(version.document_id);
    const doc = request.document_id ? docs.get(request.document_id) : undefined;
    const flags = documentCardFlags({
      uploadState: version ? asUpload(version.upload_state) : null,
      reviewState: version ? asReview(version.review_state) : null,
      superseded: Boolean(version?.superseded_at),
      expired: expired(version?.expires_on ?? request.expires_on, viewer.timezone),
      scanResult: version?.scan_result ?? null,
    });
    const personName = names.get(request.person_id) ?? "Person";
    const ref = doc ? refByDocument.get(doc.id) : request.document_id ? refByDocument.get(request.document_id) : undefined;
    cards.push({
      key: `request-${request.id}`,
      title: request.purpose,
      personName,
      meta: request.purpose,
      versionLabel: version ? `v${version.version_number}` : "Requested",
      when: formatWhen(version?.created_at ?? null, viewer.timezone),
      labels: flags.labels,
      needsYou: flags.needsYou && request.status !== "waived",
      countsAsAccepted: flags.countsAsAccepted,
      canDownload: flags.canDownload,
      ...alertFor(version?.id, flags.labels.includes("Changes needed")),
      versionId: version?.id ?? null,
      expectedVersion: version?.version ?? null,
      requestId: request.id,
      requestVersion: request.version,
      documentId: request.document_id,
      matterId: request.matter_id,
      personId: request.person_id,
      refId: ref?.id ?? null,
      purpose: request.purpose,
      sensitivity: doc?.sensitivity ?? request.sensitivity,
      audience: doc?.audience ?? request.audience,
      canReview: canReview && flags.labels.includes("Being reviewed"),
      ...(flags.labels.includes(VIRUS_LABELS.infected) ? { note: INFECTED_CLIENT_NOTE } : {}),
      ...(sourceByRequest.get(request.id) ? { source: sourceByRequest.get(request.id) } : {}),
    });
  }

  for (const [documentId, version] of latestByDocument) {
    if (seenDocuments.has(documentId) || version.request_id) continue;
    const doc = docs.get(documentId);
    if (!doc) continue;
    const flags = documentCardFlags({
      uploadState: asUpload(version.upload_state),
      reviewState: asReview(version.review_state),
      superseded: Boolean(version.superseded_at),
      expired: expired(version.expires_on, viewer.timezone),
      scanResult: version.scan_result ?? null,
    });
    const ref = refByDocument.get(documentId);
    cards.push({
      key: `document-${documentId}`,
      title: doc.purpose,
      personName: names.get(doc.person_id) ?? "Person",
      meta: version.original_filename,
      versionLabel: `v${version.version_number}`,
      when: formatWhen(version.created_at, viewer.timezone),
      labels: flags.labels,
      needsYou: flags.needsYou,
      countsAsAccepted: flags.countsAsAccepted,
      canDownload: flags.canDownload,
      ...alertFor(version.id, flags.labels.includes("Changes needed")),
      versionId: version.id,
      expectedVersion: version.version,
      requestId: null,
      requestVersion: null,
      documentId,
      matterId: ref?.matterId ?? matterId ?? "",
      personId: doc.person_id,
      refId: ref?.id ?? null,
      purpose: doc.purpose,
      sensitivity: doc.sensitivity,
      audience: doc.audience,
      canReview: canReview && flags.labels.includes("Being reviewed"),
      ...(flags.labels.includes(VIRUS_LABELS.infected) ? { note: INFECTED_CLIENT_NOTE } : {}),
    });
  }

  const openRequests: PortalOpenRequest[] = (requests ?? [])
    .filter((request) => request.status === "open")
    .map((request) => ({
      id: request.id,
      matterId: request.matter_id,
      personId: request.person_id,
      personName: names.get(request.person_id) ?? "Person",
      purpose: request.purpose,
      explanation: request.explanation,
      documentId: request.document_id,
      formats: request.acceptable_formats,
      sensitivity: request.sensitivity,
      audience: request.audience,
      ...(sourceByRequest.get(request.id) ? { source: sourceByRequest.get(request.id) } : {}),
    }));

  const progressRecord = progress.data && typeof progress.data === "object" && !Array.isArray(progress.data) ? progress.data : null;
  const requestCount = typeof progressRecord?.request_count === "number" ? progressRecord.request_count : (requests ?? []).length;
  const acceptedCount = typeof progressRecord?.accepted_count === "number"
    ? progressRecord.accepted_count
    : cards.filter((card) => card.countsAsAccepted).length;
  const uploadedUnaccepted = typeof progressRecord?.uploaded_unaccepted_count === "number" ? progressRecord.uploaded_unaccepted_count : 0;

  return {
    cards,
    requests: openRequests,
    progressLine: progressLine({ requestCount, acceptedCount, uploadedUnacceptedCount: uploadedUnaccepted }),
    canReview,
    people: viewer.people.map((person) => ({ id: person.id, displayName: person.displayName })),
    ...(typeof limit.data === "number" && limit.data > 0 ? { maxBytes: limit.data } : {}),
    // DES-04: the firm's reasons for "Changes needed" couldn't be read; the page says so.
    ...(reviewsError ? { unavailable: ["review notes" as const] } : {}),
  };
}
