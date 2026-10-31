import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Lost two-step device (20261102100100): after a reset request is approved in the database,
 * removes the person's second factors with the Supabase Auth admin API (server only, service
 * role), then public.complete_mfa_reset removes anything left (passkeys, sessions), stamps the
 * request and audits it. At their next sign-in the person is sent to /mfa to set up two-step.
 */
export async function clearResetFactors(requestId: string, userId: string): Promise<{ ok: boolean; removed: number }> {
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: false, removed: 0 };
  const admin = createServiceClient();
  let removed = 0;
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return { ok: false, removed };
  for (const factor of data?.factors ?? []) {
    const deleted = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleted.error) return { ok: false, removed };
    removed += 1;
  }
  const done = await admin.rpc("complete_mfa_reset", { p_id: requestId, p_factors_removed: removed });
  return { ok: !done.error, removed };
}
