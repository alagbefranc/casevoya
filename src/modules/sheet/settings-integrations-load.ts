import "server-only";
import type { SettingsTab } from "@/components/sheet/designer/settings-integrations";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createClient } from "@/lib/supabase/server";
import { stripeMode } from "@/modules/finance/keys";
import { composioConfigured } from "@/modules/integrations/composio";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { composioDialog, integrationsData, whatsappDialog, notificationPrefsData, type StaffConnection, type WhatsAppInput } from "@/modules/sheet/settings-integrations-present";
import { zernioConfigured } from "@/modules/whatsapp/env";
import { displayPhone } from "@/modules/whatsapp/phone";
import { createZernioClient } from "@/modules/whatsapp/zernio";

const BILLING_ROLES = new Set(["firm_owner", "finance_user"]);

/**
 * Settings > Integrations: the firm's real connection state, read as the signed-in staff member
 * (RLS decides): the owner's connected-accounts switch, this person's own Composio connections and
 * last busy-time read, the firm's stored Stripe status, and its WhatsApp number. Nothing calls
 * Composio or Stripe here; Zernio is asked only for a connected number's live status (read-only).
 */
async function loadIntegrations(staff: SheetStaff) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const canBill = BILLING_ROLES.has(staff.role);
  const [firm, vo, connections, busy, account, proposals] = await Promise.all([
    supabase.from("organizations").select("slug").eq("id", org).maybeSingle(),
    supabase.from("vo_settings").select("composio_enabled, composio_accepted_at").eq("organization_id", org).maybeSingle(),
    supabase.from("staff_connections").select("id, toolkit, status, updated_at").eq("organization_id", org).eq("membership_id", staff.membershipId),
    supabase
      .from("external_busy_blocks")
      .select("synced_at")
      .eq("organization_id", org)
      .eq("membership_id", staff.membershipId)
      .eq("source", "google")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    canBill ? supabase.from("firm_payment_accounts").select("card_payments_status, requirements_due").eq("organization_id", org).maybeSingle() : null,
    supabase
      .from("connected_action_proposals")
      .select("id, toolkit, summary, created_at")
      .eq("organization_id", org)
      .eq("membership_id", staff.membershipId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at")
      .limit(20),
  ]);
  const whatsapp = await loadWhatsApp(supabase, org);
  const mail = emailRuntimeConfig();
  const input = {
    organizationId: org,
    firmSlug: firm.data?.slug ?? null,
    fromAddress: mail.fromAddress,
    inboundDomain: mail.inboundDomain,
    isOwner: staff.role === "firm_owner",
    composio: {
      configured: composioConfigured(),
      enabled: vo.data?.composio_enabled === true,
      acceptedAt: vo.data?.composio_accepted_at ?? null,
    },
    connections: (connections.data ?? []).map((row): StaffConnection => ({ id: row.id, toolkit: row.toolkit, status: row.status, updatedAt: row.updated_at })),
    busySyncedAt: busy.data?.synced_at ?? null,
    stripe: {
      canSee: canBill,
      isOwner: staff.role === "firm_owner",
      live: stripeMode() === "live",
      account: account?.data ? { cardPayments: account.data.card_payments_status, requirementsDue: account.data.requirements_due } : null,
    },
    whatsapp,
    timeZone: staff.timezone,
    proposals: (proposals.data ?? []).map((row) => ({ id: row.id, toolkit: row.toolkit, summary: row.summary, createdAt: row.created_at })),
  };
  return { integrations: integrationsData(input), dialog: composioDialog(input), whatsappDialog: whatsappDialog(input) };
}

/**
 * The firm's WhatsApp number (RLS: the firm's staff) and, when connected, Meta's live view of it
 * through Zernio's number-info (a 400 there means Meta no longer serves the number). A slow or
 * failed read just leaves the live status out.
 */
async function loadWhatsApp(supabase: Awaited<ReturnType<typeof createClient>>, org: string): Promise<WhatsAppInput> {
  const configured = zernioConfigured();
  const { data } = await supabase
    .from("firm_whatsapp_accounts")
    .select("status, zernio_account_id, display_phone, is_sandbox, connected_at")
    .eq("organization_id", org)
    .maybeSingle();
  const status = data?.status ?? "none";
  let live: WhatsAppInput["live"] = null;
  if (configured && status === "connected" && data?.zernio_account_id) {
    const info = await createZernioClient({ apiKey: process.env.ZERNIO_API_KEY ?? "", timeoutMs: 3000 }).numberInfo(data.zernio_account_id);
    live = info.ok ? { status: info.data.status, quality: info.data.quality } : info.status === 400 ? "dead" : null;
  }
  return {
    configured,
    status,
    phone: displayPhone(data?.display_phone) ?? data?.display_phone ?? null,
    sandbox: data?.is_sandbox === true,
    connectedAt: data?.connected_at ?? null,
    live,
  };
}

/** Settings > Notifications: this person's own email choices and the firm's quiet hours. */
async function loadNotificationPrefs(staff: SheetStaff) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [prefs, firm] = await Promise.all([
    supabase.from("staff_notification_preferences").select("kind, email").eq("organization_id", org).eq("membership_id", staff.membershipId),
    supabase.from("organizations").select("quiet_hours_start, quiet_hours_end").eq("id", org).maybeSingle(),
  ]);
  const start = firm.data?.quiet_hours_start ?? null;
  const end = firm.data?.quiet_hours_end ?? null;
  return notificationPrefsData({
    organizationId: org,
    isOwner: staff.role === "firm_owner",
    email: Object.fromEntries((prefs.data ?? []).map((row) => [row.kind, row.email])),
    quietHours: start && end ? { start, end } : null,
  });
}

export async function loadSheetSettingsIntegrations(staff: SheetStaff, tab: SettingsTab) {
  const chrome = await loadSheetChrome(staff, "/sheet/settings");
  const pills = [staff.organizationName];
  if (tab === "integrations") {
    const { integrations, dialog, whatsappDialog: waDialog } = await loadIntegrations(staff);
    return { chrome, pills, tab, integrations, notifications: null, dialog, waDialog };
  }
  return { chrome, pills, tab, integrations: null, notifications: await loadNotificationPrefs(staff), dialog: null, waDialog: null };
}
