import "server-only";
import type { FinanceBillingData, InvoiceBillingDialogsData, MatterWorkData } from "@/components/sheet/designer/billing-live";
import type { createClient } from "@/lib/supabase/server";
import type { AgeingInvoice } from "@/modules/billing/present";
import { financeBilling, matterWork, taxChoices, unbilledTotals, type AcceptedQuote, type BilledOn, type FeeReferenceRow, type TaxRateRow, type TimeEntryRow } from "@/modules/billing/view";
import { formatMoney } from "@/modules/finance/money";
import type { SheetStaff } from "@/modules/sheet/load";
import { plusDays } from "@/modules/sheet/present";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const BILLING_ROLES = new Set(["firm_owner", "finance_user"]);
const TIME_COLUMNS = "id, matter_id, membership_id, worked_on, minutes, started_at, rate_cents, description, billable, discarded_at, created_at";

async function staffNames(supabase: Supabase, org: string): Promise<Map<string, string>> {
  const directory = await supabase.rpc("firm_staff_directory", { p_organization_id: org });
  return new Map((directory.data ?? []).map((row) => [row.membership_id, row.display_name || "Staff member"]));
}

async function taxRates(supabase: Supabase, org: string): Promise<TaxRateRow[]> {
  const rates = await supabase
    .from("tax_rates")
    .select("id, name, rate_percent, effective_from, effective_to, approved_by, source_note")
    .eq("organization_id", org)
    .order("effective_from", { ascending: false })
    .limit(200);
  return rates.data ?? [];
}

/** The matter's Billing tab, live-only part: time, and (billing staff) accepted quotes and instalments. */
export async function loadMatterWork(supabase: Supabase, input: { staff: SheetStaff; matterId: string; closed: boolean; today: string }): Promise<MatterWorkData> {
  const { staff, matterId, today } = input;
  const org = staff.organizationId;
  const canBill = BILLING_ROLES.has(staff.role);
  const [entries, billedRows, names, rates, agreements] = await Promise.all([
    supabase.from("time_entries").select(TIME_COLUMNS).eq("organization_id", org).eq("matter_id", matterId).order("worked_on", { ascending: false }).limit(500),
    supabase.rpc("matter_time_invoices", { p_matter_id: matterId }),
    staffNames(supabase, org),
    taxRates(supabase, org),
    canBill
      ? supabase.from("agreements").select("id, title, current_version_id").eq("organization_id", org).eq("matter_id", matterId).eq("kind", "quote").eq("status", "accepted").limit(20)
      : null,
  ]);
  const billed = new Map<string, BilledOn>((billedRows.data ?? []).map((row) => [row.time_entry_id, { number: row.invoice_number, status: row.invoice_status }]));

  let quotes: AcceptedQuote[] | null = null;
  const accepted = (agreements?.data ?? []).filter((row): row is typeof row & { current_version_id: string } => Boolean(row.current_version_id));
  if (canBill) {
    quotes = [];
    if (accepted.length) {
      const versions = accepted.map((row) => row.current_version_id);
      const [lines, instalments, plans] = await Promise.all([
        supabase.from("quote_lines").select("id, agreement_version_id, category, amount_cents").eq("organization_id", org).in("agreement_version_id", versions),
        supabase.from("quote_instalments").select("agreement_version_id, position, label, amount_cents, paid_as").eq("organization_id", org).in("agreement_version_id", versions).order("position"),
        supabase.from("instalment_plans").select("id, agreement_id, status, created_at").eq("organization_id", org).in("agreement_id", accepted.map((row) => row.id)).order("created_at", { ascending: false }),
      ]);
      const lineRows = lines.data ?? [];
      const planRows = (plans.data ?? []).filter((row) => row.status === "active");
      const items = planRows.length
        ? await supabase.from("instalment_plan_items").select("id, plan_id, position, label, amount_cents, paid_as, due_on").eq("organization_id", org).in("plan_id", planRows.map((row) => row.id)).order("position")
        : null;
      const itemRows = items?.data ?? [];
      const invoiceLines =
        lineRows.length || itemRows.length
          ? await supabase
              .from("invoice_lines")
              .select("invoice_id, quote_line_id, instalment_item_id")
              .eq("organization_id", org)
              .or(
                [
                  lineRows.length ? `quote_line_id.in.(${lineRows.map((row) => row.id).join(",")})` : "",
                  itemRows.length ? `instalment_item_id.in.(${itemRows.map((row) => row.id).join(",")})` : "",
                ]
                  .filter(Boolean)
                  .join(","),
              )
          : null;
      const invoiceIds = [...new Set((invoiceLines?.data ?? []).map((row) => row.invoice_id))];
      const invoices = invoiceIds.length ? await supabase.from("invoices").select("id, number, status, discarded_at").eq("organization_id", org).in("id", invoiceIds) : null;
      const liveInvoice = new Map((invoices?.data ?? []).filter((row) => row.status !== "voided" && !row.discarded_at).map((row) => [row.id, { number: row.number, status: row.status }]));
      const byQuoteLine = new Map<string, { number: string; status: string }>();
      const byItem = new Map<string, { number: string; status: string }>();
      for (const row of invoiceLines?.data ?? []) {
        const found = liveInvoice.get(row.invoice_id);
        if (!found) continue;
        if (row.quote_line_id) byQuoteLine.set(row.quote_line_id, found);
        if (row.instalment_item_id) byItem.set(row.instalment_item_id, found);
      }
      quotes = accepted.map((agreement) => {
        const own = lineRows.filter((row) => row.agreement_version_id === agreement.current_version_id);
        const invoiced = own.map((row) => byQuoteLine.get(row.id)).find(Boolean) ?? null;
        const plan = planRows.find((row) => row.agreement_id === agreement.id) ?? null;
        return {
          id: agreement.id,
          title: agreement.title,
          totalCents: own.filter((row) => row.category !== "government_fee").reduce((sum, row) => sum + row.amount_cents, 0),
          instalments: (instalments.data ?? []).filter((row) => row.agreement_version_id === agreement.current_version_id).map((row) => ({ label: row.label, amount_cents: row.amount_cents, paid_as: row.paid_as })),
          invoiced,
          plan: plan
            ? {
                id: plan.id,
                status: plan.status,
                items: itemRows.filter((row) => row.plan_id === plan.id).map((row) => ({ ...row, invoiced: byItem.get(row.id) ?? null })),
              }
            : null,
        };
      });
    }
  }

  return matterWork({
    organizationId: org,
    matterId,
    today,
    timeZone: staff.timezone,
    defaultDue: plusDays(today, 30),
    viewerMembershipId: staff.membershipId,
    canLog: staff.role !== "finance_user",
    canBill,
    closed: input.closed,
    entries: (entries.data ?? []) as TimeEntryRow[],
    billed,
    names,
    quotes,
    taxes: taxChoices(rates, today),
  });
}

/** Finance > Invoices, live-only panels: ageing, unbilled time, tax rates, government fee references. */
export async function loadFinanceBilling(
  supabase: Supabase,
  input: { staff: SheetStaff; today: string; invoices: readonly AgeingInvoice[]; matterName: (matterId: string) => string },
): Promise<FinanceBillingData> {
  const { staff, today } = input;
  const org = staff.organizationId;
  const canBill = BILLING_ROLES.has(staff.role);
  const [rates, fees, entries] = await Promise.all([
    taxRates(supabase, org),
    supabase
      .from("government_fee_references")
      .select("id, section, fee_group, name, amount_cents, source_url, retrieved_at, snapshot_sha256, status")
      .eq("organization_id", org)
      .in("status", ["approved", "pending_review"])
      .order("position")
      .limit(500),
    canBill
      ? supabase.from("time_entries").select(TIME_COLUMNS).eq("organization_id", org).is("discarded_at", null).eq("billable", true).not("minutes", "is", null).limit(2000)
      : null,
  ]);
  const timeRows = (entries?.data ?? []) as (TimeEntryRow & { matter_id: string })[];
  const billed = new Map<string, BilledOn>();
  if (timeRows.length) {
    const lines = await supabase.from("invoice_lines").select("invoice_id, time_entry_id").eq("organization_id", org).not("time_entry_id", "is", null).limit(5000);
    const ids = [...new Set((lines.data ?? []).map((row) => row.invoice_id))];
    const invoices = ids.length ? await supabase.from("invoices").select("id, number, status, discarded_at").eq("organization_id", org).in("id", ids) : null;
    const live = new Map((invoices?.data ?? []).filter((row) => row.status !== "voided" && !row.discarded_at).map((row) => [row.id, { number: row.number, status: row.status }]));
    for (const line of lines.data ?? []) {
      const found = live.get(line.invoice_id);
      if (found && line.time_entry_id) billed.set(line.time_entry_id, found);
    }
  }
  const byMatter = new Map<string, TimeEntryRow[]>();
  for (const row of timeRows) byMatter.set(row.matter_id, [...(byMatter.get(row.matter_id) ?? []), row]);
  const unbilled = [...byMatter.entries()]
    .map(([matterId, rows]) => ({ matterId, matter: input.matterName(matterId), ...unbilledTotals(rows, billed) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.cents - a.cents);

  return financeBilling({
    organizationId: org,
    today,
    defaultDue: plusDays(today, 30),
    timeZone: staff.timezone,
    canBill,
    canManageRates: canBill,
    canFetchFees: ["firm_owner", "licensed_consultant", "finance_user"].includes(staff.role),
    canReviewFees: ["firm_owner", "licensed_consultant"].includes(staff.role),
    invoices: input.invoices,
    sampleMode: staff.sampleMode,
    unbilled,
    rates,
    fees: (fees.data ?? []) as FeeReferenceRow[],
  });
}

/** One invoice's billing dialogs: write-off on an issued invoice with a balance, government fee and discard on a draft. */
export async function loadInvoiceBillingDialogs(
  supabase: Supabase,
  input: { staff: SheetStaff; invoice: { id: string; number: string; status: string; discarded: boolean; owedCents: number; draftCreditCents: number }; today: string; canBill: boolean },
): Promise<InvoiceBillingDialogsData | null> {
  const { invoice, canBill } = input;
  if (!canBill) return null;
  const isDraft = invoice.status === "draft" && !invoice.discarded;
  const open = invoice.status === "issued" || invoice.status === "partially_paid";
  const max = Math.max(0, invoice.owedCents - invoice.draftCreditCents);
  if (!isDraft && !(open && max > 0)) return null;
  const references = isDraft
    ? await supabase.from("government_fee_references").select("id, name, amount_cents, section").eq("organization_id", input.staff.organizationId).eq("status", "approved").order("position").limit(500)
    : null;
  return {
    organizationId: input.staff.organizationId,
    invoiceId: invoice.id,
    invoice: invoice.number,
    today: input.today,
    writeOff: open && max > 0 ? { maxCents: max, hint: `Up to ${formatMoney(max, "CAD")}, what’s still owed${invoice.draftCreditCents ? " less credit notes waiting for review" : ""}` } : null,
    draft: isDraft
      ? { references: (references?.data ?? []).map((row) => ({ value: row.id, label: `${row.name} · ${formatMoney(row.amount_cents, "CAD")}${row.section ? ` · ${row.section}` : ""}` })) }
      : null,
  };
}
