"use server";

import { headers } from "next/headers";
import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { clearMatterOnHold, overrideMatterStage, recordGovernmentStatus, recordMatterOutcome, setMatterOnHold } from "@/modules/matters/actions";
import { createPortalInvitation } from "@/modules/portal-invitations/actions";
import { closeMatter } from "@/modules/matters/closure";
import { acceptLink, guardianSubjects, readPortalInvite } from "@/modules/sheet/portal-invite";
import { todayIso } from "@/modules/sheet/birth-date";
import { editNotes, minorOn, readPersonEdit } from "@/modules/sheet/edit-person";
import { readDeadline } from "@/modules/sheet/new-deadline";
import { missingPolicies, POLICIES_MISSING } from "@/modules/portal-policies/defaults";
import { loadCurrentPolicies } from "@/modules/portal-policies/load";
import { createTask, recordDeadline, scheduleDeadlineReminders, setTaskStatus } from "@/modules/tasks/actions";

/**
 * The Designer matter page's dialogs. They send no authenticator code: the database
 * checks app.mfa_step_up_satisfied() on every one of these changes, and a refusal comes
 * back as the step-up message so the page can send the person to /mfa?step=6.
 */
type MatterRef = { organizationId: string; matterId: string; version: number };

export async function changeMatterStage(input: MatterRef & { toStage: string; reason: string }) {
  // Closing records the closure, checks open money and sets the retention date (T040).
  if (input.toStage === "closed") return closeMatter({ organizationId: input.organizationId, matterId: input.matterId, version: input.version, reason: input.reason });
  return overrideMatterStage({ organizationId: input.organizationId, matterId: input.matterId, toStage: input.toStage, expectedVersion: input.version, reason: input.reason, code: null });
}

export async function holdMatter(input: MatterRef & { reason: string; ownerMembershipId: string; reviewOn: string }) {
  return setMatterOnHold({
    organizationId: input.organizationId,
    matterId: input.matterId,
    expectedVersion: input.version,
    reason: input.reason,
    ownerMembershipId: input.ownerMembershipId,
    reviewOn: input.reviewOn,
    code: null,
  });
}

export async function resumeMatter(input: MatterRef) {
  return clearMatterOnHold({ organizationId: input.organizationId, matterId: input.matterId, expectedVersion: input.version, reason: "Resumed from the matter page", code: null });
}

export async function recordMatterLetter(input: MatterRef & { status: string; note: string }) {
  return recordGovernmentStatus({ organizationId: input.organizationId, matterId: input.matterId, status: input.status, expectedVersion: input.version, note: input.note, code: null });
}

export async function confirmMatterOutcome(input: MatterRef & { outcome: string; note: string }) {
  return recordMatterOutcome({ organizationId: input.organizationId, matterId: input.matterId, outcome: input.outcome, expectedVersion: input.version, note: input.note, code: null });
}

/**
 * Records a deadline on the matter (public.record_deadline), then proposes its reminders
 * (public.schedule_deadline_reminders). It starts tentative; confirming it is a separate,
 * licensed step. The database re-checks the official source and the staff role.
 */
export async function recordMatterDeadline(input: MatterRef & { fields: Parameters<typeof readDeadline>[0] }) {
  const read = readDeadline(input.fields);
  if ("error" in read) return { error: read.error };
  const recorded = await recordDeadline({ organizationId: input.organizationId, matterId: input.matterId, ...read.input });
  if ("error" in recorded) return { error: recorded.error };
  const reminders = await scheduleDeadlineReminders({ organizationId: input.organizationId, deadlineId: recorded.id, asOf: new Date().toISOString() });
  return { id: recorded.id, remindersScheduled: !("error" in reminders) };
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function holdMatterFromSheet(form: FormData) {
  return setMatterOnHold({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    expectedVersion: Number(field(form, "version")),
    reason: field(form, "reason"),
    ownerMembershipId: field(form, "ownerMembershipId"),
    reviewOn: field(form, "reviewOn"),
    code: field(form, "code"),
  });
}

export async function stageMatterFromSheet(form: FormData) {
  return overrideMatterStage({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    toStage: field(form, "stage"),
    expectedVersion: Number(field(form, "version")),
    reason: field(form, "reason"),
    code: field(form, "code"),
  });
}

export async function governmentFromSheet(form: FormData) {
  return recordGovernmentStatus({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    status: field(form, "status"),
    expectedVersion: Number(field(form, "version")),
    note: field(form, "note"),
    code: field(form, "code"),
  });
}

export async function outcomeFromSheet(form: FormData) {
  return recordMatterOutcome({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    outcome: field(form, "outcome"),
    expectedVersion: Number(field(form, "version")),
    note: field(form, "note"),
    code: field(form, "code"),
  });
}

export async function taskFromSheet(form: FormData) {
  return createTask({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    audience: field(form, "audience") || "internal",
    title: field(form, "title"),
    ownerMembershipId: field(form, "ownerMembershipId") || null,
    dueOn: field(form, "dueOn") || null,
    priority: "normal",
  });
}

export async function completeTaskFromSheet(form: FormData) {
  return setTaskStatus({
    organizationId: field(form, "organizationId"),
    taskId: field(form, "taskId"),
    expectedVersion: Number(field(form, "version")),
    status: "done",
  });
}

/**
 * Saves a date of birth on a person who has none, as the signed-in staff member: row-level
 * security (persons_update, app.can_write_person) decides, and app.sync_person_birth keeps
 * birth_date and is_minor in step and refuses a future date. A date already on file is never
 * overwritten here.
 */
async function recordMissingBirthDate(organizationId: string, personId: string, dateOfBirth: string): Promise<{ error: string } | null> {
  const supabase = await createClient({ organizationId });
  const { data: updated, error } = await supabase
    .from("persons")
    .update({ date_of_birth: dateOfBirth, birth_date_precision: "day" })
    .eq("organization_id", organizationId)
    .eq("id", personId)
    .is("date_of_birth", null)
    .select("id");
  if (error) return { error: "Their date of birth could not be saved. No invitation was sent." };
  if ((updated ?? []).length > 0) return null;
  // Nothing changed: either a date is already on file (a retry), or this person can't be edited.
  const { data: current } = await supabase.from("persons").select("date_of_birth").eq("organization_id", organizationId).eq("id", personId).maybeSingle();
  if (current?.date_of_birth) return null;
  return { error: "You can’t edit this person’s record, so their date of birth was not saved." };
}

/**
 * The matter page's "Invite to the portal" dialog. public.create_portal_invitation decides
 * (role on the matter, adults only, guardian subjects, sample versus real, the real-client
 * lock, rate limits, step-up) and queues the invitation email in the outbox. The private link
 * is sealed into that email (createPortalInvitation) and also comes back here once, as a backup
 * for the inviter. emailLink says whether the email will carry it.
 * When the person had no date of birth the dialog asks for it, and it is saved on the
 * person first: the database decides adulthood from it.
 */
export async function invitePortalPerson(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  roleLabel: string;
  email: string;
  /** Only when the dialog asked for it (the person has none on file). */
  dateOfBirth?: string;
}): Promise<{ error: string } | { link: string; expiresAt: string | null; emailLink: boolean; emailSaved: boolean }> {
  const read = readPortalInvite({ personId: input.personId, roleLabel: input.roleLabel, email: input.email, dateOfBirth: input.dateOfBirth });
  if ("error" in read) return { error: read.error };
  if (!isUuid(input.organizationId) || !isUuid(input.matterId)) return { error: "Choose a person and a matter." };

  // No client can accept until the firm publishes its portal terms and privacy notice, so nothing is sent before then.
  const missing = missingPolicies(await loadCurrentPolicies(await createClient({ organizationId: input.organizationId }), input.organizationId));
  if (missing.length) return { error: POLICIES_MISSING };

  // public.create_portal_invitation refuses an email other than the one on the person's record.
  // Say which, rather than the database's general refusal; the record is left as it is.
  const onFile = await personEmail(input.organizationId, read.input.personId);
  if (onFile && onFile !== read.input.email) {
    return { error: `Their record has a different email on file (${onFile}). It was left as it is. Invite them at that address, or change it with Edit details first.` };
  }

  if (read.input.dateOfBirth) {
    const saved = await recordMissingBirthDate(input.organizationId, read.input.personId, read.input.dateOfBirth);
    if (saved) return saved;
  }

  let subjects: string[] = [];
  if (read.input.role === "guardian") {
    // Read as the signed-in staff member, so row-level security decides what is visible.
    const supabase = await createClient({ organizationId: input.organizationId });
    const { data: parties } = await supabase
      .from("matter_participants")
      .select("person_id, role")
      .eq("organization_id", input.organizationId)
      .eq("matter_id", input.matterId)
      .in("role", ["applicant", "dependant"]);
    const childIds = (parties ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id));
    const { data: minors } = childIds.length
      ? await supabase.from("persons").select("id").eq("organization_id", input.organizationId).eq("is_minor", true).in("id", childIds)
      : { data: [] };
    subjects = guardianSubjects(read.input.personId, (minors ?? []).map((row) => row.id));
  }

  const created = await createPortalInvitation({
    organizationId: input.organizationId,
    personId: read.input.personId,
    matterId: input.matterId,
    role: read.input.role,
    email: read.input.email,
    guardianSubjectIds: subjects,
    code: null,
  });
  if ("error" in created) return { error: created.error ?? "That invitation could not be sent." };
  // The person had no email on file: keep the one they were invited at, so the People card shows it.
  const emailSaved = onFile === read.input.email || (await recordMissingEmail(input.organizationId, read.input.personId, read.input.email));
  const origin = (await headers()).get("origin") ?? "";
  return { link: acceptLink(origin, read.input.role, created.token), expiresAt: created.expiresAt, emailLink: created.emailLink, emailSaved };
}

/** The email on a person's record, read as the signed-in staff member; null when none (or not readable). */
async function personEmail(organizationId: string, personId: string): Promise<string | null> {
  const supabase = await createClient({ organizationId });
  const { data } = await supabase.from("persons").select("email").eq("organization_id", organizationId).eq("id", personId).maybeSingle();
  return data?.email ?? null;
}

/**
 * Saves the invited email on a person who has none, through row-level security like any
 * other edit. An email already on file is never overwritten here. True when it is on file now.
 */
async function recordMissingEmail(organizationId: string, personId: string, email: string): Promise<boolean> {
  const supabase = await createClient({ organizationId });
  const { data, error } = await supabase
    .from("persons")
    .update({ email })
    .eq("organization_id", organizationId)
    .eq("id", personId)
    .is("email", null)
    .select("id");
  if (error) return false;
  if ((data ?? []).length > 0) return true;
  return (await personEmail(organizationId, personId)) === email;
}

/**
 * The "Edit details" dialog: a person's name, email, phone and date of birth, saved as the
 * signed-in staff member. Row-level security (persons_update, app.can_write_person) decides
 * who may edit: staff on one of the person's matters, or the staff member who recorded them.
 * app.sync_person_birth keeps birth_date and is_minor in step and refuses a future date; a
 * person who stops being a minor gets a majority review task (persons_zz_majority_task); the
 * persons_audit trigger records each change. A date of birth on file is corrected, never removed.
 */
export async function savePersonDetails(input: {
  organizationId: string;
  personId: string;
  version: number | string;
  name: string;
  email: string;
  phone: string;
  /** Blank keeps the date of birth on file as it is. */
  dateOfBirth: string;
}): Promise<{ error: string } | { saved: true; notes: string[] }> {
  const today = todayIso();
  const read = readPersonEdit({ ...input, today });
  if ("error" in read) return { error: read.error };
  if (!isUuid(input.organizationId)) return { error: "Open Edit details from a person on this page." };
  const org = input.organizationId;
  const { personId, version, displayName, email, phone, dateOfBirth } = read.input;
  const supabase = await createClient({ organizationId: org });

  const { data: current } = await supabase
    .from("persons")
    .select("id, user_id, date_of_birth, is_minor, version")
    .eq("organization_id", org)
    .eq("id", personId)
    .maybeSingle();
  if (!current) return { error: "You can’t see this person’s record, so nothing was saved." };
  if (current.version !== version) return { error: CHANGED_SINCE };

  const changesBirth = dateOfBirth !== null && dateOfBirth !== current.date_of_birth;
  if (changesBirth && current.user_id && !current.is_minor) {
    // A minor cannot hold their own portal login (PRD §5); the database refuses minors at invitation and acceptance.
    const { data: firm } = await supabase.from("organizations").select("age_of_majority_years").eq("id", org).maybeSingle();
    if (minorOn(dateOfBirth, firm?.age_of_majority_years ?? 19, today)) {
      return { error: "That date makes them a minor, and they hold their own portal login. A minor can’t hold one, so nothing was saved." };
    }
  }

  const { data: updated, error } = await supabase
    .from("persons")
    .update({
      display_name: displayName,
      email,
      contact_phone: phone,
      ...(changesBirth ? { date_of_birth: dateOfBirth, birth_date_precision: "day" as const } : {}),
    })
    .eq("organization_id", org)
    .eq("id", personId)
    .eq("version", version)
    .select("id, is_minor");
  if (error) {
    if (/future/i.test(error.message)) return { error: "The date of birth can’t be in the future." };
    if (error.code === "23514") return { error: "One of those details isn’t accepted. Check the email and phone number." };
    return { error: safeAccessError(error.message) };
  }
  const row = (updated ?? [])[0];
  if (!row) {
    const { data: after } = await supabase.from("persons").select("version").eq("organization_id", org).eq("id", personId).maybeSingle();
    if (after && after.version !== version) return { error: CHANGED_SINCE };
    return { error: "You can’t edit this person’s record. Only staff on one of their matters can." };
  }
  return { saved: true, notes: editNotes({ becameAdult: current.is_minor && !row.is_minor, becameMinor: !current.is_minor && row.is_minor }) };
}

const CHANGED_SINCE = "Someone changed this person’s details since you opened them. Reload the page and try again.";
