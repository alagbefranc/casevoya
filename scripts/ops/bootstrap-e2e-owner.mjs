#!/usr/bin/env node
// Creates the browser-test firm owner on the live project:
// a confirmed user, a TOTP factor, and a new firm made through the app's own
// create_organization. Writes the generated credentials to the file named by
// E2E_SECRETS_FILE (outside the repo). Prints no secrets.
//
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
// SUPABASE_SECRET_KEY and E2E_SECRETS_FILE.
// Usage: node scripts/ops/bootstrap-e2e-owner.mjs
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { totp } from "./totp.mjs";

const EMAIL = "e2e-owner@casevoya.ca";
const FIRM = { legal: "E2E Maple Immigration Consulting Inc. (test)", display: "E2E Maple Immigration (test)", slug: "e2e-maple-test" };

const env = process.env;
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "E2E_SECRETS_FILE"]) {
  if (!env[name]) throw new Error(`${name} is not set.`);
}
const secretsFile = path.resolve(env.E2E_SECRETS_FILE);
if (secretsFile.startsWith(path.resolve("."))) throw new Error("E2E_SECRETS_FILE must be outside the repository.");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const password = randomBytes(24).toString("base64url");
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: EMAIL,
  password,
  email_confirm: true,
  user_metadata: { full_name: "E2E Owner (test)" },
});
if (createError) throw new Error(`createUser: ${createError.message}`);

const user = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: signInError } = await user.auth.signInWithPassword({ email: EMAIL, password });
if (signInError) throw new Error(`signIn: ${signInError.message}`);
const { data: factor, error: enrollError } = await user.auth.mfa.enroll({ factorType: "totp", friendlyName: "Casevoya" });
if (enrollError) throw new Error(`enroll: ${enrollError.message}`);
const { error: verifyError } = await user.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) });
if (verifyError) throw new Error(`verify: ${verifyError.message}`);

appendFileSync(
  secretsFile,
  `E2E_OWNER_EMAIL=${EMAIL}\nE2E_OWNER_PASSWORD=${password}\nE2E_OWNER_TOTP_SECRET=${factor.totp.secret}\nE2E_OWNER_USER_ID=${created.user.id}\n`,
  { mode: 0o600 },
);

const { data: org, error: orgError } = await user.rpc("create_organization", {
  legal_name: FIRM.legal,
  display_name: FIRM.display,
  slug: FIRM.slug,
});
if (orgError) throw new Error(`create_organization: ${orgError.message}`);
appendFileSync(secretsFile, `E2E_ORG_ID=${org.id}\n`);
console.log(`Created ${EMAIL} with two-step sign-in and firm ${org.slug}.`);
