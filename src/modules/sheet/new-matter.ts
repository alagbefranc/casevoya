/**
 * Pure helpers for the Sheet's "New matter" dialog: its options, what it sends, how the
 * database's refusals read, and where a step-up goes. The database decides every create.
 */
import { safeAccessError } from "@/lib/auth/step-up";
import { readBirthDate, todayIso } from "@/modules/sheet/birth-date";
import { programLabel } from "@/modules/sheet/matters-present";
import { entitlementError } from "@/modules/subscription/errors";

export type NewMatterOption = { value: string; label: string };

export type NewMatterDialogData = {
  organizationId: string;
  consultants: NewMatterOption[];
  programs: NewMatterOption[];
  /** The firm is still in sample mode: the database refuses a real matter. */
  sampleMode: boolean;
  /** The latest date of birth the date fields accept (`YYYY-MM-DD`). Absent, no limit is set. */
  maxBirthDate?: string;
};

export type NewMatterInput = {
  applicantName: string;
  applicantEmail: string | null;
  sponsorName: string | null;
  sponsorEmail: string | null;
  /** `YYYY-MM-DD`, or null when not given. */
  applicantDateOfBirth: string | null;
  sponsorDateOfBirth: string | null;
  consultantMembershipId: string;
  rulePackVersionId: string | null;
};

const BLOCKING = new Set(["revoked", "suspended", "inactive", "not_entitled"]);

/**
 * Active licensed consultants and firm owners, with the Designer's licence note when a
 * consultant's check is not done. A firm owner counts as licensed (decision 2026-10-19: the
 * database lets an owner sign and be responsible), so an owner carries no "pending" note; a
 * licence on file that blocks new matters is still named, for an owner too.
 */
export function consultantOptions(
  members: readonly { id: string; name: string; role?: string }[],
  credentialStatus: ReadonlyMap<string, string>,
): NewMatterOption[] {
  return members.map((member) => {
    const status = credentialStatus.get(member.id);
    // One set of licence words (decision 2026-10-19): a declared licence is enough to work and sign;
    // only a blocked one locks new matters. A firm owner without a credential counts as licensed.
    if (status && BLOCKING.has(status)) return { value: member.id, label: `${member.name} (licence blocks new matters)` };
    if (!status || status === "verified" || member.role === "firm_owner") return { value: member.id, label: member.name };
    return { value: member.id, label: `${member.name} (licence declared)` };
  });
}

/** Published program packs, newest version first within a program. */
export function programOptions(
  packs: readonly { id: string; program_key: string; pack_version: number; status: string }[],
): NewMatterOption[] {
  return [...packs]
    .sort((a, b) => a.program_key.localeCompare(b.program_key) || b.pack_version - a.pack_version)
    .map((pack) => ({
      value: pack.id,
      label: `${programLabel(pack.program_key)} · v${pack.pack_version}${pack.status === "review_due" ? " review due" : ""}`,
    }));
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clean(value: FormDataEntryValue | string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** What the dialog sends, or the first thing to fix. The database checks all of it again. */
export function readNewMatter(fields: {
  applicantName?: string | null;
  applicantEmail?: string | null;
  sponsorName?: string | null;
  sponsorEmail?: string | null;
  applicantDateOfBirth?: string | null;
  sponsorDateOfBirth?: string | null;
  consultant?: string | null;
  program?: string | null;
  /** `YYYY-MM-DD`; defaults to today in UTC. */
  today?: string;
}): { input: NewMatterInput } | { error: string } {
  const applicantName = clean(fields.applicantName);
  const applicantEmail = clean(fields.applicantEmail).toLowerCase() || null;
  const sponsorName = clean(fields.sponsorName) || null;
  const sponsorEmail = clean(fields.sponsorEmail).toLowerCase() || null;
  const consultant = clean(fields.consultant);
  const program = clean(fields.program) || null;
  if (!applicantName) return { error: "Add the applicant’s name." };
  if (applicantName.length > 200 || (sponsorName && sponsorName.length > 200)) return { error: "Names can be up to 200 characters." };
  if (applicantEmail && !EMAIL.test(applicantEmail)) return { error: "Enter a valid email address." };
  if (sponsorEmail && !sponsorName) return { error: "Add the sponsor’s name, or leave the sponsor out." };
  if (sponsorEmail && !EMAIL.test(sponsorEmail)) return { error: "Enter a valid email address." };
  const today = fields.today ?? todayIso();
  const applicantBirth = readBirthDate(fields.applicantDateOfBirth, today);
  if ("error" in applicantBirth) return { error: `Applicant: ${applicantBirth.error}` };
  const sponsorBirth = readBirthDate(fields.sponsorDateOfBirth, today);
  if ("error" in sponsorBirth) return { error: `Sponsor: ${sponsorBirth.error}` };
  if (sponsorBirth.date && !sponsorName) return { error: "Add the sponsor’s name, or leave the sponsor out." };
  if (!consultant) return { error: "Choose a responsible consultant." };
  return {
    input: {
      applicantName,
      applicantEmail,
      sponsorName,
      sponsorEmail,
      applicantDateOfBirth: applicantBirth.date,
      sponsorDateOfBirth: sponsorBirth.date,
      consultantMembershipId: consultant,
      rulePackVersionId: program,
    },
  };
}

const STEP_UP_ERRORS = new Set([safeAccessError("step-up is required"), safeAccessError("aal2")]);

/** User-facing copy for a refused create. Never passes a database message through. */
export function newMatterError(message: string): string {
  const entitlement = entitlementError(message);
  if (entitlement) return entitlement;
  if (/sample mode/i.test(message)) {
    return "This firm is still in sample mode, so new matters can only be fictional samples. Turn sample mode off to open a real client’s matter.";
  }
  if (/licence blocks/i.test(message)) return "A licence blocks this new matter. Check the consultant’s licence status.";
  if (/active licensed consultant/i.test(message)) return "The responsible consultant must be an active licensed consultant.";
  if (/published pack/i.test(message)) return "Choose a published program template for a jurisdiction this firm practises.";
  if (/applicant name/i.test(message)) return "Add the applicant’s name.";
  if (/sponsor name is required/i.test(message)) return "Add the sponsor’s name, or leave the sponsor out.";
  if (/date of birth/i.test(message)) return "Check the dates of birth. They can’t be in the future or before 1900.";
  if (/responsible consultant is required/i.test(message)) return "Choose a responsible consultant.";
  if (/matter create denied/i.test(message)) return "Your role can’t open matters. Ask a firm owner.";
  return safeAccessError(message);
}

export function needsStepUp(error: string | null | undefined): boolean {
  return Boolean(error && STEP_UP_ERRORS.has(error));
}

/** The step-up screen, coming back to this page with the dialog open again (`?new=1`). */
export function newMatterStepUpLocation(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set("new", "1");
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`;
}

/** The same URL without `?new=1`, so closing the dialog and refreshing does not reopen it. */
export function withoutNew(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("new");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
