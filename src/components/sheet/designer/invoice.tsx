/**
 * The Designer's single-invoice tab (`markup/finance.tsx`, variant `tab-invoice`): the invoice's
 * heading, state and tags, its Lines (with payments and credits taken off down to the balance due),
 * its Allocations, the History and the actions. Same DOM, classes and order. Given the Designer's
 * values it renders the capture.
 *
 * Live differences from the capture, in the Designer's own anatomy:
 *   * No invoice picture: the capture shows the Designer's sample invoice image, which isn't the
 *     firm's document, so the right column starts with the History.
 *   * A Credit notes panel (CN-, FIN-06) after Allocations: each note's state, the PDF of an issued
 *     note, and Review on a draft (opens `#dlgCNR`: issue or decline; a second person issues, the
 *     firm owner may issue their own after a fresh step-up).
 *   * A credit balance (money held beyond what the invoice now asks for) shows as an `.alert` that
 *     says the refund is made separately and where.
 *   * Actions are the live ones: Issue a credit note (`#dlgCN`) while the invoice can be credited,
 *     Void invoice (`#dlgVoid`) while nothing is allocated to it. The Designer's Send a reminder and
 *     Record a payment (bank payments for invoices) are not built.
 */
import type { ReactNode } from "react";
import { Icon, Pair } from "./frame";
import { Alert, i, Parts, RIGHT } from "./finance";
import { Dl, Field, LiveDialog } from "./funds";
import { Badge, type MatterBadge } from "./matters";

export type Step = { key?: string; state: "done" | "now" | ""; title: string; note: string[] };

/** The Designer's `.fp-steps`: done steps carry a check, the current one says so to screen readers. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className={"fp-steps"}>
      {steps.map((step, index) => (
        <li key={step.key ?? index} className={step.state}>
          <span className={"d"} aria-hidden={"true"}>
            {step.state === "done" ? <Icon name={"check-circle"} cls={"ic s"} /> : null}
          </span>
          <div>
            <b>{step.title}</b>
            <small>
              <Parts parts={step.note} />
            </small>
          </div>
          {step.state === "now" ? <span className={"sr"}>{"current step"}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export type LineRow = {
  key?: string;
  /** Null leaves the cell empty (totals, payments). An icon goes before the text ("Tax"). */
  category: null | { icon?: string; text: string };
  description: { bold?: boolean; parts: string[] };
  qty: string | null;
  tax: string | null;
  amount: { bold?: boolean; text: string };
};

export type AllocationRow = { key?: string; date: string; source: string; evidence: string[]; amount: string; state: MatterBadge };

export type InvoiceCreditRow = {
  key?: string;
  number: string;
  amount: string;
  reason: string;
  state: MatterBadge;
  /** Issued: the PDF. Draft, for billing staff: Review (opens `#dlgCNR`). */
  pdf?: string;
  review?: Record<string, string>;
};

export type InvoiceAction = { label: string; primary?: boolean; attrs: Record<string, string>; icon?: string; run?: boolean; /** Live: a download link (the invoice PDF) in place of a button. */ href?: string };

export type InvoiceViewData = {
  number: string;
  client: string;
  intro: string[];
  badge: MatterBadge;
  tags: { label: string; value: string }[];
  lock: string[];
  lines: LineRow[];
  allocations: AllocationRow[];
  allocationsEmpty: string;
  allocationsNote: string;
  /** Live only. */
  creditNotes: null | { rows: InvoiceCreditRow[]; empty: string };
  /** Live only: money held beyond what the invoice asks for, and how to refund it. */
  creditBalance: null | { title: string; copy: string };
  /** The Designer's sample invoice image (capture only). */
  preview: null | { src: string; srcSet: string; alt: string };
  history: Step[];
  actions: InvoiceAction[];
};

function Cell({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return <>{bold ? <b>{children}</b> : children}</>;
}

function Line({ row }: { row: LineRow }) {
  return (
    <tr>
      <td>
        {row.category ? (
          row.category.icon ? (
            <>
              <Icon name={row.category.icon} cls={"ic s"} />
              {` ${row.category.text}`}
            </>
          ) : (
            row.category.text
          )
        ) : null}
      </td>
      <td>
        <Cell bold={row.description.bold}>
          <Parts parts={row.description.parts} />
        </Cell>
      </td>
      <td>{row.qty}</td>
      <td>{row.tax}</td>
      <td className={"num"} style={RIGHT}>
        <Cell bold={row.amount.bold}>{row.amount.text}</Cell>
      </td>
    </tr>
  );
}

function Action({ action }: { action: InvoiceAction }) {
  const cls = action.primary ? "btn p sm" : "btn sm";
  if (action.href) {
    return (
      <a className={cls} href={action.href} {...action.attrs}>
        {action.label}
      </a>
    );
  }
  if (action.run) {
    return (
      <button className={cls} {...action.attrs}>
        <span className={"lab"}>
          {action.icon ? <Icon name={action.icon} cls={"ic s"} /> : null}
          {` ${action.label}`}
        </span>
        <span className={"spin"} aria-hidden={"true"}></span>
      </button>
    );
  }
  return (
    <button className={cls} {...action.attrs}>
      {action.label}
    </button>
  );
}

export function SheetFinanceInvoice({ data }: { data: InvoiceViewData }) {
  return (
    <div className={"fp-g2 rv"} style={i(0)}>
      <div>
        <div className={"ph"}>
          <div>
            <h1 className={"display"}>
              <Pair left={data.number} right={data.client} />
            </h1>
            <p>
              <Parts parts={data.intro} />
            </p>
          </div>
        </div>
        <div className={"fp-row"} style={{ margin: "-8px 0 18px" }}>
          <Badge badge={data.badge} />
          {data.tags.map((tag) => (
            <span key={tag.label} className={"fp-tag"}>
              {`${tag.label} `}
              <span className={"num"}>{tag.value}</span>
            </span>
          ))}
          <span className={"fp-tag"}>
            <Icon name={"lock"} cls={"ic s"} />
            <span>
              <Parts parts={data.lock} />
            </span>
          </span>
        </div>
        <section className={"panel"}>
          <h2>
            <Icon name={"invoice"} />
            {"Lines"}
          </h2>
          <div className={"tw"} role={"region"} aria-label={"Invoice lines"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Invoice lines"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Category"}</th>
                  <th scope={"col"}>{"Description"}</th>
                  <th scope={"col"}>{"Qty"}</th>
                  <th scope={"col"}>{"Tax"}</th>
                  <th scope={"col"} style={RIGHT}>
                    {"CAD"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((row, index) => (
                  <Line key={row.key ?? index} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className={"panel"}>
          <h2>
            <Icon name={"repeat"} />
            {"Allocations"}
          </h2>
          {data.allocations.length ? (
            <div className={"tw"} role={"region"} aria-label={"Allocations"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Allocations"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Date"}</th>
                    <th scope={"col"}>{"Source"}</th>
                    <th scope={"col"}>{"Evidence"}</th>
                    <th scope={"col"} style={RIGHT}>
                      {"CAD"}
                    </th>
                    <th scope={"col"}>{"State"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allocations.map((row, index) => (
                    <tr key={row.key ?? index}>
                      <td>{row.date}</td>
                      <td>{row.source}</td>
                      <td>
                        <Parts parts={row.evidence} />
                      </td>
                      <td className={"num"} style={RIGHT}>
                        {row.amount}
                      </td>
                      <td>
                        <Badge badge={row.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={"fp-pad"}>
              <p className={"fp-note"} style={{ margin: "0 0 8px" }}>
                {data.allocationsEmpty}
              </p>
            </div>
          )}
          <div className={"fp-pad"}>
            <p className={"fp-note"} style={{ margin: "0" }}>
              {data.allocationsNote}
            </p>
          </div>
        </section>
        {data.creditNotes ? (
          <section className={"panel"}>
            <h2>
              <Icon name={"note"} />
              {"Credit notes"}
            </h2>
            {data.creditNotes.rows.length ? (
              <div className={"tw"} role={"region"} aria-label={"Credit notes on this invoice"} tabIndex={0}>
                <table className={"t"}>
                  <caption className={"sr"}>{"Credit notes on this invoice"}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"Number"}</th>
                      <th scope={"col"}>{"Reason"}</th>
                      <th scope={"col"} style={RIGHT}>
                        {"CAD"}
                      </th>
                      <th scope={"col"}>{"State"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.creditNotes.rows.map((row, index) => (
                      <tr key={row.key ?? index}>
                        <td>
                          {row.pdf ? (
                            <a href={row.pdf} className={"num"} style={{ color: "var(--blue)" }} data-credit-note={"1"}>
                              {row.number}
                            </a>
                          ) : (
                            row.number
                          )}
                        </td>
                        <td>{row.reason}</td>
                        <td className={"num"} style={RIGHT}>
                          {row.amount}
                        </td>
                        <td>
                          {row.review ? (
                            <span className={"fp-row"}>
                              <Badge badge={row.state} />
                              <button className={"btn sm"} {...row.review}>
                                {"Review"}
                              </button>
                            </span>
                          ) : (
                            <Badge badge={row.state} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={"fp-pad"}>
                <p className={"fp-note"} style={{ margin: "0" }}>
                  {data.creditNotes.empty}
                </p>
              </div>
            )}
          </section>
        ) : null}
      </div>
      <div>
        {data.preview ? (
          <div className={"panel"}>
            <div className={"fp-pad"}>
              <img src={data.preview.src} srcSet={data.preview.srcSet} alt={data.preview.alt} style={{ width: "100%", borderRadius: "8px", border: "1px solid var(--line)" }} />
            </div>
          </div>
        ) : null}
        {data.creditBalance ? (
          <Alert tone={"warn"} icon={"refund"} title={data.creditBalance.title}>
            {data.creditBalance.copy}
          </Alert>
        ) : null}
        <section className={"panel"}>
          <h2>
            <Icon name={"history"} />
            {"History"}
          </h2>
          <div className={"fp-pad"}>
            <Steps steps={data.history} />
          </div>
        </section>
        {data.actions.length ? (
          <div className={"fp-row"}>
            {data.actions.map((action) => (
              <Action key={action.label} action={action} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type CreditReviewDialogData = { organizationId: string };

/**
 * Review a draft credit note (`#dlgCNR`), in `#dlgInv`'s anatomy. A row's Review fills it (number,
 * amount, reason, who drafted it, whether this person may issue it). Issue carries
 * `data-cn-issue`, Decline `data-cn-decline` (with a reason).
 */
export function CreditReviewDialog({ data }: { data: CreditReviewDialogData }) {
  return (
    <LiveDialog
      id={"dlgCNR"}
      title={"Review a credit note"}
      submit={
        <>
          <button className={"btn"} data-cn-decline={"1"} data-org={data.organizationId}>
            {"Decline"}
          </button>
          <button className={"btn p"} data-cn-issue={"1"} data-org={data.organizationId}>
            {"Issue credit note"}
          </button>
        </>
      }
    >
      <Dl
        rows={[
          { term: "Credit note", parts: ["—"], id: "cnrN" },
          { term: "Amount", parts: ["—"], id: "cnrA" },
          { term: "Reason", parts: ["—"], id: "cnrR" },
          { term: "Drafted by", parts: ["—"], id: "cnrB" },
        ]}
      />
      <div className={"alert warn"} id={"cnrSelf"} hidden>
        <Icon name={"info"} />
        <div>
          <b>{"Someone else issues it"}</b>
          {"You drafted this credit note, so another billing person issues it. The firm owner may issue their own draft."}
        </div>
      </div>
      <div className={"alert info"} id={"cnrOwn"} hidden>
        <Icon name={"info"} />
        <div>
          <b>{"Your own draft"}</b>
          {"As the firm owner you may issue it; you’ll confirm with your authenticator first. It shows as issued by owner (own draft)."}
        </div>
      </div>
      <Field id={"cnrW"} label={"Reason to decline"} hint={"Only if you decline it"}>
        <textarea className={"ta"} id={"cnrW"} aria-describedby={"cnrW-h"} maxLength={500} rows={2}></textarea>
      </Field>
      <Alert tone={"info"} icon={"info"} title={"It doesn’t move money"}>
        {"Issuing reduces what the client owes. If the invoice was already paid, the extra is a credit to refund separately: a card payment from the Payments tab."}
      </Alert>
    </LiveDialog>
  );
}

export type VoidDialogData = { organizationId: string; invoiceId: string; invoice: string; blocked: { title: string; copy: string } | null };

/** Void an issued invoice with nothing allocated (`#dlgVoid`), in `#dlgInv`'s anatomy. */
export function VoidDialog({ data }: { data: VoidDialogData }) {
  return (
    <LiveDialog
      id={"dlgVoid"}
      title={`Void ${data.invoice}`}
      submit={
        <button className={"btn p"} data-void-submit={"1"} data-org={data.organizationId} data-invoice={data.invoiceId} disabled={data.blocked ? true : undefined}>
          {"Void invoice"}
        </button>
      }
    >
      <Field id={"vdW"} label={"Reason"}>
        <textarea className={"ta"} id={"vdW"} maxLength={500} rows={2}></textarea>
      </Field>
      {data.blocked ? (
        <Alert tone={"warn"} icon={"info"} title={data.blocked.title}>
          {data.blocked.copy}
        </Alert>
      ) : (
        <Alert tone={"info"} icon={"info"} title={"The invoice stays on record"}>
          {
            "A voided invoice keeps its number and can’t be paid or changed. Only an invoice with nothing paid, transferred or credited can be voided; otherwise issue a credit note. Card payments the client started are canceled in Stripe. You’ll confirm with your authenticator."
          }
        </Alert>
      )}
    </LiveDialog>
  );
}
