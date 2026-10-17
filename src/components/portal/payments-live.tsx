import type { PortalFinance } from "@/modules/finance/load";
import { formatCents } from "@/modules/finance/money";
import type { PortalViewer } from "@/modules/portal/load";

export function PaymentsLive({ viewer, finance }: { viewer: PortalViewer; finance: PortalFinance }) {
  const open = finance.invoices.filter((row) => row.balanceCents > 0);
  return (
    <div id="pc">
      <div className="ph">
        <h1 className="display">Payments</h1>
        <p>Invoices from {viewer.organizationName}. Government fees, when noted, are paid to the authority and are not part of the balance.</p>
      </div>
      {finance.invoices.length === 0 ? (
        <div className="panel"><div className="emp"><b>Nothing to pay</b><small>When your firm issues an invoice, it appears here.</small></div></div>
      ) : finance.invoices.map((row) => (
        <div className="li" key={row.id}>
          <div>
            <b>{row.number}</b>
            <small>{row.matterTitle} · {row.status}{row.dueOn ? ` · due ${row.dueOn}` : ""}</small>
            {row.governmentFeeNote ? <small>{row.governmentFeeNote}</small> : null}
          </div>
          <span className="bd">{formatCents(row.balanceCents, row.currency)}</span>
          {row.payable ? <a className="btn p sm" href={`/portal/pay?invoice=${row.id}`}>Pay</a> : null}
          <a className="btn s sm" href={`/api/invoices/${row.id}/pdf?organizationId=${viewer.organizationId}`}>PDF</a>
        </div>
      ))}
      {finance.receipts.map((row) => (
        <div className="li" key={row.id}>
          <div><b>{row.number}</b><small>Receipt · {formatCents(row.amountCents, row.currency)}</small></div>
          <a className="btn s sm" href={`/api/receipts/${row.id}/pdf?organizationId=${viewer.organizationId}`}>PDF</a>
        </div>
      ))}
      {open.length === 0 && finance.invoices.length > 0 ? <p>Nothing is due.</p> : null}
    </div>
  );
}
