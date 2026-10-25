import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CAPTURED_PROVISIONS } from "@/modules/compliance/privacy-official";
import type { DeliveryRow, ItemRow, PrivacyExtras, ResponseRow, TimeLimitRow } from "@/modules/compliance/privacy-response-present";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const LIMIT_COLUMNS =
  "id, kind, law_name, provision_text, days, source_url, source_section, checked_on, current_to, snapshot_sha256, status, reviewed_by_membership_id, reviewed_at, review_note, page_attested_by_membership_id, page_attested_on, version";
const ITEM_COLUMNS = "id, request_id, source, source_id, label, fields, decision, withheld_fields, third_party, reason, decided_by";
const RESPONSE_COLUMNS = "id, request_id, status, sha256, byte_size, file_count, record_count, withheld_count, ready_at, requested_at, failed_reason";
const DELIVERY_COLUMNS = "id, request_id, response_id, delivered_at, expires_at, sha256, download_count, first_downloaded_at, last_downloaded_at";

/**
 * SEC-06 parts of Compliance > Privacy requests, read as the signed-in staff member (row-level
 * security decides): the firm's legal time limits, and for the selected request its records found,
 * packages, delivery and whether the person has a portal login.
 */
export async function loadPrivacyExtras(
  supabase: Supabase,
  org: string,
  selected: { id: string; person_id: string | null } | null,
  canReview: boolean,
): Promise<{ extras: PrivacyExtras; captured: (readonly [string, string])[] }> {
  const [limits, items, responses, delivery, person] = await Promise.all([
    supabase.from("privacy_time_limits").select(LIMIT_COLUMNS).eq("organization_id", org).order("created_at", { ascending: false }).limit(100),
    selected ? supabase.from("privacy_request_items").select(ITEM_COLUMNS).eq("request_id", selected.id).order("source").order("label").limit(1000) : null,
    selected ? supabase.from("privacy_request_responses").select(RESPONSE_COLUMNS).eq("request_id", selected.id).order("requested_at", { ascending: false }).limit(20) : null,
    selected ? supabase.from("privacy_request_deliveries").select(DELIVERY_COLUMNS).eq("request_id", selected.id).maybeSingle() : null,
    selected?.person_id ? supabase.from("persons").select("user_id").eq("organization_id", org).eq("id", selected.person_id).maybeSingle() : null,
  ]);
  const userId = person?.data?.user_id ?? null;
  const portal = userId
    ? await supabase.from("memberships").select("id").eq("organization_id", org).eq("user_id", userId).eq("status", "active").limit(1)
    : null;
  return {
    extras: {
      limits: (limits.data ?? []) as TimeLimitRow[],
      items: (items?.data ?? []) as ItemRow[],
      responses: (responses?.data ?? []) as ResponseRow[],
      delivery: (delivery?.data ?? null) as DeliveryRow | null,
      hasPortal: Boolean(portal?.data?.length),
      canReview,
    },
    captured: CAPTURED_PROVISIONS.map((provision) => [provision.key, `${provision.label} (current to ${provision.currentTo}, retrieved ${provision.retrievedOn})`] as const),
  };
}
