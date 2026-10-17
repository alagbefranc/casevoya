"use server";

import type { Json } from "@/types/database.types";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { passwordOk } from "@/lib/auth/password";
import { safeAccessError } from "@/lib/auth/step-up";
import { safeNext } from "@/lib/auth/redirect";
import { clearPendingTotp, readPendingTotp, writePendingTotp, type PendingTotp } from "@/lib/auth/mfa-pending";
import { firmSlug } from "@/lib/auth/slug";
import { syncClaimedFirmSlug } from "@/modules/email/sync-routing";
import { isInvitationToken } from "@/lib/auth/invitations";
import {
  firmSetupDbPayload,
  firmSetupPayloadSchema,
  jurisdictionCodesFromFields,
  normalizeCollegeId,
} from "@/modules/firm-onboarding";
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

function fail(message: string, state?: "error" | "locked"): PortResult {
  return { ok: false, message, state };
}

function lockedMessage(message: string) {
  return /rate|too many|locked|429/i.test(message);
}

function fromRpc(error: { message: string }): PortResult {
  if (/step-up|aal2/i.test(error.message)) return { ok: true, href: "/mfa?step=2&next=/setup" };
  if (/sample mode stays on/i.test(error.message)) {
    return fail("Sample mode stays on until real client invitations unlock.");
  }
  if (/declare a consultant licence/i.test(error.message)) {
    return fail("Declare a consultant licence before completing this step.");
  }
  if (/licence declaration denied/i.test(error.message)) {
    return fail("A licence is recorded on a licensed consultant membership, separate from this login.");
  }
  if (/college id is not usable/i.test(error.message)) {
    return fail("Enter the College ID using letters, digits, or hyphens.");
  }
  if (/add the main office/i.test(error.message)) return fail("Add the main office before completing firm details.");
  if (/choose at least one jurisdiction/i.test(error.message)) return fail("Choose at least one place you practise.");
  return fail(safeAccessError(error.message));
}

function text(fields: Record<string, string | boolean>, id: string) {
  const value = fields[id];
  return typeof value === "string" ? value.trim() : "";
}

/** One address line on the firm-details screen. The office function stores the pieces separately. */
function officeParts(raw: string) {
  const postal = raw.match(/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/i)?.[0]?.toUpperCase().replace("-", " ") ?? "";
  const region = raw.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/)?.[1] ?? "";
  let rest = raw;
  if (postal) rest = rest.replace(new RegExp(postal.replace(/\s+/g, "\\s*"), "i"), " ");
  if (region) rest = rest.replace(new RegExp(`\\b${region}\\b`), " ");
  const bits = rest.split(",").map((part) => part.trim()).filter(Boolean);
  const locality = (bits.at(-1) || raw).slice(0, 120);
  const addressLine = (bits.length > 1 ? bits.slice(0, -1).join(", ") : raw).slice(0, 300);
  return { addressLine, locality, region, postal };
}

async function ownerWorkspace() {
  const lookup = await createClient();
  const { data: claims } = await lookup.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data: membership } = await lookup
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "firm_owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  return {
    organizationId: membership.organization_id,
    supabase: await createClient({ organizationId: membership.organization_id }),
  };
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
  if (!data?.id) return fail("The firm could not be created.");
  await syncClaimedFirmSlug(data.slug || slug);
  const workspace = await createClient({ organizationId: data.id });
  const { error: modeError } = await workspace.rpc("set_sample_mode", { p_enabled: input.sampleMode });
  if (modeError) return fromRpc(modeError);
  const { error: trialError } = await workspace.rpc("sync_trial_status");
  if (trialError) return fromRpc(trialError);
  return { ok: true, href: "/setup" };
}

export async function saveSetupStep(
  stepIndex: number,
  fields: Record<string, string | boolean>,
): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const step = STEPS[stepIndex];
  if (!step) return fail("That step is not part of firm setup.");
  const workspace = await ownerWorkspace();
  if (!workspace) return fail("Firm setup is available to a firm owner with two-step sign-in.");
  const { supabase, organizationId } = workspace;

  if (step === "firm_details") {
    const office = officeParts(text(fields, "ad"));
    const { error: officeError } = await supabase.rpc("save_organization_office", {
      p_label: "Main office",
      p_address_line: office.addressLine,
      p_locality: office.locality,
      p_region: office.region,
      p_postal_code: office.postal,
      p_country_code: "CA",
      p_is_primary: true,
    });
    if (officeError) return fromRpc(officeError);
  }

  if (step === "licence" && text(fields, "rg").includes("CICC")) {
    const collegeId = normalizeCollegeId(text(fields, "lno")) ?? text(fields, "lno");
    const { data: consultants } = await supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("role", "licensed_consultant")
      .eq("status", "active")
      .limit(1);
    const membershipId = consultants?.[0]?.id;
    if (membershipId) {
      const { error: declared } = await supabase.rpc("declare_consultant_credential", {
        p_membership_id: membershipId,
        p_licence_type: "RCIC",
        p_college_id: collegeId,
        p_scope_note: text(fields, "cl").includes("IRB") ? "RCIC-IRB" : "",
        p_proof_locator: "CICC register entry.pdf",
      });
      if (declared) return fromRpc(declared);
    }
  }

  const locale = text(fields, "lc").startsWith("Fran") ? "fr-CA" : "en-CA";
  const years = Number.parseInt(text(fields, "retention_years"), 10);
  const accent = text(fields, "brand");
  const draft = {
    firm_details: {
      step,
      legalName: text(fields, "ln"),
      displayName: text(fields, "dn"),
      locale,
      timezone: text(fields, "tz").split(" ")[0] ?? "",
      billingContactName: text(fields, "bc"),
      billingContactEmail: text(fields, "be"),
    },
    terms_and_privacy: {
      step,
      subscriptionTermsAccepted: fields.t1 === true,
      dpaAccepted: fields.t2 === true,
      privacyContactName: text(fields, "pc"),
      privacyContactEmail: text(fields, "pe"),
      dpaVersion: "2026-10-17",
      subscriptionTermsVersion: "2026-10-17",
    },
    jurisdictions: { step, codes: jurisdictionCodesFromFields(fields) },
    licence: { step },
    branding: {
      step,
      acknowledged: true,
      ...(accent && /^#[0-9A-Fa-f]{6}$/.test(accent) ? { accent } : {}),
    },
    calendar_and_payments: { step, acknowledged: true },
    records_and_retention: { step, unit: "years" as const, count: years },
    sample_case: { step, acknowledged: true },
  }[step];

  const parsed = firmSetupPayloadSchema.safeParse(draft);
  if (!parsed.success) return fail("That setup step is incomplete.");
  const { error } = await supabase.rpc("save_firm_setup", {
    p_step: parsed.data.step,
    p_payload: firmSetupDbPayload(parsed.data) as Json,
  });
  if (error) return fromRpc(error);

  if (step === "sample_case") {
    const { error: trialError } = await supabase.rpc("sync_trial_status");
    if (trialError) return fromRpc(trialError);
    const { error: gateError } = await supabase.rpc("evaluate_real_client_invites", {
      p_organization_id: organizationId,
    });
    if (gateError) return fromRpc(gateError);
    if (typeof fields.sample_mode === "boolean") {
      const { error: modeError } = await supabase.rpc("set_sample_mode", { p_enabled: fields.sample_mode });
      if (modeError) return fromRpc(modeError);
    }
    return { ok: true, href: "/sheet/sample-mode" };
  }
  return { ok: true };
}

export async function verifyTotpCode(factorId: string, code: string): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!/^[0-9a-f-]{36}$/i.test(factorId) || !/^\d{6}$/.test(code)) return fail("That code didn’t match.");
  const supabase = await createClient();
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error || !challenge.data) return fail("That code didn’t match.");
  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verified.error) return fail("That code didn’t match.");
  await clearPendingTotp();
  return { ok: true };
}

/**
 * Starts authenticator setup once. A reload or a second tab gets the same
 * pending factor back, so a QR already scanned keeps working.
 */
export async function enrollAuthenticator(): Promise<PendingTotp | null> {
  if (!hasPublicSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = (factors?.all ?? []).filter((factor) => factor.factor_type === "totp");
  if (totp.some((factor) => factor.status === "verified")) return null;
  const pending = await readPendingTotp();
  if (pending && totp.some((factor) => factor.id === pending.factorId)) return pending;
  // Unconfirmed setups from an expired or lost page. Supabase refuses a second factor with the same name.
  for (const factor of totp) await supabase.auth.mfa.unenroll({ factorId: factor.id });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Casevoya",
    issuer: "Casevoya",
  });
  if (error || !data || data.type !== "totp") return null;
  const qr = data.totp.qr_code.startsWith("data:")
    ? data.totp.qr_code
    : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  const started = { factorId: data.id, secret: data.totp.secret, qr };
  await writePendingTotp(started);
  return started;
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

/** No backend in this environment: the screen keeps its current path. */
function nullResult(): null {
  return null;
}
