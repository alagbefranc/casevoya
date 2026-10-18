"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { isSwitchableEmailKind } from "./preferences";

/** The signed-in staff member turns one of their own switchable emails on or off. The database decides. */
export async function saveNotificationPreference(input: { organizationId: string; kind: string; email: boolean }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  if (!isSwitchableEmailKind(input.kind)) return { error: "That email can’t be turned off." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("set_staff_notification_preference", {
    p_organization_id: input.organizationId,
    p_kind: input.kind,
    p_email: input.email === true,
  });
  if (error) return { error: /turned off/.test(error.message) ? "That email can’t be turned off." : "Only staff of this firm, signed in with two-step verification, can change this." };
  return { ok: true };
}
