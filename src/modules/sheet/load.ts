import "server-only";

import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/modules/sheet/present";
import { looseFrom, numberValue, text } from "@/modules/sheet/query";

export type SheetStaff = {
  organizationId: string;
  organizationName: string;
  legalName: string;
  timezone: string;
  role: string;
  membershipId: string;
  displayName: string;
  sampleMode: false;
};

export type SheetMatterRow = {
  id: string;
  title: string;
  reference: string | null;
  stage: string;
  governmentStatus: string;
  onHold: boolean;
  onHoldReason: string | null;
  outcome: string | null;
  retentionOn: string | null;
  version: number;
  updatedAt: string;
};

export type SheetTaskRow = {
  id: string;
  matterId: string | null;
  title: string;
  audience: string;
  status: string;
  priority: string;
  dueOn: string | null;
  ownerMembershipId: string | null;
  blockerNote: string | null;
  version: number;
};

export type SheetDeadlineRow = {
  id: string;
  matterId: string;
  label: string;
  kind: string;
  dueOn: string | null;
  verification: string;
};

export type SheetDocumentRow = {
  id: string;
  purpose: string;
  personId: string;
  matterId: string | null;
  reviewState: string | null;
  uploadState: string | null;
};

export type SheetAgreementRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  matterId: string;
};

export type SheetInviteRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  revokedAt: string | null;
  consumedAt: string | null;
  declinedAt: string | null;
  kind: "staff" | "portal";
};

export type SheetPersonRow = { id: string; name: string; email: string | null };
export type SheetGrantRow = { id: string; kind: string; purpose: string; subjectPersonId: string };
export type SheetCredentialRow = { id: string; collegeId: string; licenceType: string; status: string; regulator: string };
export type SheetOfficeRow = { id: string; label: string; locality: string; region: string | null; primary: boolean };
export type SheetTemplateRow = { id: string; title: string; status: string; kind: "intake" | "agreement" };
export type SheetAuditRow = { id: string; action: string; occurredAt: string; result: string; objectTable: string | null };
export type SheetIntakeRow = { id: string; status: string; matterId: string; personId: string };
export type SheetMemberRow = { id: string; role: string; status: string; userId: string };

export type SheetBundle = {
  staff: SheetStaff;
  error: string | null;
  matters: SheetMatterRow[];
  tasks: SheetTaskRow[];
  deadlines: SheetDeadlineRow[];
  documents: SheetDocumentRow[];
  agreements: SheetAgreementRow[];
  invites: SheetInviteRow[];
  people: SheetPersonRow[];
  grants: SheetGrantRow[];
  credentials: SheetCredentialRow[];
  offices: SheetOfficeRow[];
  templates: SheetTemplateRow[];
  audit: SheetAuditRow[];
  intake: SheetIntakeRow[];
  members: SheetMemberRow[];
};

const EMPTY = {
  matters: [],
  tasks: [],
  deadlines: [],
  documents: [],
  agreements: [],
  invites: [],
  people: [],
  grants: [],
  credentials: [],
  offices: [],
  templates: [],
  audit: [],
  intake: [],
  members: [],
};

/** Signed-out visitors and sample-mode firms keep the designer's Northline pages. */
export async function loadSheetStaff(): Promise<SheetStaff | null> {
  if (!hasPublicSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, organization_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active");
  const membership = memberships?.find((row) => (STAFF_ROLES as readonly string[]).includes(row.role));
  if (!membership) return null;

  const scoped = await createClient({ organizationId: membership.organization_id });
  const [{ data: org }, { data: profile }] = await Promise.all([
    scoped
      .from("organizations")
      .select("id, display_name, legal_name, sample_mode, timezone")
      .eq("id", membership.organization_id)
      .maybeSingle(),
    scoped.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);
  if (!org || org.sample_mode) return null;
  return {
    organizationId: org.id,
    organizationName: org.display_name,
    legalName: org.legal_name,
    timezone: org.timezone,
    role: membership.role,
    membershipId: membership.id,
    displayName: profile?.display_name || org.display_name,
    sampleMode: false,
  };
}

export async function loadSheetBundle(staff: SheetStaff): Promise<SheetBundle> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const orgId = staff.organizationId;
  const [
    matters,
    tasks,
    deadlines,
    documents,
    versions,
    refs,
    agreements,
    staffInvites,
    portalInvites,
    people,
    grants,
    credentials,
    offices,
    intakeTemplates,
    agreementTemplates,
    intakeResponses,
    audit,
    members,
  ] = await Promise.all([
    supabase.from("matters").select("id, title, reference, stage, government_status, on_hold, on_hold_reason, outcome, retention_on, version, updated_at").eq("organization_id", orgId).order("updated_at", { ascending: false }).limit(80),
    looseFrom(supabase, "tasks").select("id, matter_id, title, audience, status, priority, due_on, owner_membership_id, blocker_note, version").eq("organization_id", orgId).order("due_on", { ascending: true }).limit(80),
    looseFrom(supabase, "deadlines").select("id, matter_id, label, kind, due_on, verification").eq("organization_id", orgId).order("due_on", { ascending: true }).limit(80),
    supabase.from("documents").select("id, purpose, person_id, current_version_id").eq("organization_id", orgId).order("updated_at", { ascending: false }).limit(80),
    supabase.from("document_versions").select("id, document_id, review_state, upload_state").eq("organization_id", orgId).limit(120),
    supabase.from("document_matter_refs").select("document_id, matter_id").eq("organization_id", orgId).is("removed_at", null).limit(120),
    supabase.from("agreements").select("id, title, kind, status, matter_id").eq("organization_id", orgId).order("updated_at", { ascending: false }).limit(80),
    supabase.from("invitations").select("id, email, role, expires_at, revoked_at, consumed_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(40),
    supabase.from("portal_invitations").select("id, email, role, expires_at, revoked_at, consumed_at, declined_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(40),
    supabase.from("persons").select("id, display_name, email").eq("organization_id", orgId).order("display_name").limit(80),
    supabase.from("access_grants").select("id, kind, purpose, subject_person_id, revoked_at").eq("organization_id", orgId).is("revoked_at", null).limit(40),
    supabase.from("consultant_credentials").select("id, college_id, licence_type, status, regulator").eq("organization_id", orgId).limit(40),
    supabase.from("organization_offices").select("id, label, locality, region, is_primary").eq("organization_id", orgId).limit(20),
    looseFrom(supabase, "intake_templates").select("id, title, status").eq("organization_id", orgId).limit(40),
    supabase.from("agreement_templates").select("id, name, status").eq("organization_id", orgId).limit(40),
    looseFrom(supabase, "intake_responses").select("id, status, matter_id, person_id").eq("organization_id", orgId).limit(40),
    supabase.from("audit_log").select("id, action, occurred_at, result, object_table").eq("organization_id", orgId).order("occurred_at", { ascending: false }).limit(40),
    supabase.from("memberships").select("id, role, status, user_id").eq("organization_id", orgId).limit(40),
  ]);

  const failed = [matters.error, documents.error, agreements.error, people.error].find(Boolean);
  const versionById = new Map((versions.data ?? []).map((row) => [row.id, row]));
  const matterByDocument = new Map((refs.data ?? []).map((row) => [row.document_id, row.matter_id]));

  return {
    staff,
    error: failed?.message ?? tasks.error?.message ?? null,
    matters: (matters.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      reference: row.reference,
      stage: row.stage,
      governmentStatus: row.government_status,
      onHold: row.on_hold,
      onHoldReason: row.on_hold_reason,
      outcome: row.outcome,
      retentionOn: row.retention_on,
      version: row.version,
      updatedAt: row.updated_at,
    })),
    tasks: (tasks.data ?? []).map((row) => ({
      id: text(row, "id") ?? "",
      matterId: text(row, "matter_id"),
      title: text(row, "title") ?? "",
      audience: text(row, "audience") ?? "internal",
      status: text(row, "status") ?? "open",
      priority: text(row, "priority") ?? "normal",
      dueOn: text(row, "due_on"),
      ownerMembershipId: text(row, "owner_membership_id"),
      blockerNote: text(row, "blocker_note"),
      version: numberValue(row, "version"),
    })),
    deadlines: (deadlines.data ?? []).map((row) => ({
      id: text(row, "id") ?? "",
      matterId: text(row, "matter_id") ?? "",
      label: text(row, "label") ?? "",
      kind: text(row, "kind") ?? "internal",
      dueOn: text(row, "due_on"),
      verification: text(row, "verification") ?? "tentative",
    })),
    documents: (documents.data ?? []).map((row) => {
      const version = row.current_version_id ? versionById.get(row.current_version_id) : undefined;
      return {
        id: row.id,
        purpose: row.purpose,
        personId: row.person_id,
        matterId: matterByDocument.get(row.id) ?? null,
        reviewState: version?.review_state ?? null,
        uploadState: version?.upload_state ?? null,
      };
    }),
    agreements: (agreements.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      matterId: row.matter_id,
    })),
    invites: [
      ...(staffInvites.data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        consumedAt: row.consumed_at,
        declinedAt: null,
        kind: "staff" as const,
      })),
      ...(portalInvites.data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        consumedAt: row.consumed_at,
        declinedAt: row.declined_at,
        kind: "portal" as const,
      })),
    ],
    people: (people.data ?? []).map((row) => ({ id: row.id, name: row.display_name, email: row.email })),
    grants: (grants.data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      purpose: row.purpose,
      subjectPersonId: row.subject_person_id,
    })),
    credentials: (credentials.data ?? []).map((row) => ({
      id: row.id,
      collegeId: row.college_id,
      licenceType: row.licence_type,
      status: row.status,
      regulator: row.regulator,
    })),
    offices: (offices.data ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      locality: row.locality,
      region: row.region,
      primary: row.is_primary,
    })),
    templates: [
      ...(intakeTemplates.data ?? []).map((row) => ({
        id: text(row, "id") ?? "",
        title: text(row, "title") ?? "",
        status: text(row, "status") ?? "draft",
        kind: "intake" as const,
      })),
      ...(agreementTemplates.data ?? []).map((row) => ({
        id: row.id,
        title: row.name,
        status: row.status,
        kind: "agreement" as const,
      })),
    ],
    audit: (audit.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      occurredAt: row.occurred_at,
      result: row.result,
      objectTable: row.object_table,
    })),
    intake: (intakeResponses.data ?? []).map((row) => ({
      id: text(row, "id") ?? "",
      status: text(row, "status") ?? "draft",
      matterId: text(row, "matter_id") ?? "",
      personId: text(row, "person_id") ?? "",
    })),
    members: (members.data ?? []).map((row) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      userId: row.user_id,
    })),
  };
}

export function emptyBundle(staff: SheetStaff, error: string | null = null): SheetBundle {
  return { staff, error, ...EMPTY };
}
