"use server";

import { appOrigin } from "@/lib/email/env";
import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { zernio, zernioConfigured } from "./env";
import { WHATSAPP_RETURN_PATH } from "./paths";
import { normalizePhoneE164 } from "./phone";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const NOT_CONFIGURED = "WhatsApp isn’t set up on this server yet.";
const CHANNELS = ["email", "whatsapp", "both"] as const;
type Channel = (typeof CHANNELS)[number];

async function ownerSession(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  const { data } = userId
    ? await supabase.from("memberships").select("role").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active")
    : { data: null };
  const owner = (data ?? []).some((row) => row.role === "firm_owner");
  return { supabase, owner, userId };
}

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The binding RPCs are service role only. Before using the service role, the owner's own session
 * must pass the database's firm-owner step-up check.
 */
async function ownerServiceClient(supabase: SessionClient, organizationId: string): Promise<{ service: ReturnType<typeof createServiceClient> } | { error: string }> {
  const gate = await supabase.rpc("assert_firm_owner_step_up", { p_organization_id: organizationId });
  if (gate.error || gate.data !== true) return { error: safeAccessError(gate.error?.message ?? "firm owner step-up is required") };
  if (!process.env.SUPABASE_SECRET_KEY) return { error: NOT_CONFIGURED };
  return { service: createServiceClient() };
}

/**
 * Connect (firm owner, step-up): the firm's Zernio profile is made once (externalId = the firm's
 * id) and stored, then Zernio's Embedded Signup link for the firm's own number is returned. The
 * database refuses the profile unless the owner confirmed with a second factor recently.
 */
export async function startWhatsAppConnect(input: { organizationId: string }): Promise<Result<{ url: string }>> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  if (!zernioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, owner, userId } = await ownerSession(input.organizationId);
  if (!owner) return { error: "Only the firm owner can connect WhatsApp." };
  const gate = await ownerServiceClient(supabase, input.organizationId);
  if ("error" in gate) return gate;
  const [{ data: firm }, { data: account }] = await Promise.all([
    supabase.from("organizations").select("display_name").eq("id", input.organizationId).maybeSingle(),
    supabase.from("firm_whatsapp_accounts").select("zernio_profile_id, status").eq("organization_id", input.organizationId).maybeSingle(),
  ]);
  if (account?.status === "connected") return { error: "WhatsApp is already connected. Disconnect it first to change the number." };
  const client = zernio();
  let profileId = account?.zernio_profile_id ?? null;
  if (!profileId) {
    const made = await client.ensureProfile({ organizationId: input.organizationId, name: firm?.display_name ?? "Casevoya firm" });
    if (!made.ok) return { error: "Zernio didn’t create the firm’s profile. Try again." };
    profileId = made.data.profileId;
  }
  const saved = await gate.service.rpc("save_firm_zernio_profile", { p_organization_id: input.organizationId, p_profile_id: profileId, p_actor: userId });
  if (saved.error) return { error: safeAccessError(saved.error.message) };
  const link = await client.connectUrl({ profileId, redirectUrl: `${appOrigin()}${WHATSAPP_RETURN_PATH}` });
  if (!link.ok) return { error: link.status === 402 ? "Zernio needs a payment method on Casevoya’s account first." : "Zernio didn’t return a sign-up link. Try again." };
  return { ok: true, url: link.data.authUrl };
}

/**
 * Back from Embedded Signup with an accountId. The browser's word is not trusted: the account must
 * be a WhatsApp account on this firm's own Zernio profile before it is stored.
 */
export async function finishWhatsAppConnect(input: { organizationId: string; accountId: string }): Promise<Result<{ phone: string | null }>> {
  if (!isUuid(input.organizationId) || !/^[A-Za-z0-9_-]{1,64}$/.test(input.accountId)) return { error: "That connection can’t be used." };
  if (!zernioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, owner, userId } = await ownerSession(input.organizationId);
  if (!owner) return { error: "Only the firm owner can connect WhatsApp." };
  const gate = await ownerServiceClient(supabase, input.organizationId);
  if ("error" in gate) return gate;
  const { data: account } = await supabase.from("firm_whatsapp_accounts").select("zernio_profile_id").eq("organization_id", input.organizationId).maybeSingle();
  if (!account?.zernio_profile_id) return { error: "Start the connection from Settings first." };
  const client = zernio();
  const accounts = await client.whatsappAccounts(account.zernio_profile_id);
  if (!accounts.ok) return { error: "Zernio couldn’t confirm the number. Try again." };
  const found = accounts.data.find((row) => row.id === input.accountId && (row.profileId === null || row.profileId === account.zernio_profile_id));
  if (!found) return { error: "That WhatsApp number isn’t on this firm’s profile." };
  const info = await client.numberInfo(input.accountId);
  const phone = info.ok ? info.data.displayPhone : null;
  const saved = await gate.service.rpc("connect_firm_whatsapp", {
    p_organization_id: input.organizationId,
    p_account_id: input.accountId,
    p_display_phone: phone ?? found.displayName ?? found.username ?? "",
    p_sandbox: false,
    p_actor: userId,
  });
  if (saved.error) return { error: /another firm/.test(saved.error.message) ? "That number is connected to another firm." : safeAccessError(saved.error.message) };
  return { ok: true, phone };
}

/** Disconnect (firm owner, step-up): nothing more goes out at once; the account leaves Zernio too. */
export async function disconnectWhatsApp(input: { organizationId: string }): Promise<Result<{ removed: boolean }>> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("disconnect_firm_whatsapp", { p_organization_id: input.organizationId });
  if (error) return { error: safeAccessError(error.message) };
  const result = (data ?? {}) as { account_id?: string | null; sandbox?: boolean };
  // The shared sandbox number belongs to Zernio: it is unlinked here, never deleted.
  if (!result.account_id || result.sandbox || !zernioConfigured()) return { ok: true, removed: false };
  const removed = await zernio().deleteAccount(result.account_id);
  return { ok: true, removed: removed.ok || removed.status === 404 };
}

/** The signed-in client's own choice, for the mobile number on their record. */
export async function setMyWhatsAppNotices(input: { organizationId: string; channel: Channel }): Promise<Result> {
  if (!isUuid(input.organizationId) || !CHANNELS.includes(input.channel)) return { error: "Choose how to hear from the firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("set_my_whatsapp_notices", { p_organization_id: input.organizationId, p_channel: input.channel });
  if (error) return { error: /mobile number/.test(error.message) ? "Ask your firm to add your mobile number first." : "That choice wasn’t saved." };
  return { ok: true };
}

/** Staff record what the client told them (their number and choice), with their own name and the time. */
export async function setPersonWhatsApp(input: { organizationId: string; personId: string; phone: string; channel: Channel }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.personId) || !CHANNELS.includes(input.channel)) return { error: "Choose a person and a channel." };
  const phone = input.phone.trim() ? normalizePhoneE164(input.phone) : "";
  if (phone === null) return { error: "Enter the WhatsApp number with the country code, like +1 431 555 0100." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("set_person_whatsapp", {
    p_organization_id: input.organizationId,
    p_person_id: input.personId,
    p_phone: phone,
    p_channel: input.channel,
  });
  if (error) return { error: /mobile number/.test(error.message) ? "Enter the WhatsApp number with the country code first." : safeAccessError(error.message) };
  return { ok: true };
}
