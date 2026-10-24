import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { channelName, readChecklist, type RequirementRow } from "@/modules/submissions/present";
import { buildSubmissionChecklist, type ChecklistEvent, type ManifestFile, type ManifestHandoff } from "@/modules/sheet/matter-submissions-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const REQUIREMENT_COLUMNS =
  "id, program_key, channel, kind, label, source_url, source_section, form_number, form_modified_on, checked_on, current_to, snapshot_sha256, status, reviewed_by_membership_id, reviewed_at, review_note, version, page_attested_by_membership_id, page_attested_on";

export type SubmissionChecklistInput = {
  organizationId: string;
  matterId: string;
  role: string;
  licensed: boolean;
  timezone: string;
  today: string;
  memberName: (membershipId: string | null) => string;
  /** The open handoff, else the latest submitted one: whose manifest is shown. */
  manifestHandoff: ManifestHandoff | null;
};

/**
 * The Submissions tab's checklist (GOV-01) and manifest (GOV-03), read as the signed-in member:
 * the gates from public.submission_checklist, the firm's official steps and channel names, this
 * handoff's ticks, fee confirmation and overrides, and the pinned files.
 */
export async function loadSubmissionChecklist(supabase: Client, input: SubmissionChecklistInput) {
  const org = input.organizationId;
  const [checklist, requirements] = await Promise.all([
    supabase.rpc("submission_checklist", { p_matter_id: input.matterId }),
    supabase.from("submission_requirements").select(REQUIREMENT_COLUMNS).eq("organization_id", org).in("status", ["approved", "pending_review"]).order("created_at").limit(200),
  ]);
  const state = checklist.error ? null : readChecklist(checklist.data);
  const handoffId = state?.handoff_id ?? null;
  const manifestId = input.manifestHandoff?.manifest_pinned_at ? input.manifestHandoff.id : null;
  const [events, files] = await Promise.all([
    handoffId
      ? supabase
          .from("submission_checklist_events")
          .select("kind, item_key, ticked, note, membership_id, created_at")
          .eq("organization_id", org)
          .eq("handoff_id", handoffId)
          .order("created_at", { ascending: false })
          .limit(300)
      : null,
    manifestId
      ? supabase
          .from("submission_manifest_files")
          .select("position, file_name, file_sha256, review_state, byte_size")
          .eq("organization_id", org)
          .eq("handoff_id", manifestId)
          .order("position")
          .limit(500)
      : null,
  ]);
  const rows = (requirements.data ?? []) as RequirementRow[];
  const built = buildSubmissionChecklist({
    ...input,
    state,
    requirements: rows,
    events: (events?.data ?? []) as ChecklistEvent[],
    manifest: manifestId && input.manifestHandoff ? { handoff: input.manifestHandoff, files: (files?.data ?? []) as ManifestFile[] } : null,
  });
  return {
    ...built,
    /** Gates for Record submission: null when the checklist couldn't be read (Record stays closed). */
    blocked: state ? state.blocked : null,
    /** IRCC's official channel name for the record rows, when approved. */
    channelName: (channel: string) => channelName(channel, rows, state?.program_key ?? null).name,
  };
}
