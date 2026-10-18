import "server-only";
import type { RetentionData, SubscriptionData } from "@/components/sheet/designer/settings-billing";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  readUsage,
  retentionPage,
  subscriptionPage,
  subscriptionPill,
  type RetentionPolicy,
  type SubscriptionRow,
} from "@/modules/sheet/settings-billing-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The firm's subscription row (any staff member with MFA may read it). */
async function loadSubscription(supabase: Client, org: string): Promise<SubscriptionRow | null> {
  const { data } = await supabase.from("organization_subscriptions").select("status, trial_started_at, trial_ends_at").eq("organization_id", org).maybeSingle();
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
 * real usage counts from public.firm_subscription_usage. Read as the signed-in staff member.
 */
export async function loadSheetSubscription(staff: SheetStaff): Promise<{ chrome: Awaited<ReturnType<typeof loadSheetChrome>>; pill: string; page: SubscriptionData }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, subscription, usage] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    loadSubscription(supabase, org),
    staff.role === "firm_owner" || staff.role === "finance_user" ? supabase.rpc("firm_subscription_usage", { p_organization_id: org }) : null,
  ]);
  const now = new Date();
  return {
    chrome,
    pill: subscriptionPill(subscription, now),
    page: subscriptionPage({
      firmName: staff.organizationName,
      subscription,
      usage: usage && !usage.error ? readUsage(usage.data) : null,
      timeZone: staff.timezone,
      now,
    }),
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
