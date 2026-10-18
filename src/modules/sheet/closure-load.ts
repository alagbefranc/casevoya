import "server-only";
import type { ClosurePanelData } from "@/components/sheet/designer/matter";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/modules/finance/money";
import { closurePanel, type ClosureCheck } from "@/modules/sheet/closure-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The matter's Closure tab checklist (T040, SEC-07): from public.matter_closure_check (money and
 * retention setting), the matter's open tasks, its latest closure and legal hold, read as the
 * signed-in staff member. A refusal (no access) leaves the Designer's plain closure view.
 */
export async function loadClosurePanel(
  supabase: Client,
  input: { organizationId: string; matterId: string; openTasks: number; consultant: string | null; outcome: string | null; closed: boolean },
): Promise<ClosurePanelData | null> {
  const org = input.organizationId;
  const [check, closure, hold] = await Promise.all([
    supabase.rpc("matter_closure_check", { p_matter_id: input.matterId }),
    supabase
      .from("matter_closures")
      .select("closed_on, retention_on, retention_years, override_reason")
      .eq("organization_id", org)
      .eq("matter_id", input.matterId)
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("matter_legal_holds").select("placed_at").eq("organization_id", org).eq("matter_id", input.matterId).is("released_at", null).maybeSingle(),
  ]);
  if (check.error || !check.data) return null;
  return closurePanel({
    check: check.data as unknown as ClosureCheck,
    openTasks: input.openTasks,
    consultant: input.consultant,
    outcome: input.outcome,
    closed: input.closed,
    closure: closure.data
      ? { closedOn: closure.data.closed_on, retentionOn: closure.data.retention_on, years: closure.data.retention_years, overridden: Boolean(closure.data.override_reason) }
      : null,
    holdSince: hold.data?.placed_at ?? null,
    money: (cents) => formatMoney(cents, "CAD"),
  });
}
