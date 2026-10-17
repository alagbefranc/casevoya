"use server";

import type { Json } from "@/types/database.types";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { passwordOk } from "@/lib/auth/password";
import { safeNext } from "@/lib/auth/redirect";
import { firmSlug } from "@/lib/auth/slug";
import { isInvitationToken } from "@/lib/auth/invitations";
import { createClient } from "@/lib/supabase/server";

export type PortResult =
  | { ok: true; href?: string; codes?: string[] }
  | { ok: false; state?: "error" | "locked"; message: string };

const STEPS = [
  "firm_details",
  "terms_and_privacy",
  "jurisdictions",
  "licence",
  "branding",
  "calendar_and_payments",
  "records_and_retention",
  "sample_case",
] as const;

const JURISDICTIONS: Record<string, string> = {
  j0: "CA",
  j1: "CA-ON",
  j2: "CA-BC",
  j3: "CA-AB",
  j4: "CA-MB",
  j5: "CA-SK",
  j6: "CA-NS",
  j7: "CA-QC",
};

function fail(message: string, state?: "error" | "locked"): PortResult {
  return { ok: false, message, state };
}

function lockedMessage(message: string) {
  return /rate|too many|locked|429/i.test(message);
}

export async function getAuthContext() {
  if (!hasPublicSupabaseEnv()) {
    return { configured: false, signedIn: false, factorId: null as string | null, assured: false, email: null as string | null };
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!data?.claims?.sub) return { configured: true, signedIn: false, factorId: null, assured: false, email };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = factors?.all.find((factor) => factor.factor_type === "totp" && factor.status === "verified")?.id ?? null;
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  let assured = level?.currentLevel === "aal2";
  if (!assured) {
    const { data: satisfied, error } = await supabase.rpc("session_mfa_satisfied");
    if (!error && satisfied === true) assured = true;
  }
  return { configured: true, signedIn: true, factorId, assured, email };
}

export async function signInWithPassword(email: string, password: string, next: string): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const clean = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || !password) {
    return fail("Email or password didn’t match", "error");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: clean, password });
  if (error) {
    return lockedMessage(error.message) ? fail(error.message, "locked") : fail("Email or password didn’t match", "error");
  }
  const dest = safeNext(next, "/app");
  return { ok: true, href: `/mfa?next=${encodeURIComponent(dest)}` };
}

export async function sendRecoveryEmail(email: string): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const clean = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return fail("Enter the email you use for Casevoya");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: false },
  });
  if (error) return fail("We couldn’t send a code to that email.");
  return { ok: true };
}

export async function verifyEmailCode(email: string, code: string, purpose: "recovery" | "signup"): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!/^\d{6}$/.test(code)) return fail("That code didn’t match.");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code,
    type: purpose === "signup" ? "signup" : "email",
  });
  if (error) return fail("That code didn’t match.");
  return { ok: true };
}

export async function updatePassword(password: string, signOutElsewhere: boolean): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!passwordOk(password)) return fail("Choose a password that meets all three rules");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return fail("Request a new code, then choose a password.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail("That password could not be saved.");
  if (signOutElsewhere) await supabase.rpc("revoke_other_sessions");
  return { ok: true, href: "/sign-in" };
}

export async function requestMfaReset(reason: string): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return fail("Sign in before sending this request. It is not stored otherwise.");
  const { error } = await supabase.rpc("request_mfa_reset", { p_reason: reason.slice(0, 2000) });
  if (error) return fail("The request could not be recorded.");
  return { ok: true };
}

export async function signUpForTrial(input: {
  name: string;
  email: string;
  password: string;
}): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const email = input.email.trim();
  const name = input.name.trim().slice(0, 200);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !passwordOk(input.password)) {
    return fail("Check your name, email and password.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: { data: { display_name: name } },
  });
  if (error) return lockedMessage(error.message) ? fail(error.message, "locked") : fail(error.message);
  if (!data.session) return { ok: true };
  return { ok: true };
}

export async function createTrialFirm(input: { firmName: string; sampleMode: boolean }): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const name = input.firmName.trim().slice(0, 200);
  if (!name) return fail("Enter your firm’s name.");
  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx.signedIn) return fail("Confirm your email before setting up the firm.");
  if (!ctx.assured) return { ok: true, href: "/mfa?step=2&next=/setup" };
  const slug = firmSlug(name);
  const { data, error } = await supabase.rpc("create_organization", {
    legal_name: name,
    display_name: name,
    slug,
  });
  if (error) {
    if (/mfa|aal2/i.test(error.message)) return { ok: true, href: "/mfa?step=2&next=/setup" };
    if (/duplicate|already/i.test(error.message)) return { ok: true, href: "/setup" };
    return fail("The firm could not be created.");
  }
  const orgId = data && "id" in data ? data.id : null;
  if (orgId) {
    await supabase
      .from("firm_onboarding")
      .update({ sample_mode: input.sampleMode, details: { firm_name: name, sample_seeded: false } })
      .eq("organization_id", orgId);
  }
  return { ok: true, href: "/setup" };
}

export async function saveSetupStep(
  stepIndex: number,
  fields: Record<string, string | boolean>,
): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const step = STEPS[stepIndex];
  if (!step) return fail("That step is not part of firm setup.");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return nullResult();
  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", claims.claims.sub)
    .eq("role", "firm_owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) return fail("Firm setup is available to a firm owner with two-step sign-in.");

  const orgPatch: {
    legal_name?: string;
    display_name?: string;
    timezone?: string;
    default_locale?: "en-CA" | "fr-CA";
    jurisdiction_codes?: string[];
  } = {};
  if (typeof fields.ln === "string" && fields.ln.trim()) orgPatch.legal_name = fields.ln.trim().slice(0, 300);
  if (typeof fields.dn === "string" && fields.dn.trim()) orgPatch.display_name = fields.dn.trim().slice(0, 200);
  if (typeof fields.tz === "string" && fields.tz.startsWith("America/")) {
    orgPatch.timezone = fields.tz.split(" ")[0] ?? fields.tz;
  }
  if (fields.lc === "Français") orgPatch.default_locale = "fr-CA";
  else if (typeof fields.lc === "string") orgPatch.default_locale = "en-CA";
  const codes = Object.entries(JURISDICTIONS)
    .filter(([id]) => fields[id] === true)
    .map(([, code]) => code);
  if (codes.length) orgPatch.jurisdiction_codes = codes;
  if (Object.keys(orgPatch).length) {
    const { error } = await supabase.from("organizations").update(orgPatch).eq("id", membership.organization_id);
    if (error) return fail("Those firm details could not be saved.");
  }

  const { data: existing } = await supabase
    .from("firm_onboarding")
    .select("details, completed_steps")
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  const prior =
    existing?.details && typeof existing.details === "object" && !Array.isArray(existing.details)
      ? (existing.details as Record<string, Json>)
      : {};
  const completed = new Set(existing?.completed_steps ?? []);
  completed.add(step);
  const next = STEPS[Math.min(STEPS.length - 1, stepIndex + 1)];
  const { error } = await supabase
    .from("firm_onboarding")
    .update({
      current_step: next,
      completed_steps: [...completed],
      details: {
        ...prior,
        [step]: fields,
        proof_stored: false,
        calendar_connected: false,
        payments_connected: false,
      } as Json,
    })
    .eq("organization_id", membership.organization_id);
  if (error) return fail("Setup progress could not be saved.");
  return { ok: true };
}

export async function verifyTotpCode(factorId: string, code: string): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!/^[0-9a-f-]{36}$/i.test(factorId) || !/^\d{6}$/.test(code)) return fail("That code didn’t match.");
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return fail("That code didn’t match.");
  return { ok: true };
}

export async function enrollAuthenticator() {
  if (!hasPublicSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Casevoya",
    issuer: "Casevoya",
  });
  if (error || !data || data.type !== "totp") return null;
  const qr = data.totp.qr_code.startsWith("data:")
    ? data.totp.qr_code
    : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  return { factorId: data.id, secret: data.totp.secret, qr };
}

export async function issueRecoveryCodes(): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_recovery_codes");
  if (error || !data) return fail("Recovery codes could not be created.");
  return { ok: true, codes: data };
}

export async function redeemRecovery(code: string): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const clean = code.trim();
  if (!/^[A-Za-z0-9-]{8,32}$/.test(clean)) return fail("That recovery code was not accepted.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_recovery_code", { p_code: clean });
  if (error || data !== true) return fail("That recovery code was not accepted.");
  return { ok: true };
}

export async function joinStaffInvite(input: {
  token: string;
  name: string;
  email: string;
  password: string;
}): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!isInvitationToken(input.token)) return fail("That invitation link is not valid.");
  if (!passwordOk(input.password)) return fail("Choose a password that meets all three rules");
  const supabase = await createClient();
  const { data: preview, error: previewError } = await supabase.rpc("preview_invitation", { p_token: input.token });
  const row = preview?.[0];
  if (previewError || !row || row.status !== "valid") {
    return fail("This invitation cannot be accepted.");
  }
  if (row.email && input.email.trim().toLowerCase() !== row.email) {
    return fail("Use the email address this invitation was sent to.");
  }
  let { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    const signedUp = await supabase.auth.signUp({
      email: row.email ?? input.email.trim(),
      password: input.password,
      options: { data: { display_name: input.name.trim().slice(0, 200) } },
    });
    if (signedUp.error && !/already/i.test(signedUp.error.message)) return fail(signedUp.error.message);
    if (!signedUp.data.session) {
      const signedIn = await supabase.auth.signInWithPassword({
        email: row.email ?? input.email.trim(),
        password: input.password,
      });
      if (signedIn.error) return fail("Confirm your email, then open this invitation again.");
    }
    claims = (await supabase.auth.getClaims()).data;
  }
  const ctx = await getAuthContext();
  const next = `/invite/${input.token}`;
  if (!ctx.assured) return { ok: true, href: `/mfa?step=2&next=${encodeURIComponent(next)}` };
  const { error } = await supabase.rpc("accept_invitation", { token: input.token });
  if (error) {
    if (/aal2/i.test(error.message)) return { ok: true, href: `/mfa?step=2&next=${encodeURIComponent(next)}` };
    return fail("This invitation cannot be accepted.");
  }
  return { ok: true, href: "/app" };
}

export async function previewStaffInvite(token: string) {
  if (!hasPublicSupabaseEnv() || !isInvitationToken(token)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_invitation", { p_token: token });
  if (error || !data?.[0]) return null;
  return data[0];
}

/** No backend in this environment: the screen keeps the prototype path. */
function nullResult(): null {
  return null;
}
