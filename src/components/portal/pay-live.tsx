import type { PortalFinance } from "@/modules/finance/load";
import { formatCents } from "@/modules/finance/money";
import type { PortalViewer } from "@/modules/portal/load";

export function PayLive({
  viewer,
  finance,
  invoiceId,
}: {
  viewer: PortalViewer;
  finance: PortalFinance;
  invoiceId?: string;
}) {
  const invoice = finance.invoices.find((row) => row.id === invoiceId) ?? finance.invoices.find((row) => row.payable);
  if (!invoice) {
    return (
      <div id="pc">
        <div className="ph"><h1 className="display">Pay</h1></div>
        <div className="panel"><div className="emp"><b>Nothing to pay</b><small>There isn’t an issued invoice on your file.</small></div></div>
      </div>
    );
  }
  const card = invoice.payable && finance.connectEnabled;
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">Pay {invoice.number}</h1><p>{invoice.matterTitle}</p></div>
      <div className="pay">
        <div className="sum">
          <b>{formatCents(invoice.balanceCents, invoice.currency)}</b>
          <small>Balance due · {invoice.currency.toUpperCase()}</small>
          {invoice.governmentFeeNote ? <small>{invoice.governmentFeeNote}</small> : null}
        </div>
        <div className="card" id="card">
          {card ? (
            <>
              <div id="cv-express" />
              <div
                id="cv-payment"
                data-invoice-id={invoice.id}
                data-organization-id={viewer.organizationId}
                data-amount-cents={String(invoice.balanceCents)}
                data-currency={invoice.currency}
              />
              <button className="btn p" id="go" type="button">Pay {formatCents(invoice.balanceCents, invoice.currency)}</button>
              <button className="btn s" id="go2" type="button">Pay with the same card</button>
            </>
          ) : (
            <div className="emp">
              <b>{invoice.kind === "advance_request" ? "Bank transfer" : "Payment isn’t open"}</b>
              <small>
                {invoice.kind === "advance_request"
                  ? "Advances are recorded as a bank transfer until the firm verifies them. Card collection stays off."
                  : "Your firm hasn’t enabled card payments on this invoice yet."}
              </small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
