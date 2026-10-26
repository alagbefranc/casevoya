import "server-only";
import type { CustodyRow, DocCard, DocChip, DocumentReviewDialogData, DocumentsData, ReviewRow } from "@/components/sheet/designer/documents";
import { WAITING_LABEL, type RequestWaiting } from "@/modules/sheet/reports-ops-more";
import { loadOpenRequests, sampleMatterIds } from "@/modules/sheet/reports-ops-more-load";
import { createClient } from "@/lib/supabase/server";
import { PREVIEWABLE } from "@/modules/documents/preview";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import {
  cardOpenable,
  cardStates,
  currentVersions,
  custodyRows,
  documentsTab,
  fileIcon,
  firstName,
  queueEntry,
  REVIEW_ROLES,
  documentDetails,
  requestAnswered,
  versionTitle,
  whenLabel,
  type VersionFacts,
} from "@/modules/sheet/documents-present";
import { dayMonth } from "@/modules/sheet/home-present";
import { voReadOffered } from "@/modules/sheet/vo-doc-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, type SheetQuery } from "@/modules/sheet/present";
import { loadImportProvenance } from "@/modules/migration/provenance-load";
import { importedNote } from "@/modules/sheet/imported-present";

/** How many versions, documents and requests the page reads. RLS decides which are visible. */
const READ = 400;

/**
 * The Designer's Documents page for a firm, read as the signed-in staff member so RLS decides
 * what is visible: the firm owner sees every document, other staff only documents linked to a
 * matter they can open, and a document limited to its subject never reaches anyone else.
 */
export async function loadSheetDocuments(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(now, staff.timezone);
  const tab = documentsTab(query.tab);

  const [chrome, versionRows, documentRows, refRows, requestRows] = await Promise.all([
    loadSheetChrome(staff, "/sheet/documents"),
    supabase
      .from("document_versions")
      .select("id, document_id, version_number, original_filename, declared_media_type, upload_state, scan_result, scan_engine, review_state, expires_on, superseded_at, intent_expires_at, completed_at, created_at, version, translation_of_version_id, language_tag")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(READ),
    supabase.from("documents").select("id, person_id, purpose, sensitivity, version").eq("organization_id", org).order("updated_at", { ascending: false }).limit(READ),
    supabase.from("document_matter_refs").select("id, document_id, matter_id, created_at").eq("organization_id", org).is("removed_at", null).limit(READ),
    tab === "all"
      ? supabase.from("document_requests").select("id, matter_id, person_id, document_id, purpose, due_on, created_at").eq("organization_id", org).eq("status", "open").order("created_at", { ascending: false }).limit(READ)
      : null,
  ]);

  const versions = (versionRows.data ?? []).map((row) => ({
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    uploadState: row.upload_state as string,
    scanResult: row.scan_result,
    scanEngine: row.scan_engine ?? null,
    reviewState: row.review_state as string,
    declaredMediaType: row.declared_media_type,
    expiresOn: row.expires_on,
    supersededAt: row.superseded_at,
    intentExpiresAt: row.intent_expires_at,
    createdAt: row.completed_at ?? row.created_at,
    filename: row.original_filename,
    rowVersion: row.version,
    translationOf: row.translation_of_version_id,
    languageTag: row.language_tag,
  }));
  const documents = new Map((documentRows.data ?? []).map((row) => [row.id, row]));
  const matterOf = new Map<string, string>();
  for (const ref of [...(refRows.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!matterOf.has(ref.document_id)) matterOf.set(ref.document_id, ref.matter_id);
  }
  const requests = requestRows?.data ?? [];

  const personIds = [...new Set([...[...documents.values()].map((doc) => doc.person_id), ...requests.map((row) => row.person_id)])];
  const canReview = (REVIEW_ROLES as readonly string[]).includes(staff.role);
  // DOC-06: the matters each person is on (that this member can read), for "Use in another matter".
  const participants =
    tab === "all" && canReview && personIds.length
      ? await supabase.from("matter_participants").select("matter_id, person_id").eq("organization_id", org).in("person_id", personIds).limit(READ)
      : null;
  const matterIds = [...new Set([...matterOf.values(), ...requests.map((row) => row.matter_id), ...(participants?.data ?? []).map((row) => row.matter_id)])];
  const [people, matters] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    matterIds.length ? supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", matterIds) : null,
  ]);
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const matterLabel = new Map((matters?.data ?? []).map((row) => [row.id, row.reference || row.title]));
  const nameOf = (id: string) => personName.get(id) ?? "Person";
  const matterName = (id: string | undefined) => (id ? matterLabel.get(id) ?? "Matter" : "No matter");

  const current = currentVersions(versions, now);
  // MIG follow-ups: a document an import brought in says "Imported from <system> on <date>".
  const imports = await loadImportProvenance(supabase, org, "documents", [...current.keys()]);

  // The last firm review of each version, for the reason shown when a replacement arrives.
  const previousIds = [...current.values()].filter((version) => version.versionNumber > 1).map((version) => version.documentId);
  const previous = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    const latest = current.get(version.documentId);
    if (!latest || !previousIds.includes(version.documentId) || version.versionNumber !== latest.versionNumber - 1) continue;
    previous.set(version.documentId, version);
  }
  const previousVersionIds = [...previous.values()].filter((version) => version.reviewState === "rejected").map((version) => version.id);
  const reviews = previousVersionIds.length
    ? await supabase.from("document_reviews").select("version_id, reason, created_at").eq("organization_id", org).in("version_id", previousVersionIds).order("created_at", { ascending: false })
    : null;
  const reasonOf = new Map<string, string>();
  for (const review of reviews?.data ?? []) if (!reasonOf.has(review.version_id)) reasonOf.set(review.version_id, review.reason);

  const queue: ReviewRow[] = [];
  let quarantined = 0;
  for (const version of [...current.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const doc = documents.get(version.documentId);
    if (!doc) continue;
    const entry = queueEntry(version, today);
    if (!entry) continue;
    if (entry.flag === "quarantined") quarantined++;
    const matterId = matterOf.get(doc.id);
    const person = nameOf(doc.person_id);
    const matter = matterName(matterId);
    const title = versionTitle(doc.purpose, version.versionNumber);
    const prior = previous.get(doc.id);
    const reason = prior ? reasonOf.get(prior.id) : undefined;
    const attrs: Record<string, string> | undefined =
      entry.reviewable && canReview
        ? {
            "data-doc-review": version.id,
            "data-version": String(version.rowVersion),
            "data-title": title,
            "data-meta": `${person} · ${matter} · ${version.filename}`,
            ...(version.expiresOn ? { "data-expires": version.expiresOn } : {}),
            ...(reason ? { "data-prev": reason } : {}),
          }
        : undefined;
    queue.push({
      title,
      link: entry.reviewable && (matterId || attrs) ? { href: matterId ? `/sheet/matters/${matterId}?tab=documents` : "/sheet/documents", attrs } : undefined,
      flags: [entry.flag],
      person,
      matter,
      uploaded: importedNote(imports, doc.id, staff.timezone) ?? whenLabel(version.createdAt, staff.timezone, today),
      scan: entry.scan,
      review: entry.review,
    });
  }

  const data: DocumentsData = {
    tab,
    // "To review" and "quarantined" are separate: a quarantined file isn't counted twice.
    pills: [`${queue.length - quarantined} to review`, `${quarantined} quarantined`],
    firmName: staff.organizationName,
  };

  if (tab === "review") data.review = { rows: queue, filterEmpty: true };

  if (tab === "all" && query.view === "requests") {
    data.all = await loadRequestsView(supabase, staff, today);
  } else if (tab === "all") {
    const cards: DocCard[] = [];
    const shown: { id: string; person_id: string; purpose: string; matterId: string | undefined }[] = [];
    for (const [documentId, version] of [...current.entries()].sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))) {
      const doc = documents.get(documentId);
      if (!doc) continue;
      shown.push({ id: doc.id, person_id: doc.person_id, purpose: doc.purpose, matterId: matterOf.get(doc.id) });
      cards.push({
        title: doc.purpose,
        thumb: { icon: fileIcon(version.declaredMediaType) },
        meta: {
          parts: [matterName(matterOf.get(doc.id)), firstName(nameOf(doc.person_id)), ...[importedNote(imports, doc.id, staff.timezone)].filter((part): part is string => Boolean(part))],
          version: `v${version.versionNumber}`,
          when: whenLabel(version.createdAt, staff.timezone, today),
        },
        states: cardStates(version as VersionFacts, today),
        // An accepted, clean file opens through a short-lived signed link after a fresh access check.
        // DOC-07: a PDF or image opens as the secure, watermarked preview.
        ...(cardOpenable(version) ? { open: { "data-doc-open": version.id, "data-org": org, ...(PREVIEWABLE.has(version.declaredMediaType) ? { "data-doc-preview": "1" } : {}) } } : {}),
        ...(canReview
          ? {
              details: documentDetails({
                organizationId: org,
                document: { id: doc.id, purpose: doc.purpose, sensitivity: doc.sensitivity, version: doc.version, personId: doc.person_id },
                person: nameOf(doc.person_id),
                version: { id: version.id, rowVersion: version.rowVersion, expiresOn: version.expiresOn, uploadState: version.uploadState, translationOf: version.translationOf, languageTag: version.languageTag },
                refs: (refRows.data ?? []).filter((ref) => ref.document_id === doc.id).map((ref) => ({ id: ref.id, matterId: ref.matter_id })),
                personMatters: (participants?.data ?? []).filter((row) => row.person_id === doc.person_id).map((row) => row.matter_id),
                others: [...current.values()]
                  .filter((other) => other.documentId !== doc.id && documents.get(other.documentId)?.person_id === doc.person_id)
                  .map((other) => ({ versionId: other.id, title: documents.get(other.documentId)?.purpose ?? "Document", translationOf: other.translationOf, languageTag: other.languageTag })),
                matterName,
              }),
            }
          : {}),
      });
    }
    for (const request of requests) {
      // An upload made for this request (or the same person's same document on the same matter)
      // is already a card: the request isn't shown a second time while it waits for review.
      if (requestAnswered(request, shown)) continue;
      cards.push({
        title: request.purpose,
        thumb: { icon: "file" },
        meta: { parts: [matterName(request.matter_id), firstName(nameOf(request.person_id))], when: request.due_on ? `Due ${dayMonth(request.due_on)}` : undefined },
        states: cardStates(null, today),
      });
    }
    data.all = { cards };
  }

  if (tab === "custody") {
    data.custody = { rows: await loadCustody(supabase, org, documents, versions, nameOf, canReview) };
    // DOC-07: Record an original, from a document whose current file passed its check.
    if (canReview) {
      data.custody.record = {
        organizationId: org,
        originals: [...current.values()]
          .filter((version) => version.uploadState === "clean" && documents.has(version.documentId))
          .map((version) => {
            const doc = documents.get(version.documentId) as { person_id: string; purpose: string };
            return { versionId: version.id, label: `${doc.purpose} · ${nameOf(doc.person_id)} · ${matterName(matterOf.get(version.documentId))}` };
          })
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
    }
  }

  const dialog: DocumentReviewDialogData | null = canReview
    ? { organizationId: org, firmName: staff.organizationName, vo: await voReadOffered(supabase, org, staff.sampleMode).catch(() => false) }
    : null;
  return { chrome, documents: data, dialog };
}

type Client = Awaited<ReturnType<typeof createClient>>;

const WAITING_TONE: Record<RequestWaiting, DocChip["tone"]> = { missing: "chg", review: "rev", changes: "chg", expired: "bad" };

/**
 * REP-01: All documents narrowed to the open document requests (`?tab=all&view=requests`), one
 * card per request, read by the same loader as the Reports page's Outstanding documents card so
 * the list and the figure are the same rows. Each card carries where it waits, in the report's words.
 */
async function loadRequestsView(supabase: Client, staff: SheetStaff, today: string): Promise<NonNullable<DocumentsData["all"]>> {
  const org = staff.organizationId;
  const sample = await sampleMatterIds(supabase, org, !staff.sampleMode);
  const cap = { capped: false };
  const requests = await loadOpenRequests(supabase, org, today, sample, cap);
  const personIds = [...new Set(requests.map((row) => row.personId))];
  const matterIds = [...new Set(requests.map((row) => row.matterId))];
  const [people, matters] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    matterIds.length ? supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", matterIds) : null,
  ]);
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const matterLabel = new Map((matters?.data ?? []).map((row) => [row.id, row.reference || row.title]));
  const cards: DocCard[] = requests.map((request) => ({
    title: request.purpose,
    thumb: { icon: "file" },
    meta: {
      parts: [matterLabel.get(request.matterId) ?? "Matter", firstName(personName.get(request.personId) ?? "Person")],
      when: request.dueOn ? `Due ${dayMonth(request.dueOn)}` : undefined,
    },
    states: [{ tone: WAITING_TONE[request.waiting], label: WAITING_LABEL[request.waiting] }],
  }));
  const n = cards.length;
  return {
    cards,
    filter: {
      text: `Showing ${n} open document ${n === 1 ? "request" : "requests"}, the rows the Reports page counts.${staff.sampleMode ? "" : " Requests on sample matters are left out."}${cap.capped ? " More requests exist than this page reads, so the list is partial." : ""}`,
      clear: "/sheet/documents?tab=all",
    },
  };
}

async function loadCustody(
  supabase: Client,
  org: string,
  documents: Map<string, { id: string; person_id: string; purpose: string }>,
  versions: { id: string; documentId: string }[],
  nameOf: (id: string) => string,
  live: boolean,
): Promise<CustodyRow[]> {
  const events = await supabase
    .from("document_custody_events")
    .select("version_id, kind, received_on, location, purpose, recipient, return_on, acknowledged_at, created_at")
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .limit(READ);
  const rows = events.data ?? [];
  const documentOf = new Map(versions.map((version) => [version.id, version.documentId]));
  const missing = [...new Set(rows.map((row) => row.version_id).filter((id) => !documentOf.has(id)))];
  if (missing.length) {
    const more = await supabase.from("document_versions").select("id, document_id").eq("organization_id", org).in("id", missing);
    for (const row of more.data ?? []) documentOf.set(row.id, row.document_id);
  }
  const missingDocs = [...new Set([...documentOf.values()].filter((id) => !documents.has(id)))];
  if (missingDocs.length) {
    const more = await supabase.from("documents").select("id, person_id, purpose").eq("organization_id", org).in("id", missingDocs);
    for (const row of more.data ?? []) documents.set(row.id, row);
  }
  return custodyRows(
    rows.map((row) => ({
      versionId: row.version_id,
      kind: row.kind,
      receivedOn: row.received_on,
      location: row.location,
      purpose: row.purpose,
      recipient: row.recipient,
      returnOn: row.return_on,
      acknowledgedAt: row.acknowledged_at,
      createdAt: row.created_at,
    })),
    (versionId) => {
      const doc = documents.get(documentOf.get(versionId) ?? "");
      return doc ? { original: doc.purpose, owner: nameOf(doc.person_id) } : null;
    },
    dayMonth,
  ).map(({ versionId, next, history, ...row }) => ({ ...row, ...(live ? { step: { versionId, organizationId: org, next }, history } : {}) }));
}
