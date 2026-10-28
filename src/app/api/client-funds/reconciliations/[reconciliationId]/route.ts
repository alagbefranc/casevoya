import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { reconciliationFilename, renderReconciliationPdf, type ReconReport, type ReconReportItem } from "@/modules/finance/reconciliation-report";

/**
 * A client-account reconciliation as a PDF report (FIN-12). Read as the signed-in person: RLS lets in
 * the firm owner and finance users of the active workspace; `record_reconciliation_export` checks the
 * same access again and audits the download. Nothing is stored; the PDF is drawn from the
 * reconciliation as it stands (a signed one never changes). A reconciliation waiting for review is
 * marked as a draft.
 */
export async function GET(request: Request, { params }: { params: Promise<{ reconciliationId: string }> }) {
  const { reconciliationId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(reconciliationId) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the reconciliation." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data: rec } = await supabase.from("client_account_reconciliations").select("*").eq("organization_id", organizationId).eq("id", reconciliationId).maybeSingle();
  if (!rec || rec.status === "discarded") return NextResponse.json({ error: "That reconciliation is not available." }, { status: 404 });
  const audited = await supabase.rpc("record_reconciliation_export", { p_reconciliation_id: rec.id });
  if (audited.error) return NextResponse.json({ error: "That reconciliation is not available." }, { status: 403 });

  const [account, firm, adjustments, names] = await Promise.all([
    supabase.from("client_accounts").select("label, institution, account_last4").eq("organization_id", organizationId).eq("id", rec.client_account_id).maybeSingle(),
    supabase.from("organizations").select("legal_name, display_name, timezone").eq("id", organizationId).maybeSingle(),
    supabase
      .from("client_reconciliation_adjustments")
      .select("kind, description, reference, item_date, amount_cents")
      .eq("organization_id", organizationId)
      .eq("reconciliation_id", rec.id)
      .is("removed_at", null)
      .order("item_date", { ascending: true }),
    supabase.rpc("client_fund_staff_names", { p_org: organizationId }),
  ]);
  const nameOf = new Map((names.data ?? []).map((row) => [row.user_id, row.display_name]));
  const name = (id: string | null) => (id ? (nameOf.get(id) ?? "Staff member") : null);
  const adjustment = (kind: string): ReconReportItem[] =>
    (adjustments.data ?? [])
      .filter((row) => row.kind === kind)
      .map((row) => ({ label: `${row.description}${row.reference ? ` (${row.reference})` : ""}`, date: row.item_date, cents: Number(row.amount_cents) }));
  const ledgerItems: ReconReportItem[] = (Array.isArray(rec.items) ? rec.items : []).map((raw) => {
    const item = (raw ?? {}) as { kind?: unknown; number?: unknown; date?: unknown; amount_cents?: unknown };
    const number = typeof item.number === "string" ? item.number : "";
    return {
      label: item.kind === "deposit_pending_verification" ? `Deposit not verified ${number}` : `Approved transfer not sent ${number}`,
      date: typeof item.date === "string" ? item.date : rec.statement_date,
      cents: Number(item.amount_cents ?? 0),
    };
  });

  const report: ReconReport = {
    id: rec.id,
    status: rec.status,
    firmLegalName: firm.data?.legal_name ?? "Firm",
    firmDisplayName: firm.data?.display_name ?? firm.data?.legal_name ?? "Firm",
    firmTimezone: firm.data?.timezone ?? "America/Toronto",
    account: account.data ? `${account.data.label}, ${account.data.institution} ••• ${account.data.account_last4}, CAD` : "Client account",
    statementDate: rec.statement_date,
    periodStart: rec.period_start,
    statementCents: Number(rec.statement_balance_cents),
    depositsInTransit: adjustment("deposit_in_transit"),
    outstandingCheques: adjustment("outstanding_cheque"),
    ledgerCents: Number(rec.ledger_balance_cents),
    clientCents: Number(rec.client_ledgers_total_cents),
    clientCount: rec.client_count,
    ledgerItems,
    preparedBy: name(rec.prepared_by) ?? "Staff member",
    preparedAt: rec.prepared_at,
    preparerNote: rec.preparer_note,
    signedBy: name(rec.signed_by),
    signedAt: rec.signed_at,
    ownerSelfSigned: rec.owner_self_signed,
    reviewNotes: rec.review_notes,
    isSample: rec.is_sample,
  };
  const bytes = await renderReconciliationPdf(report);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reconciliationFilename(report)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
