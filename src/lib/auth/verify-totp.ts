import "server-only";
import { createClient } from "@/lib/supabase/server";
import { attemptWaitMessage, recordAuthAttempt, totpGate } from "@/lib/security/auth-attempts";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function signedInUser(supabase: ServerClient): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getClaims();
    return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a current TOTP code and refreshes the session to aal2 with a new amr timestamp.
 * Limited per address and per user (RL_VERIFY), and 5 failures per user in 15 minutes.
 */
export async function verifyTotpCode(
  supabase: ServerClient,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  }
  const userId = await signedInUser(supabase);
  const gate = await totpGate(userId);
  if (!gate.allowed) return { ok: false, error: attemptWaitMessage(gate.retryAfterSeconds) };
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError || !factors) {
    return { ok: false, error: "The authenticator could not be checked. Try again." };
  }
  const factor = factors.totp.find((item) => item.status === "verified");
  if (!factor) return { ok: false, error: "Set up an authenticator app first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: normalized });
  if (error) {
    if (userId) await recordAuthAttempt("totp", userId, true);
    return { ok: false, error: "That code was not accepted." };
  }
  return { ok: true };
}
