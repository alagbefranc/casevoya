/**
 * A person's identity history on the matter's People tab (PRD INT-05): other names, passports and
 * addresses as recorded (append only: a change or removal is a new row), and the deterministic
 * review flags on them. A flag asks someone to look; it is never a finding of fraud. Pure;
 * person-history-load reads the database as the signed-in member.
 */
import { safeAccessError } from "@/lib/auth/step-up";
import { dayMonthYear } from "@/modules/compliance/format";
import { countryName, normalizeName } from "@/modules/intake/present";
import { shortDay } from "@/modules/sheet/matter-intake-present";

export type IdentityKind = "name" | "passport" | "address";

export type IdentityEntry = {
  id: string;
  kind: IdentityKind;
  data: Record<string, unknown>;
  replacesId: string | null;
  retired: boolean;
  createdAt: string;
  createdBy: string | null;
};

export type IdentityFlag = { key: string; kind: "overlap" | "gap" | "expired" | "name" | "birth"; label: string; detail: string };

export type PersonHistoryRow = { id: string; cells: string[]; badge?: { tone: "ok" | "chg" | "gr"; label: string } | null; added: string };

export type PersonHistoryPanel = {
  organizationId: string;
  personId: string;
  name: string;
  names: PersonHistoryRow[];
  passports: PersonHistoryRow[];
  addresses: PersonHistoryRow[];
  flags: IdentityFlag[];
  resolved: { label: string; detail: string; note: string; by: string }[];
  /** How many earlier versions (changed or removed entries) stay on record. */
  earlier: number;
  /** May add, change and remove entries (staff who can write the person). */
  edit: boolean;
  /** May resolve flags (owner, licensed consultant, case manager). */
  resolve: boolean;
};

export const NAME_KINDS = [
  { value: "alias", label: "Alias" },
  { value: "maiden", label: "Maiden name" },
  { value: "previous", label: "Previous name" },
  { value: "transliteration", label: "Transliteration" },
  { value: "other", label: "Other name" },
] as const;

const NAME_KIND_LABEL = new Map<string, string>(NAME_KINDS.map((kind) => [kind.value, kind.label]));

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The entries still in effect: not replaced by a later row, and not removed. */
export function currentEntries(entries: readonly IdentityEntry[]): IdentityEntry[] {
  const replaced = new Set(entries.map((entry) => entry.replacesId).filter((id): id is string => Boolean(id)));
  return entries.filter((entry) => !entry.retired && !replaced.has(entry.id));
}

/** "•••• 5678": a passport number is never shown in full on the page. */
export function maskNumber(number: string): string {
  const tail = number.slice(-4);
  return number.length > 4 ? `•••• ${tail}` : "••••";
}

function day(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
}

function addressLabel(entry: IdentityEntry): string {
  return text(entry.data.address) || "an address";
}

/**
 * The deterministic checks on one person's current entries: overlapping or missing address periods,
 * an expired passport (by the expiry date printed on it), a passport name not covered by the record
 * name or a recorded other name, and a passport date of birth that differs from the record.
 * Period lengths (how many years of history a program asks for) are not checked here: they come
 * from the official IRCC form for the program and are not stored yet.
 */
export function identityFlags(input: { displayName: string; dateOfBirth: string | null; birthPrecision: string | null; entries: readonly IdentityEntry[]; today: string }): IdentityFlag[] {
  const flags: IdentityFlag[] = [];
  const current = currentEntries(input.entries);
  const addresses = current
    .filter((entry) => entry.kind === "address" && text(entry.data.from_on))
    .sort((a, b) => text(a.data.from_on).localeCompare(text(b.data.from_on)) || a.id.localeCompare(b.id));
  for (let index = 1; index < addresses.length; index++) {
    const previous = addresses[index - 1];
    const next = addresses[index];
    const end = text(previous.data.to_on);
    const start = text(next.data.from_on);
    if (!end || day(end) > day(start)) {
      flags.push({
        key: `overlap:${previous.id}:${next.id}`,
        kind: "overlap",
        label: "Overlap",
        detail: `Addresses: “${addressLabel(previous)}” ${end ? `runs to ${dayMonthYear(end)}` : "has no end date"} and “${addressLabel(next)}” starts ${dayMonthYear(start)}`,
      });
    } else if (day(start) - day(end) > 1) {
      flags.push({ key: `gap:${previous.id}:${next.id}`, kind: "gap", label: "Gap", detail: `Addresses: nothing between ${dayMonthYear(end)} and ${dayMonthYear(start)}` });
    }
  }

  const known = new Set([normalizeName(input.displayName), ...current.filter((entry) => entry.kind === "name").map((entry) => normalizeName(text(entry.data.name)))]);
  for (const passport of current.filter((entry) => entry.kind === "passport")) {
    const which = `Passport ${text(passport.data.country)} ${maskNumber(text(passport.data.number))}`;
    const expires = text(passport.data.expires_on);
    if (expires && expires < input.today) {
      flags.push({ key: `expired:${passport.id}`, kind: "expired", label: "Expired", detail: `${which} expired ${dayMonthYear(expires)}` });
    }
    const printed = text(passport.data.name);
    if (printed && !known.has(normalizeName(printed))) {
      flags.push({ key: `name:${passport.id}`, kind: "name", label: "Name differs", detail: `${which} reads “${printed}”; the record says “${input.displayName}” and no other name recorded matches` });
    }
    const birth = text(passport.data.birth_date);
    if (birth && input.dateOfBirth && birthDiffers(birth, input.dateOfBirth, input.birthPrecision)) {
      flags.push({ key: `birth:${passport.id}`, kind: "birth", label: "Differs from record", detail: `${which} gives the date of birth as ${dayMonthYear(birth)}; the record says ${input.dateOfBirth}` });
    }
  }
  return flags;
}

function birthDiffers(printed: string, record: string, precision: string | null): boolean {
  if (precision === "year") return printed.slice(0, 4) !== record.slice(0, 4);
  if (precision === "month") return printed.slice(0, 7) !== record.slice(0, 7);
  return printed !== record.slice(0, 10);
}

/** One person's identity history as the People tab shows it. `who(userId)` names a staff member. */
export function personHistoryPanel(
  input: {
    organizationId: string;
    personId: string;
    name: string;
    dateOfBirth: string | null;
    birthPrecision: string | null;
    entries: readonly IdentityEntry[];
    resolutions: readonly { flagKey: string; detail: string; note: string; createdAt: string; createdBy: string | null }[];
    edit: boolean;
    resolve: boolean;
  },
  who: (userId: string | null) => string,
  timeZone: string,
  today: string,
): PersonHistoryPanel {
  const current = currentEntries(input.entries);
  const added = (entry: IdentityEntry) => `${who(entry.createdBy)}, ${shortDay(entry.createdAt, timeZone)}`;
  const of = (kind: IdentityKind) => current.filter((entry) => entry.kind === kind);
  const names = of("name").map((entry) => ({
    id: entry.id,
    cells: [text(entry.data.name), NAME_KIND_LABEL.get(text(entry.data.name_kind)) ?? "Other name", text(entry.data.script) || "—"],
    added: added(entry),
  }));
  const passports = of("passport")
    .sort((a, b) => text(b.data.expires_on).localeCompare(text(a.data.expires_on)))
    .map((entry) => {
      const expires = text(entry.data.expires_on);
      const expired = Boolean(expires) && expires < today;
      return {
        id: entry.id,
        cells: [
          countryName(text(entry.data.country)),
          maskNumber(text(entry.data.number)),
          text(entry.data.issued_on) ? dayMonthYear(text(entry.data.issued_on)) : "—",
          expires ? dayMonthYear(expires) : "—",
        ],
        badge: expired ? { tone: "chg" as const, label: "Expired" } : entry.data.current === true ? { tone: "ok" as const, label: "Current" } : { tone: "gr" as const, label: "Not current" },
        added: added(entry),
      };
    });
  const addresses = of("address")
    .sort((a, b) => text(b.data.from_on).localeCompare(text(a.data.from_on)))
    .map((entry) => ({
      id: entry.id,
      cells: [
        `${text(entry.data.address)}${text(entry.data.country) ? `, ${countryName(text(entry.data.country))}` : ""}`,
        dayMonthYear(text(entry.data.from_on)),
        text(entry.data.to_on) ? dayMonthYear(text(entry.data.to_on)) : "Now",
      ],
      added: added(entry),
    }));
  const done = new Map(input.resolutions.map((row) => [row.flagKey, row]));
  const flags = identityFlags({ displayName: input.name, dateOfBirth: input.dateOfBirth, birthPrecision: input.birthPrecision, entries: input.entries, today });
  return {
    organizationId: input.organizationId,
    personId: input.personId,
    name: input.name,
    names,
    passports,
    addresses,
    flags: flags.filter((flag) => !done.has(flag.key)),
    resolved: input.resolutions.map((row) => ({
      label: flags.find((flag) => flag.key === row.flagKey)?.label ?? "Resolved",
      detail: row.detail,
      note: row.note,
      by: `${who(row.createdBy)}, ${shortDay(row.createdAt, timeZone)}`,
    })),
    earlier: input.entries.length - current.length,
    edit: input.edit,
    resolve: input.resolve,
  };
}

/** The other names a person has on record, for the Intake tab's name check (INT-05). */
export function recordedNames(entries: readonly IdentityEntry[]): string[] {
  return currentEntries(entries)
    .filter((entry) => entry.kind === "name")
    .map((entry) => text(entry.data.name))
    .filter(Boolean);
}

/** The database's refusal in plain words: its own field messages are already written for people. */
export function historyError(message: string): string {
  if (/denied/i.test(message)) return "You can’t change this person’s record.";
  if (/already changed/i.test(message)) return "Someone changed this entry already. Reload to see the latest.";
  if (/already resolved/i.test(message)) return "This flag was already resolved.";
  if (/step-up|aal2|mfa/i.test(message)) return safeAccessError(message);
  if (/^(choose|a |an |enter|the |keep|say|that )/i.test(message)) return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;
  return "That didn’t save. Try again.";
}
