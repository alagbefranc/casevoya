/**
 * The Designer's Finance page, Invoices tab (`markup/finance.tsx`), rendered from the firm's
 * records. Same DOM, classes and order. Rows carry `data-f` (the filter chips: draft, issued,
 * partial, overdue, paid, closed) so the kit can filter real rows; the captured rows have none.
 *
 * The header's New invoice opens the Designer's `#dlgInv`. Given `live`, that dialog keeps the
 * Designer's anatomy (`.fld`, `.sel`, `.inp`, `.ta`, `.g2`, `.alert`) with the fields an invoice
 * needs (matter, delivered work or incurred cost, amount and currency, due date), and its submit
 * button carries `data-new-invoice` in place of the Designer's toast. The Payments tab is the
 * firm's Stripe account through Connect embedded components; it has no Designer capture and
 * uses the Designer's page anatomy (`.ph`, `.panel`, `.alert`).
 */
import type { ReactNode } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type FinanceText = string | { left: string; right: string };

export type FinanceHeaderData = {
  /** "CAD", then the firm (with "fictional" in the Designer's demo). */
  pills: FinanceText[];
  /** The Designer's "Record a payment" (manual bank payments). Not live yet. */
  recordPayment: boolean;
  /** The Designer's last tab, one open invoice ("INV-0218"). */
  invoiceTab: string | null;
  tab: "invoices" | "payments";
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

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Text({ value }: { value: FinanceText }) {
  return typeof value === "string" ? <>{value}</> : <Pair left={value.left} right={value.right} />;
}

/** "a ", sep, " b ", sep, " c": the Designer's separated list in one cell. */
function Parts({ parts }: { parts: string[] }) {
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
          <button role={"tab"} data-t={"invoice"}>
            {data.invoiceTab}
          </button>
        ) : null}
        <i className={"ul"} style={{ left: "0px", width: "49px" }}></i>
      </div>
    </>
  );
}

function Kpi({ kpi }: { kpi: FinanceKpi }) {
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

const RIGHT = { textAlign: "right" } as const;

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

const CHIPS = ["Draft", "Issued", "Partially paid", "Overdue", "Paid", "Voided or credited"];
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
        {CHIPS.map((label) => (
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
      <p className={"fp-note rv"} style={i(4)}>
        {
          "State comes from payment allocations, never typed by hand (FIN-07). Issued invoices can’t be edited; correct them with a credit note. In the Canada RCIC set-up, an invoice needs delivered work or an incurred disbursement first; before that, send a quote or an advance request."
        }
      </p>
    </>
  );
}

function Option({ option }: { option: InvoiceOption }) {
  return <option value={option.value}>{option.right ? <Pair left={option.left} right={option.right} /> : option.left}</option>;
}

function Alert({ tone, icon, title, children }: { tone: "warn" | "info"; icon: string; title: string; children: ReactNode }) {
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

/** The Payments tab: the firm's Stripe account, managed in Casevoya. */
export function SheetFinancePayments({ intro, children }: { intro: string; children: ReactNode }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Card payments"}</h1>
          <p>{intro}</p>
        </div>
      </div>
      <div className={"panel rv"} style={{ ...i(1), padding: "20px 22px" }}>
        {children}
      </div>
    </>
  );
}
