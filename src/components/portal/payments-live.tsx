import type { PortalInvoices } from "@/modules/finance/portal-load";
import type { PortalViewer } from "@/modules/portal/load";
import { formatMoney } from "@/modules/finance/money";
import { dayMonth } from "@/modules/sheet/home-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

function Sep() {
  return <span className="sep" aria-hidden="true"></span>;
}

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/**
 * The Designer's Payments page (`markup/portal-payments.tsx`) for the client's real invoices.
 * Same anatomy: heading with art, the `.money` strip, and the `.t.pay` table with a Pay button on
 * each open invoice. Advances and refunds are not on file yet, so they are not shown.
 */
export function PaymentsLive({ viewer, data }: { viewer: PortalViewer; data: PortalInvoices }) {
  const open = data.invoices.filter((invoice) => invoice.open);
  const next = [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const toPay = open.filter((invoice) => !invoice.processing).reduce((sum, invoice) => sum + invoice.amountCents - invoice.paidCents, 0);
  const processing = open.filter((invoice) => invoice.processing).reduce((sum, invoice) => sum + invoice.amountCents - invoice.paidCents, 0);
  const paid = data.invoices.reduce((sum, invoice) => sum + invoice.paidCents, 0);
  const paidCount = data.invoices.filter((invoice) => invoice.paidCents > 0).length;
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={i(0)}>
        <span className="art " style={{ "--a": "52px" } as React.CSSProperties} aria-hidden="true">
          <img src="/assets/generated/b2/invoice-plain-160@1x.webp" srcSet="/assets/generated/b2/invoice-plain-160@2x.webp 2x" width="52" height="52" alt="" loading="lazy" decoding="async" />
        </span>
        <div>
          <h1 className="display">{"Payments"}</h1>
          <p>{`Every payment goes to ${viewer.organizationName}, never to Casevoya. Government fees are paid by you to IRCC.`}</p>
        </div>
      </div>
      <div className="money rv" style={i(1)}>
        <div>
          <span className="lbl">{"To pay now"}</span>
          <b className="num">{formatMoney(toPay, "CAD")}</b>
          <small className="lbl">
            {next ? (
              <>
                {`Invoice ${next.number} `}
                <Sep />
                {` due ${dayMonth(next.dueOn)}`}
              </>
            ) : (
              "Nothing due"
            )}
          </small>
        </div>
        <div>
          <span className="lbl">{"Processing"}</span>
          <b className="num">{formatMoney(processing, "CAD")}</b>
          <small className="lbl">{"Card payments your bank is still confirming"}</small>
        </div>
        <div>
          <span className="lbl">{"Paid so far"}</span>
          <b className="num">{formatMoney(paid, "CAD")}</b>
          <small className="lbl">{paidCount ? `${paidCount} ${paidCount === 1 ? "invoice" : "invoices"}` : "No payments yet"}</small>
        </div>
      </div>
      {!data.payable && open.length ? (
        <div className="alert warn">
          <svg className="ic" aria-hidden="true">
            <use href={`${SPRITE}#i-info`} />
          </svg>
          <div>
            <b>{"Card payments aren’t configured"}</b>
            {"Nothing can be charged here yet. Your firm can tell you other ways to pay."}
          </div>
        </div>
      ) : null}
      <div className="panel rv" style={i(2)}>
        <h2>
          <svg className="ic s" aria-hidden="true">
            <use href={`${SPRITE}#i-invoice`} />
          </svg>
          {"Invoices"}
        </h2>
        {data.invoices.length === 0 ? (
          <div className="emp">
            <b>{"Nothing to pay"}</b>
            <small>{"When your firm sends an invoice, it appears here."}</small>
          </div>
        ) : (
          <div className="tw">
            <table className="t pay">
              <thead>
                <tr>
                  <th>{"Item"}</th>
                  <th>{"Paid to"}</th>
                  <th>{"Status"}</th>
                  <th style={{ textAlign: "right" }}>{"Amount"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => {
                  const dueSoon = invoice.open && !invoice.processing && invoice.state.label !== "Overdue";
                  const badge = dueSoon ? { tone: "chg", label: `Due ${dayMonth(invoice.dueOn)}` } : invoice.state;
                  return (
                    <tr key={invoice.id}>
                      <td>
                        <b style={{ fontWeight: 500 }}>
                          {`${invoice.number} `}
                          <Sep />
                          {` ${invoice.description}`}
                        </b>
                        <br />
                        <small>{invoice.matterTitle}</small>
                      </td>
                      <td>{viewer.organizationName}</td>
                      <td>
                        <span className={`bd ${badge.tone}`}>
                          <i></i>
                          {badge.label}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>
                        {formatMoney(invoice.open ? invoice.amountCents - invoice.paidCents : invoice.amountCents, invoice.currency)}
                      </td>
                      <td>
                        {invoice.open && !invoice.processing ? (
                          <a className="btn p sm" href={`/portal/pay?invoice=${invoice.id}`}>
                            {"Pay"}
                          </a>
                        ) : invoice.status === "paid" ? (
                          <small>{"Paid"}</small>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
