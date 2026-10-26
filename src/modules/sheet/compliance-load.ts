import "server-only";
import type { ComplaintsDialogsData, ComplaintsData, ComplaintsHeaderData } from "@/components/sheet/designer/complaints";
import type { PrivacyData, PrivacyDialogsData, PrivacyHeaderData } from "@/components/sheet/designer/privacy";
import { createClient } from "@/lib/supabase/server";
import { complaintsDialogs, presentComplaints, type ComplaintRowData } from "@/modules/compliance/complaints-present";
import { dmy } from "@/modules/compliance/format";
import { presentPrivacy, privacyDialogs, type ConsentRow, type KeptRecord, type PrivacyContext, type PrivacyRequestRow, type RedactionRow } from "@/modules/compliance/privacy-present";
import { loadPrivacyExtras } from "@/modules/sheet/privacy-response-load";
import { loadSheetChrome, type SheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, roleLabel, type SheetQuery } from "@/modules/sheet/present";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PRIVACY_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
const STAFF_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant", "finance_user"]);

type Member = { id: string; user_id: string; role: string; status: string; name: string };

/** The firm's memberships with display names, and the signed-in person's own. */
async function people(supabase: Supabase, org: string) {
  const [claims, members] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("memberships").select("id, user_id, role, status").eq("organization_id", org),
  ]);
  const me = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : "";
  const rows = members.data ?? [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const profiles = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : null;
  const profileName = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name as string | null]));
  const list: Member[] = rows.map((row) => ({ ...row, name: profileName.get(row.user_id) || "Staff member" }));
  const mine = list.filter((row) => row.user_id === me && row.status === "active");
  const byMembership = new Map(list.map((row) => [row.id, row.name]));
  const byUser = new Map(list.map((row) => [row.user_id, row.name]));
  return {
    list,
    mine,
    userName: (id: string | null) => (id ? (byUser.get(id) ?? "Staff member") : "—"),
    memberName: (id: string) => byMembership.get(id) ?? "Staff member",
  };
}

/** People and matters this staff member can read, for the dialogs' link fields. */
async function links(supabase: Supabase, org: string) {
  const [persons, matters] = await Promise.all([
    supabase.from("persons").select("id, display_name").eq("organization_id", org).order("display_name").limit(300),
    supabase.from("matters").select("id, reference, title").eq("organization_id", org).order("updated_at", { ascending: false }).limit(300),
  ]);
  return {
    people: (persons.data ?? []).map((row) => [row.id, row.display_name || "Unnamed person"] as const),
    matters: (matters.data ?? []).map((row) => [row.id, row.reference ? `${row.reference} · ${row.title}` : row.title] as const),
    matterRef: new Map((matters.data ?? []).map((row) => [row.id, row.reference || row.title])),
  };
}

function memberOption(member: Member): readonly [string, string] {
  return [member.id, `${member.name} (${roleLabel(member.role)})`];
}

// The last ten (extended_due_on onwards) are SEC-06's extension and its notice.
const PRIVACY_COLUMNS =
  "id, reference, kind, requester_name, person_id, details, channel, received_on, target_days, due_on, assignee_membership_id, identity_verified_at, identity_method, scope_at, scope_note, redaction_at, redaction_note, reviewed_at, reviewed_by, review_note, closed_at, outcome, outcome_note, refusal_reason, delivery_method, evidence_note, extended_due_on, extension_basis, extension_time_limit_id, extension_reason, extension_recourse, extended_at, extension_notice_channel, extension_notice_method, extension_notice_late, extension_notice_seen_at";

/**
 * Compliance > Privacy requests for a firm, read as the signed-in staff member so the database
 * decides what they see (the owner, the assignee, and staff who can read the person).
 */
export async function loadSheetPrivacy(
  staff: SheetStaff,
  query: SheetQuery,
): Promise<{ chrome: SheetChrome; header: PrivacyHeaderData; page: PrivacyData; dialogs: PrivacyDialogsData }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, who, firm, settings] = await Promise.all([
    loadSheetChrome(staff, "/sheet/privacy"),
    people(supabase, org),
    supabase.from("organizations").select("privacy_contact_name").eq("id", org).maybeSingle(),
    supabase.from("compliance_settings").select("privacy_response_days").eq("organization_id", org).maybeSingle(),
  ]);
  const isOwner = who.mine.some((row) => row.role === "firm_owner");
  const canRecord = who.mine.some((row) => PRIVACY_ROLES.has(row.role));
  const ctx: PrivacyContext = {
    organizationId: org,
    timezone: staff.timezone,
    today: isoDateInTimeZone(new Date(), staff.timezone),
    userName: who.userName,
    memberName: who.memberName,
    myMemberships: who.mine.map((row) => row.id),
    isOwner,
    canRecord,
    privacyContact: firm.data?.privacy_contact_name ?? null,
    selectedId: query.view,
  };
  const requests = canRecord
    ? await supabase.from("privacy_requests").select(PRIVACY_COLUMNS).eq("organization_id", org).order("number", { ascending: false }).limit(200)
    : null;
  const rows = canRecord ? ((requests?.data ?? []) as PrivacyRequestRow[]) : null;
  const selected = rows ? (rows.find((row) => row.id === query.view) ?? rows.find((row) => !row.closed_at) ?? rows[0] ?? null) : null;

  const [lines, consents, kept, linkData, extras] = await Promise.all([
    selected?.kind === "access"
      ? supabase.from("privacy_request_redactions").select("id, request_id, record_label, third_party, removed, state, done_by").eq("request_id", selected.id).order("created_at")
      : null,
    selected?.kind === "consent_withdrawal" && selected.person_id
      ? supabase.from("consent_records").select("id, purpose, created_at, granted, withdrawn_at").eq("organization_id", org).eq("person_id", selected.person_id).order("created_at", { ascending: false })
      : null,
    selected?.kind === "deletion" ? supabase.rpc("privacy_request_kept_records", { p_request_id: selected.id }) : null,
    canRecord ? links(supabase, org) : null,
    canRecord ? loadPrivacyExtras(supabase, org, selected, who.mine.some((row) => row.role === "firm_owner" || row.role === "licensed_consultant")) : undefined,
  ]);
  const consentRows = consents ? ((consents.data ?? []) as ConsentRow[]) : null;
  const keptRows = kept && Array.isArray(kept.data) ? (kept.data as KeptRecord[]) : null;
  const presented = presentPrivacy({ ctx: { ...ctx, selectedId: selected?.id }, rows, lines: (lines?.data ?? []) as RedactionRow[], consents: consentRows, kept: keptRows, extras: extras?.extras });
  const me = who.mine.find((row) => PRIVACY_ROLES.has(row.role));
  const dialogs = privacyDialogs({
    ctx,
    selectedRow: presented.selectedRow,
    consents: consentRows,
    settingsDays: settings.data?.privacy_response_days ?? null,
    extras: extras?.extras,
    captured: extras?.captured,
    record:
      linkData && me
        ? {
            today: dmy(ctx.today),
            people: linkData.people,
            matters: linkData.matters,
            handlers: who.list.filter((row) => row.status === "active" && PRIVACY_ROLES.has(row.role)).map(memberOption),
            me: me.id,
          }
        : null,
  });
  return { chrome, header: presented.header, page: presented.page, dialogs };
}

const COMPLAINT_COLUMNS =
  "id, reference, complainant_name, matter_id, category, channel, issue, received_on, ack_due_on, response_due_on, assignee_membership_id, acknowledged_on, ack_note, reviewed_at, reviewed_by, evidence_note, response_sent_on, response_note, resolved_on, resolution";

/**
 * Compliance > Complaints for a firm. Only the firm owner and the staff the owner designated
 * see the register; everyone else sees who to ask.
 */
export async function loadSheetComplaints(
  staff: SheetStaff,
  query: SheetQuery,
): Promise<{ chrome: SheetChrome; header: ComplaintsHeaderData; page: ComplaintsData; dialogs: ComplaintsDialogsData }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, who, settings, handlers] = await Promise.all([
    loadSheetChrome(staff, "/sheet/complaints"),
    people(supabase, org),
    supabase.from("compliance_settings").select("complaint_ack_days, complaint_response_days, complaint_escalation_text").eq("organization_id", org).maybeSingle(),
    supabase.from("complaint_handlers").select("membership_id").eq("organization_id", org).is("removed_at", null),
  ]);
  const isOwner = who.mine.some((row) => row.role === "firm_owner");
  const handlerIds = new Set((handlers.data ?? []).map((row) => row.membership_id));
  const isHandler = isOwner || who.mine.some((row) => handlerIds.has(row.id) && STAFF_ROLES.has(row.role));
  const [complaints, linkData] = await Promise.all([
    isHandler
      ? supabase.from("complaints").select(COMPLAINT_COLUMNS).eq("organization_id", org).order("number", { ascending: false }).limit(200)
      : null,
    isHandler ? links(supabase, org) : null,
  ]);
  const active = who.list.filter((row) => row.status === "active");
  const owners = active.filter((row) => row.role === "firm_owner");
  const designated = active.filter((row) => handlerIds.has(row.id) && STAFF_ROLES.has(row.role));
  const visibleTo = [...new Set([...owners, ...designated].map((row) => row.name))];
  const ctx = {
    organizationId: org,
    firmName: staff.organizationName,
    today: isoDateInTimeZone(new Date(), staff.timezone),
    isOwner,
    isHandler,
    userName: who.userName,
    memberName: who.memberName,
    matterRef: (id: string | null) => (id ? (linkData?.matterRef.get(id) ?? "Matter") : "—"),
    visibleTo,
    escalation: settings.data?.complaint_escalation_text ?? null,
    selectedId: query.view,
  };
  const presented = presentComplaints({ ctx, rows: complaints ? ((complaints.data ?? []) as ComplaintRowData[]) : null });
  const assignable = [...owners, ...designated];
  const me = who.mine.find((row) => assignable.some((member) => member.id === row.id));
  const dialogs = complaintsDialogs({
    ctx,
    selectedRow: presented.selectedRow,
    people: linkData?.people ?? [],
    matters: linkData?.matters ?? [],
    assignable: [...new Map(assignable.map((row) => [row.id, memberOption(row)])).values()],
    me: me?.id ?? null,
    staff: active.filter((row) => STAFF_ROLES.has(row.role) && row.role !== "firm_owner").map(memberOption),
    handlers: [...handlerIds],
    settings: {
      ackDays: settings.data?.complaint_ack_days ?? null,
      responseDays: settings.data?.complaint_response_days ?? null,
      escalation: settings.data?.complaint_escalation_text ?? null,
    },
  });
  return { chrome, header: presented.header, page: presented.page, dialogs };
}
