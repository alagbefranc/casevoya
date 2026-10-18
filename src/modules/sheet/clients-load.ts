import "server-only";
import type { ClientRow, ClientsData, HouseholdData, PersonData, RelationshipRow } from "@/components/sheet/designer/clients";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import {
  CLIENTS_READ,
  clientsTab,
  findDuplicate,
  householdCell,
  type InviteState,
  matterStateBadge,
  mattersLabel,
  openTasksLabel,
  partyRoleLabel,
  personFacts,
  personHref,
  personParam,
  personSummary,
  portalSentence,
  portalState,
  possessive,
  relationshipLabel,
  roleFlags,
  rolesLabel,
  type GrantFact,
} from "@/modules/sheet/clients-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { mayOfferPersonEdit, personEditData } from "@/modules/sheet/edit-person";
import { loadNewMatterDialog } from "@/modules/sheet/matters-load";
import { MATTERS_READ } from "@/modules/sheet/matters-present";
import type { SheetQuery } from "@/modules/sheet/present";
import { firstName } from "@/modules/sheet/tasks-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const PERSON_COLUMNS = "id, display_name, email, contact_phone, user_id, date_of_birth, birth_date_precision, is_minor, created_at, version";
/** Participant, invitation and household rows read at once; each is a small row. */
const LINKS_READ = 5000;
const OPEN_TASK = ["open", "blocked"] as const;

/** Where the Clients page's add control goes: the New matter dialog, which records the client with their matter. */
export const ADD_CLIENT = { href: "/sheet/matters?new=1", label: "Add a client" } as const;

type PersonRecord = {
  id: string;
  display_name: string;
  email: string | null;
  contact_phone: string | null;
  user_id: string | null;
  date_of_birth: string | null;
  birth_date_precision: string | null;
  is_minor: boolean;
  created_at: string;
  version: number;
};

type Party = { matterId: string; role: string };
type MatterRecord = { id: string; reference: string | null; title: string; stage: string };

function matterLabel(matter: MatterRecord): string {
  return matter.reference || matter.title;
}

/** People not already in the list (a related person, a household member), read as the viewer. */
async function morePeople(supabase: Client, org: string, ids: string[], known: Map<string, PersonRecord>): Promise<Map<string, PersonRecord>> {
  const missing = [...new Set(ids)].filter((id) => !known.has(id));
  const found = new Map(known);
  if (missing.length === 0) return found;
  const rows = await supabase.from("persons").select(PERSON_COLUMNS).eq("organization_id", org).in("id", missing);
  for (const row of rows.data ?? []) found.set(row.id, row);
  return found;
}

async function loadPerson(
  supabase: Client,
  org: string,
  person: PersonRecord,
  parties: Party[],
  matter: Map<string, MatterRecord>,
  portal: ReturnType<typeof portalState>,
  people: Map<string, PersonRecord>,
): Promise<PersonData> {
  const [relationships, openTasks] = await Promise.all([
    supabase
      .from("person_relationships")
      .select("from_person_id, to_person_id, relationship_type")
      .eq("organization_id", org)
      .or(`from_person_id.eq.${person.id},to_person_id.eq.${person.id}`)
      .limit(100),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("owner_person_id", person.id)
      .in("status", [...OPEN_TASK]),
  ]);
  const links = relationships.data ?? [];
  const related = await morePeople(
    supabase,
    org,
    links.map((row) => (row.from_person_id === person.id ? row.to_person_id : row.from_person_id)),
    people,
  );
  // A related person the viewer cannot read is left out rather than named.
  const rows: RelationshipRow[] = links.flatMap((row) => {
    const fromHere = row.from_person_id === person.id;
    const other = related.get(fromHere ? row.to_person_id : row.from_person_id);
    return other ? [{ person: { name: other.display_name }, label: relationshipLabel(row.relationship_type, fromHere) }] : [];
  });

  const visible = parties.filter((party) => matter.has(party.matterId));
  const roles = rolesLabel(visible.map((party) => party.role), person.is_minor);
  const references = visible.map((party) => matterLabel(matter.get(party.matterId)!));
  return {
    name: person.display_name,
    summary: personSummary(roles, references),
    facts: personFacts(person.date_of_birth, person.birth_date_precision),
    // The firm keeps no per-fact history to show yet, so the panel is left out.
    superseded: null,
    relationships: {
      rows,
      note: `Being in the same household doesn’t give anyone access to ${possessive(person.display_name)} private records.`,
    },
    matters: {
      rows: visible.map((party) => {
        const row = matter.get(party.matterId)!;
        return { href: `/sheet/matters/${row.id}`, reference: matterLabel(row), role: partyRoleLabel(party.role, person.is_minor), state: matterStateBadge(row.stage) };
      }),
      note: [portalSentence(portal), `${openTasksLabel(openTasks.count ?? 0)}.`],
    },
    // Language, timezone and contact preferences are not stored for a person yet.
    preferences: null,
  };
}

async function loadHousehold(
  supabase: Client,
  staff: SheetStaff,
  household: { id: string; name: string },
  memberIds: string[],
  people: Map<string, PersonRecord>,
  now: Date,
): Promise<HouseholdData | null> {
  const org = staff.organizationId;
  const known = await morePeople(supabase, org, memberIds, people);
  // Only people the viewer can read are shown; household membership grants nobody access.
  const members = [...new Set(memberIds)]
    .map((id) => known.get(id))
    .filter((row): row is PersonRecord => Boolean(row))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  if (members.length === 0) return null;

  // Only a firm owner can read the firm's access grants. Anyone else sees "—" for other people's records.
  let grants: GrantFact[] | null = null;
  if (staff.role === "firm_owner") {
    const rows = await supabase
      .from("access_grants")
      .select("grantee_person_id, subject_person_id, kind, expires_at")
      .eq("organization_id", org)
      .is("revoked_at", null)
      .in(
        "subject_person_id",
        members.map((row) => row.id),
      );
    if (!rows.error) {
      const minor = new Map(members.map((row) => [row.id, row.is_minor]));
      grants = (rows.data ?? [])
        .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now.getTime())
        // A guardian grant works only while the subject is a minor.
        .filter((row) => row.kind !== "guardian" || minor.get(row.subject_person_id) === true)
        .map((row) => ({ grantee: row.grantee_person_id, subject: row.subject_person_id, kind: row.kind }));
    }
  }
  return {
    name: household.name,
    copy: "How the people on this file are related, and what each can see. Selecting a name never grants access.",
    members: members.map((row) => firstName(row.display_name)),
    rows: members.map((subject) => ({
      record: `${possessive(subject.display_name)} private records`,
      cells: members.map((viewer) => householdCell(viewer.id, subject.id, grants)),
    })),
  };
}

/** The Designer's Clients page for a firm, read as the signed-in staff member so RLS decides who is listed. */
export async function loadSheetClients(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const tab = clientsTab(query.tab);
  const asked = personParam(query.person);
  const count = { count: "exact" as const, head: true };

  const [chrome, persons, peopleCount, participants, matters, invites, households, householdMembers, newMatter] = await Promise.all([
    loadSheetChrome(staff, "/sheet/clients"),
    supabase.from("persons").select(PERSON_COLUMNS).eq("organization_id", org).order("display_name").order("id").limit(CLIENTS_READ),
    supabase.from("persons").select("id", count).eq("organization_id", org),
    supabase.from("matter_participants").select("matter_id, person_id, role").eq("organization_id", org).not("person_id", "is", null).limit(LINKS_READ),
    supabase.from("matters").select("id, reference, title, stage").eq("organization_id", org).order("updated_at", { ascending: false }).limit(MATTERS_READ),
    supabase.from("portal_invitations").select("person_id, expires_at, consumed_at, revoked_at, declined_at").eq("organization_id", org).limit(LINKS_READ),
    supabase.from("households").select("id, name").eq("organization_id", org).order("name").limit(500),
    supabase.from("household_members").select("household_id, person_id").eq("organization_id", org).limit(LINKS_READ),
    loadNewMatterDialog(supabase, staff),
  ]);

  const list = persons.data ?? [];
  const people = new Map<string, PersonRecord>(list.map((row) => [row.id, row]));
  const matter = new Map((matters.data ?? []).map((row) => [row.id, row]));
  const parties = new Map<string, Party[]>();
  for (const row of participants.data ?? []) {
    if (!row.person_id) continue;
    parties.set(row.person_id, [...(parties.get(row.person_id) ?? []), { matterId: row.matter_id, role: row.role }]);
  }
  const invitesOf = new Map<string, InviteState[]>();
  for (const row of invites.data ?? []) invitesOf.set(row.person_id, [...(invitesOf.get(row.person_id) ?? []), row]);
  const visibleParties = (id: string) => (parties.get(id) ?? []).filter((party) => matter.has(party.matterId));
  const portalOf = (row: PersonRecord) => portalState(Boolean(row.user_id), invitesOf.get(row.id) ?? [], now);

  const rows: ClientRow[] = list.map((row) => {
    const own = visibleParties(row.id);
    const roles = own.map((party) => party.role);
    return {
      href: personHref(row.id),
      flags: roleFlags(roles),
      person: { name: row.display_name },
      role: rolesLabel(roles, row.is_minor),
      matter: mattersLabel(own.map((party) => matterLabel(matter.get(party.matterId)!))),
      // Language and timezone are not stored for a person yet.
      language: "—",
      timezone: "—",
      portal: portalOf(row),
    };
  });

  // The person tab shows the person asked for, or the first person listed. One the viewer
  // cannot read is not swapped for someone else.
  let person: PersonRecord | null = asked ? (people.get(asked) ?? null) : (list[0] ?? null);
  if (asked && !person) {
    const one = await supabase.from("persons").select(PERSON_COLUMNS).eq("organization_id", org).eq("id", asked).maybeSingle();
    person = one.data ?? null;
    if (person) people.set(person.id, person);
  }

  const membership = householdMembers.data ?? [];
  // A household counts here when it groups someone the viewer can read.
  const withReadable = new Set(membership.filter((row) => people.has(row.person_id)).map((row) => row.household_id));
  const householdRows = (households.data ?? []).filter((row) => withReadable.has(row.id));
  const householdId = person ? membership.find((row) => row.person_id === person.id)?.household_id : asked ? undefined : householdRows[0]?.id;
  const household = householdRows.find((row) => row.id === householdId) ?? null;

  const [personData, householdData] = await Promise.all([
    tab === "person" && person ? loadPerson(supabase, org, person, parties.get(person.id) ?? [], matter, portalOf(person), people) : null,
    tab === "household" && household
      ? loadHousehold(
          supabase,
          staff,
          household,
          membership.filter((row) => row.household_id === household.id).map((row) => row.person_id),
          people,
          now,
        )
      : null,
  ]);

  const firstMatter = (id: string) => {
    const party = visibleParties(id)[0];
    return party ? matterLabel(matter.get(party.matterId)!) : null;
  };
  const clients: ClientsData = {
    tab,
    counts: { people: peopleCount.count ?? list.length, households: householdRows.length },
    add: ADD_CLIENT,
    tabs: { person: person?.display_name ?? "Person", household: household?.name ?? "Household" },
    dir:
      tab === "dir"
        ? {
            // Person access is assignment-based for every role, the firm owner included (DEC-006).
            copy: "Everyone on the matters you’re assigned to, one record per person. Two people who share an email stay separate, and nobody is merged without your confirmation.",
            rows,
            duplicate: findDuplicate(
              list.map((row) => ({
                id: row.id,
                name: row.display_name,
                email: row.email,
                phone: row.contact_phone,
                dateOfBirth: row.date_of_birth,
                precision: row.birth_date_precision,
                createdAt: row.created_at,
                reference: firstMatter(row.id),
              })),
            ),
          }
        : undefined,
    person: personData,
    household: householdData,
    // Edit details for the person shown; row-level security (app.can_write_person) decides the save.
    edit: tab === "person" && personData && person && mayOfferPersonEdit(staff.role) ? personEditData(org, person) : null,
  };
  return { chrome, clients, newMatter };
}
