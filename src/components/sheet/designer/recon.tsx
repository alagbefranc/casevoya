/**
 * The Designer's Reconciliation tab (`markup/finance.tsx`, variant `tab-recon`): the three balances
 * (bank statement, control ledger, client ledgers), the difference with what explains it, the
 * Outstanding items, the Sign-off steps and the Earlier months. Same DOM, classes and order. Given
 * the Designer's values it renders the capture.
 *
 * Live (FIN-12): the figures are the reconciliation the firm prepared for a client account as of its
 * statement date (`client_account_reconciliations`), copied when prepared and checked again when
 * signed. Differences from the capture, in the Designer's own anatomy:
 *   * With no reconciliation waiting for review, the balances, items and sign-off are replaced by one
 *     `.panel` with the empty state and Prepare a reconciliation (`#dlgRec`).
 *   * Sign reconciliation opens `#dlgRecSign` (reconciled when the difference is zero, or signed with
 *     exception notes; or discarded). It is `aria-disabled` with the reason when this person can't
 *     sign (they prepared it and aren't the firm owner).
 *   * Item actions go to the Client funds tab, where deposits are verified and bank transfers recorded.
 *   * Under the Earlier months, an optional read-only Card payouts panel: Stripe's payouts (test mode)
 *     with the card payments, refunds and fees in each, matched to Casevoya's card payments.
 */
import { Empty, Icon, Pair } from "./frame";
import { Alert, i, Parts, RIGHT } from "./finance";
import { Field, LiveDialog, Options, type FundsOption } from "./funds";
import { Steps, type Step } from "./invoice";
import { Badge, type MatterBadge } from "./matters";

export type ReconCard = { title: string; value: string; note: string };

/** A button that opens a dialog (`attrs`) or a link to another tab (`href`). */
export type ReconAction = { label: string; primary?: boolean; attrs?: Record<string, string>; href?: string };

export type ReconItem = { key?: string; item: string[]; bank: string; ledger: string; amount: string; action: ReconAction | null };

export type ReconHistoryRow = { key?: string; month: string; bank: string; control: string; clients: string; signed: string };

export type PayoutRow = { key?: string; date: string; amount: string; payments: string; refunds: string; fees: string; matched: string; state: MatterBadge };

export type ReconData = {
  /** " October 2026" after "Reconciliation", or null. */
  period: string | null;
  intro: string;
  pending: null | {
    cards: ReconCard[];
    alert: { tone: "warn" | "info"; title: string[]; copy: string; action: ReconAction | null };
    items: ReconItem[];
    itemsEmpty: string;
    steps: Step[];
    /** `discard`: opens the sign dialog for its Discard, when signing is closed to this person (they prepared it). */
    sign: { label: string; disabled: boolean; why: string | null; attrs: Record<string, string>; discard?: Record<string, string> };
  };
  start: null | { title: string; copy: string; action: ReconAction | null };
  history: ReconHistoryRow[];
  historyEmpty: { title: string; copy: string };
  /** The signed list's heading: the Designer's "Earlier months", or live "Signed reconciliations" when the current month is in it. */
  historyTitle?: string;
  payouts: null | { rows: PayoutRow[]; empty: string; note: string };
};

function ActionControl({ action, sm = true }: { action: ReconAction; sm?: boolean }) {
  const cls = `btn${action.primary ? " p" : ""}${sm ? " sm" : ""}`;
  if (action.href) {
    return (
      <a className={cls} href={action.href}>
        {action.label}
      </a>
    );
  }
  return (
    <button className={cls} {...action.attrs}>
      {action.label}
    </button>
  );
}

function History({ data, index }: { data: ReconData; index: number }) {
  return (
    <section className={"panel rv"} style={i(index)}>
      <h2>
        <Icon name={"history"} />
        {data.historyTitle ?? "Earlier months"}
      </h2>
      {data.history.length ? (
        <div className={"tw"} role={"region"} aria-label={"Earlier reconciliations"} tabIndex={0}>
          <table className={"t"}>
            <caption className={"sr"}>{"Earlier reconciliations"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Month"}</th>
                <th scope={"col"}>{"Bank"}</th>
                <th scope={"col"}>{"Control"}</th>
                <th scope={"col"}>{"Clients"}</th>
                <th scope={"col"}>{"Signed"}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row, rowIndex) => (
                <tr key={row.key ?? rowIndex}>
                  <td>{row.month}</td>
                  <td>{row.bank}</td>
                  <td>{row.control}</td>
                  <td>{row.clients}</td>
                  <td>{row.signed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty art={"reconciliation"} title={data.historyEmpty.title} copy={data.historyEmpty.copy} />
      )}
    </section>
  );
}

function Payouts({ data, index }: { data: NonNullable<ReconData["payouts"]>; index: number }) {
  return (
    <section className={"panel rv"} style={i(index)}>
      <h2>
        <Icon name={"bank"} />
        {"Card payouts (Stripe)"}
      </h2>
      {data.rows.length ? (
        <div className={"tw"} role={"region"} aria-label={"Card payouts"} tabIndex={0}>
          <table className={"t"}>
            <caption className={"sr"}>{"Card payouts"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Paid out"}</th>
                <th scope={"col"} style={RIGHT}>
                  {"CAD"}
                </th>
                <th scope={"col"}>{"Card payments"}</th>
                <th scope={"col"}>{"Refunds"}</th>
                <th scope={"col"}>{"Fees"}</th>
                <th scope={"col"}>{"In Casevoya"}</th>
                <th scope={"col"}>{"State"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIndex) => (
                <tr key={row.key ?? rowIndex}>
                  <td>{row.date}</td>
                  <td className={"num"} style={RIGHT}>
                    {row.amount}
                  </td>
                  <td>{row.payments}</td>
                  <td>{row.refunds}</td>
                  <td>{row.fees}</td>
                  <td>{row.matched}</td>
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
            {data.empty}
          </p>
        </div>
      )}
      <div className={"fp-pad"}>
        <p className={"fp-note"} style={{ margin: "0" }}>
          {data.note}
        </p>
      </div>
    </section>
  );
}

export function SheetFinanceRecon({ data }: { data: ReconData }) {
  const pending = data.pending;
  const historyIndex = pending ? 5 : 2;
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/reconciliation-160@1x.webp"}
            srcSet={"/assets/generated/b2/reconciliation-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{data.period ? <Pair left={"Reconciliation"} right={data.period} /> : "Reconciliation"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      {pending ? (
        <>
          <div className={"fp-g3 rv"} style={i(1)}>
            {pending.cards.map((card) => (
              <div key={card.title} className={"fp-card"}>
                <h3>{card.title}</h3>
                <b className={"display num"} style={{ fontSize: "28px", display: "block" }}>
                  {card.value}
                </b>
                <p>{card.note}</p>
              </div>
            ))}
          </div>
          <div className={`alert ${pending.alert.tone} rv`} style={{ marginTop: "18px", ...i(2) }}>
            <Icon name={"reconcile"} />
            <div>
              <b>
                <Parts parts={pending.alert.title} />
              </b>
              {pending.alert.copy}
            </div>
            {pending.alert.action ? (
              <div className={"acts"}>
                <ActionControl action={pending.alert.action} />
              </div>
            ) : null}
          </div>
          <section className={"panel rv"} style={i(3)}>
            <h2>
              <Icon name={"task"} />
              {"Outstanding items"}
            </h2>
            {pending.items.length ? (
              <div className={"tw"} role={"region"} aria-label={"Outstanding items"} tabIndex={0}>
                <table className={"t"}>
                  <caption className={"sr"}>{"Outstanding items"}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"Item"}</th>
                      <th scope={"col"}>{"Bank"}</th>
                      <th scope={"col"}>{"Ledger"}</th>
                      <th scope={"col"} style={RIGHT}>
                        {"CAD"}
                      </th>
                      <th scope={"col"}>{"Action"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.items.map((row, index) => (
                      <tr key={row.key ?? index}>
                        <td>
                          <Parts parts={row.item} />
                        </td>
                        <td>{row.bank}</td>
                        <td>{row.ledger}</td>
                        <td className={"num"} style={RIGHT}>
                          {row.amount}
                        </td>
                        <td>{row.action ? <ActionControl action={row.action} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={"fp-pad"}>
                <p className={"fp-note"} style={{ margin: "0" }}>
                  {pending.itemsEmpty}
                </p>
              </div>
            )}
          </section>
          <section className={"panel rv"} style={i(4)}>
            <h2>
              <Icon name={"signature"} />
              {"Sign-off"}
            </h2>
            <div className={"fp-pad"}>
              <Steps steps={pending.steps} />
              <div className={"fp-row"} style={{ marginTop: "12px" }}>
                {pending.sign.disabled ? (
                  <button className={"btn p sm"} aria-disabled={"true"} title={""}>
                    {pending.sign.label}
                  </button>
                ) : (
                  <button className={"btn p sm"} {...pending.sign.attrs}>
                    {pending.sign.label}
                  </button>
                )}
                {pending.sign.discard ? (
                  <button className={"btn sm"} {...pending.sign.discard}>
                    {"Discard"}
                  </button>
                ) : null}
                {pending.sign.why ? <span className={"why"}>{pending.sign.why}</span> : null}
              </div>
            </div>
          </section>
        </>
      ) : data.start ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"reconciliation"} title={data.start.title} copy={data.start.copy}>
            {data.start.action ? <ActionControl action={data.start.action} /> : null}
          </Empty>
        </div>
      ) : null}
      <History data={data} index={historyIndex} />
      {data.payouts ? <Payouts data={data.payouts} index={historyIndex + 1} /> : null}
    </>
  );
}

export type ReconDialogsData = {
  organizationId: string;
  today: string;
  /** The firm's client accounts: value = account id, data-after = the last signed statement date. */
  accounts: FundsOption[];
  blocked: { title: string; copy: string } | null;
  /** The reconciliation waiting for review, for the sign dialog. */
  pending: null | { id: string; difference: number; summary: string[]; canSign: boolean; ownPreparation: boolean };
};

/** Prepare (`#dlgRec`) and sign or discard (`#dlgRecSign`) a reconciliation, in `#dlgInv`'s anatomy. */
export function ReconDialogs({ data }: { data: ReconDialogsData }) {
  const pending = data.pending;
  return (
    <>
      <LiveDialog
        id={"dlgRec"}
        title={"Prepare a reconciliation"}
        submit={
          <button className={"btn p"} data-rec-prepare={"1"} data-org={data.organizationId} data-today={data.today} disabled={data.blocked ? true : undefined}>
            {"Prepare"}
          </button>
        }
      >
        <Field id={"rcA"} label={"Client account"}>
          <select className={"sel"} id={"rcA"}>
            <Options options={data.accounts} />
          </select>
        </Field>
        <div className={"g2"}>
          <Field id={"rcD"} label={"Statement date"} hint={"The closing date on the bank statement"}>
            <input className={"inp"} id={"rcD"} type={"date"} max={data.today} defaultValue={data.today} aria-describedby={"rcD-h"} />
          </Field>
          <Field id={"rcB"} label={"Closing balance"} hint={"CAD, as the statement shows it"}>
            <input className={"inp"} id={"rcB"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"rcB-h"} maxLength={18} />
          </Field>
        </div>
        <Field id={"rcN"} label={"Note"} hint={"Optional: statement page, anything the reviewer should know"}>
          <textarea className={"ta"} id={"rcN"} aria-describedby={"rcN-h"} maxLength={2000} rows={2}></textarea>
        </Field>
        {data.blocked ? (
          <Alert tone={"warn"} icon={"info"} title={data.blocked.title}>
            {data.blocked.copy}
          </Alert>
        ) : (
          <Alert tone={"info"} icon={"info"} title={"Casevoya works out the rest"}>
            {
              "The control ledger and the client ledgers are computed as of the statement date from verified deposits, bank transfers recorded as sent, refunds and corrections. Someone other than you signs it; the firm owner may sign their own."
            }
          </Alert>
        )}
      </LiveDialog>
      {pending ? (
        <LiveDialog
          id={"dlgRecSign"}
          title={"Sign the reconciliation"}
          submit={
            <>
              <button className={"btn"} data-rec-discard={"1"} data-org={data.organizationId} data-rec={pending.id}>
                {"Discard"}
              </button>
              <button className={"btn p"} data-rec-sign={"1"} data-org={data.organizationId} data-rec={pending.id} data-difference={String(pending.difference)} disabled={pending.canSign ? undefined : true}>
                {"Sign"}
              </button>
            </>
          }
        >
          <p className={"fp-note"} style={{ margin: "0 0 12px" }}>
            <Parts parts={pending.summary} />
          </p>
          <Field id={"rsO"} label={"Outcome"}>
            <select className={"sel"} id={"rsO"} defaultValue={pending.difference === 0 ? "reconciled" : "exceptions"}>
              <option value={"reconciled"} disabled={pending.difference !== 0 ? true : undefined}>
                {"Reconciled: the statement matches the control ledger"}
              </option>
              <option value={"exceptions"}>{"Signed with exceptions (explain below)"}</option>
            </select>
          </Field>
          <Field id={"rsN"} label={"Notes"} hint={"Required for exceptions; for a discard, the reason"}>
            <textarea className={"ta"} id={"rsN"} aria-describedby={"rsN-h"} maxLength={2000} rows={3}></textarea>
          </Field>
          {pending.ownPreparation ? (
            <Alert tone={"info"} icon={"info"} title={"Your own preparation"}>
              {"As the firm owner you may sign it; you’ll confirm with your authenticator first. It shows as signed by owner (own preparation)."}
            </Alert>
          ) : !pending.canSign ? (
            <Alert tone={"warn"} icon={"info"} title={"Someone else signs it"}>
              {"You prepared this reconciliation, so the firm owner or another finance user signs it. You can still discard it."}
            </Alert>
          ) : (
            <Alert tone={"info"} icon={"info"} title={"Signed once, kept as it is"}>
              {"The figures are checked again when you sign. Once signed it can’t be changed; a later reconciliation starts after this statement date."}
            </Alert>
          )}
        </LiveDialog>
      ) : null}
    </>
  );
}
