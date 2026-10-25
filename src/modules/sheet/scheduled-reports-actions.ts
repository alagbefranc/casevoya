"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { scheduleError, scheduleInputError } from "@/modules/sheet/scheduled-reports-present";

/**
 * Reports > Scheduled (REP-03) actions, each as the signed-in staff member. The database decides
 * (the caller and every recipient see the tab; only who made it or the firm owner changes it) and
 * audits; these only check the shape and pass the request on.
 */
export type ScheduleResult<T = true> = { ok: T } | { error: string };

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(organizationId: string): Promise<{ supabase: Client } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") return { error: "Sign in first." };
  return { supabase };
}

function refused(message: string): { error: string } {
  return { error: scheduleError(message) ?? safeAccessError(message) };
}

export type ScheduleInput = {
  organizationId: string;
  id: string | null;
  version: number | null;
  title: string;
  tab: string;
  range: string;
  frequency: string;
  weekday: number | null;
  monthDay: number | null;
  sendTime: string;
  recipients: string[];
};

export async function saveScheduledReport(input: ScheduleInput): Promise<ScheduleResult<string>> {
  const recipients = [...new Set((input.recipients ?? []).filter((id) => isUuid(id)))];
  const invalid = scheduleInputError({ ...input, recipients });
  if (invalid) return { error: invalid };
  if (input.id !== null && !isUuid(input.id)) return { error: "Reload the page and try again." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const weekly = input.frequency === "weekly";
  const { data, error } = await session.supabase.rpc("save_scheduled_report", {
    p_organization_id: input.organizationId,
    p_schedule_id: input.id,
    p_title: input.title.trim(),
    p_tab: input.tab,
    p_range: input.range,
    p_frequency: input.frequency,
    p_weekday: weekly ? input.weekday : null,
    p_month_day: weekly ? null : input.monthDay,
    p_send_time: input.sendTime,
    p_recipients: recipients,
    p_expected_version: input.id ? input.version : null,
  });
  if (error) return refused(error.message);
  return typeof data === "string" ? { ok: data } : { error: "The schedule could not be saved." };
}

export async function pauseScheduledReport(input: { organizationId: string; id: string; paused: boolean }): Promise<ScheduleResult<boolean>> {
  if (!isUuid(input.id)) return { error: "Reload the page and try again." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("set_scheduled_report_paused", { p_schedule_id: input.id, p_paused: input.paused === true });
  if (error) return refused(error.message);
  return { ok: data === true };
}

export async function deleteScheduledReport(input: { organizationId: string; id: string }): Promise<ScheduleResult> {
  if (!isUuid(input.id)) return { error: "Reload the page and try again." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("delete_scheduled_report", { p_schedule_id: input.id });
  if (error) return refused(error.message);
  return { ok: true };
}

export async function runScheduledReportNow(input: { organizationId: string; id: string }): Promise<ScheduleResult<{ delivered: number; skipped: number }>> {
  if (!isUuid(input.id)) return { error: "Reload the page and try again." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("run_scheduled_report_now", { p_schedule_id: input.id });
  if (error) return refused(error.message);
  const row = (data ?? {}) as { delivered?: unknown; skipped?: unknown };
  return { ok: { delivered: Number(row.delivered) || 0, skipped: Number(row.skipped) || 0 } };
}
