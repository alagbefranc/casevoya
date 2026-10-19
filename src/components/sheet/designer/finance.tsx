/**
 * The Designer's Finance page, Invoices tab (`markup/finance.tsx`), rendered from the firm's
 * records. Same DOM, classes and order. Rows carry `data-f` (the filter chips: draft, issued,
 * partial, overdue, paid, closed) so the kit can filter real rows; the captured rows have none.
 *
 * The header's New invoice opens the Designer's `#dlgInv`. Given `live`, that dialog keeps the
 * Designer's anatomy (`.fld`, `.sel`, `.inp`, `.ta`, `.g2`, `.alert`) with the fields an invoice
 * needs (matter, delivered work or incurred cost, amount and currency, due date), and its submit
 * button carries `data-new-invoice` in place of the Designer's toast.
 *
 * The Payments tab (`FinanceMarkup({ variant: "tab-payments" })`) lists the firm's card payments
 * from `invoice_payments`. The Designer's bank-transfer flows (record, verify, transfer approval,
 * the "bank payment to verify" banner) are not ported. Two things it adds use the Designer's own
 * anatomy: the Stripe account banner (`.alert` with `.acts`, the slot of the Designer's banner)
 * and the Stripe balance (`.fp-kpi` tiles, as on the Invoices tab). Live, a received card payment
 * that can still be refunded carries a Refund button beside its badge, which opens `#dlgRefund`,
 * and a received payment's receipt (CICC Code s. 33(3)) follows its reference as a
 * "Receipt PR-0001" download link (the Designer's rows show "RC-0093" in that place as plain text;
 * the Designer capture has no `receipt`, so the fidelity test renders without it).
 *
 * The Refunds and disputes tab (`variant: "tab-refunds"`) lists the firm's card refunds, credit
 * notes and the disputes Stripe reported. The dispute Add evidence button is not ported.
 *
 * The credit note dialog (`#dlgCN`) is `CreditNoteDialog`; the Reconciliation and single-invoice
 * tabs are in `recon.tsx` and `invoice.tsx`.
 */
import type { ReactNode } from "react";
import { REFUND_REASONS } from "@/modules/sheet/finance-present";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import { FilterEmpty } from "./filter-empty";

export type FinanceText = string | { left: string; right: string };

export type FinanceHeaderData = {
  /** "CAD", then the firm (with "fictional" in the Designer's demo). */
  pills: FinanceText[];
  /** The Designer's "Record a payment" (manual bank payments). Not live yet. */
  recordPayment: boolean;
  /** The Designer's last tab, one open invoice ("INV-0218"). */
  invoiceTab: string | null;
  tab: "invoices" | "payments" | "funds" | "recon" | "refunds" | "invoice";
};

export type FinanceKpi = {
  href: string;
  label: string;
  /** A money value ("CAD 3,729.00"), or a count the kit animates. */
  value: { money: string } | { count: number };
  note: FinanceText;
  tone?: "bad" | "warn";
};

export type InvoiceRow = {
  key?: string;
  /** Filter chip tokens: draft, issued, partial, overdue, paid, closed. */
  flags?: string[];
  number: { href: string; label: string };
  client: SidebarPerson;
  matter: string;
  /** Line categories, shown with the Designer's separator between them. */
  categories: string[];
  issued: string;
  due: string;
  total: string;
  paid: string;
  state: MatterBadge;
};

export type FinanceData = {
  intro: string;
  kpis: FinanceKpi[];
  rows: InvoiceRow[];
  empty: null | { title: string; copy: string; action?: { label: string; dialog: string } };
  /** Live: the filter chips after All (the Designer's list without Draft when no invoice is a draft). */
  chips?: string[];
  /** Live only: the hidden "Nothing matches" panel for the chips and search. */
  filterEmpty?: boolean;
};

export type InvoiceOption = { value?: string; left: string; right?: string };

export type NewInvoiceDialogData = {
  matters: InvoiceOption[];
  /** The Designer's "Delivered work or incurred cost" choices (demo only). */
  work: InvoiceOption[];
  live?: {
    organizationId: string;
    sampleMode: boolean;
    currencies: string[];
    /** ISO date the due date starts at. */
    defaultDue: string;
    /** ISO date of today in the firm's timezone; the earliest due date. */
    today: string;
    /** Card payments are not set up: invoices can be issued, clients can't pay by card yet. */
    cardPaymentsReady: boolean;
    blocked: { title: string; copy: string } | null;
  };
};

export function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Text({ value }: { value: FinanceText }) {
  return typeof value === "string" ? <>{value}</> : <Pair left={value.left} right={value.right} />;
}

/** "a ", sep, " b ", sep, " c": the Designer's separated list in one cell. */
export function Parts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.flatMap((part, index) => {
        const last = index === parts.length - 1;
        const text = index === 0 ? (last ? part : `${part} `) : last ? ` ${part}` : ` ${part} `;
        return index === 0 ? [text] : [<Sep key={`s${index}`} />, text];
      })}
    </>
  );
}

const TABS: [string, string][] = [
  ["invoices", "Invoices"],
  ["payments", "Payments"],
  ["funds", "Client funds"],
  ["recon", "Reconciliation"],
  ["refunds", "Refunds and disputes"],
];

/** Where the Designer's capture leaves the tab underline (the kit moves it to the open tab). */
const UNDERLINE: Record<FinanceHeaderData["tab"], { left: string; width: string }> = {
  invoices: { left: "0px", width: "49px" },
  payments: { left: "75px", width: "56px" },
  funds: { left: "158px", width: "71px" },
  recon: { left: "255px", width: "85px" },
  refunds: { left: "365px", width: "124px" },
  invoice: { left: "515px", width: "58px" },
};

/** The Finance page's own top bar and its tab strip. */
export function FinanceHeader({ data }: { data: FinanceHeaderData }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"inbox"} cls={"ic s"} />
          {"Records"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"wallet"} cls={"ic s"} />
          {"Finance"}
        </button>
        {data.pills.map((pill, index) => (
          <span key={index} className={"pill"}>
            {typeof pill === "string" ? (
              pill
            ) : (
              <span>
                <Pair left={pill.left} right={pill.right} />
              </span>
            )}
          </span>
        ))}
        <span className={"acts"}>
          {data.recordPayment ? (
            <button className={"btn sm"} data-dlg={"dlgPay"} data-fpd={"1"}>
              <Icon name={"bank"} cls={"ic s"} />
              {"Record a payment"}
            </button>
          ) : null}
          <button className={"btn p sm"} data-dlg={"dlgInv"} data-fpd={"1"}>
            <Icon name={"plus"} cls={"ic s"} />
            {"New invoice"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={data.tab === key ? "on" : undefined}>
            {label}
          </button>
        ))}
        {data.invoiceTab ? (
          <button role={"tab"} data-t={"invoice"} className={data.tab === "invoice" ? "on" : undefined}>
            {data.invoiceTab}
          </button>
        ) : null}
        <i className={"ul"} style={UNDERLINE[data.tab]}></i>
      </div>
    </>
  );
}

export function Kpi({ kpi }: { kpi: FinanceKpi }) {
  return (
    <a className={kpi.tone ? `fp-k ${kpi.tone} k2-spot` : "fp-k k2-spot"} href={kpi.href} data-spot={"1"}>
      <small>{kpi.label}</small>
      {"money" in kpi.value ? (
        <b className={"num"}>{kpi.value.money}</b>
      ) : (
        <b className={"num"} data-count={String(kpi.value.count)} data-done={"1"}>
          {String(kpi.value.count)}
        </b>
      )}
      <span>
        <Text value={kpi.note} />
      </span>
    </a>
  );
}

export const RIGHT = { textAlign: "right" } as const;

function Row({ row }: { row: InvoiceRow }) {
  return (
    <tr data-f={row.flags?.length ? row.flags.join(" ") : undefined}>
      <td>
        <a href={row.number.href} className={"num"} style={{ color: "var(--blue)" }}>
          {row.number.label}
        </a>
      </td>
      <td>
        <span className={"fp-row"}>
          <Avatar person={row.client} />
          {row.client.name}
        </span>
      </td>
      <td>
        <span className={"num"}>{row.matter}</span>
      </td>
      <td>
        <Parts parts={row.categories} />
      </td>
      <td>
        <span className={"num"}>{row.issued}</span>
      </td>
      <td>
        <span className={"num"}>{row.due}</span>
      </td>
      <td className={"num"} style={RIGHT}>
        {row.total}
      </td>
      <td className={"num"} style={RIGHT}>
        {row.paid}
      </td>
      <td>
        <Badge badge={row.state} />
      </td>
    </tr>
  );
}

export const FINANCE_CHIPS = ["Draft", "Issued", "Partially paid", "Overdue", "Paid", "Voided or credited"];
const HEADS: [string, boolean][] = [
  ["Number", false],
  ["Client", false],
  ["Matter", false],
  ["Line categories", false],
  ["Issued", false],
  ["Due", false],
  ["Total", true],
  ["Paid", true],
  ["State", false],
];

export function SheetFinance({ data }: { data: FinanceData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Finance"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"fp-kpi rv"} style={i(1)}>
        {data.kpis.map((kpi) => (
          <Kpi key={kpi.label} kpi={kpi} />
        ))}
      </div>
      <div className={"bar fp-bar rv"} role={"search"} style={i(2)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search invoices, clients or matters"} aria-label={"Search invoices, clients or matters"} />
        <button className={"fchip on"} aria-pressed={"true"}>
          {"All"}
        </button>
        {(data.chips ?? FINANCE_CHIPS).map((label) => (
          <button key={label} className={"fchip"} aria-pressed={"false"}>
            {label}
          </button>
        ))}
      </div>
      {data.empty ? (
        <div className={"panel rv"} style={i(3)}>
          <Empty art={"invoice-plain"} title={data.empty.title} copy={data.empty.copy}>
            {data.empty.action ? (
              <button className={"btn p sm"} data-dlg={data.empty.action.dialog}>
                {data.empty.action.label}
              </button>
            ) : null}
          </Empty>
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Invoices"} tabIndex={0} style={i(3)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Invoices"}</caption>
            <thead>
              <tr>
                {HEADS.map(([head, right]) => (
                  <th key={head} scope={"col"} style={right ? RIGHT : undefined}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <Row key={row.key ?? index} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.filterEmpty && !data.empty ? <FilterEmpty n={3} /> : null}
      <p className={"fp-note rv"} style={i(4)}>
        {
          "State comes from payment allocations, never typed by hand. Issued invoices can’t be edited; correct them with a credit note. In the Canada RCIC set-up, an invoice needs delivered work or an incurred disbursement first; before that, send a quote or an advance request."
        }
      </p>
    </>
  );
}

export function Option({ option }: { option: InvoiceOption }) {
  return <option value={option.value}>{option.right ? <Pair left={option.left} right={option.right} /> : option.left}</option>;
}

export function Alert({ tone, icon, title, children }: { tone: "warn" | "info"; icon: string; title: string; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`}>
      <Icon name={icon} />
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

/** The Designer's New invoice dialog (`#dlgInv`); live, it issues a real invoice on a matter. */
export function NewInvoiceDialog({ data }: { data: NewInvoiceDialogData }) {
  const live = data.live;
  return (
    <dialog className={"dlg"} id={"dlgInv"} aria-labelledby={"dlgInvH"}>
      <div className={"dh"}>
        <h2 id={"dlgInvH"}>{"New invoice"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgInv"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"niC"}>{"Matter"}</label>
          <select className={"sel"} id={"niC"}>
            {data.matters.map((option, index) => (
              <Option key={option.value ?? index} option={option} />
            ))}
          </select>
        </div>
        {live ? (
          <>
            <div className={"fld"}>
              <label htmlFor={"niW"}>{"Delivered work or incurred cost"}</label>
              <small className={"hint"} id={"niW-h"}>
                {"Required before an earned-fee invoice. The client sees this on the invoice."}
              </small>
              <textarea className={"ta"} id={"niW"} aria-describedby={"niW-h"} maxLength={500} rows={2}></textarea>
            </div>
            <div className={"g2"}>
              <div className={"fld"}>
                <label htmlFor={"niA"}>{"Amount"}</label>
                <small className={"hint"} id={"niA-h"}>
                  {"Including any tax you charge."}
                </small>
                <input className={"inp"} id={"niA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"niA-h"} maxLength={16} />
              </div>
              <div className={"fld"}>
                <label htmlFor={"niCur"}>{"Currency"}</label>
                <select className={"sel"} id={"niCur"}>
                  {live.currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={"fld"}>
              <label htmlFor={"niDue"}>{"Due"}</label>
              <input className={"inp"} id={"niDue"} type={"date"} min={live.today} defaultValue={live.defaultDue} />
            </div>
            {live.sampleMode ? (
              <Alert tone={"warn"} icon={"info"} title={"This firm is in sample mode"}>
                {"Only sample matters take invoices until sample mode is turned off. Payments run in Stripe test mode; no real card is charged."}
              </Alert>
            ) : null}
            {live.blocked ? (
              <Alert tone={"warn"} icon={"info"} title={live.blocked.title}>
                {live.blocked.copy}
              </Alert>
            ) : live.cardPaymentsReady ? (
              <Alert tone={"info"} icon={"info"} title={"Issued to the client’s portal"}>
                {"The client pays by card in their portal. The invoice is marked paid when Stripe confirms the payment."}
              </Alert>
            ) : (
              <Alert tone={"info"} icon={"info"} title={"Card payments aren’t set up yet"}>
                {"The invoice is issued now. The client can pay by card once the firm owner finishes the Stripe account on the Payments tab."}
              </Alert>
            )}
          </>
        ) : (
          <>
            <div className={"fld"}>
              <label htmlFor={"niW"}>{"Delivered work or incurred cost"}</label>
              <small className={"hint"} id={"niW-h"}>
                {"Required before an earned-fee invoice"}
              </small>
              <select className={"sel"} id={"niW"}>
                {data.work.map((option, index) => (
                  <Option key={option.value ?? index} option={option} />
                ))}
              </select>
            </div>
            <div className={"alert info"}>
              <Icon name={"info"} />
              <div>
                <b>{"Work not delivered yet?"}</b>
                {"Send an advance request instead. It goes to the client account."}
              </div>
            </div>
          </>
        )}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgInv"}>
          {"Cancel"}
        </button>
        {live ? (
          <button className={"btn p"} data-new-invoice={"1"} data-org={live.organizationId} data-today={live.today} disabled={live.blocked ? true : undefined}>
            {"Issue invoice"}
          </button>
        ) : (
          <button className={"btn p"} data-close={"dlgInv"} data-toast={"Draft invoice INV-0223 created"} data-toast-sub={"Draft · not sent"}>
            {"Create draft"}
          </button>
        )}
      </div>
    </dialog>
  );
}

export type PaymentRow = {
  key?: string;
  /** Day received ("16 Oct"), in the firm's timezone. */
  received: string;
  from: string;
  method: string;
  /** The processor reference, then any detail, with the Designer's separator between them. */
  reference: string[];
  goesTo: string;
  amount: string;
  state: MatterBadge;
  /** Live only: a received card payment billing staff may still refund (opens `#dlgRefund`). */
  refund?: { paymentId: string; refundable: string; refundableCents: number; label: string };
  /** Live only: the payment's receipt ("Receipt PR-0001", CICC Code s. 33(3)), after the reference. */
  receipt?: { label: string; href: string };
};

export type PaymentsData = {
  intro: string;
  /** The amount column's heading, the currency ("CAD"). */
  currency: string;
  /** The Stripe balance and payouts tiles; null when the viewer may not see them. */
  balance: FinanceKpi[] | null;
  rows: PaymentRow[];
  empty: null | { title: string; copy: string };
  /** The closing note, split where the Designer puts a separator. */
  note: string[];
};

function PaymentLine({ row }: { row: PaymentRow }) {
  return (
    <tr>
      <td>{row.received}</td>
      <td>{row.from}</td>
      <td>{row.method}</td>
      <td>
        <Parts parts={row.reference} />
        {row.receipt ? (
          <>
            {" "}
            <Sep />{" "}
            <a href={row.receipt.href} className={"num"} style={{ color: "var(--blue)" }} data-payment-receipt={"1"}>
              {row.receipt.label}
            </a>
          </>
        ) : null}
      </td>
      <td>{row.goesTo}</td>
      <td className={"num"} style={RIGHT}>
        {row.amount}
      </td>
      <td>
        {row.refund ? (
          <span className={"fp-row"}>
            <Badge badge={row.state} />
            <button
              className={"btn sm"}
              data-refund-open={row.refund.paymentId}
              data-refundable={String(row.refund.refundableCents)}
              data-amount={row.refund.refundable}
              data-label={row.refund.label}
            >
              {"Refund"}
            </button>
          </span>
        ) : (
          <Badge badge={row.state} />
        )}
      </td>
    </tr>
  );
}

/**
 * The Payments tab. `status` is the Stripe account banner (it renders the Designer's `.alert`
 * itself, or nothing); it sits where the Designer has its bank-payment banner.
 */
export function SheetFinancePayments({ data, status }: { data: PaymentsData; status?: ReactNode }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Payments"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      {status}
      {data.balance ? (
        <div className={"fp-kpi rv"} style={i(1)}>
          {data.balance.map((kpi) => (
            <Kpi key={kpi.label} kpi={kpi} />
          ))}
        </div>
      ) : null}
      {data.empty ? (
        <div className={"panel rv"} style={i(2)}>
          <Empty art={"received-tray"} title={data.empty.title} copy={data.empty.copy} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Payments"} tabIndex={0} style={i(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Payments"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Received"}</th>
                <th scope={"col"}>{"From"}</th>
                <th scope={"col"}>{"Method"}</th>
                <th scope={"col"}>{"Reference"}</th>
                <th scope={"col"}>{"Goes to"}</th>
                <th scope={"col"} style={RIGHT}>
                  {data.currency}
                </th>
                <th scope={"col"}>{"State"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <PaymentLine key={row.key ?? index} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={"fp-note rv"} style={i(3)}>
        <Parts parts={data.note} />
      </p>
    </>
  );
}

export type RefundRow = {
  key?: string;
  /** "RF-0013". */
  number: string;
  client: string;
  /** "Card", then what the payment paid, with the Designer's separator between them. */
  from: string[];
  amount: string;
  /** Day requested ("11 Oct"), in the firm's timezone. */
  requested: string;
  state: MatterBadge;
};

export type DisputeRow = {
  key?: string;
  /** "DP-0003". */
  number: string;
  client: string;
  payment: string[];
  amount: string;
  /** Stripe's evidence deadline ("24 Oct"), or "—". */
  evidenceDue: string;
  state: MatterBadge;
};

export type CreditNoteRow = {
  key?: string;
  /** "CN-0007". Live, it links to the invoice's own tab. */
  number: string;
  href?: string;
  /** The invoice number, then the client, with the Designer's separator between them. */
  invoice: string[];
  amount: string;
  reason: string;
  /** "Lena Park, 8 Sep" when issued; who drafted it and that it waits for review otherwise. */
  issuedBy: string;
};

export type RefundsData = {
  intro: string;
  refunds: RefundRow[];
  /** Shown in the Refunds panel when there are no rows. */
  refundsEmpty: { title: string; copy: string };
  /** The Designer's failed-refund banner, for the latest failed refund. */
  failed: null | { title: string; copy: string };
  /** Credit notes against invoices (issued, waiting for review, declined), newest first. */
  creditNotes: CreditNoteRow[];
  creditNotesEmpty: { title: string; copy: string };
  disputes: DisputeRow[];
  disputesEmpty: { title: string; copy: string };
  /** Under the disputes table: the Designer's Add evidence button (demo only) and its note. */
  disputeFooter: null | { evidence?: { toast: string; sub: string }; note: string };
};

/**
 * The Refunds and disputes tab (Designer `tab-refunds`): refunds, credit notes (CN-, FIN-06) and
 * disputes, each in the Designer's panel. Live, a credit note's number links to its invoice's tab,
 * where it is reviewed and downloaded; the Add evidence button is not shown because evidence can't
 * be submitted from Casevoya.
 */
export function SheetFinanceRefunds({ data }: { data: RefundsData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Refunds and disputes"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <section className={"panel rv"} style={i(1)}>
        <h2>
          <Icon name={"refund"} />
          {"Refunds"}
        </h2>
        {data.refunds.length ? (
          <div className={"tw"} role={"region"} aria-label={"Refunds"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Refunds"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Number"}</th>
                  <th scope={"col"}>{"Client"}</th>
                  <th scope={"col"}>{"From payment"}</th>
                  <th scope={"col"} style={RIGHT}>
                    {"CAD"}
                  </th>
                  <th scope={"col"}>{"Requested"}</th>
                  <th scope={"col"}>{"State"}</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((row, index) => (
                  <tr key={row.key ?? index}>
                    <td>{row.number}</td>
                    <td>{row.client}</td>
                    <td>
                      <Parts parts={row.from} />
                    </td>
                    <td className={"num"} style={RIGHT}>
                      {row.amount}
                    </td>
                    <td>{row.requested}</td>
                    <td>
                      <Badge badge={row.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty art={"reconciliation"} title={data.refundsEmpty.title} copy={data.refundsEmpty.copy} />
        )}
        {data.failed ? (
          <div className={"fp-pad"}>
            <div className={"alert bad"} style={{ margin: "0" }}>
              <Icon name={"x-circle"} />
              <div>
                <b>{data.failed.title}</b>
                {data.failed.copy}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      <section className={"panel rv"} style={i(2)}>
        <h2>
          <Icon name={"note"} />
          {"Credit notes"}
        </h2>
        {data.creditNotes.length ? (
          <div className={"tw"} role={"region"} aria-label={"Credit notes"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Credit notes"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Number"}</th>
                  <th scope={"col"}>{"Invoice"}</th>
                  <th scope={"col"} style={RIGHT}>
                    {"CAD"}
                  </th>
                  <th scope={"col"}>{"Reason"}</th>
                  <th scope={"col"}>{"Issued by"}</th>
                </tr>
              </thead>
              <tbody>
                {data.creditNotes.map((row, index) => (
                  <tr key={row.key ?? index}>
                    <td>
                      {row.href ? (
                        <a href={row.href} className={"num"} style={{ color: "var(--blue)" }}>
                          {row.number}
                        </a>
                      ) : (
                        row.number
                      )}
                    </td>
                    <td>
                      <Parts parts={row.invoice} />
                    </td>
                    <td className={"num"} style={RIGHT}>
                      {row.amount}
                    </td>
                    <td>{row.reason}</td>
                    <td>{row.issuedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty art={"invoice-plain"} title={data.creditNotesEmpty.title} copy={data.creditNotesEmpty.copy} />
        )}
      </section>
      <section className={"panel rv"} style={i(3)}>
        <h2>
          <Icon name={"flag"} />
          {"Disputes and chargebacks"}
        </h2>
        {data.disputes.length ? (
          <div className={"tw"} role={"region"} aria-label={"Disputes"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Disputes"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Case"}</th>
                  <th scope={"col"}>{"Client"}</th>
                  <th scope={"col"}>{"Payment"}</th>
                  <th scope={"col"} style={RIGHT}>
                    {"CAD"}
                  </th>
                  <th scope={"col"}>{"Evidence due"}</th>
                  <th scope={"col"}>{"State"}</th>
                </tr>
              </thead>
              <tbody>
                {data.disputes.map((row, index) => (
                  <tr key={row.key ?? index}>
                    <td>{row.number}</td>
                    <td>{row.client}</td>
                    <td>
                      <Parts parts={row.payment} />
                    </td>
                    <td className={"num"} style={RIGHT}>
                      {row.amount}
                    </td>
                    <td>{row.evidenceDue}</td>
                    <td>
                      <Badge badge={row.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty art={"review-queue-empty"} title={data.disputesEmpty.title} copy={data.disputesEmpty.copy} />
        )}
        {data.disputeFooter ? (
          <div className={"fp-pad"}>
            <div className={"fp-row"}>
              {data.disputeFooter.evidence ? (
                <button className={"btn p sm"} data-toast={data.disputeFooter.evidence.toast} data-sub={data.disputeFooter.evidence.sub} data-fpb={"1"}>
                  {"Add evidence"}
                </button>
              ) : null}
              <span className={"fp-note"} style={{ margin: "0" }}>
                {data.disputeFooter.note}
              </span>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

export type RefundDialogData = {
  organizationId: string;
  /** The firm can refund: billing staff, with Stripe configured. Otherwise why not. */
  blocked: { title: string; copy: string } | null;
};

/**
 * Refund a card payment. The capture has no refund dialog, so this follows `#dlgInv`'s anatomy
 * (`.dh`, `.db` with `.fld`, `.g2`, `.inp`, `.sel`, `.alert`, `.df`). A Payments row's Refund
 * button fills it (payment, refundable amount) and opens it; Refund carries `data-refund-submit`.
 */
export function RefundDialog({ data }: { data: RefundDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgRefund"} aria-labelledby={"dlgRefundH"}>
      <div className={"dh"}>
        <h2 id={"dlgRefundH"}>{"Refund a card payment"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgRefund"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"rfP"}>{"Payment"}</label>
          <input className={"inp"} id={"rfP"} type={"text"} readOnly defaultValue={""} />
        </div>
        <div className={"g2"}>
          <div className={"fld"}>
            <label htmlFor={"rfA"}>{"Amount"}</label>
            <small className={"hint"} id={"rfA-h"}>
              {"Up to what is left to refund on this payment."}
            </small>
            <input className={"inp"} id={"rfA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"rfA-h"} maxLength={16} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"rfR"}>{"Reason"}</label>
            <select className={"sel"} id={"rfR"}>
              {REFUND_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {data.blocked ? (
          <Alert tone={"warn"} icon={"info"} title={data.blocked.title}>
            {data.blocked.copy}
          </Alert>
        ) : (
          <Alert tone={"info"} icon={"info"} title={"Returned to the client’s card"}>
            {
              "Stripe sends the money back to the card that paid (test mode: no real card). The refund shows as processing until Stripe confirms it. The matter stage and government status don’t change."
            }
          </Alert>
        )}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgRefund"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-refund-submit={"1"} data-org={data.organizationId} disabled={data.blocked ? true : undefined}>
          {"Refund"}
        </button>
      </div>
    </dialog>
  );
}

export type CreditNoteDialogData = {
  /** The Designer's capture: the invoice ("INV-0218") and the amount hint. */
  designer?: { invoice: string; hint: string };
  /** One invoice's credit note (the single-invoice tab): drafted here, issued by a second person. */
  live?: {
    organizationId: string;
    invoiceId: string;
    invoice: string;
    /** What can still be credited, in cents (the database checks again). */
    maxCents: number;
    hint: string;
    blocked: { title: string; copy: string } | null;
  };
};

/**
 * The Designer's credit note dialog (`#dlgCN`, "Issue a credit note for INV-…"). Given the Designer's
 * values it renders the capture; live, its Create draft carries `data-cn-submit` in place of the
 * Designer's toast, and says that someone else reviews the draft before it is issued.
 */
export function CreditNoteDialog({ data }: { data: CreditNoteDialogData }) {
  const live = data.live;
  const invoice = live?.invoice ?? data.designer?.invoice ?? "an invoice";
  const hint = live?.hint ?? data.designer?.hint ?? "";
  return (
    <dialog className={"dlg"} id={"dlgCN"} aria-labelledby={"dlgCNH"}>
      <div className={"dh"}>
        <h2 id={"dlgCNH"}>{`Issue a credit note for ${invoice}`}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgCN"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"cnA"}>{"Amount"}</label>
          <small className={"hint"} id={"cnA-h"}>
            {hint}
          </small>
          {live ? (
            <input className={"inp"} id={"cnA"} type={"text"} defaultValue={""} placeholder={"e.g. 113.00"} inputMode={"decimal"} autoComplete={"off"} aria-describedby={"cnA-h"} maxLength={16} />
          ) : (
            <input className={"inp"} id={"cnA"} type={"text"} defaultValue={""} placeholder={"e.g. 113.00"} />
          )}
        </div>
        <div className={"fld"}>
          <label htmlFor={"cnR"}>{"Reason"}</label>
          {live ? <textarea className={"ta"} id={"cnR"} maxLength={500} rows={2}></textarea> : <textarea className={"ta"} id={"cnR"}></textarea>}
        </div>
        <p className={"fp-note"}>{"A credit note reduces what’s owed. It doesn’t send money back; that’s a refund."}</p>
        {live ? (
          live.blocked ? (
            <Alert tone={"warn"} icon={"info"} title={live.blocked.title}>
              {live.blocked.copy}
            </Alert>
          ) : (
            <Alert tone={"info"} icon={"info"} title={"Someone else reviews it"}>
              {
                "The draft is issued only when another billing person reviews it; the firm owner may issue their own after confirming with their authenticator. If the invoice was already paid, the credit becomes a balance to refund separately."
              }
            </Alert>
          )
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgCN"}>
          {"Cancel"}
        </button>
        {live ? (
          <button
            className={"btn p"}
            data-cn-submit={"1"}
            data-org={live.organizationId}
            data-invoice={live.invoiceId}
            data-max={String(live.maxCents)}
            disabled={live.blocked ? true : undefined}
          >
            {"Create draft"}
          </button>
        ) : (
          <button className={"btn p"} data-close={"dlgCN"} data-toast={"Credit note CN-0008 drafted"} data-toast-sub={"Lena reviews it before it’s issued."}>
            {"Create draft"}
          </button>
        )}
      </div>
    </dialog>
  );
}
