import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { IssuerRow } from "@/modules/government/letters";
import type { LetterTaskRow } from "@/modules/sheet/letter-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

type Client = Awaited<ReturnType<typeof createClient>>;

const ISSUER_COLUMNS =
  "id, name, source_url, checked_on, retrieved_at, snapshot_sha256, page_modified_on, name_on_page, status, review_note, reviewed_at, version";

export type LetterExtras = {
  letterTasks: LetterTaskRow[];
  issuers: IssuerRow[];
  /** Client names for the client tasks (person id to name). */
  people: Map<string, string>;
  /** Files from emails filed to this matter (OPS-06), stored and cleared, not left out. */
  filed: { versionId: string; filename: string; subject: string | null; receivedOn: string }[];
};

/**
 * GOV-04 records for one matter, read as the signed-in member (row-level security decides): the
 * tasks each letter created, the firm's issuer list, and the files of emails filed to the matter.
 * A read that fails leaves its part empty; nothing is made up.
 */
export async function loadLetterExtras(supabase: Client, org: string, matterId: string, letterIds: readonly string[], timezone: string): Promise<LetterExtras> {
  const [links, issuers, items] = await Promise.all([
    letterIds.length
      ? supabase.from("correspondence_work_links").select("correspondence_id, task_id").eq("organization_id", org).in("correspondence_id", [...letterIds]).not("task_id", "is", null)
      : null,
    supabase.from("government_issuers").select(ISSUER_COLUMNS).eq("organization_id", org).order("name").limit(200),
    supabase
      .from("inbound_inbox_items")
      .select("assigned_version_id, filename, inbound_email_id, created_at")
      .eq("organization_id", org)
      .eq("matter_id", matterId)
      .eq("upload_state", "clean")
      .is("skipped_at", null)
      .not("assigned_version_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const taskIds = (links?.data ?? []).map((row) => row.task_id).filter((id): id is string => Boolean(id));
  const emailIds = [...new Set((items.data ?? []).map((row) => row.inbound_email_id))];
  const [tasks, emails] = await Promise.all([
    taskIds.length
      ? supabase.from("tasks").select("id, title, audience, status, due_on, owner_membership_id, owner_person_id").eq("organization_id", org).in("id", taskIds)
      : null,
    emailIds.length ? supabase.from("inbound_emails").select("id, subject, created_at").eq("organization_id", org).in("id", emailIds) : null,
  ]);
  const taskById = new Map((tasks?.data ?? []).map((row) => [row.id, row]));
  const letterTasks: LetterTaskRow[] = [];
  for (const link of links?.data ?? []) {
    const task = link.task_id ? taskById.get(link.task_id) : undefined;
    if (task) letterTasks.push({ correspondence_id: link.correspondence_id, ...task });
  }
  const personIds = [...new Set(letterTasks.map((row) => row.owner_person_id).filter((id): id is string => Boolean(id)))];
  const persons = personIds.length ? await supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null;
  const email = new Map((emails?.data ?? []).map((row) => [row.id, row]));
  return {
    letterTasks,
    issuers: (issuers.data ?? []) as IssuerRow[],
    people: new Map((persons?.data ?? []).map((row) => [row.id, row.display_name])),
    filed: (items.data ?? []).flatMap((row) =>
      row.assigned_version_id
        ? [
            {
              versionId: row.assigned_version_id,
              filename: row.filename,
              subject: email.get(row.inbound_email_id)?.subject ?? null,
              receivedOn: isoDateInTimeZone(new Date(email.get(row.inbound_email_id)?.created_at ?? row.created_at), timezone),
            },
          ]
        : [],
    ),
  };
}
