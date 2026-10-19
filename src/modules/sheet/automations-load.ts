import "server-only";
import type { AutomationsTab } from "@/components/sheet/designer/automations";
import { createClient } from "@/lib/supabase/server";
import { automationsData, quietHours, reminderDays, type ReminderRun } from "@/modules/sheet/automations-present";
import { loadSheetChrome, matterNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";

/** The Designer's Automations page for a firm, read as the signed-in staff member (RLS). Read only. */
export async function loadSheetAutomations(staff: SheetStaff, tab: AutomationsTab, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, offsets, proposed, firm, schedules] = await Promise.all([
    loadSheetChrome(staff, "/sheet/automations"),
    supabase.from("firm_reminder_offsets").select("offset_days").eq("organization_id", org),
    supabase.from("product_settings").select("value").eq("key", "reminders.proposed_offsets").maybeSingle(),
    supabase.from("organizations").select("quiet_hours_start, quiet_hours_end").eq("id", org).maybeSingle(),
    supabase
      .from("reminder_schedules")
      .select("deadline_id, task_id, offset_days, reminder_kind, status, scheduled_for, sent_at, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const rows = schedules.data ?? [];
  const deadlineIds = [...new Set(rows.map((row) => row.deadline_id).filter((id): id is string => Boolean(id)))];
  const deadlines = deadlineIds.length ? await supabase.from("deadlines").select("id, matter_id, label, due_on").in("id", deadlineIds) : null;
  const matterOf = new Map((deadlines?.data ?? []).map((row) => [row.id, row.matter_id]));
  const deadlineOf = new Map((deadlines?.data ?? []).map((row) => [row.id, { label: row.label, dueOn: row.due_on }]));
  const matterIds = [...new Set([...matterOf.values()])];
  const [name, matters] = await Promise.all([
    matterNames(supabase, org, matterIds),
    matterIds.length ? supabase.from("matters").select("id, reference").in("id", matterIds) : null,
  ]);
  const referenceOf = new Map((matters?.data ?? []).map((row) => [row.id, row.reference]));
  const runs: ReminderRun[] = rows.map((row) => {
    const matter = row.deadline_id ? (matterOf.get(row.deadline_id) ?? null) : null;
    return {
      status: row.status,
      kind: row.reminder_kind,
      offsetDays: row.offset_days,
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      createdAt: row.created_at,
      matterName: matter ? name(matter) : "Task reminder",
      reference: matter ? (referenceOf.get(matter) ?? null) : null,
      deadline: row.deadline_id ? (deadlineOf.get(row.deadline_id) ?? null) : null,
      matterId: matter,
    };
  });
  const { days, firmSet } = reminderDays((offsets.data ?? []).map((row) => row.offset_days), proposed.data?.value ?? null);
  const data = automationsData({
    tab,
    days,
    firmSet,
    quiet: quietHours(firm.data?.quiet_hours_start ?? null, firm.data?.quiet_hours_end ?? null),
    runs,
    now,
    timeZone: staff.timezone,
    editable: staff.role === "firm_owner",
  });
  const dialog =
    staff.role === "firm_owner"
      ? {
          organizationId: org,
          days: days.join(", "),
          quietStart: (firm.data?.quiet_hours_start ?? "").slice(0, 5),
          quietEnd: (firm.data?.quiet_hours_end ?? "").slice(0, 5),
        }
      : null;
  return { chrome, data, dialog };
}
