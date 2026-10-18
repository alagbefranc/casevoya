import "server-only";
import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { publishableKey } from "@/modules/finance/keys";
import type { PortalViewer } from "@/modules/portal/load";
import { invoiceState } from "@/modules/sheet/finance-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

export type PortalInvoice = {
  id: string;
  number: string;
  description: string;
  matterTitle: string;
  amountCents: number;
  paidCents: number;
  currency: string;
  status: string;
  issuedOn: string | null;
  dueOn: string;
  open: boolean;
  processing: boolean;
  state: { tone: string; label: string };
};

export type PortalInvoices = {
  invoices: PortalInvoice[];
  today: string;
  /** Test keys on both sides: the Payment Element can load. */
  payable: boolean;
  publishableKey: string | null;
};

/** The client's invoices (RLS: invoices on matters where they are a party). */
export async function loadPortalInvoices(viewer: PortalViewer): Promise<PortalInvoices> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const today = isoDateInTimeZone(new Date(), viewer.timezone);
  const { data } = await supabase
    .from("invoices")
    .select("id, matter_id, number, description, amount_cents, paid_cents, currency, status, issued_on, due_on")
    .eq("organization_id", viewer.organizationId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const processing = ids.length
    ? await supabase.from("invoice_payments").select("invoice_id").eq("organization_id", viewer.organizationId).eq("status", "processing").in("invoice_id", ids)
    : null;
  const busy = new Set((processing?.data ?? []).map((row) => row.invoice_id));
  const titles = new Map(viewer.matters.map((matter) => [matter.id, matter.title]));
  const pk = publishableKey();
  return {
    today,
    payable: Boolean(pk && stripeServer()),
    publishableKey: pk,
    invoices: rows.map((row) => {
      const state = invoiceState(row.status, row.due_on, today, busy.has(row.id));
      return {
        id: row.id,
        number: row.number,
        description: row.description,
        matterTitle: titles.get(row.matter_id) ?? "Your matter",
        amountCents: row.amount_cents,
        paidCents: row.paid_cents,
        currency: row.currency,
        status: row.status,
        issuedOn: row.issued_on,
        dueOn: row.due_on,
        open: row.status === "issued" || row.status === "partially_paid",
        processing: busy.has(row.id),
        state: { tone: state.tone, label: state.label },
      };
    }),
  };
}
