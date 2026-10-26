"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/**
 * ADM-04: a staff member dismisses a service notice's banner for themselves, in the firm in use.
 * public.dismiss_service_notice checks staff, two-step and that the notice reaches the firm, and
 * audits it. The notice stays in the firm's history.
 */
export async function dismissServiceNotice(input: { organizationId: string; noticeId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.noticeId)) return { error: "Reload the page and try again." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("dismiss_service_notice", { p_notice_id: input.noticeId });
  if (error) return { error: /not found/i.test(error.message) ? "This notice is no longer available." : safeAccessError(error.message) };
  return { ok: true };
}
