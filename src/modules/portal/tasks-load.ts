import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "@/modules/portal/load";

export type PortalTask = {
  id: string;
  title: string;
  status: "open" | "blocked" | "done";
  dueOn: string | null;
  completedAt: string | null;
  blockerNote: string | null;
  /** The intake form this task asks for (intake_requests), opened from the task. */
  intakeResponseId: string | null;
};

/**
 * The signed-in person's own client tasks (row-level security: a client task is read by the person
 * it is for and by staff on the matter). Cancelled tasks are left out.
 */
export async function loadPortalTasks(viewer: PortalViewer): Promise<PortalTask[]> {
  const personId = viewer.person?.id;
  if (!personId) return [];
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, due_on, completed_at, blocker_note")
    .eq("organization_id", viewer.organizationId)
    .eq("audience", "client")
    .eq("owner_person_id", personId)
    .in("status", ["open", "blocked", "done"])
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(100);
  const rows = tasks ?? [];
  const ids = rows.map((row) => row.id);
  const { data: requests } = ids.length
    ? await supabase.from("intake_requests").select("task_id, response_id").in("task_id", ids)
    : { data: [] as { task_id: string | null; response_id: string }[] };
  const intake = new Map((requests ?? []).filter((row) => row.task_id).map((row) => [row.task_id as string, row.response_id]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status === "done" ? "done" : row.status === "blocked" ? "blocked" : "open",
    dueOn: row.due_on,
    completedAt: row.completed_at,
    blockerNote: row.blocker_note,
    intakeResponseId: intake.get(row.id) ?? null,
  }));
}

/** The count of open client tasks for the signed-in person (the portal's Tasks badge). */
export async function countPortalTasks(viewer: PortalViewer): Promise<number> {
  const personId = viewer.person?.id;
  if (!personId) return 0;
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", viewer.organizationId)
    .eq("audience", "client")
    .eq("owner_person_id", personId)
    .in("status", ["open", "blocked"]);
  return count ?? 0;
}
