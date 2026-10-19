/**
 * Pure helpers for the Sheet's "Edit details" dialog (a person's name, email, phone and date
 * of birth), opened from the Clients page person tab and the matter page People cards.
 * Row-level security (persons_update, app.can_write_person) decides who may save, and
 * app.sync_person_birth keeps birth_date, birth_date_precision and is_minor in step.
 */
import { birthDateLabel } from "@/modules/sheet/clients-present";
import { readBirthDate, todayIso } from "@/modules/sheet/birth-date";

/** What the dialog is opened with for one person. The opener carries it as `data-*`. */
export type PersonEditData = {
  organizationId: string;
  personId: string;
  /** persons.version when the page was read; a save made after someone else's is refused. */
  version: number;
  name: string;
  email: string;
  phone: string;
  /** A full date on file (`YYYY-MM-DD`) to prefill, or "" when none or only part of one is on file. */
  dateOfBirth: string;
  /** What is on file when it is only a month or a year ("1984-03", "1984"); otherwise null. */
  partialBirth: string | null;
};

export type PersonEditInput = {
  personId: string;
  version: number;
  displayName: string;
  email: string | null;
  phone: string | null;
  /** `YYYY-MM-DD` to save, or null to leave the date of birth on file as it is. */
  dateOfBirth: string | null;
};

/**
 * Staff roles app.can_write_person can allow (app.actor_staff_assigned_to_matter). Edit details
 * is offered to these; whether this person may be edited is still the database's decision.
 */
export const PERSON_EDIT_ROLES: readonly string[] = ["firm_owner", "licensed_consultant", "case_manager", "assistant"];

export function mayOfferPersonEdit(role: string): boolean {
  return PERSON_EDIT_ROLES.includes(role);
}

/** The same email check the invitation dialog and the database use. */
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** persons_contact_phone_ck: E.164, a plus sign then 8 to 15 digits. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** The dialog's prefill for a person record. */
export function personEditData(
  organizationId: string,
  person: {
    id: string;
    version: number;
    display_name: string;
    email: string | null;
    contact_phone: string | null;
    date_of_birth: string | null;
    birth_date_precision: string | null;
  },
): PersonEditData {
  const full = person.date_of_birth && (person.birth_date_precision ?? "day") === "day";
  return {
    organizationId,
    personId: person.id,
    version: person.version,
    name: person.display_name,
    email: person.email ?? "",
    phone: person.contact_phone ?? "",
    dateOfBirth: full ? person.date_of_birth!.slice(0, 10) : "",
    partialBirth: full ? null : birthDateLabel(person.date_of_birth, person.birth_date_precision),
  };
}

/** The Date of birth field's hint for this person. */
export function birthHint(data: Pick<PersonEditData, "dateOfBirth" | "partialBirth">): string {
  if (data.partialBirth) return `On file as ${data.partialBirth} only. Enter the full date, or leave it blank to keep that.`;
  if (data.dateOfBirth) return "Correct it if it’s wrong. It decides who counts as an adult.";
  return "Optional. Only adults get a portal login.";
}

/**
 * A phone number as E.164 (`+14165550100`), `null` when left blank, or what to fix. Spaces,
 * dashes, dots and brackets are dropped; the country code is required.
 */
export function readPhone(value: string | null | undefined): { phone: string | null } | { error: string } {
  const text = (value ?? "").trim();
  if (!text) return { phone: null };
  const compact = text.replace(/[\s().-]/g, "");
  if (!compact.startsWith("+")) return { error: "Add the phone number with its country code, starting with +." };
  if (!E164.test(compact)) return { error: "Enter a valid phone number, like +1 416 555 0100." };
  return { phone: compact };
}

/** What the dialog sends, or the first thing to fix. The database checks all of it again. */
export function readPersonEdit(fields: {
  personId?: string | null;
  version?: string | number | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  /** `YYYY-MM-DD`; defaults to today in UTC. */
  today?: string;
}): { input: PersonEditInput } | { error: string } {
  const personId = (fields.personId ?? "").trim();
  const version = Number(fields.version);
  if (!UUID.test(personId) || !Number.isInteger(version) || version < 1) return { error: "Open Edit details from a person on this page." };
  const displayName = (fields.name ?? "").replace(/\s+/g, " ").trim();
  if (!displayName) return { error: "Add their name." };
  if (displayName.length > 200) return { error: "Shorten the name to 200 characters or fewer." };
  const email = (fields.email ?? "").trim().toLowerCase() || null;
  if (email && (!EMAIL.test(email) || email.length > 320)) return { error: "Enter a valid email address." };
  const phone = readPhone(fields.phone);
  if ("error" in phone) return phone;
  const birth = readBirthDate(fields.dateOfBirth, fields.today ?? todayIso());
  if ("error" in birth) return birth;
  return { input: { personId, version, displayName, email, phone: phone.phone, dateOfBirth: birth.date } };
}

/**
 * app.derive_is_minor for a full date: still under the firm's age of majority on `today`.
 * Used only to explain a refusal before saving; the database decides.
 */
export function minorOn(dateOfBirth: string, majorityYears: number, today: string): boolean {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const adult = new Date(Date.UTC(year + majorityYears, month - 1, day));
  // 29 February rolls to 1 March in a non-leap year, as Postgres date + interval does not; close enough to explain.
  return adult.toISOString().slice(0, 10) > today;
}

/** Whether the name, email or phone differ from what is on file (the date of birth is compared separately). */
export function personDetailsChanged(
  current: { display_name: string; email: string | null; contact_phone: string | null },
  next: { displayName: string; email: string | null; phone: string | null },
): boolean {
  return current.display_name !== next.displayName || (current.email ?? null) !== next.email || (current.contact_phone ?? null) !== next.phone;
}

/** What the save toast says, in order: the change itself, then anything the database did because of it. */
export function editNotes(change: { becameAdult: boolean; becameMinor: boolean }): string[] {
  const notes: string[] = [];
  if (change.becameAdult) notes.push("They now count as an adult, so a majority review task was opened and guardian access stops.");
  if (change.becameMinor) notes.push("They now count as a minor. Only a guardian can be invited for them.");
  return notes;
}
