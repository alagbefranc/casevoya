/**
 * The Designer's Finance page, Client funds tab (`markup/finance.tsx`, variant `tab-funds`), and its
 * dialogs: Record a bank payment (`#dlgPay`), Verify (`#dlgVer`) and Approve earned-fee transfer
 * (`#dlgTr`). Same DOM, classes and order. Given the Designer's values they render the capture;
 * live, they show the firm's own client-account ledger (one panel per client and matter) and the
 * dialogs carry data attributes in place of the Designer's toasts.
 *
 * Live differences from the capture, all in the Designer's own anatomy:
 *   * `#dlgPay` asks whose money it is (client and matter), takes a typed evidence note instead of
 *     an upload (files are not stored yet) and has no Reviewer: any billing person may verify.
 *   * `#dlgVer` adds a Reject with a reason for a payment that isn't on the statement, and says
 *     why the person who recorded a payment can't verify it (the firm owner may verify their own,
 *     after a fresh step-up, shown as "Verified by owner (own entry)"). Verifying issues the receipt (CICC Code s. 32(b)),
 *     downloaded from the ledger row. An approved transfer's row links the receipt for the invoice
 *     payment it made ("Receipt PR-0001", s. 33(3)) the same way.
 *   * An approved transfer reads "Approved — awaiting bank transfer" until the bank transfer is
 *     recorded (`#dlgBank`, the Designer's "Record the bank transfer next"). A sub-ledger with money
 *     to withdraw shows "Withdraw by <date>" (CICC Code s. 32(g): 30 days after the invoice).
 *   * `#dlgTr` adds a decline reason; its Approve says who approves. The requester can't approve
 *     their own transfer unless they are the firm owner (decided by Francis), and the dialog says so.
 *   * The "Last reconciliation" tile is "Available": reconciliation is not built.
 *   * Four dialogs the capture doesn't have, in `#dlgInv`'s anatomy: propose a transfer
 *     (`#dlgTrNew`), refund to the client (`#dlgOut`), correct an entry (`#dlgFix`) and add the
 *     client account (`#dlgAcct`).
 */
import type { ReactNode } from "react";
import { CLIENT_FUND_METHODS, type LedgerLine } from "@/modules/finance/client-funds-present";
import { Empty, Icon, Pair } from "./frame";
import { Alert, i, Kpi, Parts, RIGHT, type FinanceKpi } from "./finance";
import { Badge, type MatterBadge } from "./matters";

export type FundsAction = { label: string; primary?: boolean; attrs: Record<string, string> };

export type FundsPanel = {
  key?: string;
  client: string;
  matter: string;
  badge: MatterBadge;
  rows: LedgerLine[];
  footer: null | { actions: FundsAction[]; note: string };
};

export type FundsData = {
  intro: string;
  kpis: FinanceKpi[];
  panels: FundsPanel[];
  empty: null | { title: string; copy: string; actions: FundsAction[] };
  alert: { title: string; copy: string };
};

function ActionButton({ action }: { action: FundsAction }) {
  return (
    <button className={action.primary ? "btn p sm" : "btn sm"} {...action.attrs}>
      {action.label}
    </button>
  );
}

function Panel({ panel, index }: { panel: FundsPanel; index: number }) {
  const label = `Client-account ledger, ${panel.client}`;
  return (
    <section className={"panel rv"} style={i(index)}>
      <h2>
        <Icon name={"wallet"} />
        <span>
          <Pair left={panel.client} right={panel.matter} />
        </span>
        <span className={"r"}>
          <Badge badge={panel.badge} />
        </span>
      </h2>
      <div className={"tw"} role={"region"} aria-label={label} tabIndex={0}>
        <table className={"t"}>
          <caption className={"sr"}>{label}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Date"}</th>
              <th scope={"col"}>{"Entry"}</th>
              <th scope={"col"}>{"Evidence"}</th>
              <th scope={"col"} style={RIGHT}>
                {"In"}
              </th>
              <th scope={"col"} style={RIGHT}>
                {"Out"}
              </th>
              <th scope={"col"} style={RIGHT}>
                {"Balance"}
              </th>
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((row, rowIndex) => (
              <tr key={row.key || rowIndex}>
                <td>{row.date}</td>
                <td>
                  <Parts parts={row.entry} />
                  {row.receipt ? (
                    <>
                      {" "}
                      <span className={"sep"} aria-hidden={"true"}></span>{" "}
                      <a href={row.receipt.href} className={"num"} style={{ color: "var(--blue)" }} data-funds-receipt={"1"}>
                        {row.receipt.label}
                      </a>
                    </>
                  ) : null}
                </td>
                <td>
                  <Parts parts={row.evidence} />
                </td>
                <td className={"num"} style={RIGHT}>
                  {row.in}
                </td>
                <td className={"num"} style={RIGHT}>
                  {row.out}
                </td>
                <td className={"num"} style={RIGHT}>
                  {row.balance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {panel.footer ? (
        <div className={"fp-pad"}>
          <div className={"fp-row"}>
            {panel.footer.actions.map((action) => (
              <ActionButton key={action.label + JSON.stringify(action.attrs)} action={action} />
            ))}
            <span className={"fp-note"} style={{ margin: "0" }}>
              {panel.footer.note}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The Client funds tab: KPI tiles, one ledger panel per client and matter, the separation note. */
export function SheetFinanceFunds({ data }: { data: FundsData }) {
  const after = 2 + Math.max(data.panels.length, data.empty ? 1 : 0);
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/client-funds-160@1x.webp"}
            srcSet={"/assets/generated/b2/client-funds-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{"Client funds"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"fp-kpi rv"} style={i(1)}>
        {data.kpis.map((kpi) => (
          <Kpi key={kpi.label} kpi={kpi} />
        ))}
      </div>
      {data.empty ? (
        <div className={"panel rv"} style={i(2)}>
          <Empty art={"client-funds"} title={data.empty.title} copy={data.empty.copy}>
            {data.empty.actions.length ? (
              <span className={"fp-row"}>
                {data.empty.actions.map((action) => (
                  <ActionButton key={action.label} action={action} />
                ))}
              </span>
            ) : null}
          </Empty>
        </div>
      ) : (
        data.panels.map((panel, index) => <Panel key={panel.key ?? index} panel={panel} index={2 + index} />)
      )}
      <div className={"alert lockd rv"} style={i(after)}>
        <Icon name={"shield"} />
        <div>
          <b>{data.alert.title}</b>
          {data.alert.copy}
        </div>
      </div>
    </>
  );
}

function DialogHead({ id, title }: { id: string; title: string }) {
  return (
    <div className={"dh"}>
      <h2 id={`${id}H`}>{title}</h2>
      <button className={"x"} aria-label={"Close"} data-close={id}>
        <Icon name={"close"} cls={"ic s"} />
      </button>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      {children}
    </div>
  );
}

export type FundsOption = { value: string; label: string; data?: Record<string, string> };

function Options({ options }: { options: FundsOption[] }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={option.value} {...option.data}>
          {option.label}
        </option>
      ))}
    </>
  );
}

export type Blocked = { title: string; copy: string } | null;

// ---------------------------------------------------------------------------
// Record a bank payment (#dlgPay)
// ---------------------------------------------------------------------------

export type RecordPaymentDialogData = {
  /** The Designer's sample values (the capture). */
  designer?: { amount: string; methods: string[]; reference: string; received: string; destinations: string[]; reviewers: string[] };
  live?: {
    organizationId: string;
    today: string;
    sampleMode: boolean;
    parties: FundsOption[];
    accounts: FundsOption[];
    blocked: Blocked;
  };
};

const PAY_INTRO = "It stays “Pending verification” until it matches the bank statement (FIN-09).";

export function RecordPaymentDialog({ data }: { data: RecordPaymentDialogData }) {
  const live = data.live;
  const designer = data.designer;
  return (
    <dialog className={"dlg"} id={"dlgPay"} aria-labelledby={"dlgPayH"}>
      <DialogHead id={"dlgPay"} title={"Record a bank payment"} />
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{PAY_INTRO}</p>
        {live ? (
          <>
            <Field id={"mpC"} label={"Client and matter"} hint={"Whose money it is. Each client has their own ledger on each matter."}>
              <select className={"sel"} id={"mpC"} aria-describedby={"mpC-h"}>
                <Options options={live.parties} />
              </select>
            </Field>
            <div className={"g2"}>
              <Field id={"mpA"} label={"Amount"} hint={"CAD"}>
                <input className={"inp"} id={"mpA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"mpA-h"} maxLength={16} />
              </Field>
              <Field id={"mpM"} label={"Method"}>
                <select className={"sel"} id={"mpM"}>
                  <Options options={CLIENT_FUND_METHODS.map((method) => ({ value: method.value, label: method.label }))} />
                </select>
              </Field>
            </div>
            <div className={"g2"}>
              <Field id={"mpR"} label={"External reference"}>
                <input className={"inp"} id={"mpR"} type={"text"} autoComplete={"off"} maxLength={80} />
              </Field>
              <Field id={"mpD"} label={"Received on"}>
                <input className={"inp"} id={"mpD"} type={"date"} max={live.today} defaultValue={live.today} />
              </Field>
            </div>
            <Field id={"mpB"} label={"Bank destination"} hint={"Advances must go to the client account"}>
              <select className={"sel"} id={"mpB"} aria-describedby={"mpB-h"}>
                <Options options={live.accounts} />
              </select>
            </Field>
            <Field id={"mpE"} label={"Evidence"} hint={"What you’ll match it against: a statement line, a screenshot, a cheque number. Files aren’t stored here yet."}>
              <textarea className={"ta"} id={"mpE"} aria-describedby={"mpE-h"} maxLength={500} rows={2}></textarea>
            </Field>
            {live.sampleMode ? (
              <Alert tone={"warn"} icon={"info"} title={"This firm is in sample mode"}>
                {"Only sample matters take client funds until sample mode is turned off. Nothing here moves real money."}
              </Alert>
            ) : null}
            {live.blocked ? (
              <Alert tone={"warn"} icon={"info"} title={live.blocked.title}>
                {live.blocked.copy}
              </Alert>
            ) : null}
          </>
        ) : designer ? (
          <>
            <div className={"fld"}>
              <label htmlFor={"mpA"}>{"Amount"}</label>
              <small className={"hint"} id={"mpA-h"}>
                {"CAD"}
              </small>
              <input className={"inp"} id={"mpA"} type={"text"} defaultValue={designer.amount} placeholder={""} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"mpM"}>{"Method"}</label>
              <select className={"sel"} id={"mpM"}>
                {designer.methods.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </div>
            <div className={"fld"}>
              <label htmlFor={"mpR"}>{"External reference"}</label>
              <input className={"inp"} id={"mpR"} type={"text"} defaultValue={designer.reference} placeholder={""} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"mpD"}>{"Received on"}</label>
              <input className={"inp"} id={"mpD"} type={"text"} defaultValue={designer.received} placeholder={""} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"mpB"}>{"Bank destination"}</label>
              <small className={"hint"} id={"mpB-h"}>
                {"Advances must go to the client account"}
              </small>
              <select className={"sel"} id={"mpB"}>
                {designer.destinations.map((destination) => (
                  <option key={destination}>{destination}</option>
                ))}
              </select>
            </div>
            <div className={"fld"}>
              <label htmlFor={"mpE"}>{"Evidence"}</label>
              <button className={"btn sm"}>
                <Icon name={"upload"} cls={"ic s"} />
                {"Upload a statement line or screenshot"}
              </button>
            </div>
            <div className={"fld"}>
              <label htmlFor={"mpV"}>{"Reviewer"}</label>
              <select className={"sel"} id={"mpV"}>
                {designer.reviewers.map((reviewer) => (
                  <option key={reviewer}>{reviewer}</option>
                ))}
              </select>
            </div>
          </>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgPay"}>
          {"Cancel"}
        </button>
        {live ? (
          <button className={"btn p"} data-funds-deposit={"1"} data-org={live.organizationId} data-today={live.today} disabled={live.blocked ? true : undefined}>
            {"Record payment"}
          </button>
        ) : (
          <button className={"btn p"} data-close={"dlgPay"} data-toast={"Payment recorded"} data-toast-sub={"Pending verification. Nothing is marked paid yet."} data-toast-kind={"ok"}>
            {"Record payment"}
          </button>
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Verify (#dlgVer)
// ---------------------------------------------------------------------------

export type DlRow = { term: string; parts: string[]; id?: string };

function Dl({ rows }: { rows: DlRow[] }) {
  return (
    <dl className={"fp-dl"}>
      {rows.map((row) => (
        <div key={row.term}>
          <dt>{row.term}</dt>
          <dd id={row.id}>
            <Parts parts={row.parts} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type VerifyDialogData = {
  designer?: { title: string; rows: DlRow[] };
  live?: { organizationId: string };
};

/** Live, a ledger's Verify button fills the `dd`s (by id) and the title, then opens it. */
export function VerifyPaymentDialog({ data }: { data: VerifyDialogData }) {
  const live = data.live;
  const rows: DlRow[] = live
    ? [
        { term: "Amount", parts: ["—"], id: "vA" },
        { term: "Reference", parts: ["—"], id: "vR" },
        { term: "Received", parts: ["—"], id: "vD" },
        { term: "Evidence", parts: ["—"], id: "vE" },
        { term: "Recorded by", parts: ["—"], id: "vB" },
        { term: "Destination", parts: ["—"], id: "vT" },
      ]
    : (data.designer?.rows ?? []);
  return (
    <dialog className={"dlg"} id={"dlgVer"} aria-labelledby={"dlgVerH"}>
      <DialogHead id={"dlgVer"} title={live ? "Verify a payment" : (data.designer?.title ?? "")} />
      <div className={"db"}>
        <Dl rows={rows} />
        <label className={"check"} style={{ marginTop: "12px" }}>
          <input type={"checkbox"} id={"vOk"} />
          <span>{"The amount, date and reference match the bank statement"}</span>
        </label>
        {live ? (
          <>
            <div className={"alert warn"} id={"vSelf"} hidden>
              <Icon name={"info"} />
              <div>
                <b>{"You recorded this payment"}</b>
                {"A second person verifies it against the bank statement: the firm owner or another finance user on this matter. You can still reject it if it was recorded by mistake."}
              </div>
            </div>
            <div className={"alert info"} id={"vOwn"} hidden>
              <Icon name={"info"} />
              <div>
                <b>{"Your own entry"}</b>
                {"As the firm owner you may verify a payment you recorded. You’ll confirm with your authenticator first. It’s shown as “Verified by owner (own entry)” and kept in the audit log."}
              </div>
            </div>
            <Field id={"vWhy"} label={"If it doesn’t match"} hint={"Reject it with a reason. A rejected payment never counts in the client’s balance."}>
              <textarea className={"ta"} id={"vWhy"} aria-describedby={"vWhy-h"} maxLength={500} rows={2}></textarea>
            </Field>
            <p className={"fp-note"}>{"Verifying issues the client’s receipt for the advance (CICC Code s. 32(b)). They can download it from their portal."}</p>
          </>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgVer"}>
          {"Not yet"}
        </button>
        {live ? (
          <>
            <button className={"btn"} data-funds-reject={"1"} data-org={live.organizationId}>
              {"Reject"}
            </button>
            <button className={"btn p"} data-funds-verify={"1"} data-org={live.organizationId}>
              {"Verify"}
            </button>
          </>
        ) : (
          <button className={"btn p"} data-close={"dlgVer"} data-toast={"Tick the check first"} data-toast-sub={"Kofi’s CAD 1,808.00 is now available in his client ledger."} data-toast-kind={"bad"}>
            {"Verify"}
          </button>
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Approve earned-fee transfer (#dlgTr)
// ---------------------------------------------------------------------------

export type TransferDialogData = {
  designer?: { rows: DlRow[]; note: string; approveLabel: string };
  live?: { organizationId: string };
};

const TRANSFER_NOTE_LIVE =
  "Someone other than the person who asked approves it. The firm owner may approve any transfer, including their own request; that approval is recorded as the owner’s own.";

/** Live, a ledger's Review transfer button fills the `dd`s, the Approve label and whether it may approve. */
export function ApproveTransferDialog({ data }: { data: TransferDialogData }) {
  const live = data.live;
  const rows: DlRow[] = live
    ? [
        { term: "From", parts: ["—"], id: "tF" },
        { term: "To", parts: ["The firm’s operating account"], id: "tT" },
        { term: "For", parts: ["—"], id: "tFor" },
        { term: "Amount", parts: ["—"], id: "tA" },
        { term: "Approvals", parts: ["—"], id: "tAp" },
        { term: "Bank transfer", parts: ["Made from the client account after approval, then recorded here"], id: "tB" },
      ]
    : (data.designer?.rows ?? []);
  return (
    <dialog className={"dlg"} id={"dlgTr"} aria-labelledby={"dlgTrH"}>
      <DialogHead id={"dlgTr"} title={"Approve earned-fee transfer"} />
      <div className={"db"}>
        <Dl rows={rows} />
        <p className={"fp-note"}>{live ? TRANSFER_NOTE_LIVE : (data.designer?.note ?? "")}</p>
        {live ? (
          <>
            <div className={"alert warn"} id={"tSelf"} hidden>
              <Icon name={"info"} />
              <div>
                <b>{"You asked for this transfer"}</b>
                {"Someone else approves it: the firm owner or another finance user on this matter. You can still decline it."}
              </div>
            </div>
            <Field id={"tWhy"} label={"Reason, if you decline"}>
              <textarea className={"ta"} id={"tWhy"} maxLength={500} rows={2}></textarea>
            </Field>
          </>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgTr"}>
          {"Cancel"}
        </button>
        {live ? (
          <>
            <button className={"btn"} data-funds-decline={"1"} data-org={live.organizationId}>
              {"Decline"}
            </button>
            <button className={"btn p"} data-funds-approve={"1"} data-org={live.organizationId}>
              {"Approve"}
            </button>
          </>
        ) : (
          <>
            <button className={"btn"} data-close={"dlgTr"} data-toast={"Transfer declined"} data-toast-sub={"Reason requested. Funds stay in the client account."}>
              {"Decline"}
            </button>
            <button className={"btn p"} data-close={"dlgTr"} data-toast={"Approved by Lena Park"} data-toast-sub={"2 of 2. Record the bank transfer next."} data-toast-kind={"ok"}>
              {data.designer?.approveLabel ?? "Approve"}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Live-only dialogs, in #dlgInv's anatomy
// ---------------------------------------------------------------------------

function LiveDialog({ id, title, children, submit }: { id: string; title: string; children: ReactNode; submit: ReactNode }) {
  return (
    <dialog className={"dlg"} id={id} aria-labelledby={`${id}H`}>
      <DialogHead id={id} title={title} />
      <div className={"db"}>{children}</div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        {submit}
      </div>
    </dialog>
  );
}

export type FundsLiveDialogsData = {
  organizationId: string;
  today: string;
  /** Sub-ledgers with money available: value = ledger id, data-matter, data-available (cents). */
  ledgers: FundsOption[];
  /** Issued invoices with an amount due: value = invoice id, data-matter, data-due (cents). */
  invoices: FundsOption[];
  /** Entries that can be corrected: value = entry id, data-ledger. */
  corrections: FundsOption[];
  /** Approved transfers whose bank transfer isn't recorded: value = entry id, data-ledger, data-earliest (invoice date). */
  bankTransfers: FundsOption[];
  /** Firm owner: may add the client account. */
  isOwner: boolean;
};

export function FundsLiveDialogs({ data }: { data: FundsLiveDialogsData }) {
  const noLedger = data.ledgers.length === 0;
  return (
    <>
      <LiveDialog
        id={"dlgTrNew"}
        title={"Transfer earned fees"}
        submit={
          <button className={"btn p"} data-funds-transfer={"1"} data-org={data.organizationId} disabled={noLedger ? true : undefined}>
            {"Ask for approval"}
          </button>
        }
      >
        <Field id={"tnL"} label={"From the client ledger"}>
          <select className={"sel"} id={"tnL"} data-ledger-select={"1"}>
            <Options options={data.ledgers} />
          </select>
        </Field>
        <Field id={"tnI"} label={"For the issued invoice"} hint={"Only an issued invoice on the same matter, after the work was delivered."}>
          <select className={"sel"} id={"tnI"} aria-describedby={"tnI-h"} data-matter-filter={"1"}>
            <Options options={data.invoices} />
          </select>
        </Field>
        <Field id={"tnA"} label={"Amount"} hint={"CAD. No more than the client has available or the invoice has due."}>
          <input className={"inp"} id={"tnA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"tnA-h"} maxLength={16} />
        </Field>
        <Field id={"tnN"} label={"What was delivered"}>
          <textarea className={"ta"} id={"tnN"} maxLength={500} rows={2} placeholder={"Milestone 1, preparation delivered 1–15 Oct"}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"Two people, by default"}>
          {"Someone other than you approves it before it counts; the firm owner may approve their own request. A ledger entry doesn’t move money: make the bank transfer from the client account after approval."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgOut"}
        title={"Refund to the client"}
        submit={
          <button className={"btn p"} data-funds-refund={"1"} data-org={data.organizationId} data-today={data.today} disabled={noLedger ? true : undefined}>
            {"Record refund"}
          </button>
        }
      >
        <Field id={"roL"} label={"From the client ledger"}>
          <select className={"sel"} id={"roL"} data-ledger-select={"1"}>
            <Options options={data.ledgers} />
          </select>
        </Field>
        <div className={"g2"}>
          <Field id={"roA"} label={"Amount"} hint={"CAD"}>
            <input className={"inp"} id={"roA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"roA-h"} maxLength={16} />
          </Field>
          <Field id={"roM"} label={"Method"}>
            <select className={"sel"} id={"roM"}>
              <Options options={CLIENT_FUND_METHODS.map((method) => ({ value: method.value, label: method.label }))} />
            </select>
          </Field>
        </div>
        <div className={"g2"}>
          <Field id={"roR"} label={"External reference"}>
            <input className={"inp"} id={"roR"} type={"text"} autoComplete={"off"} maxLength={80} />
          </Field>
          <Field id={"roD"} label={"Paid on"}>
            <input className={"inp"} id={"roD"} type={"date"} max={data.today} defaultValue={data.today} />
          </Field>
        </div>
        <Field id={"roW"} label={"Reason"}>
          <textarea className={"ta"} id={"roW"} maxLength={500} rows={2}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"Record it once it’s sent"}>
          {"Send the money from the client account first, then record it here. It can’t be more than the client has available."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgFix"}
        title={"Correct an entry"}
        submit={
          <button className={"btn p"} data-funds-correct={"1"} data-org={data.organizationId} disabled={data.corrections.length ? undefined : true}>
            {"Add reversing entry"}
          </button>
        }
      >
        <Field id={"rcE"} label={"Entry to reverse"}>
          <select className={"sel"} id={"rcE"} data-ledger-filter={"1"}>
            <Options options={data.corrections} />
          </select>
        </Field>
        <Field id={"rcW"} label={"Reason"}>
          <textarea className={"ta"} id={"rcW"} maxLength={500} rows={2}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"Nothing is edited or deleted"}>
          {"A correction adds a reversing entry; both stay on the ledger. A verified deposit or a refund can be reversed once. An approved transfer can’t be reversed here."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgBank"}
        title={"Record the bank transfer"}
        submit={
          <button className={"btn p"} data-funds-bank={"1"} data-org={data.organizationId} data-today={data.today} disabled={data.bankTransfers.length ? undefined : true}>
            {"Record transfer"}
          </button>
        }
      >
        <Field id={"bkE"} label={"Approved transfer"}>
          <select className={"sel"} id={"bkE"} data-ledger-filter={"1"}>
            <Options options={data.bankTransfers} />
          </select>
        </Field>
        <div className={"g2"}>
          <Field id={"bkD"} label={"Sent by the bank on"}>
            <input className={"inp"} id={"bkD"} type={"date"} max={data.today} defaultValue={data.today} />
          </Field>
          <Field id={"bkR"} label={"Bank reference"}>
            <input className={"inp"} id={"bkR"} type={"text"} autoComplete={"off"} maxLength={80} />
          </Field>
        </div>
        <Field id={"bkN"} label={"Note"} hint={"Optional"}>
          <textarea className={"ta"} id={"bkN"} aria-describedby={"bkN-h"} maxLength={500} rows={2}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"Withdraw within 30 days of the invoice"}>
          {"CICC Code s. 32(g): the invoiced amount leaves the client account no later than 30 days after the day the client is invoiced. Record it once your bank has sent it from the client account to the operating account. It can be recorded once."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgAcct"}
        title={"Add the client account"}
        submit={
          <button className={"btn p"} data-funds-account={"1"} data-org={data.organizationId} disabled={data.isOwner ? undefined : true}>
            {"Add account"}
          </button>
        }
      >
        <Field id={"caL"} label={"Name"}>
          <input className={"inp"} id={"caL"} type={"text"} autoComplete={"off"} maxLength={80} defaultValue={"Client account"} />
        </Field>
        <div className={"g2"}>
          <Field id={"caI"} label={"Bank or credit union"}>
            <input className={"inp"} id={"caI"} type={"text"} autoComplete={"off"} maxLength={120} />
          </Field>
          <Field id={"caN"} label={"Last four digits"}>
            <input className={"inp"} id={"caN"} type={"text"} inputMode={"numeric"} autoComplete={"off"} maxLength={4} />
          </Field>
        </div>
        {data.isOwner ? (
          <Alert tone={"info"} icon={"info"} title={"Only the last four digits are kept"}>
            {"This is the firm’s own client (trust) account at its bank. Casevoya records what happens in it; it never holds or moves the money."}
          </Alert>
        ) : (
          <Alert tone={"warn"} icon={"info"} title={"Firm owner only"}>
            {"The firm owner adds the client account."}
          </Alert>
        )}
      </LiveDialog>
    </>
  );
}
