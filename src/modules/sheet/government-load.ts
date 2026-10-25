import "server-only";
import type { GovernmentHeaderData, GovernmentPageData, GovernmentRow } from "@/components/sheet/designer/government";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { isLicensedMembership, LICENCE_FACT_COLUMNS, type LicenceFacts } from "@/lib/tenant/roles";
import { correspondenceLabel, handoffBadge } from "@/modules/government/present";
import { NOT_CHECKED } from "@/modules/sheet/gov-status-present";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import { dayMonth, isoDate, localNow } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  buildDecisions,
  buildGovernmentPage,
  buildSubmissions,
  GOVERNMENT_PILLS,
  whenFull,
  type GovernmentContext,
  type GovernmentRecords,
} from "@/modules/sheet/government-present";
import { governmentLabel, type SheetQuery } from "@/modules/sheet/present";
import { loadSubmissionChecklist } from "@/modules/sheet/matter-submissions-load";
import { blockedWhy, type GateKey } from "@/modules/submissions/present";
import { loadLetterExtras } from "@/modules/sheet/letter-load";
import { loadApprovalFollowUp } from "@/modules/decisions/load";
import { withApprovalFollowUp } from "@/modules/decisions/present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Roles that read government records on a matter (app.gov_staff_roles). */
const GOV_STAFF = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);

const HANDOFF_COLUMNS =
  "id, package_label, package_sha256, channel, status, signoff_membership_id, signed_off_at, submitted_by_membership_id, external_reference, submitted_at, receipt_version_id, receipt_locator, acknowledged_on, verified_by_membership_id, verified_at, cancel_reason, cancelled_at, created_by, created_at, version, manifest_sha256, manifest_file_count, manifest_pinned_at";
const LETTER_COLUMNS =
  "id, kind, channel, received_on, document_date, action_requested, stated_deadline, evidence_version_id, evidence_locator, verified_by_membership_id, verified_at, shared_with_client_at, created_by, created_at, version, issuer, issuer_id";
const ESTIMATE_COLUMNS =
  "id, source_url, application_type, estimate_text, checked_on, page_retrieved_at, snapshot_sha256, status, entered_by_membership_id, reviewed_by_membership_id, reviewed_at, created_at, version, page_attested_by_membership_id, page_attested_on";
const DECISION_COLUMNS =
  "id, correspondence_id, outcome, milestone, decided_on, authority_reasons, state, consultant_interpretation, next_steps, confirmed_by_membership_id, confirmed_at, created_by, created_at, version";

/** Every government record on one matter, read as the signed-in member (row-level security decides). */
export async function loadGovernmentRecords(supabase: Client, org: string, matterId: string): Promise<GovernmentRecords> {
  const [handoffs, letters, decisions, checks, transitions, representation, requests, refs, estimates] = await Promise.all([
    supabase.from("submission_handoffs").select(HANDOFF_COLUMNS).eq("organization_id", org).eq("matter_id", matterId).order("created_at", { ascending: false }).limit(20),
    supabase.from("government_correspondence").select(LETTER_COLUMNS).eq("organization_id", org).eq("matter_id", matterId).order("received_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    supabase.from("decision_records").select(DECISION_COLUMNS).eq("organization_id", org).eq("matter_id", matterId).order("created_at", { ascending: false }).limit(20),
    supabase.from("government_status_checks").select("note, checked_by_membership_id, checked_at, correspondence_id").eq("organization_id", org).eq("matter_id", matterId).order("checked_at", { ascending: false }).limit(20),
    supabase.from("matter_stage_transitions").select("to_stage, actor_user_id, created_at").eq("organization_id", org).eq("matter_id", matterId).order("created_at", { ascending: false }).limit(10),
    supabase.from("representation_authorities").select("id").eq("organization_id", org).eq("matter_id", matterId).is("revoked_at", null).limit(1),
    supabase.from("document_requests").select("status, document_id").eq("organization_id", org).eq("matter_id", matterId).neq("status", "cancelled").limit(200),
    supabase.from("document_matter_refs").select("document_id").eq("organization_id", org).eq("matter_id", matterId).is("removed_at", null).limit(200),
    // GOV-05: IRCC processing-time estimates entered on this matter (staff only).
    supabase.from("government_processing_estimates").select(ESTIMATE_COLUMNS).eq("organization_id", org).eq("matter_id", matterId).in("status", ["pending_review", "approved"]).order("created_at", { ascending: false }).limit(10),
  ]);
  const letterRows = letters.data ?? [];
  const decisionRows = decisions.data ?? [];
  const decisionIds = decisionRows.map((row) => row.id);
  const letterIds = letterRows.map((row) => row.id);
  const documentIds = [...new Set((refs.data ?? []).map((row) => row.document_id))];

  const [followUps, steps, links, documents] = await Promise.all([
    decisionIds.length
      ? supabase.from("decision_follow_ups").select("decision_id, kind, document_version_id, task_id").eq("organization_id", org).in("decision_id", decisionIds)
      : null,
    decisionIds.length
      ? supabase.from("decision_steps").select("decision_id, step, note, done_by_membership_id, done_at").eq("organization_id", org).in("decision_id", decisionIds)
      : null,
    letterIds.length
      ? supabase.from("correspondence_work_links").select("correspondence_id, deadline_id").eq("organization_id", org).in("correspondence_id", letterIds).not("deadline_id", "is", null)
      : null,
    documentIds.length ? supabase.from("documents").select("id, purpose, current_version_id").eq("organization_id", org).in("id", documentIds) : null,
  ]);
  const taskIds = (followUps?.data ?? []).map((row) => row.task_id);
  const deadlineIds = (links?.data ?? []).map((row) => row.deadline_id).filter((id): id is string => Boolean(id));
  const versionIds = (documents?.data ?? []).map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const [tasks, deadlines, versions] = await Promise.all([
    taskIds.length ? supabase.from("tasks").select("id, title, status, priority, due_on, owner_membership_id, version").eq("organization_id", org).in("id", taskIds) : null,
    deadlineIds.length ? supabase.from("deadlines").select("id, due_on").eq("organization_id", org).in("id", deadlineIds) : null,
    versionIds.length
      ? supabase.from("document_versions").select("id, expires_on, upload_state").eq("organization_id", org).in("id", versionIds).not("expires_on", "is", null)
      : null,
  ]);
  const taskById = new Map((tasks?.data ?? []).map((row) => [row.id, row]));
  const deadlineDue = new Map((deadlines?.data ?? []).map((row) => [row.id, row.due_on]));
  const purposeByVersion = new Map((documents?.data ?? []).filter((row) => row.current_version_id).map((row) => [row.current_version_id as string, row.purpose]));
  const requestRows = requests.data ?? [];
  return {
    handoffs: handoffs.data ?? [],
    letters: letterRows,
    decisions: decisionRows,
    followUps: (followUps?.data ?? []).map((row) => ({
      decision_id: row.decision_id,
      kind: row.kind,
      document_version_id: row.document_version_id,
      task: taskById.get(row.task_id) ?? null,
    })),
    steps: steps?.data ?? [],
    checks: checks.data ?? [],
    estimates: estimates.data ?? [],
    transitions: transitions.data ?? [],
    deadlines: (links?.data ?? []).map((row) => ({ correspondence_id: row.correspondence_id, due_on: row.deadline_id ? (deadlineDue.get(row.deadline_id) ?? null) : null })),
    representation: (representation.data ?? []).length > 0,
    documents: { total: requestRows.length, open: requestRows.filter((row) => row.status !== "fulfilled" && row.status !== "waived").length },
    expiring: (versions?.data ?? [])
      .filter((row) => row.upload_state === "clean" && row.expires_on)
      .map((row) => ({ versionId: row.id, purpose: purposeByVersion.get(row.id) ?? "Document", expiresOn: row.expires_on as string })),
  };
}

/** Licensed members who may be recorded as the submitting representative. */
async function representatives(supabase: Client, org: string, members: Map<string, string>) {
  const [rows, credentials] = await Promise.all([
    supabase.from("memberships").select("id, role").eq("organization_id", org).eq("status", "active").in("role", ["licensed_consultant", "firm_owner"]),
    supabase.from("consultant_credentials").select(`membership_id, ${LICENCE_FACT_COLUMNS}`).eq("organization_id", org),
  ]);
  const facts = new Map((credentials.data ?? []).map((row) => [row.membership_id, row as unknown as LicenceFacts]));
  return (rows.data ?? []).filter((row) => isLicensedMembership(row.role, facts.get(row.id))).map((row) => ({ id: row.id, name: members.get(row.id) ?? "Licensed member" }));
}

async function userNames(supabase: Client, org: string, members: Map<string, string>) {
  const rows = await supabase.from("memberships").select("id, user_id").eq("organization_id", org);
  const map = new Map<string, string>();
  for (const row of rows.data ?? []) if (row.user_id && members.has(row.id)) map.set(row.user_id, members.get(row.id) as string);
  return (id: string | null) => (id ? map.get(id) : undefined) || "Someone at the firm";
}

export type MatterGovernmentInput = {
  staff: SheetStaff;
  matter: { id: string; stage: string; responsible_consultant_membership_id: string | null };
  members: Map<string, string>;
  licensed: boolean;
  today: string;
  now: Date;
};

/** The Submissions and Decisions tabs, their dialogs, and the letters the deadline dialog can cite. */
export async function loadMatterGovernment(supabase: Client, input: MatterGovernmentInput) {
  const org = input.staff.organizationId;
  const [records, people, userName] = await Promise.all([
    loadGovernmentRecords(supabase, org, input.matter.id),
    representatives(supabase, org, input.members),
    userNames(supabase, org, input.members),
  ]);
  // GOV-04: each letter's tasks, the firm's issuer list, and files from emails filed to the matter.
  const extras = await loadLetterExtras(supabase, org, input.matter.id, records.letters.map((row) => row.id), input.staff.timezone);
  Object.assign(records, { letterTasks: extras.letterTasks, issuers: extras.issuers, people: extras.people });
  const ctx = context(input, people, userName);
  // GOV-01 and GOV-03: the Submission checklist and the pinned manifest, for the matter's staff.
  const shown =
    records.handoffs.find((row) => row.status === "awaiting_signoff" || row.status === "authorized") ??
    records.handoffs.find((row) => row.status === "submission_unverified" || row.status === "submission_verified") ??
    null;
  const checklist = GOV_STAFF.has(input.staff.role)
    ? await loadSubmissionChecklist(supabase, {
        organizationId: org,
        matterId: input.matter.id,
        role: input.staff.role,
        licensed: input.licensed,
        timezone: input.staff.timezone,
        today: input.today,
        memberName: ctx.memberName,
        manifestHandoff: shown
          ? {
              id: shown.id,
              package_label: shown.package_label,
              manifest_sha256: shown.manifest_sha256 ?? null,
              manifest_file_count: shown.manifest_file_count ?? null,
              manifest_pinned_at: shown.manifest_pinned_at ?? null,
            }
          : null,
      })
    : null;
  const submissions = buildSubmissions(
    records,
    ctx,
    checklist ? { blocked: checklist.blocked, why: checklist.blocked ? blockedWhy(checklist.blocked as GateKey[]) : null, channelName: checklist.channelName } : undefined,
  );
  // DEC-02: the approval follow-up checklist, conditions summary and delivery record (matter staff).
  const decisions = buildDecisions(records, ctx);
  const approval = GOV_STAFF.has(input.staff.role)
    ? await loadApprovalFollowUp(supabase, records, {
        organizationId: org,
        matterId: input.matter.id,
        role: input.staff.role,
        licensed: input.licensed,
        timezone: input.staff.timezone,
        today: input.today,
        now: input.now,
        memberName: ctx.memberName,
        userName,
      })
    : null;
  return {
    issuers: extras.issuers,
    filed: extras.filed,
    submissions: { ...submissions.tab, checklist: checklist?.card ?? null },
    decisions: approval ? withApprovalFollowUp(decisions, approval.card) : decisions,
    dialogs: { ...submissions.dialogs, checklist: checklist?.dialogs ?? null, approval: approval?.dialogs ?? null },
    letters: records.letters.map((row) => ({ id: row.id, label: `${correspondenceLabel(row.kind)}, received ${dayMonth(row.received_on)}` })),
  };
}

function context(input: MatterGovernmentInput, people: { id: string; name: string }[], userName: (id: string | null) => string): GovernmentContext {
  const memberName = (id: string | null) => (id ? input.members.get(id) : undefined) || "Unassigned";
  return {
    organizationId: input.staff.organizationId,
    matterId: input.matter.id,
    stage: input.matter.stage,
    timezone: input.staff.timezone,
    today: input.today,
    now: input.now,
    memberName,
    userName,
    consultant: input.matter.responsible_consultant_membership_id ? memberName(input.matter.responsible_consultant_membership_id) : null,
    me: input.staff.displayName,
    role: input.staff.role,
    licensed: input.licensed,
    representatives: people,
    firmName: input.staff.organizationName,
  };
}

/**
 * The Government status page. `?view=<matter id>` is one matter's record (the Designer's
 * screen); without it, the firm's matters that have a submission or a letter on record.
 */
export async function loadSheetGovernment(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const matterId = query.view && isUuid(query.view) ? query.view : null;
  const [chrome, members, ownLicence] = await Promise.all([
    loadSheetChrome(staff, "/sheet/government"),
    memberNames(supabase, org),
    staff.role === "firm_owner"
      ? supabase.from("consultant_credentials").select(LICENCE_FACT_COLUMNS).eq("organization_id", org).eq("membership_id", staff.membershipId).maybeSingle()
      : null,
  ]);
  const licensed = isLicensedMembership(staff.role, ownLicence?.data);

  if (matterId) {
    const { data: matter } = await supabase
      .from("matters")
      .select("id, title, stage, responsible_consultant_membership_id")
      .eq("organization_id", org)
      .eq("id", matterId)
      .maybeSingle();
    if (!matter) return null;
    const [records, userName, client] = await Promise.all([
      loadGovernmentRecords(supabase, org, matter.id),
      userNames(supabase, org, members),
      clientName(supabase, org, matter.id),
    ]);
    const ctx = context({ staff, matter, members, licensed, today, now }, [], userName);
    const header: GovernmentHeaderData = { back: `/sheet/matters/${matter.id}`, client: { name: client ?? matter.title }, pills: GOVERNMENT_PILLS };
    return { chrome, header, page: buildGovernmentPage(records, ctx) };
  }

  // Firm-wide: one row per matter with a handoff or a letter, newest first.
  const [handoffs, letters] = await Promise.all([
    supabase.from("submission_handoffs").select("matter_id, status, submitted_by_membership_id, created_by, verified_at, verified_by_membership_id, created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(200),
    supabase.from("government_correspondence").select("matter_id, created_at, verified_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(400),
  ]);
  const matterIds = [...new Set([...(handoffs.data ?? []).map((row) => row.matter_id), ...(letters.data ?? []).map((row) => row.matter_id)])].slice(0, 100);
  const [matters, userName, checks] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, title, reference, government_status").eq("organization_id", org).in("id", matterIds) : null,
    userNames(supabase, org, members),
    // GOV-05: "Last checked" is when a staff member last checked the official channel, not when a record was added.
    matterIds.length ? supabase.from("government_status_checks").select("matter_id, checked_at").eq("organization_id", org).in("matter_id", matterIds).order("checked_at", { ascending: false }).limit(500) : null,
  ]);
  const lastCheck = new Map<string, string>();
  for (const row of checks?.data ?? []) if (!lastCheck.has(row.matter_id)) lastCheck.set(row.matter_id, row.checked_at);
  const matterById = new Map((matters?.data ?? []).map((row) => [row.id, row]));
  const rows: GovernmentRow[] = [];
  let unverified: string | null = null;
  for (const id of matterIds) {
    const matter = matterById.get(id);
    if (!matter) continue;
    const handoff = (handoffs.data ?? []).find((row) => row.matter_id === id);
    const matterLetters = (letters.data ?? []).filter((row) => row.matter_id === id);
    if (handoff?.status === "submission_unverified" && !unverified) unverified = id;
    const verifiedAt = [handoff?.verified_at, ...matterLetters.map((row) => row.verified_at)].filter((value): value is string => Boolean(value)).sort().pop();
    rows.push({
      item: matter.reference ? `${matter.title}, ${matter.reference}` : matter.title,
      status: handoff ? handoffBadge(handoff.status) : { tone: "gr", label: governmentLabel(matter.government_status) },
      recordedBy: handoff ? (handoff.submitted_by_membership_id ? (members.get(handoff.submitted_by_membership_id) ?? "Unassigned") : userName(handoff.created_by)) : "—",
      evidence: matterLetters.length ? `${matterLetters.length} ${matterLetters.length === 1 ? "letter" : "letters"} on record` : "No letters yet",
      verified: verifiedAt ? whenFull(verifiedAt, staff.timezone, today) : "—",
      lastChecked: lastCheck.has(id) ? whenFull(lastCheck.get(id) as string, staff.timezone, today) : NOT_CHECKED,
      href: `/sheet/government?view=${id}`,
    });
  }
  // A failed read is not "nothing recorded": say so instead of an empty record.
  const failed = Boolean(handoffs.error || letters.error || matters?.error);
  if (failed) {
    rows.length = 0;
    rows.push({ item: "This list couldn’t load. Reload the page to try again.", status: { tone: "bad", label: "Not loaded" }, recordedBy: "—", evidence: "—", verified: "—", lastChecked: "—" });
  } else if (!rows.length) {
    rows.push({ item: "No submissions or letters recorded yet", status: { tone: "gr", label: "Not recorded" }, recordedBy: "—", evidence: "—", verified: "—", lastChecked: "—" });
  }
  const page: GovernmentPageData = {
    intro: "What the firm knows about each government application, who recorded it, from what evidence, and when it was last checked. This is a record kept by the firm, not a live feed.",
    alert: unverified
      ? {
          copy: "A submission was recorded without a confirmation on file. Open the matter’s Submissions tab to add the receipt.",
          upload: { "data-nav": `/sheet/matters/${unverified}?tab=submissions` },
          manual: { "data-nav": `/sheet/matters/${unverified}?tab=submissions&dlg=receipt` },
        }
      : null,
    rows,
    record: null,
    history: null,
  };
  const header: GovernmentHeaderData = { back: "/sheet/matters", client: null, pills: GOVERNMENT_PILLS };
  return { chrome, header, page };
}

async function clientName(supabase: Client, org: string, matterId: string) {
  const parties = await supabase.from("matter_participants").select("person_id, role").eq("organization_id", org).eq("matter_id", matterId).not("person_id", "is", null).limit(20);
  const applicant = (parties.data ?? []).find((row) => row.role === "applicant") ?? (parties.data ?? [])[0];
  if (!applicant?.person_id) return null;
  const person = await supabase.from("persons").select("display_name").eq("organization_id", org).eq("id", applicant.person_id).maybeSingle();
  return person.data?.display_name ?? null;
}
