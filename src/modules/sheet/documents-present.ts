/**
 * Pure helpers for the Sheet's Documents page: which version is a document's current one,
 * what the To review queue shows for it, and the chips on the All documents cards.
 * Upload state and firm review stay separate (DOC-02, DOC-04): "Clean" is a file check,
 * "Accepted" is the firm's acceptance for its purpose, never a government validation.
 */
import type { DocChip, DocTone, DocumentsTab } from "@/components/sheet/designer/documents";
import { documentCardFlags, type ReviewState, type UploadState } from "@/modules/documents/present";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, plusDays } from "@/modules/sheet/present";

export const REVIEW_ROLES = ["firm_owner", "licensed_consultant", "case_manager"] as const;
/** Accepted documents show in To review this many days before they expire. */
export const EXPIRY_WINDOW_DAYS = 30;

export function documentsTab(raw: string | undefined): DocumentsTab {
  return raw === "all" || raw === "custody" ? raw : "review";
}

export type VersionFacts = {
  id: string;
  documentId: string;
  versionNumber: number;
  uploadState: string;
  scanResult: string | null;
  reviewState: string;
  declaredMediaType: string;
  expiresOn: string | null;
  supersededAt: string | null;
  intentExpiresAt: string;
  createdAt: string;
};

/** An upload nobody finished: its authorization lapsed. It is not the document's current state. */
export function abandoned(version: Pick<VersionFacts, "uploadState" | "scanResult" | "intentExpiresAt">, now: Date): boolean {
  if (version.uploadState === "failed" && version.scanResult === "intent_expired") return true;
  return version.uploadState === "uploading" && new Date(version.intentExpiresAt).getTime() <= now.getTime();
}

/** The newest version of each document that is not an abandoned upload. */
export function currentVersions<T extends VersionFacts>(versions: readonly T[], now: Date): Map<string, T> {
  const current = new Map<string, T>();
  const ordered = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
  for (const version of ordered) {
    if (current.has(version.documentId) || abandoned(version, now)) continue;
    current.set(version.documentId, version);
  }
  return current;
}

const TYPE_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/heic": "HEIC image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word file",
};

/** The short reason after "Quarantined" or "Check failed". */
export function fileProblem(scanResult: string | null, declaredMediaType: string): string {
  if (scanResult === "extension_mismatch") return `not a ${TYPE_LABEL[declaredMediaType] ?? "matching file"}`;
  if (scanResult === "size_mismatch") return "size doesn’t match";
  if (scanResult === "unrecognized_type") return "unknown file type";
  return "can’t be checked";
}

export function fileIcon(mediaType: string | null): string {
  switch (mediaType) {
    case "application/pdf":
      return "file-pdf";
    case "image/jpeg":
      return "file-jpg";
    case "image/png":
      return "file-png";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "file-doc";
    default:
      return "file";
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type QueueEntry = {
  scan: DocChip | { tone: DocTone; pair: [string, string] };
  review: DocChip | string;
  flag: "review" | "quarantined" | "expiring";
  /** A clean file someone can open and review. */
  reviewable: boolean;
};

/** What To review shows for a document's current version, or null when it needs nothing. */
export function queueEntry(version: VersionFacts, today: string): QueueEntry | null {
  if (version.supersededAt) return null;
  if (version.uploadState === "quarantined") {
    return { scan: { tone: "bad", pair: ["Quarantined", fileProblem(version.scanResult, version.declaredMediaType)] }, review: "Can’t open", flag: "quarantined", reviewable: false };
  }
  if (version.uploadState === "failed") {
    return { scan: { tone: "bad", pair: ["Check failed", fileProblem(version.scanResult, version.declaredMediaType)] }, review: "Can’t open", flag: "quarantined", reviewable: false };
  }
  if (version.uploadState !== "clean") return null;
  const clean: DocChip = { tone: "ok", label: "Clean" };
  if (version.reviewState === "pending") return { scan: clean, review: { tone: "rev", label: "Awaiting review" }, flag: "review", reviewable: true };
  if (version.reviewState === "accepted" && version.expiresOn) {
    if (version.expiresOn < today) return { scan: clean, review: { tone: "bad", label: "Expired" }, flag: "expiring", reviewable: true };
    if (version.expiresOn <= plusDays(today, EXPIRY_WINDOW_DAYS)) {
      const days = daysBetween(today, version.expiresOn);
      const label = days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`;
      return { scan: clean, review: { tone: "chg", label }, flag: "expiring", reviewable: true };
    }
  }
  return null;
}

const CARD_TONE: Record<string, DocTone> = {
  Uploaded: "unv",
  Accepted: "ok",
  "Being reviewed": "rev",
  "Changes needed": "chg",
  Expired: "bad",
  Quarantined: "bad",
  "Upload failed": "bad",
  "Checking file": "unv",
  Requested: "chg",
  Superseded: "unv",
};

const UPLOADS = new Set(["uploading", "scanning", "quarantined", "clean", "failed"]);
const REVIEWS = new Set(["pending", "accepted", "rejected"]);

/** The All documents card chips, in the Designer's words ("Check failed" reads "Upload failed"). */
export function cardStates(version: VersionFacts | null, today: string): DocChip[] {
  const flags = documentCardFlags({
    uploadState: version && UPLOADS.has(version.uploadState) ? (version.uploadState as UploadState) : null,
    reviewState: version && REVIEWS.has(version.reviewState) ? (version.reviewState as ReviewState) : null,
    superseded: Boolean(version?.supersededAt),
    expired: Boolean(version?.expiresOn && version.expiresOn < today),
  });
  return flags.labels.map((label) => {
    const text = label === "Check failed" ? "Upload failed" : label;
    return { tone: CARD_TONE[text] ?? "unv", label: text };
  });
}

/** Whether All documents offers Open on a card: the current version passed the file check and the firm accepted it. */
export function cardOpenable(version: Pick<VersionFacts, "uploadState" | "reviewState"> & { scanResult?: string | null }): boolean {
  return version.uploadState === "clean" && version.reviewState === "accepted";
}

/**
 * Whether an open request is already answered by an upload on the page: the upload was attached to
 * it (the request's `document_id`), or it is the same person's document with the same purpose on
 * the same matter. The request stays open in the database until a person accepts the upload; the
 * page shows the upload once, not the upload and the request.
 */
export function requestAnswered(
  request: { document_id: string | null; person_id: string; matter_id: string; purpose: string },
  shown: readonly { id: string; person_id: string; purpose: string; matterId: string | undefined }[],
): boolean {
  if (request.document_id && shown.some((doc) => doc.id === request.document_id)) return true;
  const purpose = request.purpose.trim().toLowerCase();
  return shown.some((doc) => doc.person_id === request.person_id && doc.matterId === request.matter_id && doc.purpose.trim().toLowerCase() === purpose);
}

/** "Today 08:41" for today in the firm's zone, otherwise "16 Oct". */
export function whenLabel(iso: string, timeZone: string, today: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = isoDateInTimeZone(date, timeZone);
  if (day !== today) return dayMonth(day);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `Today ${time}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** "Marriage certificate v2": the version number once there is more than one. */
export function versionTitle(purpose: string, versionNumber: number): string {
  return versionNumber > 1 ? `${purpose} v${versionNumber}` : purpose;
}

/** DOC-06: the sensitivity choices a document can have, in plain words. */
export const SENSITIVITIES = [
  { value: "ordinary", label: "Ordinary" },
  { value: "narrative", label: "Personal statement or narrative" },
  { value: "medical", label: "Medical" },
  { value: "criminal", label: "Police or court record" },
] as const;

/** DOC-06: the languages a translation can be marked as, by ISO 639-1 code. */
export const TRANSLATION_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
] as const;

export type DocumentDetails = {
  organizationId: string;
  documentId: string;
  /** documents.version, for a classification change. */
  documentVersion: number;
  versionId: string;
  /** document_versions.version, for the translation and expiry changes. */
  versionRow: number;
  title: string;
  person: string;
  purpose: string;
  sensitivity: string;
  expiresOn: string | null;
  /** Matters using it now: each removable (public.unlink_document_matter). */
  refs: { id: string; label: string }[];
  /** The person's other matters it can be used on; empty when its file hasn't passed its check. */
  candidates: { id: string; label: string }[];
  /** A note when it can't be used on another matter yet. */
  linkNote: string | null;
  /** The person's other documents' current versions, as originals it can translate. */
  originals: { versionId: string; label: string }[];
  translationOf: string | null;
  languageTag: string | null;
  /** "Passport bio page (English)": the documents that translate this one. */
  translations: string[];
};

const LANGUAGE_LABEL = new Map<string, string>(TRANSLATION_LANGUAGES.map((language) => [language.value, language.label]));

export function languageLabel(tag: string | null): string {
  if (!tag) return "";
  return LANGUAGE_LABEL.get(tag.slice(0, 2)) ?? tag;
}

/** The All documents card's Details (DOC-06), for staff who review documents. */
export function documentDetails(input: {
  organizationId: string;
  document: { id: string; purpose: string; sensitivity: string; version: number; personId: string };
  person: string;
  version: { id: string; rowVersion: number; expiresOn: string | null; uploadState: string; translationOf: string | null; languageTag: string | null };
  refs: { id: string; matterId: string }[];
  personMatters: string[];
  others: { versionId: string; title: string; translationOf: string | null; languageTag: string | null }[];
  matterName: (id: string) => string;
}): DocumentDetails {
  const linked = new Set(input.refs.map((ref) => ref.matterId));
  const checked = input.version.uploadState === "clean";
  const candidates = checked
    ? [...new Set(input.personMatters)].filter((id) => !linked.has(id)).map((id) => ({ id, label: input.matterName(id) })).sort((a, b) => a.label.localeCompare(b.label))
    : [];
  return {
    organizationId: input.organizationId,
    documentId: input.document.id,
    documentVersion: input.document.version,
    versionId: input.version.id,
    versionRow: input.version.rowVersion,
    title: input.document.purpose,
    person: input.person,
    purpose: input.document.purpose,
    sensitivity: input.document.sensitivity,
    expiresOn: input.version.expiresOn,
    refs: input.refs.map((ref) => ({ id: ref.id, label: input.matterName(ref.matterId) })),
    candidates,
    linkNote: checked ? (candidates.length ? null : `${input.person} isn’t on another matter you can open.`) : "Only a file that passed its check can be used on another matter.",
    // A document that already translates this one can't also be its original.
    originals: input.others.filter((other) => other.translationOf !== input.version.id).map((other) => ({ versionId: other.versionId, label: other.title })),
    translationOf: input.version.translationOf,
    languageTag: input.version.languageTag,
    translations: input.others.filter((other) => other.translationOf === input.version.id).map((other) => `${other.title}${other.languageTag ? ` (${languageLabel(other.languageTag)})` : ""}`),
  };
}

export type CustodyEvent = {
  versionId: string;
  kind: string | null;
  receivedOn: string | null;
  location: string | null;
  purpose: string;
  recipient: string | null;
  returnOn: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};

export type CustodyStep = "moved" | "returned" | "acknowledged";

export type CustodyLine = {
  versionId: string;
  original: string;
  owner: string;
  received: string;
  location: string | [string, string];
  purpose: string;
  returnBy: string | [string, string];
  acknowledged: DocChip | string;
  next: CustodyStep[];
  history: string[];
};

/**
 * Originals we hold (DOC-07): one row per original, from its custody steps. The row shows its
 * latest custody: received, where it is now, and its return and acknowledgement. `next` is the
 * steps a reviewer may take now; `history` lists every step with its date. Newest activity first.
 */
export function custodyRows(events: readonly CustodyEvent[], describe: (versionId: string) => { original: string; owner: string } | null, dayOf: (iso: string) => string): CustodyLine[] {
  const byVersion = new Map<string, CustodyEvent[]>();
  for (const event of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const list = byVersion.get(event.versionId) ?? [];
    list.push(event);
    byVersion.set(event.versionId, list);
  }
  const rows: { latest: string; line: CustodyLine }[] = [];
  for (const [versionId, list] of byVersion) {
    const doc = describe(versionId);
    if (!doc) continue;
    // The latest time the firm received it; earlier holdings stay in the history.
    let start = 0;
    list.forEach((event, index) => {
      if (event.kind === "received" || event.kind === null) start = index;
    });
    const held = list.slice(start);
    const received = held[0];
    const moved = held.filter((event) => event.kind === "moved").at(-1);
    const returned = held.find((event) => event.kind === "returned");
    const acknowledged = held.find((event) => event.kind === "acknowledged");
    const legacy = received.kind === null;
    const location: string | [string, string] = returned ? ["Returned", returned.recipient ?? "—"] : (moved?.location ?? received.location ?? "—");
    const returnBy: string | [string, string] = returned?.returnOn ? ["Returned", dayOf(returned.returnOn)] : legacy && received.returnOn ? dayOf(received.returnOn) : "—";
    const ack = acknowledged ?? (legacy && received.acknowledgedAt ? received : null);
    const acknowledgedCell: DocChip | string = ack?.acknowledgedAt
      ? `${ack.recipient ? `Signed by ${ack.recipient}` : "Acknowledged"}, ${dayOf(ack.acknowledgedAt.slice(0, 10))}`
      : { tone: "chg", label: "Waiting" };
    const next: CustodyStep[] = legacy ? [] : returned ? (acknowledged ? [] : ["acknowledged"]) : ["moved", "returned"];
    const history = list.map((event) => {
      if (event.kind === "moved") return `Moved to ${event.location ?? "—"}, ${dayOf(event.createdAt.slice(0, 10))}`;
      if (event.kind === "returned") return `Returned to ${event.recipient ?? "—"}${event.returnOn ? `, ${dayOf(event.returnOn)}` : ""}`;
      if (event.kind === "acknowledged") return `Return acknowledged${event.recipient ? ` by ${event.recipient}` : ""}, ${dayOf(event.createdAt.slice(0, 10))}`;
      return `Received${event.receivedOn ? ` ${dayOf(event.receivedOn)}` : ""}${event.location ? `, kept in ${event.location}` : ""}`;
    });
    rows.push({
      latest: list.at(-1)?.createdAt ?? "",
      line: { versionId, original: doc.original, owner: doc.owner, received: received.receivedOn ? dayOf(received.receivedOn) : "—", location, purpose: received.purpose, returnBy, acknowledged: acknowledgedCell, next, history },
    });
  }
  return rows.sort((a, b) => b.latest.localeCompare(a.latest)).map((entry) => entry.line);
}
