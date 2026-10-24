import "server-only";

import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const PORTAL_ROLES = ["client", "adult_dependant", "sponsor", "employer_contact", "guardian"] as const;

export function isPortalRole(role: string): boolean {
  return (PORTAL_ROLES as readonly string[]).includes(role);
}

export type PortalMatter = {
  id: string;
  title: string;
  stage: string;
  onHold: boolean;
  /** The firm's matter reference ("NL-2026-0142"), when it has one. */
  reference: string | null;
};

export type PortalPerson = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isMinor: boolean;
  role: string | null;
};

export type PortalGrant = {
  id: string;
  kind: string;
  purpose: string;
  subjectName: string;
  granteeName: string;
};

export type PortalShare = {
  id: string;
  sectionKey: string;
  subjectName: string;
  granteeName: string;
  matterTitle: string;
};

export type PortalPrefs = {
  emailNotices: boolean;
  smsNotices: boolean;
  deadlineReminders: boolean;
  locale: "en-CA" | "fr-CA";
  /** WhatsApp notices chosen, with consent on record (person_whatsapp_contacts). */
  whatsapp?: boolean;
};

export type PortalViewer = {
  organizationId: string;
  organizationName: string;
  /** The firm's public slug (its logo and booking page). */
  organizationSlug: string;
  timezone: string;
  role: string;
  person: PortalPerson | null;
  matters: PortalMatter[];
  people: PortalPerson[];
  grants: PortalGrant[];
  shares: PortalShare[];
  prefs: PortalPrefs | null;
  sections: { id: string; sectionKey: string; summary: string; personName: string; matterTitle: string }[];
};

export type PortalAccess =
  | { kind: "signed-out" }
  | { kind: "sample" }
  | { kind: "empty" }
  | { kind: "live"; viewer: PortalViewer };

/** Designer demo pages render only for firm staff previewing a sample-mode firm's portal. */
export async function loadPortalAccess(): Promise<PortalAccess> {
  if (!hasPublicSupabaseEnv()) return { kind: "signed-out" };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { kind: "signed-out" };

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active");
  const membership =
    memberships?.find((row) => isPortalRole(row.role)) ?? memberships?.[0];
  if (!membership) return { kind: "empty" };

  const scoped = await createClient({ organizationId: membership.organization_id });
  const { data: org } = await scoped
    .from("organizations")
    .select("id, display_name, slug, sample_mode, timezone")
    .eq("id", membership.organization_id)
    .maybeSingle();
  if (!org) return { kind: "empty" };
  // Firm staff previewing the portal of a sample-mode firm see the Designer demo. A client,
  // sponsor or family member always sees their own records (sample matters are real rows).
  if (org.sample_mode && !isPortalRole(membership.role)) return { kind: "sample" };

  const [{ data: matters }, { data: persons }, { data: participants }, { data: grants }, { data: shares }, { data: sections }] =
    await Promise.all([
      scoped.from("matters").select("id, title, reference, stage, on_hold").order("updated_at", { ascending: false }).limit(40),
      scoped.from("persons").select("id, display_name, email, contact_phone, is_minor, user_id").limit(80),
      scoped.from("matter_participants").select("person_id, role, matter_id").limit(200),
      scoped.from("access_grants").select("id, kind, purpose, subject_person_id, grantee_person_id, revoked_at").is("revoked_at", null).limit(40),
      scoped.from("section_shares").select("id, section_key, subject_person_id, grantee_person_id, matter_id, revoked_at").is("revoked_at", null).limit(40),
      scoped.from("person_section_records").select("id, section_key, summary, person_id, matter_id").order("updated_at", { ascending: false }).limit(40),
    ]);

  const names = new Map((persons ?? []).map((person) => [person.id, person.display_name]));
  const matterTitles = new Map((matters ?? []).map((matter) => [matter.id, matter.title]));
  const roleByPerson = new Map<string, string>();
  for (const row of participants ?? []) {
    if (row.person_id && !roleByPerson.has(row.person_id)) roleByPerson.set(row.person_id, row.role);
  }

  const people: PortalPerson[] = (persons ?? []).map((person) => ({
    id: person.id,
    displayName: person.display_name,
    email: person.email,
    phone: person.contact_phone,
    isMinor: person.is_minor,
    role: roleByPerson.get(person.id) ?? null,
  }));
  const self = (persons ?? []).find((person) => person.user_id === userId);
  const person = self ? people.find((row) => row.id === self.id) ?? null : null;

  let prefs: PortalPrefs | null = null;
  if (person) {
    const [{ data }, { data: wa }] = await Promise.all([
      scoped.from("person_contact_preferences").select("email_notices, sms_notices, deadline_reminders, locale").eq("person_id", person.id).maybeSingle(),
      scoped.from("person_whatsapp_contacts").select("channel, consent_at, withdrawn_at").eq("person_id", person.id).maybeSingle(),
    ]);
    const whatsapp = Boolean(wa && wa.channel !== "email" && wa.consent_at && !wa.withdrawn_at);
    if (data) {
      prefs = {
        emailNotices: data.email_notices,
        smsNotices: data.sms_notices,
        deadlineReminders: data.deadline_reminders,
        locale: data.locale === "fr-CA" ? "fr-CA" : "en-CA",
        whatsapp,
      };
    }
  }

  return { kind: "live", viewer: {
    organizationId: org.id,
    organizationName: org.display_name,
    organizationSlug: org.slug,
    timezone: org.timezone,
    role: membership.role,
    person,
    matters: (matters ?? []).map((matter) => ({
      id: matter.id,
      title: matter.title,
      stage: matter.stage.replaceAll("_", " "),
      onHold: matter.on_hold,
      reference: matter.reference,
    })),
    people,
    grants: (grants ?? []).map((grant) => ({
      id: grant.id,
      kind: grant.kind,
      purpose: grant.purpose,
      subjectName: names.get(grant.subject_person_id) ?? "Person",
      granteeName: names.get(grant.grantee_person_id) ?? "Person",
    })),
    shares: (shares ?? []).map((share) => ({
      id: share.id,
      sectionKey: share.section_key.replaceAll("_", " "),
      subjectName: names.get(share.subject_person_id) ?? "Person",
      granteeName: names.get(share.grantee_person_id) ?? "Person",
      matterTitle: matterTitles.get(share.matter_id) ?? "Matter",
    })),
    prefs,
    sections: (sections ?? []).map((section) => ({
      id: section.id,
      sectionKey: section.section_key.replaceAll("_", " "),
      summary: section.summary,
      personName: names.get(section.person_id) ?? "Person",
      matterTitle: matterTitles.get(section.matter_id) ?? "Matter",
    })),
  } };
}
