"use server";

import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/redirect";
import { recordAuthAttempt, totpGate } from "@/lib/security/auth-attempts";
import { createClient } from "@/lib/supabase/server";

export type EnrollState =
  | { factorId: string; secret: string; qr: string }
  | { error: string }
  | null;

function mfaPath(next: string, error?: string) {
  const params = new URLSearchParams();
  if (next !== "/app") params.set("next", next);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/mfa?${query}` : "/mfa";
}

export async function enrollTotp(): Promise<EnrollState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in before setting up an authenticator app." };

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Casevoya",
    issuer: "Casevoya",
  });
  if (error || !data || data.type !== "totp") {
    return { error: "The authenticator could not be started. Try again." };
  }
  const qr = data.totp.qr_code.startsWith("data:")
    ? data.totp.qr_code
    : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  return { factorId: data.id, secret: data.totp.secret, qr };
}

export async function verifyTotp(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(factorId) || !/^\d{6}$/.test(code)) {
    redirect(mfaPath(next, "invalid_code"));
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/sign-in?next=${encodeURIComponent(mfaPath(next))}`);
  const userId = claims.claims.sub;
  if (!(await totpGate(userId)).allowed) redirect(mfaPath(next, "rate_limited"));

  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error || !challenge.data) redirect(mfaPath(next, "verify_failed"));
  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verified.error) {
    await recordAuthAttempt("totp", userId, true);
    redirect(mfaPath(next, "verify_failed"));
  }
  redirect(next);
}

/** Redeems one app recovery code for this session. The code is not written to logs. */
export async function redeemRecoveryCode(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const code = String(formData.get("code") ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,32}$/.test(code)) redirect(mfaPath(next, "invalid_recovery"));

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/sign-in?next=${encodeURIComponent(mfaPath(next))}`);

  const { data, error } = await supabase.rpc("consume_recovery_code", { p_code: code });
  if (error || data !== true) redirect(mfaPath(next, "recovery_failed"));
  redirect(next);
}
