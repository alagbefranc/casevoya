import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { mayHandleIntake } from "@/modules/sheet/matter-intake-present";
import { personHistoryPanel, type IdentityEntry, type IdentityKind, type PersonHistoryPanel } from "@/modules/sheet/person-history-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Roles public.record_person_identity accepts (with app.can_write_person on the person). */
const EDIT_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant"];

/**
 * The identity history of the clients on a matter (INT-05), read as the signed-in member:
 * row-level security (app.can_write_person) returns rows only to staff who can write the person,
 * so anyone else gets no panels.
 */
export async function loadPersonHistory(
  supabase: Client,
  input: {
    organizationId: string;
    role: string;
    timezone: string;
    today: string;
    people: { id: string; name: string; dateOfBirth: string | null; birthPrecision: string | null; editable: boolean }[];
  },
): Promise<PersonHistoryPanel[]> {
  const people = input.people.filter((person) => person.editable);
  if (people.length === 0 || !EDIT_ROLES.includes(input.role)) return [];
  const ids = people.map((person) => person.id);
  const [entries, resolutions] = await Promise.all([
    supabase.from("person_identity_entries").select("id, person_id, kind, data, replaces_id, retired, created_at, created_by").eq("organization_id", input.organizationId).in("person_id", ids).order("created_at", { ascending: true }).limit(1000),
    supabase.from("person_flag_resolutions").select("person_id, flag_key, detail, note, created_at, created_by").eq("organization_id", input.organizationId).in("person_id", ids).limit(500),
  ]);
  if (entries.error || resolutions.error) return [];
  const userIds = [...new Set([...(entries.data ?? []), ...(resolutions.data ?? [])].map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const profiles = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : null;
  const names = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  const who = (userId: string | null) => (userId ? (names.get(userId) ?? "Someone") : "Someone");
  return people.map((person) =>
    personHistoryPanel(
      {
        organizationId: input.organizationId,
        personId: person.id,
        name: person.name,
        dateOfBirth: person.dateOfBirth,
        birthPrecision: person.birthPrecision,
        entries: (entries.data ?? [])
          .filter((row) => row.person_id === person.id)
          .map(
            (row): IdentityEntry => ({
              id: row.id,
              kind: row.kind as IdentityKind,
              data: row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {},
              replacesId: row.replaces_id,
              retired: row.retired,
              createdAt: row.created_at,
              createdBy: row.created_by,
            }),
          ),
        resolutions: (resolutions.data ?? [])
          .filter((row) => row.person_id === person.id)
          .map((row) => ({ flagKey: row.flag_key, detail: row.detail, note: row.note, createdAt: row.created_at, createdBy: row.created_by })),
        edit: true,
        resolve: mayHandleIntake(input.role),
      },
      who,
      input.timezone,
      input.today,
    ),
  );
}
