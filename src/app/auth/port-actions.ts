"use server";

import { headers } from "next/headers";
import type { Json } from "@/types/database.types";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { passwordOk } from "@/lib/auth/password";
import { safeAccessError } from "@/lib/auth/step-up";
import { homeRoute } from "@/lib/auth/home-route";
import { safeNext } from "@/lib/auth/redirect";
import { clearPendingTotp, readPendingTotp, withQr, writePendingTotp, type TotpSetup } from "@/lib/auth/mfa-pending";
import { firmSlug } from "@/lib/auth/slug";
import { syncClaimedFirmSlug } from "@/modules/email/sync-routing";
import { isInvitationToken, normalizeEmail } from "@/lib/auth/invitations";
import { acceptWithClient } from "@/modules/portal-invitations/accept";
import type { PortalAcceptPayload } from "@/modules/portal-invitations/types";
import {
  firmSetupDbPayload,
  firmSetupPayloadSchema,
  jurisdictionCodesFromFields,
  normalizeCollegeId,
  signupLicence,
} from "@/modules/firm-onboarding";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DPA_AVAILABLE, DPA_VERSION } from "@/modules/firm-onboarding/legal";
import { LICENCE_PROOF_BUCKET, ownLicenceProofKey } from "@/modules/firm-onboarding/licence-proof";
import { FIRM_LOGO_BUCKET, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";
import { todayIso } from "@/modules/sheet/birth-date";
import { acceptPath } from "@/modules/sheet/portal-invite";
import { appOrigin } from "@/lib/email/env";
import { isPortalInviteRole, type PortalInviteRole } from "@/modules/portal-invitations/types";

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
  if (/licence expiry date is in the past/i.test(error.message)) {
    return fail("Enter a “Valid until” date that hasn’t passed.");
  }
  if (/college id is not usable/i.test(error.message)) {
    return fail("Enter your licence number as it appears on the public register, using letters, digits or hyphens.");
  }
  if (/licence class/i.test(error.message)) return fail("Choose your licence class.");
  if (/already has a licence on file/i.test(error.message)) return fail("Your licence is already on file.");
  if (/add the main office/i.test(error.message)) return fail("Add the main office before completing firm details.");
  if (/choose at least one jurisdiction/i.test(error.message)) return fail("Choose at least one place you practise.");
  return fail(safeAccessError(error.message));
}

/** A calendar date as a date input sends it (YYYY-MM-DD), and a real one. */
function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

/**
 * The file exists in its private bucket. Licence proofs are written only by /api/firm/licence-proof
 * and firm logos only by /api/firm/logo.
 */
async function privateFileStored(bucket: string, key: string): Promise<boolean> {
  try {
    const folder = key.slice(0, key.lastIndexOf("/"));
    const name = key.slice(key.lastIndexOf("/") + 1);
    const { data } = await createServiceClient().storage.from(bucket).list(folder, { search: name, limit: 1 });
    return Boolean(data?.some((object) => object.name === name));
  } catch {
    return false;
  }
}

async function ownerWorkspace() {
  const lookup = await createClient();
  const { data: claims } = await lookup.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data: membership } = await lookup
    .from("memberships")
    .select("id, organization_id")
    .eq("user_id", userId)
    .eq("role", "firm_owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  return {
    organizationId: membership.organization_id,
    membershipId: membership.id,
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
  // Clients, sponsors and family sign in with a password only; two-step is for firm staff.
  if ((await homeRoute()) === "/portal") return { ok: true, href: portalDestination(dest) };
  return { ok: true, href: `/mfa?next=${encodeURIComponent(dest)}` };
}

/** A portal-only account goes where it asked if that is a portal page, else to its portal. */
function portalDestination(dest: string): string {
  return dest === "/portal" || dest.startsWith("/portal/") || dest.startsWith("/portal?") ? dest : "/portal";
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

async function ownsFirm(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return false;
  const { data } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "firm_owner")
    .eq("status", "active")
    .limit(1);
  return Boolean(data?.length);
}

/**
 * Creates the trial firm with the owner's CICC licence (decision 2026-10-19: only licensed
 * consultants sign up, and firms start live). public.create_firm_with_licence makes the firm, the
 * owner's membership and the declared licence together, with sample mode off. The sample case
 * stays an optional tour; `sampleMode` (the "How do you want to start?" choice) no longer changes
 * the firm.
 */
export async function createTrialFirm(input: {
  firmName: string;
  sampleMode: boolean;
  licenceNumber?: string;
  licenceClass?: string;
}): Promise<PortResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  const name = input.firmName.trim().slice(0, 200);
  if (!name) return fail("Enter your firm’s name.");
  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx.signedIn) return fail("Confirm your email before setting up the firm.");
  if (!ctx.assured) return { ok: true, href: "/mfa?step=2&next=/setup" };
  // One trial firm per sign-up: a second click, a stale tab or /setup's resume must not make another.
  if (await ownsFirm(supabase)) return { ok: true, href: "/setup" };
  // A sign-up started before the licence was asked for: the start-trial screen asks for it now.
  if (!input.licenceNumber?.trim()) return { ok: true, href: "/start-trial" };
  const licence = signupLicence(input.licenceNumber, input.licenceClass ?? "");
  if (!licence.ok) return fail(licence.message);
  const slug = firmSlug(name);
  const { data, error } = await supabase.rpc("create_firm_with_licence", {
    legal_name: name,
    display_name: name,
    slug,
    licence_type: licence.licenceType,
    college_id: licence.collegeId,
    licence_class: licence.licenceClass,
  });
  if (error) {
    if (/mfa|aal2|two-step/i.test(error.message)) return { ok: true, href: "/mfa?step=2&next=/setup" };
    if (/duplicate|already/i.test(error.message)) return { ok: true, href: "/setup" };
    if (/college id|licence class/i.test(error.message)) return fromRpc(error);
    return fail("The firm could not be created.");
  }
  if (!data?.id) return fail("The firm could not be created.");
  await syncClaimedFirmSlug(data.slug || slug);
  const workspace = await createClient({ organizationId: data.id });
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

  if (step === "licence") {
    // The owner's licence was declared at sign-up; a firm made before that declares it here. The
    // proof file is optional (decision 2026-10-19); when given it must be the one uploaded on this
    // step (see /api/firm/licence-proof).
    const typed = text(fields, "lno");
    if (typed && !text(fields, "rg").includes("CICC")) return fail("Casevoya records CICC licences.");
    const { data: existing } = await supabase
      .from("consultant_credentials")
      .select("id, college_id")
      .eq("organization_id", organizationId)
      .eq("membership_id", workspace.membershipId)
      .limit(1);
    const onFile = existing?.[0] ?? null;
    if (!onFile && !typed) return fail("Enter your licence number.");
    const collegeId = typed ? (normalizeCollegeId(typed) ?? typed) : "";
    if (onFile && typed && collegeId.toUpperCase() !== onFile.college_id) {
      return fail(`Your licence ${onFile.college_id} is on file. To change it, use “Report a change” on Licences.`);
    }
    const locator = text(fields, "lproof");
    if (locator) {
      const proofKey = ownLicenceProofKey(locator, organizationId, workspace.membershipId);
      if (!proofKey) return fail("Upload your licence proof again.");
      if (!(await privateFileStored(LICENCE_PROOF_BUCKET, proofKey))) return fail("Your licence proof wasn’t found. Upload it again.");
    }
    // "Valid until" (#ex) is optional; when given it must be a real date that hasn't passed.
    const validUntil = text(fields, "ex");
    if (validUntil && !isIsoDate(validUntil)) return fail("Enter the “Valid until” date as a full date.");
    if (validUntil) {
      // The firm's today, as app.set_credential_valid_until counts it.
      const { data: firmZone } = await supabase.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
      if (validUntil < todayIso(new Date(), firmZone?.timezone)) return fail("Enter a “Valid until” date that hasn’t passed.");
    }
    let credentialId = onFile?.id ?? null;
    if (!credentialId && locator) {
      const { data: declaredId, error: declared } = await supabase.rpc("declare_consultant_credential", {
        p_membership_id: workspace.membershipId,
        p_licence_type: "RCIC",
        p_college_id: collegeId,
        p_scope_note: text(fields, "cl").includes("IRB") ? "RCIC-IRB" : "",
        p_proof_locator: locator,
      });
      if (declared) return fromRpc(declared);
      credentialId = declaredId ?? null;
    } else if (!credentialId) {
      const { data: addedId, error: added } = await supabase.rpc("add_consultant_licence", {
        p_membership_id: workspace.membershipId,
        p_licence_type: "RCIC",
        p_college_id: collegeId,
      });
      if (added) return fromRpc(added);
      credentialId = addedId ?? null;
    } else if (locator) {
      const { error: proofError } = await supabase.rpc("set_credential_proof", { p_credential_id: credentialId, p_proof_locator: locator });
      if (proofError) return fromRpc(proofError);
    }
    // Stored separately so declare_consultant_credential keeps its signature.
    if (validUntil && credentialId) {
      const { error: expiryError } = await supabase.rpc("set_credential_valid_until", {
        p_credential_id: credentialId,
        p_valid_until: validUntil,
      });
      if (expiryError) return fromRpc(expiryError);
    }
  }

  // The firm's logo, uploaded on this step (see /api/firm/logo). Saving branding replaces it, so the
  // saved logo rides in #logo too; an empty value means no logo.
  const logoLocator = step === "branding" ? text(fields, "logo") : "";
  if (logoLocator) {
    const logoKey = ownFirmLogoKey(logoLocator, organizationId);
    if (!logoKey) return fail("Upload your logo again.");
    if (!(await privateFileStored(FIRM_LOGO_BUCKET, logoKey))) return fail("Your logo wasn’t found. Upload it again.");
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
      dpaAccepted: DPA_AVAILABLE && fields.t2 === true,
      privacyContactName: text(fields, "pc"),
      privacyContactEmail: text(fields, "pe"),
      ...(DPA_AVAILABLE ? { dpaVersion: DPA_VERSION } : {}),
      subscriptionTermsVersion: "2026-10-17",
    },
    jurisdictions: { step, codes: jurisdictionCodesFromFields(fields) },
    licence: { step },
    branding: {
      step,
      acknowledged: true,
      ...(logoLocator ? { logoLocator } : {}),
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
    // Sample mode is no longer set here: firms start live (2026-10-19). Someone who chose
    // "Explore with sample data" goes to the optional tour (its page makes the sample case).
    if (fields.tour === true) return { ok: true, href: "/sheet/sample-mode" };
    return { ok: true, href: "/sheet" };
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
export async function enrollAuthenticator(): Promise<TotpSetup | null> {
  if (!hasPublicSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = (factors?.all ?? []).filter((factor) => factor.factor_type === "totp");
  if (totp.some((factor) => factor.status === "verified")) return null;
  const pending = await readPendingTotp();
  if (pending && totp.some((factor) => factor.id === pending.factorId)) return withQr(pending);
  // Unconfirmed setups from an expired or lost page. Supabase refuses a second factor with the same name.
  for (const factor of totp) await supabase.auth.mfa.unenroll({ factorId: factor.id });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Casevoya",
    issuer: "Casevoya",
  });
  if (error || !data || data.type !== "totp") return null;
  const started = { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
  await writePendingTotp(started);
  return withQr(started);
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
  // Opened on a device still signed in as someone else (often the owner who sent it, testing
  // on their own phone): end that session here so the invited person gets their own account,
  // instead of trying to accept it for the wrong person.
  const invitedEmail = (row.email ?? input.email).trim().toLowerCase();
  const signedInEmail = typeof claims?.claims?.email === "string" ? claims.claims.email.toLowerCase() : "";
  if (claims?.claims?.sub && signedInEmail !== invitedEmail) {
    await supabase.auth.signOut({ scope: "local" });
    claims = null;
  }
  if (!claims?.claims?.sub) {
    // The confirmation link brings them back to this invitation, not to the app home (where
    // someone with no firm yet is offered a new firm of their own).
    // No Origin header would make the link relative, and Supabase would send it to the Site URL.
    const origin = (await headers()).get("origin") || appOrigin();
    const signedUp = await supabase.auth.signUp({
      email: row.email ?? input.email.trim(),
      password: input.password,
      options: {
        data: { display_name: input.name.trim().slice(0, 200) },
        emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(`/invite/${input.token}`)}`,
      },
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

export type PortalJoinResult =
  | { ok: true; confirm: true }
  | { ok: true; confirm?: false; firstRequest: { purpose: string } | null }
  | { ok: false; message: string };

type PortalInvitee = { email: string; displayName: string; role: PortalInviteRole | null };

const SIGNED_IN_ELSEWHERE = "You’re signed in with a different email. Sign out, then open this invitation again.";
const WRONG_PASSWORD = "That password didn’t match the Casevoya sign-in for this email.";

function joinFail(message: string): PortalJoinResult {
  return { ok: false, message };
}

/** The invited person, from public.preview_portal_invitation; null unless the invitation is open. */
async function openPortalInvitee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  token: string,
): Promise<PortalInvitee | { error: string }> {
  const { data, error } = await supabase.rpc("preview_portal_invitation", { p_token: token });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return { error: "This invitation could not be opened." };
  const preview = data as { status?: unknown; invitee?: { email?: unknown; display_name?: unknown } | null };
  if (preview.status === "rate_limited") return { error: "Too many attempts. Wait and try again." };
  if (preview.status !== "open") return { error: "This invitation can no longer be used." };
  const email = typeof preview.invitee?.email === "string" ? normalizeEmail(preview.invitee.email) : null;
  if (!email) return { error: "This invitation can no longer be used." };
  const displayName = typeof preview.invitee?.display_name === "string" ? preview.invitee.display_name.trim().slice(0, 200) : "";
  const rawRole = (data as { role?: unknown }).role;
  const role = typeof rawRole === "string" && isPortalInviteRole(rawRole) ? rawRole : null;
  return { email, displayName, role };
}

/**
 * Where the confirmation email's link lands: /auth/confirm (which starts the session) and then
 * back on this invitation's accept screen, signed in. Without it Supabase falls back to the
 * Site URL (the app root), which drops the PKCE code and the invitation (prod test 2026-10-22).
 * The origin is APP_URL, never a request header.
 */
function portalInviteRedirect(token: string, role: PortalInviteRole | null): string {
  const next = `${acceptPath(role ?? "client")}?token=${encodeURIComponent(token)}`;
  return `${appOrigin()}/auth/confirm?next=${encodeURIComponent(next)}`;
}

type ConfirmedCheck = "signed-in" | "unconfirmed" | "wrong-password" | "locked" | "no-password" | "elsewhere";

/**
 * Whether the invitee has confirmed their email some other way (the link in the same email,
 * maybe in another tab or on another device) and can be signed in now. A session already
 * signed in as the invitee counts (the link opened in this browser); otherwise the password
 * typed on the sign-in step is tried. Supabase answers a resend for a confirmed email with a
 * silent success and a used code with "expired or invalid", so neither can tell us this.
 */
async function signedInAfterConfirm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invitee: PortalInvitee,
  password: string,
): Promise<ConfirmedCheck> {
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.sub) {
    const current = typeof claims.claims.email === "string" ? normalizeEmail(claims.claims.email) : null;
    return current === invitee.email ? "signed-in" : "elsewhere";
  }
  if (!password || password.length > 200) return "no-password";
  const { error } = await supabase.auth.signInWithPassword({ email: invitee.email, password });
  if (!error) return "signed-in";
  if (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message)) return "unconfirmed";
  if (lockedMessage(error.message)) return "locked";
  return "wrong-password";
}

/**
 * Why signedInAfterConfirm could not sign the person in, when a new code won't help: another
 * account in this browser, too many attempts, or the wrong password. Null otherwise (the email is
 * still unconfirmed, or no password was typed).
 */
function notSignedInMessage(checked: ConfirmedCheck): string | null {
  if (checked === "elsewhere") return SIGNED_IN_ELSEWHERE;
  if (checked === "locked") return "Too many attempts. Wait and try again.";
  if (checked === "wrong-password") return WRONG_PASSWORD;
  return null;
}

function passwordInput(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function acceptPayloadOk(payload: unknown): payload is PortalAcceptPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  return typeof value.portal_terms_id === "string" && typeof value.privacy_notice_id === "string";
}

/** The person's first open document request on the file, for the Done step. Null when there is none. */
async function firstOpenRequest(organizationId: string | null, personId: string | null) {
  if (!organizationId || !personId) return null;
  try {
    const supabase = await createClient({ organizationId });
    const { data } = await supabase
      .from("document_requests")
      .select("purpose")
      .eq("person_id", personId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(1);
    const purpose = data?.[0]?.purpose?.trim();
    return purpose ? { purpose: purpose.slice(0, 200) } : null;
  } catch {
    return null;
  }
}

async function acceptJoined(
  supabase: Awaited<ReturnType<typeof createClient>>,
  token: string,
  payload: PortalAcceptPayload,
): Promise<PortalJoinResult> {
  const accepted = await acceptWithClient(supabase, token, payload);
  if ("error" in accepted) return joinFail(accepted.error);
  return { ok: true, firstRequest: await firstOpenRequest(accepted.organizationId, accepted.personId) };
}

/**
 * The account step of a portal invitation (client, sponsor, family). Signs up with the invited
 * email, or signs in to an existing Casevoya account with it, then accepts the invitation.
 * When Supabase needs the email confirmed first, the result asks for the six-digit code
 * (confirmPortalInvite). Portal roles do not need two-step sign-in; staff do (joinStaffInvite).
 */
export async function joinPortalInvite(input: {
  token: string;
  mode: "create" | "existing";
  password: string;
  payload: PortalAcceptPayload;
}): Promise<PortalJoinResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!isInvitationToken(input.token)) return joinFail("That invitation link is not valid.");
  if (input.mode !== "create" && input.mode !== "existing") return joinFail("Choose how you’ll sign in.");
  if (!acceptPayloadOk(input.payload)) return joinFail("The current terms and privacy notice have to be accepted.");
  const password = typeof input.password === "string" ? input.password : "";
  if (input.mode === "create" && !passwordOk(password)) return joinFail("Choose a password that meets all three rules");
  if (input.mode === "existing" && (!password || password.length > 200)) return joinFail("Enter your Casevoya password");

  const supabase = await createClient();
  const invitee = await openPortalInvitee(supabase, input.token);
  if ("error" in invitee) return joinFail(invitee.error);

  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.sub) {
    const current = typeof claims.claims.email === "string" ? normalizeEmail(claims.claims.email) : null;
    if (current !== invitee.email) return joinFail(SIGNED_IN_ELSEWHERE);
    return acceptJoined(supabase, input.token, input.payload);
  }

  const signIn = async (): Promise<PortalJoinResult | "signed-in"> => {
    const { error } = await supabase.auth.signInWithPassword({ email: invitee.email, password });
    if (!error) return "signed-in";
    if (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message)) {
      const resent = await supabase.auth.resend({
        type: "signup",
        email: invitee.email,
        options: { emailRedirectTo: portalInviteRedirect(input.token, invitee.role) },
      });
      if (resent.error) {
        return lockedMessage(resent.error.message)
          ? joinFail("Too many codes were sent. Wait a minute, then try again.")
          : joinFail("We couldn’t send a code to this email.");
      }
      return { ok: true, confirm: true };
    }
    if (lockedMessage(error.message)) return joinFail("Too many attempts. Wait and try again.");
    return joinFail(WRONG_PASSWORD);
  };

  if (input.mode === "existing") {
    const signedIn = await signIn();
    if (signedIn !== "signed-in") return signedIn;
    return acceptJoined(supabase, input.token, input.payload);
  }

  const signedUp = await supabase.auth.signUp({
    email: invitee.email,
    password,
    options: {
      data: invitee.displayName ? { display_name: invitee.displayName } : {},
      emailRedirectTo: portalInviteRedirect(input.token, invitee.role),
    },
  });
  if (signedUp.error) {
    if (/already/i.test(signedUp.error.message) || signedUp.error.code === "user_already_exists") {
      const signedIn = await signIn();
      if (signedIn !== "signed-in") {
        return signedIn.ok
          ? signedIn
          : joinFail("This email already has a Casevoya sign-in. Choose “Already have a Casevoya sign-in?” and use that password.");
      }
      return acceptJoined(supabase, input.token, input.payload);
    }
    if (lockedMessage(signedUp.error.message)) return joinFail("Too many attempts. Wait and try again.");
    if (signedUp.error.code === "weak_password") return joinFail("Choose a password that meets all three rules");
    return joinFail("Your sign-in could not be created.");
  }
  if (signedUp.data.session) return acceptJoined(supabase, input.token, input.payload);
  // With email confirmation on, an address that already has an account comes back with no identities.
  if (signedUp.data.user && signedUp.data.user.identities?.length === 0) {
    const signedIn = await signIn();
    if (signedIn !== "signed-in") {
      return signedIn.ok
        ? signedIn
        : joinFail("This email already has a Casevoya sign-in. Choose “Already have a Casevoya sign-in?” and use that password.");
    }
    return acceptJoined(supabase, input.token, input.payload);
  }
  // Supabase emailed a six-digit confirmation code; the same screen asks for it.
  return { ok: true, confirm: true };
}

/**
 * The six-digit code from the confirmation email, then the acceptance (see joinPortalInvite).
 * `password` is what the person typed on the sign-in step: when the code no longer works because
 * the email was already confirmed through the link, they are signed in with it and the
 * invitation is accepted, instead of being stuck on the code.
 */
export async function confirmPortalInvite(input: {
  token: string;
  code: string;
  payload: PortalAcceptPayload;
  password?: string;
}): Promise<PortalJoinResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!isInvitationToken(input.token)) return joinFail("That invitation link is not valid.");
  if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) return joinFail("That code didn’t match.");
  if (!acceptPayloadOk(input.payload)) return joinFail("The current terms and privacy notice have to be accepted.");
  const supabase = await createClient();
  const invitee = await openPortalInvitee(supabase, input.token);
  if ("error" in invitee) return joinFail(invitee.error);
  const { error } = await supabase.auth.verifyOtp({ email: invitee.email, token: input.code, type: "signup" });
  if (error) {
    if (lockedMessage(error.message)) return joinFail("Too many attempts. Wait and try again.");
    // A used code: the email may have been confirmed through the link already.
    const checked = await signedInAfterConfirm(supabase, invitee, passwordInput(input.password));
    if (checked === "signed-in") return acceptJoined(supabase, input.token, input.payload);
    return joinFail(notSignedInMessage(checked) ?? "That code didn’t match. Use the newest code we emailed you.");
  }
  return acceptJoined(supabase, input.token, input.payload);
}

/**
 * The code step's way on without a code: the person clicked the link in the email instead
 * ("I clicked the link", or the page noticed the session the link started in another tab).
 * Signs in (an existing session as the invitee, or the password from the sign-in step) and
 * accepts. An email that is still unconfirmed is answered with a message and nothing changes.
 */
export async function continuePortalInvite(input: {
  token: string;
  password?: string;
  payload: PortalAcceptPayload;
}): Promise<PortalJoinResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!isInvitationToken(input.token)) return joinFail("That invitation link is not valid.");
  if (!acceptPayloadOk(input.payload)) return joinFail("The current terms and privacy notice have to be accepted.");
  const supabase = await createClient();
  const invitee = await openPortalInvitee(supabase, input.token);
  if ("error" in invitee) return joinFail(invitee.error);
  const checked = await signedInAfterConfirm(supabase, invitee, passwordInput(input.password));
  if (checked === "signed-in") return acceptJoined(supabase, input.token, input.payload);
  return joinFail(notSignedInMessage(checked) ?? "Your email isn’t confirmed yet. Enter the six-digit code, or open the link in the email we sent.");
}

/**
 * Sends the invited email a new six-digit confirmation code. Supabase sends nothing (and still
 * answers success) when the email is already confirmed, so with the sign-in step's password the
 * person is first signed in and the invitation accepted if they already confirmed by the link.
 */
export async function resendPortalInviteCode(token: string, extra?: { password?: string; payload?: PortalAcceptPayload }): Promise<PortalJoinResult | null> {
  if (!hasPublicSupabaseEnv()) return nullResult();
  if (!isInvitationToken(token)) return joinFail("That invitation link is not valid.");
  const supabase = await createClient();
  const invitee = await openPortalInvitee(supabase, token);
  if ("error" in invitee) return joinFail(invitee.error);
  if (extra?.payload && acceptPayloadOk(extra.payload)) {
    const checked = await signedInAfterConfirm(supabase, invitee, passwordInput(extra.password));
    if (checked === "signed-in") return acceptJoined(supabase, token, extra.payload);
    if (checked === "locked") return joinFail("Too many attempts. Wait and try again.");
  }
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: invitee.email,
    options: { emailRedirectTo: portalInviteRedirect(token, invitee.role) },
  });
  if (error) {
    return lockedMessage(error.message)
      ? joinFail("A code was sent a moment ago. Wait a minute, then ask for another.")
      : joinFail("We couldn’t send a code to this email.");
  }
  return { ok: true, confirm: true };
}

export async function previewStaffInvite(token: string) {
  if (!hasPublicSupabaseEnv() || !isInvitationToken(token)) return null;
  const supabase = await createClient();
  const [{ data, error }, inviter] = await Promise.all([
    supabase.rpc("preview_invitation", { p_token: token }),
    supabase.rpc("preview_invitation_inviter", { p_token: token }),
  ]);
  if (error || !data?.[0]) return null;
  return { ...data[0], inviter: inviter.error ? null : inviter.data };
}

/** No backend in this environment: the screen keeps its current path. */
function nullResult(): null {
  return null;
}
