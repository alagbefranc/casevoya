import "server-only";
import type { BankAccountsData } from "@/components/sheet/designer/manual-pay";
import type { RetentionData, SubscriptionData } from "@/components/sheet/designer/settings-billing";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  readFirmSubscription,
  retentionPage,
  subscriptionPage,
  subscriptionPill,
  type RetentionPolicy,
  type SubscriptionRow,
} from "@/modules/sheet/settings-billing-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The firm's subscription row (any staff member with MFA may read it). */
async function loadSubscription(supabase: Client, org: string): Promise<SubscriptionRow | null> {
  const { data } = await supabase.from("organization_subscriptions").select("status, trial_started_at, trial_ends_at, plan").eq("organization_id", org).maybeSingle();
  return data ?? null;
}

/** Display names for auth users, as the viewer may read them. */
async function profileNames(supabase: Client, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  return new Map((data ?? []).filter((row) => row.display_name).map((row) => [row.id, row.display_name as string]));
}

/**
 * Settings > Subscription: the stored subscription state and, for the firm owner and finance,
 * the plan, prices, allowances, real usage and Casevoya's invoices from public.firm_subscription
 * (which also moves the state clock). Read as the signed-in staff member.
 */
export async function loadSheetSubscription(
  staff: SheetStaff,
): Promise<{ chrome: Awaited<ReturnType<typeof loadSheetChrome>>; pill: string; page: SubscriptionData; accounts: BankAccountsData | null }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const canSee = staff.role === "firm_owner" || staff.role === "finance_user";
  const [chrome, firm, accounts] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    canSee ? supabase.rpc("firm_subscription", { p_organization_id: org }) : null,
    canSee ? loadBankAccounts(supabase, staff) : null,
  ]);
  const detail = firm && !firm.error ? readFirmSubscription(firm.data) : null;
  // After the clock moved the state, read the row again so the pill and the State row agree.
  const subscription = await loadSubscription(supabase, org);
  const now = new Date();
  return {
    chrome,
    pill: subscriptionPill(subscription, now),
    page: subscriptionPage({
      firmName: staff.organizationName,
      subscription,
      usage: detail?.usage ?? null,
      timeZone: staff.timezone,
      now,
      detail,
      canManage: staff.role === "firm_owner",
      organizationId: org,
    }),
    accounts,
  };
}

/**
 * FIN-09 / FIN-12: the firm's client (trust) account and operating account records, read by the
 * owner and finance users (RLS). Only the firm owner adds one, after a step-up (the database checks).
 */
async function loadBankAccounts(supabase: Client, staff: SheetStaff): Promise<BankAccountsData> {
  const org = staff.organizationId;
  const [client, operating] = await Promise.all([
    supabase.from("client_accounts").select("label, institution, account_last4, currency, is_active").eq("organization_id", org).order("created_at"),
    supabase.from("firm_operating_accounts").select("label, institution, account_last4, currency, is_active").eq("organization_id", org).order("created_at"),
  ]);
  const describe = (rows: { label: string; institution: string; account_last4: string; currency: string; is_active: boolean }[] | null, none: string) => {
    const active = (rows ?? []).filter((row) => row.is_active);
    return active.length ? active.map((row) => `${row.label}: ${row.institution} ••• ${row.account_last4} · ${row.currency}`).join("; ") : none;
  };
  return {
    organizationId: org,
    rows: [
      ["Client (trust) account", client.error ? "Couldn’t load" : describe(client.data, "Not set up. Advances can’t be recorded until it is.")],
      ["Operating account", operating.error ? "Couldn’t load" : describe(operating.data, "Not set up. Manual invoice payments need it as their destination.")],
    ],
    canAdd: staff.role === "firm_owner",
    note:
      staff.role === "firm_owner"
        ? "Records of the firm’s own accounts at its bank: a name, the bank and the last four digits. Casevoya never holds or moves the money. Adding one asks you to confirm with your authenticator."
        : "Records of the firm’s own accounts at its bank. The firm owner adds them.",
  };
}

/**
 * Settings > Retention: the firm's own retention period with its version, who approved it, and
 * the legal holds the viewer can see. Only the firm owner gets the Save button; the database
 * (public.set_firm_retention_policy) decides either way.
 */
export async function loadSheetRetention(staff: SheetStaff): Promise<{ chrome: Awaited<ReturnType<typeof loadSheetChrome>>; pill: string; page: RetentionData }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, subscription, firm, latest, setup, holds] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    loadSubscription(supabase, org),
    supabase.from("organizations").select("retention_policy").eq("id", org).maybeSingle(),
    supabase
      .from("retention_policy_versions")
      .select("version, period_count, source, approved_at, approved_by")
      .eq("organization_id", org)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("organization_setup_steps").select("completed_at, completed_by").eq("organization_id", org).eq("step", "records_and_retention").maybeSingle(),
    supabase.from("matter_legal_holds").select("matter_id").eq("organization_id", org).is("released_at", null).order("placed_at", { ascending: true }),
  ]);
  const matterIds = [...new Set((holds.data ?? []).map((row) => row.matter_id))];
  const [names, matters] = await Promise.all([
    profileNames(supabase, [latest.data?.approved_by, setup.data?.completed_by]),
    matterIds.length ? supabase.from("matters").select("id, reference").eq("organization_id", org).in("id", matterIds) : null,
  ]);
  const reference = new Map((matters?.data ?? []).map((row) => [row.id, row.reference]));
  const references = matterIds.map((id) => reference.get(id)).filter((ref): ref is string => Boolean(ref));
  return {
    chrome,
    pill: subscriptionPill(subscription, new Date()),
    page: retentionPage({
      policy: (firm.data?.retention_policy ?? null) as RetentionPolicy,
      latest: latest.data
        ? {
            version: latest.data.version,
            periodCount: latest.data.period_count,
            source: latest.data.source,
            approvedAt: latest.data.approved_at,
            approvedBy: names.get(latest.data.approved_by) ?? null,
          }
        : null,
      setup: setup.data ? { at: setup.data.completed_at, by: names.get(setup.data.completed_by) ?? null } : null,
      holds: { count: (holds.data ?? []).length, references },
      organizationId: org,
      canSave: staff.role === "firm_owner",
      timeZone: staff.timezone,
    }),
  };
}
