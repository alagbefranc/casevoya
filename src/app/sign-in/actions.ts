"use server";

import { redirect } from "next/navigation";
import { safeRedirect } from "@/lib/auth/redirect";
import { appOrigin } from "@/lib/email/env";
import { authEmailGate, resolveAuthAttempt } from "@/lib/security/auth-attempts";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeRedirect(formData.get("next"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`/sign-in?error=invalid_email&next=${encodeURIComponent(next)}`);
  }

  const emailGate = await authEmailGate(email);
  if (!emailGate.allowed) {
    redirect(`/sign-in?error=rate_limited&next=${encodeURIComponent(next)}`);
  }

  // The emailed link uses the configured app origin, never a request header.
  const origin = appOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      // Sign-in only: accounts are created by sign-up and invitations, never by a magic link.
      shouldCreateUser: false,
    },
  });
  // Only a link that was sent counts toward the recipient's hourly limit.
  await resolveAuthAttempt(emailGate, !error);
  if (error) {
    redirect(`/sign-in?error=send_failed&next=${encodeURIComponent(next)}`);
  }
  redirect(`/sign-in?sent=1`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
