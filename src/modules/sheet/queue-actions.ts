"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

export type QueueReassignResult = { ok: true; moved: number; refused: number } | { error: string; stepUp?: boolean };

/**
 * The Team queue's Reassign: the ticked tasks go to one staff member, each through
 * `reassign_task` (staff with MFA and a recent step-up; it checks the task, its version and that
 * the new owner is active staff, and writes the task history and outbox event). Nothing here
 * decides access.
 */
export async function reassignQueueTasks(input: { organizationId: string; membershipId: string; tasks: { id: string; version: number }[] }): Promise<QueueReassignResult> {
  if (!isUuid(input.organizationId) || !isUuid(input.membershipId)) return { error: "Choose a person." };
  const tasks = (Array.isArray(input.tasks) ? input.tasks : []).filter((task) => isUuid(task.id) && Number.isInteger(task.version) && task.version >= 1).slice(0, 50);
  if (!tasks.length) return { error: "Tick the tasks to reassign first." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { error: "Sign in first." };
  let moved = 0;
  let refused = 0;
  for (const task of tasks) {
    const { error } = await supabase.rpc("reassign_task", {
      p_task_id: task.id,
      p_expected_version: task.version,
      p_owner_membership_id: input.membershipId,
      p_owner_person_id: null,
    });
    if (!error) {
      moved++;
      continue;
    }
    if (/step-up/i.test(error.message)) return moved ? { ok: true, moved, refused: tasks.length - moved } : { error: "Confirm it’s you with your authenticator, then reassign again.", stepUp: true };
    refused++;
  }
  return { ok: true, moved, refused };
}
