/**
 * Live-only parts for manual payments (FIN-09) and the reconciliation workspace (FIN-12), built from
 * the Designer's own anatomy (`#dlgInv`'s `.dlg`, `.dh`, `.db`, `.fld`, `.sel`, `.inp`, `.ta`,
 * `.df`; `section.panel`, `.fp-pad`, `dl.fp-dl`, `.fp-row`, `.alert`). The Designer has no capture
 * for them, so there is nothing to diff: they reuse its classes only.
 *
 *   * `#dlgMP`  Record a manual payment on an invoice: the fields of the Designer's `#dlgPay`
 *               (amount, method, reference, received on, bank destination, evidence upload,
 *               reviewer), the destination being the firm's operating account.
 *   * `#dlgMPV` Verify a manual payment (or reject it), in `#dlgVer`'s shape.
 *   * `#dlgMPR` Mark a manual payment reversed or failed.
 *   * `#dlgRecItem` Add an outstanding deposit or cheque to the reconciliation waiting for review.
 *   * Settings > Subscription's Bank accounts panel and its two add dialogs (firm owner, step-up).
 */
import { Icon } from "./frame";
import { Alert } from "./finance";
import { Dl, EvidencePicker, Field, LiveDialog, Options, type Blocked, type DlRow, type FundsOption } from "./funds";

// ---------------------------------------------------------------------------
// Invoice: record, verify, reverse
// ---------------------------------------------------------------------------

export type ManualPaymentDialogsData = {
  organizationId: string;
  today: string;
  invoiceId: string;
  /** "INV-0001", "(sample)" marked. */
  invoice: string;
  matterId: string;
  /** Still due less payments waiting for verification, in cents. */
  maxCents: number;
  hint: string;
  methods: FundsOption[];
  /** The firm's operating accounts. */
  accounts: FundsOption[];
  /** Who may review it: the firm owners and the matter's finance users (the viewer last, or alone). */
  reviewers: FundsOption[];
  blocked: Blocked;
};

export function ManualPaymentDialogs({ data }: { data: ManualPaymentDialogsData }) {
  const verifyRows: DlRow[] = [
    { term: "Amount", parts: ["—"], id: "mvA" },
    { term: "Method", parts: ["—"], id: "mvR" },
    { term: "Received", parts: ["—"], id: "mvD" },
    { term: "Destination", parts: ["—"], id: "mvT" },
    { term: "Evidence", parts: ["—"], id: "mvE" },
    { term: "Recorded by", parts: ["—"], id: "mvB" },
    { term: "Reviewer", parts: ["—"], id: "mvV" },
  ];
  return (
    <>
      <LiveDialog
        id={"dlgMP"}
        title={"Record a manual payment"}
        submit={
          <button
            className={"btn p"}
            data-mp-record={"1"}
            data-org={data.organizationId}
            data-invoice={data.invoiceId}
            data-matter={data.matterId}
            data-today={data.today}
            data-max={String(data.maxCents)}
            disabled={data.blocked ? true : undefined}
          >
            {"Record payment"}
          </button>
        }
      >
        <p style={{ marginBottom: "12px" }}>{`${data.invoice}. It stays “Pending verification” until the reviewer checks it against the bank. The client sees it as pending, not paid.`}</p>
        <div className={"g2"}>
          <Field id={"mxA"} label={"Amount"} hint={data.hint}>
            <input className={"inp"} id={"mxA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"mxA-h"} maxLength={16} />
          </Field>
          <Field id={"mxM"} label={"Method"}>
            <select className={"sel"} id={"mxM"}>
              <Options options={data.methods} />
            </select>
          </Field>
        </div>
        <div className={"g2"}>
          <Field id={"mxR"} label={"External reference"}>
            <input className={"inp"} id={"mxR"} type={"text"} autoComplete={"off"} maxLength={80} placeholder={"e-Transfer reference, cheque or wire number"} />
          </Field>
          <Field id={"mxD"} label={"Received on"}>
            <input className={"inp"} id={"mxD"} type={"date"} max={data.today} defaultValue={data.today} />
          </Field>
        </div>
        <Field id={"mxB"} label={"Bank destination"} hint={"Earned fees go to the firm’s operating account, never the client account"}>
          <select className={"sel"} id={"mxB"} aria-describedby={"mxB-h"}>
            <Options options={data.accounts} />
          </select>
        </Field>
        <EvidencePicker id={"mxE"} note={"A PDF or image is stored with the matter, staff only. A note is enough when there’s no file."} />
        <Field id={"mxV"} label={"Reviewer"} hint={"Someone other than you, when the firm has anyone else who can"}>
          <select className={"sel"} id={"mxV"} aria-describedby={"mxV-h"}>
            <Options options={data.reviewers} />
          </select>
        </Field>
        {data.blocked ? (
          <Alert tone={"warn"} icon={"info"} title={data.blocked.title}>
            {data.blocked.copy}
          </Alert>
        ) : null}
      </LiveDialog>
      <LiveDialog
        id={"dlgMPV"}
        title={"Verify a manual payment"}
        submit={
          <>
            <button className={"btn"} data-mp-reject={"1"} data-org={data.organizationId}>
              {"Reject"}
            </button>
            <button className={"btn p"} data-mp-verify={"1"} data-org={data.organizationId}>
              {"Verify"}
            </button>
          </>
        }
      >
        <Dl rows={verifyRows} />
        <div className={"fp-row"} style={{ marginTop: "8px" }}>
          <button type={"button"} className={"btn sm"} data-mp-evidence={""} data-org={data.organizationId} hidden>
            {"Open the evidence file"}
          </button>
        </div>
        <label className={"check"} style={{ marginTop: "12px" }}>
          <input type={"checkbox"} id={"mvOk"} />
          <span>{"The amount, date and reference match the bank statement"}</span>
        </label>
        <div className={"alert warn"} id={"mvSelf"} hidden>
          <Icon name={"info"} />
          <div>
            <b>{"Someone else verifies it"}</b>
            <span id={"mvWhy"}>{"The reviewer named on it, or the firm owner, verifies it. You can still reject it if it was recorded by mistake."}</span>
          </div>
        </div>
        <Field id={"mvW"} label={"If it doesn’t match"} hint={"Reject it with a reason. A rejected payment never counts."}>
          <textarea className={"ta"} id={"mvW"} aria-describedby={"mvW-h"} maxLength={500} rows={2}></textarea>
        </Field>
        <p className={"fp-note"}>{"Verifying counts it as paid on the invoice and in the client’s portal."}</p>
      </LiveDialog>
      <LiveDialog
        id={"dlgMPR"}
        title={"Mark reversed or failed"}
        submit={
          <button className={"btn p"} data-mp-reverse={"1"} data-org={data.organizationId}>
            {"Mark it"}
          </button>
        }
      >
        <p className={"fp-note"} id={"mrS"} style={{ margin: "0 0 12px" }}>
          {"—"}
        </p>
        <Field id={"mrO"} label={"What happened"}>
          <select className={"sel"} id={"mrO"} defaultValue={"failed"}>
            <option value={"failed"}>{"Failed: it didn’t clear (a returned cheque, a declined transfer)"}</option>
            <option value={"reversed"}>{"Reversed: the bank took a verified payment back"}</option>
          </select>
        </Field>
        <Field id={"mrW"} label={"What the bank reported"}>
          <textarea className={"ta"} id={"mrW"} maxLength={500} rows={2}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"The balance reopens; the matter doesn’t move"}>
          {"A verified payment comes off the invoice, which shows as owing again. A task is created for the matter’s responsible consultant to follow up. The matter’s stage and government status don’t change."}
        </Alert>
      </LiveDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation: outstanding deposits and cheques
// ---------------------------------------------------------------------------

export type ReconItemDialogData = { organizationId: string; reconciliationId: string; statementDate: string };

export function ReconItemDialog({ data }: { data: ReconItemDialogData }) {
  return (
    <LiveDialog
      id={"dlgRecItem"}
      title={"Add an outstanding item"}
      submit={
        <button className={"btn p"} data-rec-item={"1"} data-org={data.organizationId} data-rec={data.reconciliationId} data-statement={data.statementDate}>
          {"Add item"}
        </button>
      }
    >
      <Field id={"riK"} label={"Item"}>
        <select className={"sel"} id={"riK"}>
          <option value={"deposit_in_transit"}>{"Deposit in transit: on the ledger, not yet on the statement (added)"}</option>
          <option value={"outstanding_cheque"}>{"Outstanding cheque: written, not yet cleared (subtracted)"}</option>
        </select>
      </Field>
      <Field id={"riD"} label={"Description"}>
        <input className={"inp"} id={"riD"} type={"text"} autoComplete={"off"} maxLength={200} placeholder={"Cheque 104 to the client"} />
      </Field>
      <div className={"g2"}>
        <Field id={"riT"} label={"Date"} hint={"On or before the statement date"}>
          <input className={"inp"} id={"riT"} type={"date"} max={data.statementDate} defaultValue={data.statementDate} aria-describedby={"riT-h"} />
        </Field>
        <Field id={"riA"} label={"Amount"} hint={"CAD"}>
          <input className={"inp"} id={"riA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"riA-h"} maxLength={16} />
        </Field>
      </div>
      <Field id={"riR"} label={"Reference"} hint={"Optional"}>
        <input className={"inp"} id={"riR"} type={"text"} autoComplete={"off"} maxLength={80} aria-describedby={"riR-h"} />
      </Field>
      <Alert tone={"info"} icon={"info"} title={"Adjusts the bank side only"}>
        {"The adjusted bank balance is the statement’s closing balance plus deposits in transit, less outstanding cheques. The ledger isn’t changed. Items lock when the reconciliation is signed."}
      </Alert>
    </LiveDialog>
  );
}

// ---------------------------------------------------------------------------
// Settings > Subscription: Bank accounts
// ---------------------------------------------------------------------------

export type BankAccountsData = {
  organizationId: string;
  rows: [string, string][];
  /** Firm owner only. */
  canAdd: boolean;
  note: string;
};

export function SettingsBankAccounts({ data, index }: { data: BankAccountsData; index: number }) {
  return (
    <section className={"panel rv"} style={{ "--i": String(index) } as React.CSSProperties}>
      <h2>
        <Icon name={"bank"} />
        {"Bank accounts"}
      </h2>
      <div className={"fp-pad"}>
        <dl className={"fp-dl"}>
          {data.rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {data.canAdd ? (
          <div className={"fp-row"} style={{ marginTop: "12px" }}>
            <button className={"btn sm"} data-dlg={"dlgBankC"}>
              {"Add the client account"}
            </button>
            <button className={"btn sm"} data-dlg={"dlgBankO"}>
              {"Add an operating account"}
            </button>
          </div>
        ) : null}
        <p className={"fp-note"} style={{ margin: "12px 0 0" }}>
          {data.note}
        </p>
      </div>
    </section>
  );
}

function BankDialog({ id, kind, title, organizationId, defaultLabel, copy }: { id: string; kind: "client" | "operating"; title: string; organizationId: string; defaultLabel: string; copy: string }) {
  return (
    <LiveDialog
      id={id}
      title={title}
      submit={
        <button className={"btn p"} data-bank-add={kind} data-org={organizationId}>
          {"Add account"}
        </button>
      }
    >
      <Field id={`${id}L`} label={"Name"}>
        <input className={"inp"} id={`${id}L`} type={"text"} autoComplete={"off"} maxLength={80} defaultValue={defaultLabel} />
      </Field>
      <div className={"g2"}>
        <Field id={`${id}I`} label={"Bank or credit union"}>
          <input className={"inp"} id={`${id}I`} type={"text"} autoComplete={"off"} maxLength={120} />
        </Field>
        <Field id={`${id}N`} label={"Last four digits"}>
          <input className={"inp"} id={`${id}N`} type={"text"} inputMode={"numeric"} autoComplete={"off"} maxLength={4} />
        </Field>
      </div>
      <Field id={`${id}C`} label={"Currency"} hint={"Casevoya records bank accounts in CAD for now"}>
        <select className={"sel"} id={`${id}C`} aria-describedby={`${id}C-h`}>
          <option value={"CAD"}>{"CAD"}</option>
        </select>
      </Field>
      <Alert tone={"info"} icon={"info"} title={"Only the last four digits are kept"}>
        {copy}
      </Alert>
    </LiveDialog>
  );
}

export function BankAccountDialogs({ organizationId }: { organizationId: string }) {
  return (
    <>
      <BankDialog
        id={"dlgBankC"}
        kind={"client"}
        title={"Add the client account"}
        organizationId={organizationId}
        defaultLabel={"Client account"}
        copy={"The firm’s own client (trust) account at its bank, for advances. Casevoya records what happens in it; it never holds or moves the money. You’ll confirm with your authenticator first."}
      />
      <BankDialog
        id={"dlgBankO"}
        kind={"operating"}
        title={"Add an operating account"}
        organizationId={organizationId}
        defaultLabel={"Operating account"}
        copy={"The firm’s general account, where earned fees are paid. Manual invoice payments name it as their destination. You’ll confirm with your authenticator first."}
      />
    </>
  );
}
