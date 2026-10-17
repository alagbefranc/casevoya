import Link from "next/link";
import { ActionForm } from "@/components/sheet/action-form";
import { ConnectEmbedded } from "@/components/sheet/connect-embedded";
import { PlanPay } from "@/components/sheet/plan-pay";
import {
  proposeTransferFromSheet,
  recordManualPaymentFromSheet,
  recordReconciliationFromSheet,
} from "@/modules/finance/actions";
import type { FinanceSnapshot } from "@/modules/finance/load";
import { formatCents } from "@/modules/finance/money";

export function FinanceLive({
  organizationId,
  snapshot,
  tab,
  matterId,
  showPlan,
}: {
  organizationId: string;
  snapshot: FinanceSnapshot;
  tab?: string;
  matterId?: string;
  showPlan?: boolean;
}) {
  const current = showPlan ? "billing" : tab || "invoices";
  const invoices = matterId ? snapshot.invoices.filter((row) => row.matterId === matterId) : snapshot.invoices;
  return (
    <>
      <div className="ph">
        <h1 className="display">{showPlan ? "Billing" : "Finance"}</h1>
        <p>Client funds {formatCents(snapshot.clientFundsCents, snapshot.currency)}. Amounts are integer cents. Government fees are a note, not a line.</p>
      </div>
      {showPlan ? null : (
        <div className="tabs" role="tablist">
          {["invoices", "payouts", "reconcile"].map((id) => (
            <Link key={id} href={matterId ? `/sheet/matters/${matterId}?tab=billing&view=${id}` : `/sheet/finance?tab=${id}`} role="tab" aria-selected={current === id}>{id}</Link>
          ))}
        </div>
      )}
      {showPlan ? <PlanPay organizationId={organizationId} snapshot={snapshot} /> : null}
      {current === "payouts" ? <ConnectEmbedded organizationId={organizationId} status={snapshot.connectStatus} /> : null}
      {current === "reconcile" ? (
        <div className="panel">
          <h2>Reconciliation</h2>
          <p>The bank statement is compared with client funds. A processor balance is recorded and is not the client account.</p>
          {snapshot.exceptions.map((row) => <div className="li" key={row.id}><div><b>Exception</b><small>{row.detail}</small></div></div>)}
          <ActionForm action={recordReconciliationFromSheet} label="Record reconciliation">
            <input type="hidden" name="organizationId" value={organizationId} />
            <label className="fld">Period start<input name="periodStart" type="date" required /></label>
            <label className="fld">Period end<input name="periodEnd" type="date" required /></label>
            <label className="fld">Statement cents<input name="statementCents" inputMode="numeric" required /></label>
            <label className="fld">Processor balance cents<input name="processorCents" inputMode="numeric" required /></label>
          </ActionForm>
        </div>
      ) : null}
      {current === "invoices" || current === "billing" || (!showPlan && current !== "payouts" && current !== "reconcile") ? (
        <div className="panel">
          <h2>Invoices</h2>
          <div className="panel" data-slot="designer">
            <div className="emp">
              <b>Invoice and receipt layout</b>
              <small>The designer invoice and receipt screens are not separate sources on main. These rows are the live documents, and the PDF is generated in Casevoya.</small>
            </div>
          </div>
          {invoices.length === 0 ? <div className="emp"><b>No invoices</b><small>Issued invoices for this firm appear here.</small></div> : invoices.map((row) => (
            <div className="li" key={row.id}>
              <div>
                <b>{row.number}</b>
                <small>{row.matterTitle}{row.billingName ? ` · ${row.billingName}` : ""} · {row.kind} · {row.status}</small>
                {row.governmentFeeNote ? <small>{row.governmentFeeNote}</small> : null}
              </div>
              <span className="bd">{formatCents(row.balanceCents, row.currency)} due</span>
              <a className="btn s sm" href={`/api/invoices/${row.id}/pdf?organizationId=${organizationId}`}>PDF</a>
            </div>
          ))}
          <ActionForm action={recordManualPaymentFromSheet} label="Record bank transfer">
            <input type="hidden" name="organizationId" value={organizationId} />
            <label className="fld">Invoice id<input name="invoiceId" required /></label>
            <label className="fld">Amount cents<input name="amountCents" inputMode="numeric" required /></label>
            <label className="fld">Reference<input name="reference" required /></label>
            <label className="fld">Received<input name="receivedOn" type="date" required /></label>
            <label className="fld">Destination<input name="destination" required /></label>
            <label className="fld">Evidence<input name="evidence" required /></label>
          </ActionForm>
          <ActionForm action={proposeTransferFromSheet} label="Propose earned-fee transfer">
            <input type="hidden" name="organizationId" value={organizationId} />
            <label className="fld">Invoice id<input name="invoiceId" required /></label>
            <label className="fld">Amount cents<input name="amountCents" inputMode="numeric" required /></label>
            <label className="fld">Reason<input name="reason" required minLength={8} /></label>
          </ActionForm>
        </div>
      ) : null}
    </>
  );
}
