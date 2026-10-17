import "server-only";
import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Verifies a current TOTP code and refreshes the session to aal2 with a new amr timestamp. */
export async function verifyTotpCode(
  supabase: ServerClient,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
  }
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError || !factors) {
    return { ok: false, error: "The authenticator could not be checked. Try again." };
  }
  const factor = factors.totp.find((item) => item.status === "verified");
  if (!factor) return { ok: false, error: "Set up an authenticator app first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: normalized });
  if (error) return { ok: false, error: "That code was not accepted." };
  return { ok: true };
}
