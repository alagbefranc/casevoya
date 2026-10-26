import type { PortalFundsEntry, PortalInvoice, PortalInvoices } from "@/modules/finance/portal-load";
import { methodShort } from "@/modules/finance/client-funds-present";
import type { PortalViewer } from "@/modules/portal/load";
import { formatMoney } from "@/modules/finance/money";
import { creditNoteHref } from "@/modules/finance/receipt-links";
import { dayMonth } from "@/modules/sheet/home-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

function Sep() {
  return <span className="sep" aria-hidden="true"></span>;
}

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The receipt PDF for a verified advance (CICC Code s. 32(b)); the route checks access again. */
export function receiptHref(entryId: string, organizationId: string): string {
  return `/api/client-funds/receipts/${entryId}?organizationId=${organizationId}`;
}

/** A client-account ledger line as the client sees it (Designer: "Advance payment · bank transfer"). */
export function fundsRow(entry: PortalFundsEntry, firm: string): { title: string[]; detail: string; paidTo: string; badge: { tone: string; label: string } } {
  const account = `${firm}, client account`;
  const ref = entry.reference ? `, ref ${entry.reference}` : "";
  switch (entry.kind) {
    case "deposit":
      return { title: ["Advance payment", methodShort(entry.method)], detail: `Received ${dayMonth(entry.occurredOn)}${ref}`, paidTo: account, badge: { tone: "ok", label: "Received" } };
    case "transfer":
      return {
        title: [entry.invoiceNumber ?? "Invoice", "paid from your client account"],
        detail: `Moved ${dayMonth(entry.occurredOn)} to ${firm} for work done`,
        paidTo: firm,
        badge: { tone: "ok", label: "Paid" },
      };
    case "refund":
      return { title: ["Refund from your client account", methodShort(entry.method)], detail: `Sent ${dayMonth(entry.occurredOn)}${ref}`, paidTo: "You", badge: { tone: "gr", label: "Refunded" } };
    default:
      return {
        title: ["Correction"],
        detail: `${entry.direction === "in" ? "Added back" : "Taken off"} ${dayMonth(entry.occurredOn)}, fixing an earlier entry`,
        paidTo: account,
        badge: { tone: "gr", label: "Corrected" },
      };
  }
}

/**
 * The Designer's Payments page (`markup/portal-payments.tsx`) for the client's real invoices.
 * Same anatomy: heading with art, the `.money` strip, and the `.t.pay` table with a Pay button on
 * each open invoice. A card refund shows on its invoice: a partly refunded invoice stays paid and
 * says how much went back, a fully refunded one reads "Refunded", and "Paid so far" is net of
 * refunds. When the client has money in the firm's client account, the strip's middle tile is the
 * Designer's "Held for you in …’s client account", the Designer's explanation panel follows, and
 * the table ("Invoices and requests") lists the client-account entries that count (verified
 * deposits, transfers applied to invoices, refunds, corrections), read-only. A verified deposit
 * has a Receipt download (the advance-payment receipt, CICC Code s. 32(b)). An invoice the client
 * paid (by card, or from their client-account money) has a "Receipt PR-0001" download per payment
 * (CICC Code s. 33(3)), in place of the plain "Paid" note. An issued credit note takes its amount off
 * what is due and has a "Credit note CN-0001" download (read-only; drafts are never shown).
 */
export function PaymentsLive({ viewer, data }: { viewer: PortalViewer; data: PortalInvoices }) {
  const funds = data.clientFunds;
  const open = data.invoices.filter((invoice) => invoice.open);
  const next = [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const due = (invoice: PortalInvoice) => Math.max(0, invoice.amountCents - invoice.paidCents - invoice.creditedCents);
  const toPay = open.filter((invoice) => !invoice.processing).reduce((sum, invoice) => sum + due(invoice), 0);
  const processing = open.filter((invoice) => invoice.processing).reduce((sum, invoice) => sum + due(invoice), 0);
  const refunded = data.invoices.reduce((sum, invoice) => sum + invoice.refundedCents, 0);
  const paid = data.invoices.reduce((sum, invoice) => sum + invoice.paidCents, 0) - refunded;
  const paidCount = data.invoices.filter((invoice) => invoice.paidCents > 0).length;
  const paidNote = paidCount ? `${paidCount} ${paidCount === 1 ? "invoice" : "invoices"}` : "No payments yet";
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
        {funds ? (
          <div>
            <span className="lbl">{`Held for you in ${viewer.organizationName}’s client account`}</span>
            <b className="num">{formatMoney(funds.heldCents, "CAD")}</b>
            <small className="lbl">{"Not yet earned. Shown on every statement."}</small>
          </div>
        ) : (
          <div>
            <span className="lbl">{"Processing"}</span>
            <b className="num">{formatMoney(processing, "CAD")}</b>
            <small className="lbl">{"Card payments your bank is still confirming"}</small>
          </div>
        )}
        <div>
          <span className="lbl">{"Paid so far"}</span>
          <b className="num">{formatMoney(paid, "CAD")}</b>
          <small className="lbl">
            {refunded > 0 ? (
              <>
                {`${paidNote} `}
                <Sep />
                {` ${formatMoney(refunded, "CAD")} refunded to your card`}
              </>
            ) : (
              paidNote
            )}
          </small>
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
      {funds ? (
        <div className="panel rv" style={{ ...i(1), display: "flex", gap: "16px", alignItems: "center", padding: "16px 20px" }}>
          <span className="art " style={{ "--a": "56px" } as React.CSSProperties} aria-hidden="true">
            <img src="/assets/generated/b2/client-funds-160@1x.webp" srcSet="/assets/generated/b2/client-funds-160@2x.webp 2x" width="56" height="56" alt="" loading="lazy" decoding="async" />
          </span>
          <p style={{ margin: "0", fontSize: "14px", color: "var(--t2)", maxWidth: "62ch" }}>
            <b style={{ fontWeight: "500", color: "var(--t1)" }}>{"What “held in the client account” means."}</b>
            {` An advance payment sits in ${viewer.organizationName}’s separate client (trust) account at its bank until the work it covers is done and invoiced. Only then does it move to the firm, and you’ll see that move here.`}
          </p>
        </div>
      ) : null}
      <div className="panel rv" style={i(2)}>
        <h2>
          <svg className="ic s" aria-hidden="true">
            <use href={`${SPRITE}#i-invoice`} />
          </svg>
          {funds ? "Invoices and requests" : "Invoices"}
        </h2>
        {data.invoices.length === 0 && !funds ? (
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
                  // A payment waiting for the firm's check keeps its "Pending verification" badge, not the due date.
                  const dueSoon = invoice.open && !invoice.processing && !invoice.pendingCents && invoice.state.label !== "Overdue";
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
                          {"detail" in badge && badge.detail ? (
                            <span>
                              {`${badge.label} `}
                              <Sep />
                              {` ${badge.detail}`}
                            </span>
                          ) : (
                            badge.label
                          )}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>
                        {formatMoney(invoice.open ? due(invoice) : invoice.amountCents, invoice.currency)}
                      </td>
                      <td>
                        {invoice.open && !invoice.processing ? (
                          <a className="btn p sm" href={`/portal/pay?invoice=${invoice.id}`}>
                            {"Pay"}
                          </a>
                        ) : invoice.receipts.length || invoice.creditNotes.length ? null : invoice.status === "paid" ? (
                          <small>{"Paid"}</small>
                        ) : invoice.status === "refunded" ? (
                          <small>{"Refunded"}</small>
                        ) : null}
                        {invoice.receipts.map((receipt, index) => (
                          <span key={receipt.id}>
                            {index > 0 || (invoice.open && !invoice.processing) ? " " : null}
                            <a
                              className="btn sm"
                              href={`/portal/receipt?id=${receipt.id}`}
                              aria-label={`Open receipt ${receipt.number} for invoice ${invoice.number}`}
                              data-payment-receipt="1"
                            >
                              {`Receipt ${receipt.number}`}
                            </a>
                          </span>
                        ))}
                        {invoice.creditNotes.map((note, index) => (
                          <span key={note.id}>
                            {index > 0 || invoice.receipts.length || (invoice.open && !invoice.processing) ? " " : null}
                            <a
                              className="btn sm"
                              href={creditNoteHref(note.id, viewer.organizationId)}
                              aria-label={`Download credit note ${note.number} (${formatMoney(note.amountCents, invoice.currency)}) for invoice ${invoice.number}`}
                              data-credit-note="1"
                            >
                              {`Credit note ${note.number}`}
                            </a>
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
                {(funds?.entries ?? []).map((entry) => {
                  const row = fundsRow(entry, viewer.organizationName);
                  return (
                    <tr key={entry.id}>
                      <td>
                        <b style={{ fontWeight: 500 }}>
                          {row.title.length > 1 ? (
                            <>
                              {`${row.title[0]} `}
                              <Sep />
                              {` ${row.title[1]}`}
                            </>
                          ) : (
                            row.title[0]
                          )}
                        </b>
                        <br />
                        <small>{row.detail}</small>
                      </td>
                      <td>{row.paidTo}</td>
                      <td>
                        <span className={`bd ${row.badge.tone}`}>
                          <i></i>
                          {row.badge.label}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>
                        {formatMoney(entry.amountCents, "CAD")}
                      </td>
                      <td>
                        {entry.receiptNumber ? (
                          <a className="btn sm" href={receiptHref(entry.id, viewer.organizationId)} aria-label={`Download receipt ${entry.receiptNumber}`}>
                            {"Receipt"}
                          </a>
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
