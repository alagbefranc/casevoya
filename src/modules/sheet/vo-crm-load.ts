import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CallNotesData, LeadVoData } from "@/components/sheet/designer/vo-crm";
import type { SheetStaff } from "@/modules/sheet/load";
import { composioConfigured } from "@/modules/integrations/composio";
import { voAgentConfigured } from "@/modules/vo/agent-client";
import { effectiveSettings } from "@/modules/sheet/vo-present";
import { callVoView, leadVoView, type VoCrmDraftRow } from "@/modules/sheet/vo-crm-present";
import type { ConsentRow } from "@/modules/leads/present";

type Client = Awaited<ReturnType<typeof createClient>>;

const DRAFT_COLUMNS = "id, body, sources, needs_rule, marketing_consent, left_out";

async function settingsFor(supabase: Client, staff: SheetStaff) {
  const { data } = await supabase.from("vo_settings").select("*").eq("organization_id", staff.organizationId).maybeSingle();
  return effectiveSettings(data ?? null, staff.sampleMode);
}

/** The Lead page's "Follow-up with Vo" panel, read as the signed-in staff member (RLS). */
export async function loadLeadVo(staff: SheetStaff, leadId: string): Promise<LeadVoData | null> {
  const org = staff.organizationId;
  const supabase = await createClient({ organizationId: org });
  const [settings, lead, consents, draft, mailboxes] = await Promise.all([
    settingsFor(supabase, staff),
    supabase.from("leads").select("id, email, phone, converted_matter_id").eq("organization_id", org).eq("id", leadId).maybeSingle(),
    supabase.from("lead_consents").select("purpose, granted, captured_via, recorded_at").eq("organization_id", org).eq("lead_id", leadId),
    supabase
      .from("vo_crm_drafts")
      .select(DRAFT_COLUMNS)
      .eq("organization_id", org)
      .eq("lead_id", leadId)
      .eq("kind", "lead_follow_up")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    composioConfigured() && staff.membershipId
      ? supabase.from("staff_connections").select("toolkit, status").eq("organization_id", org).eq("membership_id", staff.membershipId).in("toolkit", ["gmail", "outlook"])
      : null,
  ]);
  if (!lead.data) return null;
  return leadVoView({
    organizationId: org,
    lead: { id: lead.data.id, email: lead.data.email, phone: lead.data.phone, convertedMatterId: lead.data.converted_matter_id },
    consents: (consents.data ?? []) as ConsentRow[],
    settings,
    agentReady: voAgentConfigured(),
    draft: (draft.data as VoCrmDraftRow | null) ?? null,
    mailboxes: mailboxes?.data ?? [],
  });
}

/** The consultation record's "Call notes with Vo" panel, for a Casevoya video call. */
export async function loadCallVo(
  supabase: Client,
  staff: SheetStaff,
  booking: { id: string; location_kind: string; status: string; starts_at: string; matter_id: string | null; is_sample: boolean },
  lead: { id: string; display_name: string } | null,
  now: number,
): Promise<CallNotesData | null> {
  if (booking.location_kind !== "video") return null;
  const org = staff.organizationId;
  const [settings, session, draft, matter] = await Promise.all([
    settingsFor(supabase, staff),
    supabase.from("video_sessions").select("started_at").eq("organization_id", org).eq("booking_id", booking.id).maybeSingle(),
    supabase
      .from("vo_crm_drafts")
      .select(DRAFT_COLUMNS)
      .eq("organization_id", org)
      .eq("booking_id", booking.id)
      .eq("kind", "call_summary")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    !lead && booking.matter_id ? supabase.from("matters").select("reference, title").eq("organization_id", org).eq("id", booking.matter_id).maybeSingle() : null,
  ]);
  return callVoView({
    organizationId: org,
    booking: { id: booking.id, locationKind: booking.location_kind, status: booking.status, startsAt: booking.starts_at, isSample: booking.is_sample },
    callStarted: Boolean(session.data?.started_at),
    target: { lead: lead?.display_name ?? null, matter: matter?.data ? matter.data.reference || matter.data.title : null },
    settings,
    agentReady: voAgentConfigured(),
    draft: (draft.data as VoCrmDraftRow | null) ?? null,
    now,
  });
}
