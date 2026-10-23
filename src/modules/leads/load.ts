import "server-only";
import type { BookingLeadsData, CsvDialogData, NewLeadDialogData, PipelineData, PipelineHeaderData } from "@/components/sheet/designer/pipeline";
import type {
  BookingLinkRow,
  ConflictPanelData,
  ConvertDialogData,
  DuplicateCompareData,
  EditLeadDialogData,
  FollowUpDialogData,
  HistoryItem,
  LeadData,
  LeadDlItem,
  LeadHeaderData,
} from "@/components/sheet/designer/lead";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { safeZone, shortWhen } from "@/modules/scheduling/format";
import { todayIso } from "@/modules/sheet/birth-date";
import { loadSheetChrome, type SheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { loadNewMatterDialog } from "@/modules/sheet/matters-load";
import type { SheetQuery } from "@/modules/sheet/present";
import {
  buildPipeline,
  CONFLICT_STATE,
  consentValues,
  dueLabel,
  duplicateAlert,
  duplicateFor,
  historyItems,
  leadSummary,
  listFee,
  marketingGranted,
  pipelineTab,
  preferredLabel,
  reopenStage,
  replyGranted,
  STAFF_SOURCES,
  shortDay,
  sourceLabel,
  stamp,
  type BookingRow,
  type ConsentRow,
  type DecisionRow,
  type EventRow,
  type FollowUpRow,
  type LeadRow,
  type Owner,
  type StageRow,
} from "./present";

type Client = Awaited<ReturnType<typeof createClient>>;

const LEAD_COLUMNS =
  "id, display_name, email, phone, date_of_birth, service_interest, source, source_detail, stage_id, owner_membership_id, proposed_fee_cents, same_person_lead_id, converted_at, lost_at, created_at, updated_at, version, is_sample";
const LEAD_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant"];
/** Converted and lost leads stay on the board this long after they last changed. */
const CLOSED_DAYS = 90;
const READ = 1000;

/** Active operational staff, by membership id and by user id. */
async function staffDirectory(supabase: Client, org: string) {
  const members = await supabase.from("memberships").select("id, user_id, role").eq("organization_id", org).eq("status", "active");
  const rows = members.data ?? [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const profiles = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : null;
  const profileName = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name ?? ""]));
  const byMembership = new Map<string, Owner>();
  const byUser = new Map<string, string>();
  const owners: { value: string; label: string }[] = [];
  for (const row of rows) {
    const name = profileName.get(row.user_id) || "Staff member";
    byMembership.set(row.id, { name });
    byUser.set(row.user_id, name);
    if (LEAD_ROLES.includes(row.role)) owners.push({ value: row.id, label: name });
  }
  owners.sort((a, b) => a.label.localeCompare(b.label));
  return { byMembership, byUser, owners };
}

const CSV_MAP: CsvDialogData["map"] = [
  { column: "Name", sample: "—", field: "Name" },
  { column: "Email", sample: "—", field: "Email" },
  { column: "Phone", sample: "—", field: "Phone" },
  { column: "Service interest", sample: "—", field: "Service interest" },
  { column: "Source", sample: "—", field: "Source" },
  { column: "Note", sample: "—", field: "First note" },
];

export type PipelinePage = {
  chrome: SheetChrome;
  header: PipelineHeaderData;
  page: PipelineData;
  csv: CsvDialogData;
  newLead: NewLeadDialogData;
  bookings: BookingLeadsData | null;
};

/** Public bookings (no client record) that are not linked to a lead, from 30 days ago on. */
async function bookingsWithoutLead(supabase: Client, org: string, now: Date, timeZone: string) {
  const bookings = await supabase
    .from("bookings")
    .select("id, starts_at, title, status")
    .eq("organization_id", org)
    .eq("source", "public")
    .is("person_id", null)
    .in("status", ["held", "confirmed", "completed", "no_show"])
    .gte("starts_at", new Date(now.getTime() - 30 * 86_400_000).toISOString())
    .order("starts_at")
    .limit(100);
  const found = bookings.data ?? [];
  if (!found.length) return [];
  const ids = found.map((row) => row.id);
  const [links, attendees] = await Promise.all([
    supabase.from("lead_booking_links").select("booking_id").eq("organization_id", org).in("booking_id", ids),
    supabase.from("booking_attendees").select("booking_id, display_name").eq("organization_id", org).eq("role", "primary").in("booking_id", ids),
  ]);
  const taken = new Set((links.data ?? []).map((row) => row.booking_id));
  const name = new Map((attendees.data ?? []).map((row) => [row.booking_id, row.display_name]));
  return found
    .filter((row) => !taken.has(row.id))
    .map((row) => ({ id: row.id, label: `${shortWhen(Date.parse(row.starts_at), timeZone)} · ${name.get(row.id) ?? "Booking"} · ${row.title}` }));
}

/** The Designer's Lead pipeline for a firm, read as the signed-in staff member. */
export async function loadSheetPipeline(staff: SheetStaff, query: SheetQuery, now: Date = new Date()): Promise<PipelinePage> {
  const org = staff.organizationId;
  const supabase = await createClient({ organizationId: org });
  const tab = pipelineTab(query.tab);
  const closedSince = new Date(now.getTime() - CLOSED_DAYS * 86_400_000).toISOString();

  const [chrome, stages, leads, directory, unlinked] = await Promise.all([
    loadSheetChrome(staff, "/sheet/pipeline"),
    supabase.from("lead_stages").select("id, key, label, kind, position").eq("organization_id", org).is("archived_at", null).order("position"),
    supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("organization_id", org)
      .or(`and(converted_at.is.null,lost_at.is.null),updated_at.gte.${closedSince}`)
      .order("created_at", { ascending: false })
      .limit(READ),
    staffDirectory(supabase, org),
    bookingsWithoutLead(supabase, org, now, safeZone(staff.timezone)),
  ]);
  const leadRows = (leads.data ?? []) as LeadRow[];
  const ids = leadRows.map((row) => row.id);
  const [followUps, links, decisions] = ids.length
    ? await Promise.all([
        supabase.from("lead_follow_ups").select("id, lead_id, title, due_on, completed_at, owner_membership_id").eq("organization_id", org).is("completed_at", null).in("lead_id", ids),
        supabase.from("lead_booking_links").select("lead_id, booking_id").eq("organization_id", org).in("lead_id", ids),
        supabase.from("lead_duplicate_decisions").select("lead_id, other_lead_id, same_person").eq("organization_id", org),
      ])
    : [null, null, null];
  const bookingIds = (links?.data ?? []).map((row) => row.booking_id);
  const linkedBookings = bookingIds.length
    ? await supabase.from("bookings").select("id, starts_at, status, title").eq("organization_id", org).in("id", bookingIds)
    : null;
  const bookingById = new Map((linkedBookings?.data ?? []).map((row) => [row.id, row]));
  const bookingRows: BookingRow[] = (links?.data ?? []).flatMap((link) => {
    const booking = bookingById.get(link.booking_id);
    return booking ? [{ lead_id: link.lead_id, starts_at: booking.starts_at, status: booking.status, title: booking.title }] : [];
  });

  const built = buildPipeline({
    tab,
    stages: (stages.data ?? []) as StageRow[],
    leads: leadRows,
    followUps: (followUps?.data ?? []) as FollowUpRow[],
    bookings: bookingRows,
    decisions: (decisions?.data ?? []) as DecisionRow[],
    owners: directory.byMembership,
    filter: { stage: query.stage ?? null, owner: query.owner && (query.owner === "none" || isUuid(query.owner)) ? query.owner : null },
    organizationId: org,
    timeZone: staff.timezone,
    now,
  });

  const bookings: BookingLeadsData | null = unlinked.length
    ? {
        title: unlinked.length === 1 ? "1 booking isn’t a lead yet" : `${unlinked.length} bookings aren’t leads yet`,
        copy: "People who booked on your public page. Make each one a lead, or link it from a lead.",
        rows: unlinked.map((row) => ({ label: row.label, data: { "data-lead-act": "from-booking", "data-org": org, "data-booking": row.id } })),
      }
    : null;
  return {
    bookings,
    chrome: { ...chrome, sidebar: { ...chrome.sidebar, counts: { ...chrome.sidebar.counts, pipeline: built.openCount } } },
    header: {
      tab,
      pills: built.pills,
      csv: { "data-dlg": "dlgCsv", "data-fpd": "1" },
      newLead: { "data-lead-open": "new" },
    },
    // A failed read is said as such, not as an empty pipeline.
    page: {
      ...built.data,
      bookings,
      failed: leads.error || stages.error ? { title: "Leads couldn’t load", copy: "Reload the page. Nothing was changed; if it keeps happening, sign in again." } : null,
    },
    csv: {
      file: null,
      map: CSV_MAP,
      mapLabel: "Columns found in your file",
      mapNote:
        "Columns are matched by their header names: Name, Email, Phone, Service interest, Source and Note. To read a column differently, rename it in your file and choose the file again.",
      submit: { label: "Import leads", data: { "data-lead-act": "import", "data-org": org } },
    },
    newLead: {
      organizationId: org,
      owners: directory.owners,
      owner: directory.owners.some((option) => option.value === staff.membershipId) ? staff.membershipId : directory.owners[0]?.value ?? "",
      sampleMode: staff.sampleMode,
    },
  };
}

// ---------------------------------------------------------------------------
// One lead
// ---------------------------------------------------------------------------

export type LeadPage = {
  chrome: SheetChrome;
  header: LeadHeaderData;
  page: LeadData;
  conflict: ConflictPanelData;
  history: HistoryItem[];
  enquiry: LeadDlItem[];
  consultations: { rows: BookingLinkRow[]; link: { options: { value: string; label: string }[]; data: Record<string, string> } | null };
  dialogs: {
    convert: ConvertDialogData | null;
    duplicate: DuplicateCompareData | null;
    lost: Record<string, string> | null;
    edit: EditLeadDialogData | null;
    followUp: FollowUpDialogData;
    conflict: Record<string, string> | null;
    /** A lost (or archived) lead's Reopen: back to the stage it was closed from, or Contacted. */
    reopen: { label: string; data: Record<string, string> } | null;
  };
  /** The conflict search, run only when the Conflict check dialog is asked for (`?dlg=conflict`); it is audited. */
  conflictMatches: { label: string; detail: string }[] | null;
  /** Lead id and version for the page's own acts. */
  wire: { organizationId: string; leadId: string; version: number };
  /** A converted lead's matter, for the header's Open the matter. */
  matterHref: string | null;
};

type FullLead = LeadRow & {
  preferred_contact: string | null;
  country_now: string | null;
  language: string | null;
  tags: string[];
  conflict_result: string;
  conflict_note: string | null;
  conflict_checked_at: string | null;
  conflict_checked_by: string | null;
  lost_reason: string | null;
  converted_matter_id: string | null;
};

type ConflictMatches = {
  leads?: { name?: string; stage?: string; created_at?: string; matched?: string[] }[];
  clients?: { name?: string | null; matched?: string[]; matters?: { reference?: string | null; role?: string }[] }[];
};

/** The conflict search's rows as the dialog's table: who matched, and on what. */
export function conflictRows(result: unknown, timeZone: string): { label: string; detail: string }[] {
  const data = (result && typeof result === "object" ? result : {}) as ConflictMatches;
  const leads = (data.leads ?? []).map((row) => ({
    label: `Lead: ${row.name ?? "Unnamed"}${row.stage ? ` (${row.stage}${row.created_at ? `, ${shortDay(row.created_at, timeZone)}` : ""})` : ""}`,
    detail: (row.matched ?? []).join(", ") || "—",
  }));
  const clients = (data.clients ?? []).map((row) => {
    const refs = (row.matters ?? []).map((matter) => matter.reference).filter(Boolean).join(", ");
    return {
      label: `${row.name ? `Client: ${row.name}` : "A client record you can’t open"}${refs ? ` · ${refs}` : ""}`,
      detail: (row.matched ?? []).join(", ") || "—",
    };
  });
  return [...clients, ...leads];
}

export async function loadSheetLead(staff: SheetStaff, leadId: string, options: { conflict?: boolean } = {}, now: Date = new Date()): Promise<LeadPage | null> {
  if (!isUuid(leadId)) return null;
  const org = staff.organizationId;
  const tz = safeZone(staff.timezone);
  const supabase = await createClient({ organizationId: org });
  const leadResult = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, preferred_contact, country_now, language, tags, conflict_result, conflict_note, conflict_checked_at, conflict_checked_by, lost_reason, converted_matter_id`)
    .eq("organization_id", org)
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadResult.data as FullLead | null;
  if (!lead) return null;

  const [chrome, stages, notes, followUps, consents, events, links, decisions, similar, directory, matterDialog, orgRow, publicTypes, unlinked] = await Promise.all([
    loadSheetChrome(staff, "/sheet/lead"),
    supabase.from("lead_stages").select("id, key, label, kind, position").eq("organization_id", org),
    supabase.from("lead_notes").select("body, created_at, created_by").eq("organization_id", org).eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("lead_follow_ups").select("id, lead_id, title, due_on, completed_at, owner_membership_id").eq("organization_id", org).eq("lead_id", lead.id).order("created_at"),
    supabase.from("lead_consents").select("purpose, granted, captured_via, recorded_at").eq("organization_id", org).eq("lead_id", lead.id),
    supabase.from("lead_events").select("kind, from_stage_id, to_stage_id, reason, payload, actor_user_id, created_at").eq("organization_id", org).eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("lead_booking_links").select("booking_id").eq("organization_id", org).eq("lead_id", lead.id),
    supabase.from("lead_duplicate_decisions").select("lead_id, other_lead_id, same_person").eq("organization_id", org).or(`lead_id.eq.${lead.id},other_lead_id.eq.${lead.id}`),
    supabase.from("leads").select(LEAD_COLUMNS).eq("organization_id", org).neq("id", lead.id).order("created_at").limit(READ),
    staffDirectory(supabase, org),
    loadNewMatterDialog(supabase, staff),
    supabase.from("organizations").select("slug").eq("id", org).maybeSingle(),
    // A practice (sample) page only while the firm is in sample mode.
    (staff.sampleMode
      ? supabase.from("booking_event_types").select("slug, title").eq("organization_id", org)
      : supabase.from("booking_event_types").select("slug, title").eq("organization_id", org).eq("is_sample", false)
    )
      .eq("is_published", true)
      .is("archived_at", null)
      .order("title")
      .limit(1),
    supabase
      .from("bookings")
      .select("id, starts_at, title, status")
      .eq("organization_id", org)
      .eq("source", "public")
      .is("person_id", null)
      .gte("starts_at", new Date(now.getTime() - 30 * 86_400_000).toISOString())
      .order("starts_at")
      .limit(100),
  ]);

  const conflictSearch = options.conflict ? await supabase.rpc("lead_conflict_matches", { p_org: org, p_lead: lead.id }) : null;
  const stageRows = (stages.data ?? []) as StageRow[];
  const stage = stageRows.find((row) => row.id === lead.stage_id);
  const kind = stage?.kind ?? "open";
  const stageNames = new Map(stageRows.map((row) => [row.id, row.label]));
  const ownerName = lead.owner_membership_id ? directory.byMembership.get(lead.owner_membership_id)?.name ?? "Former staff" : "Unassigned";

  // Bookings linked to this lead, and public bookings not linked to any lead yet.
  const linkedIds = (links.data ?? []).map((row) => row.booking_id);
  const linked = linkedIds.length ? await supabase.from("bookings").select("id, starts_at, title, status").eq("organization_id", org).in("id", linkedIds).order("starts_at") : null;
  const candidateIds = (unlinked.data ?? []).map((row) => row.id);
  const taken = candidateIds.length ? await supabase.from("lead_booking_links").select("booking_id").eq("organization_id", org).in("booking_id", candidateIds) : null;
  const takenIds = new Set((taken?.data ?? []).map((row) => row.booking_id));
  const free = (unlinked.data ?? []).filter((row) => !takenIds.has(row.id) && ["held", "confirmed", "completed", "no_show"].includes(row.status));
  const attendees = free.length
    ? await supabase.from("booking_attendees").select("booking_id, display_name").eq("organization_id", org).eq("role", "primary").in("booking_id", free.map((row) => row.id))
    : null;
  const attendeeName = new Map((attendees?.data ?? []).map((row) => [row.booking_id, row.display_name]));

  const statusLabel: Record<string, string> = { held: "Held", pending_payment: "Awaiting payment", confirmed: "Confirmed", cancelled: "Cancelled", expired: "Expired", no_show: "No-show", completed: "Attended" };
  const consultationRows: BookingLinkRow[] = (linked?.data ?? []).map((row) => ({
    when: shortWhen(Date.parse(row.starts_at), tz),
    title: row.title,
    state: statusLabel[row.status] ?? row.status,
  }));

  const decisionRows = (decisions.data ?? []) as DecisionRow[];
  const match = kind === "open" ? duplicateFor(lead, [lead, ...((similar.data ?? []) as LeadRow[])], decisionRows) : null;
  const consentRows = (consents.data ?? []) as ConsentRow[];
  const consent = consentValues(consentRows, tz);
  const wire = { "data-org": org, "data-lead": lead.id, "data-version": String(lead.version) };
  const open = kind === "open";
  const closed = kind === "converted" || kind === "lost";

  const firmSlug = orgRow.data?.slug ?? "";
  const bookType = (publicTypes.data ?? [])[0];
  const bookHref = bookType && firmSlug ? `/book/${firmSlug}/${bookType.slug}` : "/sheet/consultations?tab=booking";

  const contact: LeadDlItem[] = [
    { term: "Email", value: lead.email ?? "Not given" },
    { term: "Phone", value: lead.phone ?? "Not given" },
    { term: "Preferred contact", value: preferredLabel(lead.preferred_contact, lead.email, lead.phone) },
    { term: "Language", value: lead.language ?? "Not given" },
    { term: "Country now", value: lead.country_now ?? "Not given" },
    { term: "Consent", value: consent.reply },
    { term: "Marketing", value: consent.marketing },
    { term: "Tags", value: lead.tags.length ? lead.tags.join(", ") : "None" },
    { term: "Owner", value: ownerName },
    { term: "Proposed fee", value: lead.proposed_fee_cents == null ? "Not set" : `CAD ${listFee(lead.proposed_fee_cents)} (firm’s fee)` },
  ];
  const enquiry: LeadDlItem[] = [
    { term: "Source", value: lead.source_detail ? { left: sourceLabel(lead.source), right: lead.source_detail } : sourceLabel(lead.source) },
    { term: "Service interest", value: lead.service_interest ?? "Not given" },
    { term: "Received", value: stamp(lead.created_at, tz) },
    ...(lead.date_of_birth ? [{ term: "Date of birth", value: lead.date_of_birth }] : []),
    ...(lead.lost_reason ? [{ term: "Lost reason", value: lead.lost_reason }] : []),
    ...(lead.converted_matter_id ? [{ term: "Matter", value: "Opened from this lead" }] : []),
    ...(lead.is_sample ? [{ term: "Record", value: "Sample (practice)" }] : []),
  ];

  const conflictState = CONFLICT_STATE[lead.conflict_result] ?? CONFLICT_STATE.not_checked;
  const conflict: ConflictPanelData = {
    state: conflictState,
    checked: lead.conflict_checked_at
      ? `${lead.conflict_checked_by ? directory.byUser.get(lead.conflict_checked_by) ?? "Staff" : "Staff"} · ${shortDay(lead.conflict_checked_at, tz)}`
      : null,
    note: lead.conflict_note,
    open: open ? { "data-lead-open": "conflict", ...wire } : null,
  };

  const convertWarning =
    lead.conflict_result !== "clear"
      ? { title: "Run the conflict check first", copy: "A lead converts after a conflict check with no conflict is recorded." }
      : staff.sampleMode
        ? { title: "This firm is in sample mode", copy: "The lead becomes a sample (practice) matter. Real client matters open once sample mode is turned off." }
        : lead.is_sample
          ? { title: "This is a sample lead", copy: "It becomes a sample (practice) matter, like the other sample records." }
        : matterDialog.consultants.length === 0
          ? { title: "A matter needs a licensed consultant", copy: "Invite a licensed consultant from Settings before converting." }
          : null;

  const header: LeadHeaderData = {
    name: lead.display_name,
    pills: [stage?.label ?? "Lead", sourceLabel(lead.source)],
    book: { href: bookHref },
    convert: open ? {} : null,
    extra: null,
  };

  const eventRows = (events.data ?? []) as EventRow[];
  const reopenTo = kind === "lost" || kind === "archived" ? reopenStage(stageRows, eventRows, lead.stage_id) : null;

  const followUpRows = (followUps.data ?? []) as FollowUpRow[];
  const page: LeadData = {
    name: lead.display_name,
    summary: leadSummary(lead),
    duplicate: match ? duplicateAlert(lead, match) : null,
    notes: (notes.data ?? []).map((note) => ({
      who: note.created_by ? directory.byUser.get(note.created_by) ?? "Staff" : "The enquiry form",
      when: shortDay(note.created_at, tz),
      body: note.body,
    })),
    noteSave: { "data-lead-act": "note", ...wire },
    followUps: followUpRows.map((item) => ({
      task: item.title,
      owner: item.owner_membership_id ? directory.byMembership.get(item.owner_membership_id)?.name ?? "Former staff" : "Unassigned",
      due: item.completed_at ? `Done ${shortDay(item.completed_at, tz)}` : dueLabel(item.due_on),
      done: item.completed_at ? null : { "data-lead-act": "follow-done", "data-follow-up": item.id, "data-org": org },
      doneLabel: "Done",
    })),
    followUpLive: { add: { "data-lead-open": "follow-up" }, empty: "No follow-ups yet." },
    contact,
  };

  const owners = directory.owners;
  const myOwner = owners.some((option) => option.value === staff.membershipId) ? staff.membershipId : owners[0]?.value ?? "";
  return {
    chrome,
    header,
    page,
    conflict,
    history: historyItems(eventRows, stageNames, directory.byUser, tz),
    enquiry,
    consultations: {
      rows: consultationRows,
      link: closed
        ? null
        : {
            options: free.map((row) => ({ value: row.id, label: `${shortWhen(Date.parse(row.starts_at), tz)} · ${attendeeName.get(row.id) ?? "Booking"} · ${row.title}` })),
            data: { "data-lead-act": "link-booking", ...wire },
          },
    },
    dialogs: {
      convert: open
        ? {
            programs: [...matterDialog.programs.map((option) => ({ label: option.label, value: option.value })), { label: matterDialog.programs.length ? "Choose later" : "No published template yet (choose later)", value: "" }],
            consultants: matterDialog.consultants.length
              ? matterDialog.consultants.map((option) => ({ label: option.label, value: option.value }))
              : [{ label: "No licensed consultant yet", value: "" }],
            warning: convertWarning,
            submit: { data: { "data-lead-act": "convert", ...wire } },
          }
        : null,
      duplicate: match
        ? {
            other: `${match.other.created_at.slice(0, 4)} lead`,
            rows: [
              { label: "Name", other: match.other.display_name, mine: lead.display_name },
              { label: "Date of birth", other: match.other.date_of_birth ?? "—", mine: lead.date_of_birth ?? "—" },
              { label: "Email", other: match.other.email ?? "—", mine: lead.email ?? "—" },
              { label: "Phone", other: match.other.phone ?? "—", mine: lead.phone ?? "—" },
            ],
            different: { data: { "data-lead-act": "dup-different", "data-other": match.other.id, ...wire } },
            same: { data: { "data-lead-act": "dup-same", "data-other": match.other.id, ...wire } },
          }
        : null,
      lost: open ? { "data-lead-act": "lost", ...wire } : null,
      edit: lead.converted_at
        ? null
        : {
            data: { "data-lead-act": "edit", ...wire },
            owners,
            values: {
              name: lead.display_name,
              email: lead.email ?? "",
              phone: lead.phone ?? "",
              preferred: lead.preferred_contact ?? "",
              service: lead.service_interest ?? "",
              country: lead.country_now ?? "",
              language: lead.language ?? "",
              dateOfBirth: lead.date_of_birth ?? "",
              sourceDetail: lead.source_detail ?? "",
              owner: lead.owner_membership_id ?? "",
              fee: lead.proposed_fee_cents == null ? "" : (lead.proposed_fee_cents / 100).toFixed(2),
              tags: lead.tags.join(", "),
            },
            maxBirthDate: todayIso(),
            marketing: { granted: marketingGranted(consentRows), data: { "data-marketing-was": marketingGranted(consentRows) ? "1" : "0" } },
            source: { value: lead.source, label: sourceLabel(lead.source), editable: STAFF_SOURCES.has(lead.source) },
            reply: { granted: replyGranted(consentRows), data: { "data-reply-was": replyGranted(consentRows) ? "1" : "0" } },
          },
      followUp: { data: { "data-lead-act": "follow-up", ...wire }, owners, owner: myOwner },
      conflict: open ? { "data-lead-act": "conflict", ...wire } : null,
      reopen: reopenTo
        ? { label: reopenTo.label, data: { "data-lead-act": "reopen", ...wire, "data-stage": reopenTo.id, "data-stage-label": reopenTo.label } }
        : null,
    },
    conflictMatches: conflictSearch && !conflictSearch.error ? conflictRows(conflictSearch.data, tz) : null,
    wire: { organizationId: org, leadId: lead.id, version: lead.version },
    matterHref: lead.converted_matter_id ? `/sheet/matters/${lead.converted_matter_id}` : null,
  };
}
