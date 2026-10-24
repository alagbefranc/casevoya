import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { voAgentConfigured } from "@/modules/vo/agent-client";
import { effectiveSettings } from "@/modules/sheet/vo-present";
import { lettersDialogs, lettersRbar, voLetterCard, type LetterRow, type LetterVersionRow, type LettersViewer } from "@/modules/sheet/letters-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** public.create_matter_letter and the letter functions accept these roles. */
const LETTER_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);

const LETTER_COLUMNS =
  "id, letter_type, title, origin, status, current_version, approved_version, approved_by_membership_id, approved_at, approved_self, created_at, updated_at, version, is_sample";
const VERSION_COLUMNS = "letter_id, version_number, title, body, facts, official, left_out, origin, created_by, created_at";

/**
 * AI-01: one matter's letters, read as the signed-in member (row-level security: staff who can
 * read the matter's messages; nobody else gets rows). Whether "Draft letter with Vo" shows comes
 * from the firm's Vo switches (Vo on and its letter switch on); "New letter" always works for the
 * roles that write letters. Null for anyone else, so the section stays out of their page.
 */
export async function loadMatterLetters(
  supabase: Client,
  input: { staff: SheetStaff; matterId: string; licensed: boolean; memberName: (membershipId: string | null) => string },
) {
  const { staff, matterId } = input;
  if (!LETTER_ROLES.has(staff.role)) return null;
  const org = staff.organizationId;
  const [settings, letters] = await Promise.all([
    supabase.from("vo_settings").select("*").eq("organization_id", org).maybeSingle(),
    supabase.from("matter_letters").select(LETTER_COLUMNS).eq("organization_id", org).eq("matter_id", matterId).order("updated_at", { ascending: false }).limit(30),
  ]);
  const rows = (letters.data ?? []) as LetterRow[];
  const versions = rows.length
    ? ((
        await supabase
          .from("matter_letter_versions")
          .select(VERSION_COLUMNS)
          .eq("organization_id", org)
          .in("letter_id", rows.map((row) => row.id))
          .order("version_number", { ascending: false })
          .limit(200)
      ).data ?? []) as LetterVersionRow[]
    : [];
  const writers = [...new Set(versions.map((row) => row.created_by))];
  const profiles = writers.length ? await supabase.from("profiles").select("id, display_name").in("id", writers) : null;
  const person = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  const vo = effectiveSettings(settings.data ?? null, staff.sampleMode);
  const viewer: LettersViewer = {
    organizationId: org,
    matterId,
    timeZone: staff.timezone,
    canWrite: true,
    licensed: input.licensed,
    vo: vo.enabled && vo.letter_drafts ? (voAgentConfigured() ? "on" : "unavailable") : "off",
  };
  const names = {
    member: (id: string | null) => (id ? input.memberName(id) : "a licensed member"),
    user: (id: string | null) => (id ? person.get(id) || "a staff member" : "a staff member"),
  };
  return {
    rbar: lettersRbar(rows, viewer),
    dialogs: lettersDialogs(rows, versions, viewer, names),
    // Vo's Assist card shows only while Vo is on (the Designer's rule); the letters stay listed.
    assist: viewer.vo === "off" ? null : voLetterCard(rows, versions, viewer),
  };
}
