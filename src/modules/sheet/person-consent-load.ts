import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { presentPersonConsent, type PersonConsentData } from "@/modules/sheet/person-consent-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The person tab's consent and portal sign-in panels (SEC-01, SEC-05), read as the signed-in staff
 * member. public.person_consent_overview refuses anyone who may not see them (an assistant, a
 * finance user, staff not on the person's matters): then the panels are left out.
 */
export async function loadPersonConsent(supabase: Client, organizationId: string, personId: string, timeZone: string): Promise<PersonConsentData | null> {
  const { data, error } = await supabase.rpc("person_consent_overview", { p_organization_id: organizationId, p_person_id: personId });
  if (error || !data) return null;
  const overview = data as { reviews?: { done_by?: string | null }[]; resets?: { reset_by?: string }[] };
  const ids = [
    ...new Set([...(overview.reviews ?? []).map((row) => row.done_by), ...(overview.resets ?? []).map((row) => row.reset_by)].filter((id): id is string => typeof id === "string")),
  ];
  const profiles = ids.length ? await supabase.from("profiles").select("id, display_name").in("id", ids) : null;
  const names = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name as string | null]));
  return presentPersonConsent({
    organizationId,
    personId,
    overview: data,
    timeZone,
    userName: (id) => (id ? names.get(id) || "Staff member" : "Staff member"),
  });
}
