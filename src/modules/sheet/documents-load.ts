import "server-only";
import type { CustodyRow, DocCard, DocumentReviewDialogData, DocumentsData, ReviewRow } from "@/components/sheet/designer/documents";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import {
  cardOpenable,
  cardStates,
  currentVersions,
  documentsTab,
  fileIcon,
  firstName,
  queueEntry,
  REVIEW_ROLES,
  requestAnswered,
  versionTitle,
  whenLabel,
  type VersionFacts,
} from "@/modules/sheet/documents-present";
import { dayMonth } from "@/modules/sheet/home-present";
import { voReadOffered } from "@/modules/sheet/vo-doc-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, type SheetQuery } from "@/modules/sheet/present";

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
      .select("id, document_id, version_number, original_filename, declared_media_type, upload_state, scan_result, review_state, expires_on, superseded_at, intent_expires_at, completed_at, created_at, version")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(READ),
    supabase.from("documents").select("id, person_id, purpose").eq("organization_id", org).order("updated_at", { ascending: false }).limit(READ),
    supabase.from("document_matter_refs").select("document_id, matter_id, created_at").eq("organization_id", org).is("removed_at", null).limit(READ),
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
    reviewState: row.review_state as string,
    declaredMediaType: row.declared_media_type,
    expiresOn: row.expires_on,
    supersededAt: row.superseded_at,
    intentExpiresAt: row.intent_expires_at,
    createdAt: row.completed_at ?? row.created_at,
    filename: row.original_filename,
    rowVersion: row.version,
  }));
  const documents = new Map((documentRows.data ?? []).map((row) => [row.id, row]));
  const matterOf = new Map<string, string>();
  for (const ref of [...(refRows.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!matterOf.has(ref.document_id)) matterOf.set(ref.document_id, ref.matter_id);
  }
  const requests = requestRows?.data ?? [];

  const personIds = [...new Set([...[...documents.values()].map((doc) => doc.person_id), ...requests.map((row) => row.person_id)])];
  const matterIds = [...new Set([...matterOf.values(), ...requests.map((row) => row.matter_id)])];
  const [people, matters] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    matterIds.length ? supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", matterIds) : null,
  ]);
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const matterLabel = new Map((matters?.data ?? []).map((row) => [row.id, row.reference || row.title]));
  const nameOf = (id: string) => personName.get(id) ?? "Person";
  const matterName = (id: string | undefined) => (id ? matterLabel.get(id) ?? "Matter" : "No matter");

  const current = currentVersions(versions, now);
  const canReview = (REVIEW_ROLES as readonly string[]).includes(staff.role);

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
      uploaded: whenLabel(version.createdAt, staff.timezone, today),
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

  if (tab === "all") {
    const cards: DocCard[] = [];
    const shown: { id: string; person_id: string; purpose: string; matterId: string | undefined }[] = [];
    for (const [documentId, version] of [...current.entries()].sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))) {
      const doc = documents.get(documentId);
      if (!doc) continue;
      shown.push({ id: doc.id, person_id: doc.person_id, purpose: doc.purpose, matterId: matterOf.get(doc.id) });
      cards.push({
        title: doc.purpose,
        thumb: { icon: fileIcon(version.declaredMediaType) },
        meta: { parts: [matterName(matterOf.get(doc.id)), firstName(nameOf(doc.person_id))], version: `v${version.versionNumber}`, when: whenLabel(version.createdAt, staff.timezone, today) },
        states: cardStates(version as VersionFacts, today),
        // An accepted, clean file opens through a short-lived signed link after a fresh access check.
        ...(cardOpenable(version) ? { open: { "data-doc-open": version.id, "data-org": org } } : {}),
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

  if (tab === "custody") data.custody = { rows: await loadCustody(supabase, org, documents, versions, nameOf, staff.timezone) };

  const dialog: DocumentReviewDialogData | null = canReview
    ? { organizationId: org, firmName: staff.organizationName, vo: await voReadOffered(supabase, org, staff.sampleMode).catch(() => false) }
    : null;
  return { chrome, documents: data, dialog };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function loadCustody(
  supabase: Client,
  org: string,
  documents: Map<string, { id: string; person_id: string; purpose: string }>,
  versions: { id: string; documentId: string }[],
  nameOf: (id: string) => string,
  timeZone: string,
): Promise<CustodyRow[]> {
  const events = await supabase
    .from("document_custody_events")
    .select("version_id, received_on, location, purpose, recipient, return_on, acknowledged_at, created_at")
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
  return rows.flatMap((row) => {
    const doc = documents.get(documentOf.get(row.version_id) ?? "");
    if (!doc) return [];
    const acknowledged = row.acknowledged_at
      ? `${row.recipient ? `Signed by ${row.recipient}` : "Acknowledged"}, ${dayMonth(isoDateInTimeZone(new Date(row.acknowledged_at), timeZone))}`
      : ({ tone: "chg", label: "Waiting" } as const);
    return [
      {
        original: doc.purpose,
        owner: nameOf(doc.person_id),
        received: row.received_on ? dayMonth(row.received_on) : "—",
        location: row.location ?? "—",
        purpose: row.purpose,
        returnBy: row.return_on ? dayMonth(row.return_on) : "—",
        acknowledged,
      },
    ];
  });
}
