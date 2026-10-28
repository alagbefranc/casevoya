/**
 * FIN-06 billing, live only: time on a matter, quotes and instalments, ageing, tax rates and the
 * government fee references, plus their dialogs. The Designer has no capture of these, so they are
 * built from its own parts, the way the live-only panels on the invoice tab are: `section.panel`
 * with an `h2` and icon, `.tw` / `table.t`, `.fp-pad` / `.fp-note`, `.fp-row` of `.btn sm`, `.bd`
 * badges, and dialogs in `#dlgInv`'s anatomy (`LiveDialog`, `.fld`, `.inp`, `.sel`, `.ta`,
 * `.alert`). Buttons carry `data-billing-open` (fill a dialog, then open it) or `data-billing-act`
 * (run it); use-sheet sends both to billing-acts.
 */
import { Icon } from "./frame";
import { Alert, i, Parts, RIGHT } from "./finance";
import { Field, LiveDialog } from "./funds";
import { Badge, type MatterBadge } from "./matters";

export type Attrs = Record<string, string>;
export type BillingButton = { label: string; attrs: Attrs; primary?: boolean };
export type TaxChoice = { value: string; label: string };

function Buttons({ buttons }: { buttons: BillingButton[] }) {
  if (!buttons.length) return null;
  return (
    <div className={"fp-row"}>
      {buttons.map((button) => (
        <button key={button.label} className={button.primary ? "btn p sm" : "btn sm"} {...button.attrs}>
          {button.label}
        </button>
      ))}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className={"fp-pad"}>
      <p className={"fp-note"} style={{ margin: "0" }}>
        {text}
      </p>
    </div>
  );
}

function TaxSelect({ id, choices }: { id: string; choices: TaxChoice[] }) {
  return (
    <Field id={id} label={"Tax"} hint={"The firm’s rate of that name in effect on the invoice date applies when it’s issued."}>
      <select className={"sel"} id={id} aria-describedby={`${id}-h`}>
        <option value={""}>{"No tax"}</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Matter: time, quotes and instalments
// ---------------------------------------------------------------------------

export type TimeRow = { key: string; date: string; who: string; description: string; duration: string; rate: string; amount: string; state: MatterBadge; actions: BillingButton[] };

export type QuoteRow = {
  key: string;
  title: string;
  total: string;
  state: MatterBadge;
  actions: BillingButton[];
  /** The instalment plan, when there is one. */
  plan: null | { state: MatterBadge; rows: { key: string; label: string; due: string; amount: string; paidAs: string; state: MatterBadge; actions: BillingButton[] }[]; actions: BillingButton[] };
};

export type MatterWorkData = {
  organizationId: string;
  matterId: string;
  today: string;
  time: {
    rows: TimeRow[];
    summary: string[];
    empty: string;
    actions: BillingButton[];
    running: null | { id: string; text: string };
  };
  /** Billing staff only: accepted quotes, invoiced once or by instalments. */
  quotes: null | { rows: QuoteRow[]; empty: string };
  taxes: TaxChoice[];
  defaultDue: string;
  /** Per accepted quote with instalments: the dialog that sets their due dates. */
  planDialogs: { id: string; agreementId: string; title: string; instalments: { label: string; amount: string; paidAs: string }[] }[];
};

export function MatterWork({ data }: { data: MatterWorkData }) {
  return (
    <>
      <h3 className={"sub rv"} style={i(4)}>
        {"Time"}
      </h3>
      <section className={"panel rv"} style={i(5)}>
        <h2>
          <Icon name={"clock"} />
          {"Time on this matter"}
          <span className={"r"}>
            <span className={"pill"}>
              <Parts parts={data.time.summary} />
            </span>
          </span>
        </h2>
        {data.time.running ? (
          <div className={"fp-pad"}>
            <div className={"alert info"}>
              <Icon name={"clock"} />
              <div>
                <b>{"Timer running"}</b>
                {data.time.running.text}
              </div>
            </div>
          </div>
        ) : null}
        {data.time.rows.length ? (
          <div className={"tw"} role={"region"} aria-label={"Time entries"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Time entries"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Date"}</th>
                  <th scope={"col"}>{"Who"}</th>
                  <th scope={"col"}>{"Work"}</th>
                  <th scope={"col"}>{"Time"}</th>
                  <th scope={"col"}>{"Rate"}</th>
                  <th scope={"col"} style={RIGHT}>
                    {"CAD"}
                  </th>
                  <th scope={"col"}>{"State"}</th>
                </tr>
              </thead>
              <tbody>
                {data.time.rows.map((row) => (
                  <tr key={row.key}>
                    <td className={"num"}>{row.date}</td>
                    <td>{row.who}</td>
                    <td>{row.description}</td>
                    <td className={"num"}>{row.duration}</td>
                    <td className={"num"}>{row.rate}</td>
                    <td className={"num"} style={RIGHT}>
                      {row.amount}
                    </td>
                    <td>
                      <span className={"fp-row"}>
                        <Badge badge={row.state} />
                        {row.actions.map((button) => (
                          <button key={button.label} className={"btn sm"} {...button.attrs}>
                            {button.label}
                          </button>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Note text={data.time.empty} />
        )}
        <div className={"fp-pad"}>
          <Buttons buttons={data.time.actions} />
        </div>
        <Note text={"A time line is minutes × hourly rate ÷ 60, rounded to the nearest cent (half a cent rounds up). Only billable time that isn’t on an invoice can be pulled into a draft."} />
      </section>
      {data.quotes ? (
        <>
          <h3 className={"sub rv"} style={i(6)}>
            {"Quotes and instalments"}
          </h3>
          <section className={"panel rv"} style={i(7)}>
            <h2>
              <Icon name={"invoice"} />
              {"Accepted quotes"}
            </h2>
            {data.quotes.rows.length ? (
              data.quotes.rows.map((quote) => (
                <div key={quote.key} className={"fp-pad"}>
                  <div className={"fp-row"} style={{ justifyContent: "space-between" }}>
                    <b>{quote.title}</b>
                    <span className={"fp-row"}>
                      <span className={"num"}>{quote.total}</span>
                      <Badge badge={quote.state} />
                    </span>
                  </div>
                  {quote.plan ? (
                    <div className={"tw"} role={"region"} aria-label={`Instalments for ${quote.title}`} tabIndex={0} style={{ margin: "10px 0" }}>
                      <table className={"t"}>
                        <caption className={"sr"}>{"Instalments"}</caption>
                        <thead>
                          <tr>
                            <th scope={"col"}>{"Instalment"}</th>
                            <th scope={"col"}>{"Due"}</th>
                            <th scope={"col"}>{"Paid as"}</th>
                            <th scope={"col"} style={RIGHT}>
                              {"CAD"}
                            </th>
                            <th scope={"col"}>{"State"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quote.plan.rows.map((row) => (
                            <tr key={row.key}>
                              <td>{row.label}</td>
                              <td className={"num"}>{row.due}</td>
                              <td>{row.paidAs}</td>
                              <td className={"num"} style={RIGHT}>
                                {row.amount}
                              </td>
                              <td>
                                <span className={"fp-row"}>
                                  <Badge badge={row.state} />
                                  {row.actions.map((button) => (
                                    <button key={button.label} className={"btn sm"} {...button.attrs}>
                                      {button.label}
                                    </button>
                                  ))}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <div style={{ marginTop: "8px" }}>
                    <Buttons buttons={[...quote.actions, ...(quote.plan?.actions ?? [])]} />
                  </div>
                </div>
              ))
            ) : (
              <Note text={data.quotes.empty} />
            )}
            <Note
              text={
                "An accepted quote is invoiced once (its professional fees and disbursements, as a draft), or by instalments with dated reminders. Government fees aren’t carried from the quote: add them to the draft with their official source. An advance instalment is requested into the client account, never invoiced."
              }
            />
          </section>
        </>
      ) : null}
    </>
  );
}

export function MatterWorkDialogs({ data }: { data: MatterWorkData }) {
  const org = data.organizationId;
  return (
    <>
      <LiveDialog
        id={"dlgTime"}
        title={"Log time"}
        submit={
          <>
            <button className={"btn"} data-billing-act={"timer-start"} data-org={org} data-matter={data.matterId}>
              {"Start a timer"}
            </button>
            <button className={"btn p"} data-billing-act={"time-log"} data-org={org} data-matter={data.matterId} data-today={data.today}>
              {"Log time"}
            </button>
          </>
        }
      >
        <Field id={"tmW"} label={"Work done"} hint={"The client sees this on the invoice."}>
          <textarea className={"ta"} id={"tmW"} aria-describedby={"tmW-h"} maxLength={500} rows={2}></textarea>
        </Field>
        <div className={"g2"}>
          <Field id={"tmD"} label={"Date"}>
            <input className={"inp"} id={"tmD"} type={"date"} max={data.today} defaultValue={data.today} />
          </Field>
          <Field id={"tmM"} label={"Time"} hint={"Minutes (90) or hours and minutes (1:30)"}>
            <input className={"inp"} id={"tmM"} type={"text"} inputMode={"numeric"} autoComplete={"off"} aria-describedby={"tmM-h"} maxLength={8} />
          </Field>
        </div>
        <Field id={"tmR"} label={"Hourly rate (CAD)"} hint={"The firm’s own rate for this work."}>
          <input className={"inp"} id={"tmR"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"tmR-h"} maxLength={12} />
        </Field>
        <label className={"check"}>
          <input type={"checkbox"} id={"tmB"} defaultChecked />
          <span>{"Billable"}</span>
        </label>
        <Alert tone={"info"} icon={"info"} title={"A timer counts from now"}>
          {"Start a timer instead of typing the time: it uses the work and rate above, and you stop it from this tab. Stopping rounds to the nearest minute."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgTimeInv"}
        title={"Draft an invoice from unbilled time"}
        submit={
          <button className={"btn p"} data-billing-act={"time-invoice"} data-org={org} data-matter={data.matterId}>
            {"Create draft"}
          </button>
        }
      >
        <DueAndTax due={data.defaultDue} today={data.today} prefix={"tiv"} taxes={data.taxes} />
        <Alert tone={"info"} icon={"info"} title={"A draft first"}>
          {"Every unbilled billable entry becomes a line. Check the draft on its invoice tab, add any government fee with its source, then issue it."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgQuoteInv"}
        title={"Invoice an accepted quote"}
        submit={
          <button className={"btn p"} data-billing-act={"quote-invoice"} data-org={org}>
            {"Create draft"}
          </button>
        }
      >
        <DueAndTax due={data.defaultDue} today={data.today} prefix={"qiv"} taxes={data.taxes} />
        <Alert tone={"info"} icon={"info"} title={"The quote’s own tax lines aren’t copied"}>
          {"Tax comes from the firm’s rate in effect on the invoice date, on the professional fee lines. Government fee lines aren’t carried: add them to the draft with their official source."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgInstInv"}
        title={"Invoice an instalment"}
        submit={
          <button className={"btn p"} data-billing-act={"instalment-invoice"} data-org={org}>
            {"Create draft"}
          </button>
        }
      >
        <DueAndTax due={data.defaultDue} today={data.today} prefix={"iiv"} taxes={data.taxes} />
      </LiveDialog>
      <LiveDialog
        id={"dlgPlanX"}
        title={"Cancel the instalment plan"}
        submit={
          <button className={"btn p"} data-billing-act={"plan-cancel"} data-org={org}>
            {"Cancel plan"}
          </button>
        }
      >
        <Field id={"pxW"} label={"Reason"}>
          <textarea className={"ta"} id={"pxW"} maxLength={500} rows={2}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"Invoices already drafted or issued stay"}>
          {"The open reminder tasks are cancelled. Correct an issued instalment invoice with a credit note."}
        </Alert>
      </LiveDialog>
      {data.planDialogs.map((plan) => (
        <LiveDialog
          key={plan.id}
          id={plan.id}
          title={`Instalments for ${plan.title}`}
          submit={
            <button className={"btn p"} data-billing-act={"plan-create"} data-org={org} data-agreement={plan.agreementId} data-count={String(plan.instalments.length)}>
              {"Set up instalments"}
            </button>
          }
        >
          {plan.instalments.map((instalment, index) => (
            <Field key={index} id={`${plan.id}D${index}`} label={`${instalment.label} · ${instalment.amount}`} hint={instalment.paidAs}>
              <input className={"inp"} id={`${plan.id}D${index}`} type={"date"} min={data.today} aria-describedby={`${plan.id}D${index}-h`} data-plan-date={String(index)} />
            </Field>
          ))}
          <Alert tone={"info"} icon={"info"} title={"A reminder task for each date"}>
            {"Each instalment gets an internal task due that day, owned by you. No email is sent to the client."}
          </Alert>
        </LiveDialog>
      ))}
    </>
  );
}

function DueAndTax({ due, today, prefix, taxes }: { due: string; today: string; prefix: string; taxes: TaxChoice[] }) {
  return (
    <>
      <Field id={`${prefix}Due`} label={"Due"}>
        <input className={"inp"} id={`${prefix}Due`} type={"date"} min={today} defaultValue={due} />
      </Field>
      <TaxSelect id={`${prefix}Tax`} choices={taxes} />
      {taxes.length === 0 ? (
        <Alert tone={"warn"} icon={"info"} title={"No tax rates yet"}>
          {"The firm hasn’t added a tax rate, so none is charged. Add the firm’s rates on Finance > Invoices > Tax rates; Casevoya never picks one."}
        </Alert>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Finance: ageing, unbilled time, tax rates, government fee references
// ---------------------------------------------------------------------------

export type FinanceBillingData = {
  organizationId: string;
  today: string;
  ageing: { rows: { label: string; invoices: number; amount: string }[]; total: { invoices: number; amount: string }; note: string };
  /** Billing staff: matters with unbilled billable time. */
  unbilled: null | { rows: { key: string; matter: string; time: string; amount: string; actions: BillingButton[] }[]; empty: string };
  taxes: { rows: { key: string; name: string; rate: string; from: string; to: string; approvedBy: string; source: string; state: MatterBadge; actions: BillingButton[] }[]; empty: string; actions: BillingButton[] };
  fees: {
    intro: string;
    rows: { key: string; section: string; name: string; amount: string; state: MatterBadge }[];
    more: string | null;
    source: string[];
    empty: string;
    actions: BillingButton[];
  };
  taxChoices: TaxChoice[];
  defaultDue: string;
  /** The snapshot waiting for review, for the review dialog. */
  pending: null | { sha256: string; rows: number };
};

export function FinanceBillingPanels({ data }: { data: FinanceBillingData }) {
  return (
    <>
      <section className={"panel rv"} style={i(5)} id={"ageing"}>
        <h2>
          <Icon name={"history"} />
          {"Ageing"}
          <span className={"r"}>
            <span className={"pill"}>{"CAD"}</span>
          </span>
        </h2>
        <div className={"tw"} role={"region"} aria-label={"Receivables ageing"} tabIndex={0}>
          <table className={"t"}>
            <caption className={"sr"}>{"Receivables ageing"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Age"}</th>
                <th scope={"col"} style={RIGHT}>
                  {"Invoices"}
                </th>
                <th scope={"col"} style={RIGHT}>
                  {"Owed"}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.ageing.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className={"num"} style={RIGHT}>
                    {String(row.invoices)}
                  </td>
                  <td className={"num"} style={RIGHT}>
                    {row.amount}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>{"Total"}</b>
                </td>
                <td className={"num"} style={RIGHT}>
                  <b>{String(data.ageing.total.invoices)}</b>
                </td>
                <td className={"num"} style={RIGHT}>
                  <b>{data.ageing.total.amount}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Note text={data.ageing.note} />
      </section>
      {data.unbilled ? (
        <section className={"panel rv"} style={i(6)}>
          <h2>
            <Icon name={"clock"} />
            {"Unbilled time"}
          </h2>
          {data.unbilled.rows.length ? (
            <div className={"tw"} role={"region"} aria-label={"Unbilled time"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Unbilled time"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Matter"}</th>
                    <th scope={"col"}>{"Time"}</th>
                    <th scope={"col"} style={RIGHT}>
                      {"CAD"}
                    </th>
                    <th scope={"col"}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.unbilled.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.matter}</td>
                      <td className={"num"}>{row.time}</td>
                      <td className={"num"} style={RIGHT}>
                        {row.amount}
                      </td>
                      <td>
                        <Buttons buttons={row.actions} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Note text={data.unbilled.empty} />
          )}
        </section>
      ) : null}
      <section className={"panel rv"} style={i(7)} id={"tax-rates"}>
        <h2>
          <Icon name={"number"} />
          {"Tax rates"}
        </h2>
        {data.taxes.rows.length ? (
          <div className={"tw"} role={"region"} aria-label={"Tax rates"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Tax rates"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Name"}</th>
                  <th scope={"col"}>{"Rate"}</th>
                  <th scope={"col"}>{"From"}</th>
                  <th scope={"col"}>{"To"}</th>
                  <th scope={"col"}>{"Approved by"}</th>
                  <th scope={"col"}>{"State"}</th>
                </tr>
              </thead>
              <tbody>
                {data.taxes.rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {row.name}
                      {row.source ? <small style={{ display: "block", color: "var(--t2)" }}>{row.source}</small> : null}
                    </td>
                    <td className={"num"}>{row.rate}</td>
                    <td className={"num"}>{row.from}</td>
                    <td className={"num"}>{row.to}</td>
                    <td>{row.approvedBy}</td>
                    <td>
                      <span className={"fp-row"}>
                        <Badge badge={row.state} />
                        {row.actions.map((button) => (
                          <button key={button.label} className={"btn sm"} {...button.attrs}>
                            {button.label}
                          </button>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Note text={data.taxes.empty} />
        )}
        <div className={"fp-pad"}>
          <Buttons buttons={data.taxes.actions} />
        </div>
      </section>
      <section className={"panel rv"} style={i(8)} id={"government-fees"}>
        <h2>
          <Icon name={"globe"} />
          {"Government fee references"}
        </h2>
        <Note text={data.fees.intro} />
        {data.fees.rows.length ? (
          <div className={"tw"} role={"region"} aria-label={"Government fee references"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Government fee references"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Section"}</th>
                  <th scope={"col"}>{"Fee"}</th>
                  <th scope={"col"} style={RIGHT}>
                    {"CAD"}
                  </th>
                  <th scope={"col"}>{"State"}</th>
                </tr>
              </thead>
              <tbody>
                {data.fees.rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.section}</td>
                    <td>{row.name}</td>
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
          <Note text={data.fees.empty} />
        )}
        {data.fees.more ? <Note text={data.fees.more} /> : null}
        {data.fees.source.length ? (
          <div className={"fp-pad"}>
            <p className={"fp-note"} style={{ margin: "0" }}>
              <Parts parts={data.fees.source} />
            </p>
          </div>
        ) : null}
        <div className={"fp-pad"}>
          <Buttons buttons={data.fees.actions} />
        </div>
      </section>
    </>
  );
}

export function FinanceBillingDialogs({ data }: { data: FinanceBillingData }) {
  const org = data.organizationId;
  return (
    <>
      <LiveDialog
        id={"dlgTimeInv"}
        title={"Draft an invoice from unbilled time"}
        submit={
          <button className={"btn p"} data-billing-act={"time-invoice"} data-org={org}>
            {"Create draft"}
          </button>
        }
      >
        <DueAndTax due={data.defaultDue} today={data.today} prefix={"tiv"} taxes={data.taxChoices} />
      </LiveDialog>
      <LiveDialog
        id={"dlgTax"}
        title={"Add a tax rate"}
        submit={
          <button className={"btn p"} data-billing-act={"tax-add"} data-org={org}>
            {"Add rate"}
          </button>
        }
      >
        <div className={"g2"}>
          <Field id={"txN"} label={"Name"} hint={"As it shows on invoices, like HST Ontario"}>
            <input className={"inp"} id={"txN"} type={"text"} autoComplete={"off"} aria-describedby={"txN-h"} maxLength={80} />
          </Field>
          <Field id={"txR"} label={"Rate (%)"} hint={"Up to four decimals"}>
            <input className={"inp"} id={"txR"} type={"text"} inputMode={"decimal"} autoComplete={"off"} aria-describedby={"txR-h"} maxLength={8} />
          </Field>
        </div>
        <div className={"g2"}>
          <Field id={"txF"} label={"Effective from"}>
            <input className={"inp"} id={"txF"} type={"date"} />
          </Field>
          <Field id={"txT"} label={"Effective to"} hint={"Leave empty while it applies"}>
            <input className={"inp"} id={"txT"} type={"date"} aria-describedby={"txT-h"} />
          </Field>
        </div>
        <Field id={"txA"} label={"Approved by"} hint={"The firm or its accountant, by name"}>
          <input className={"inp"} id={"txA"} type={"text"} autoComplete={"off"} aria-describedby={"txA-h"} maxLength={200} />
        </Field>
        <Field id={"txS"} label={"Source"} hint={"Optional: where the rate comes from, like a CRA page"}>
          <input className={"inp"} id={"txS"} type={"text"} autoComplete={"off"} aria-describedby={"txS-h"} maxLength={500} />
        </Field>
        <Alert tone={"info"} icon={"info"} title={"The firm chooses its rates"}>
          {"Casevoya never picks or suggests a rate. A rate is never edited: end it and add the new one. You’ll confirm with your authenticator."}
        </Alert>
      </LiveDialog>
      <LiveDialog
        id={"dlgTaxEnd"}
        title={"End a tax rate"}
        submit={
          <button className={"btn p"} data-billing-act={"tax-end"} data-org={org}>
            {"End rate"}
          </button>
        }
      >
        <Field id={"teT"} label={"Last day it applies"}>
          <input className={"inp"} id={"teT"} type={"date"} defaultValue={data.today} />
        </Field>
      </LiveDialog>
      <LiveDialog
        id={"dlgFeeReview"}
        title={"Review the fee list"}
        submit={
          <>
            <button className={"btn"} data-billing-act={"fees-reject"} data-org={org} data-sha={data.pending?.sha256 ?? ""}>
              {"Reject"}
            </button>
            <button className={"btn p"} data-billing-act={"fees-approve"} data-org={org} data-sha={data.pending?.sha256 ?? ""}>
              {"Approve for use"}
            </button>
          </>
        }
      >
        <p className={"fp-note"} style={{ margin: "0 0 12px" }}>
          {data.pending
            ? `${data.pending.rows} fees read from IRCC’s fee list. Compare them with the page before approving; staff can then pick them as government fee lines.`
            : "Nothing is waiting for review."}
        </p>
        <Field id={"frW"} label={"Note"} hint={"Required to reject"}>
          <textarea className={"ta"} id={"frW"} aria-describedby={"frW-h"} maxLength={500} rows={2}></textarea>
        </Field>
        <Alert tone={"info"} icon={"info"} title={"A licensed member approves"}>
          {"Only a licensed consultant (or a licensed owner) approves fee references. You’ll confirm with your authenticator."}
        </Alert>
      </LiveDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// One invoice: write-off, government fee, discard
// ---------------------------------------------------------------------------

export type InvoiceBillingDialogsData = {
  organizationId: string;
  invoiceId: string;
  invoice: string;
  today: string;
  /** Issued with a balance: what can still be written off. */
  writeOff: null | { maxCents: number; hint: string };
  /** A draft: approved fee references to pick from. */
  draft: null | { references: { value: string; label: string }[] };
};

export function InvoiceBillingDialogs({ data }: { data: InvoiceBillingDialogsData }) {
  const org = data.organizationId;
  return (
    <>
      {data.writeOff ? (
        <LiveDialog
          id={"dlgWO"}
          title={`Write off part of ${data.invoice}`}
          submit={
            <button className={"btn p"} data-billing-act={"write-off"} data-org={org} data-invoice={data.invoiceId} data-max={String(data.writeOff.maxCents)}>
              {"Write off"}
            </button>
          }
        >
          <Field id={"woA"} label={"Amount (CAD)"} hint={data.writeOff.hint}>
            <input className={"inp"} id={"woA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} aria-describedby={"woA-h"} maxLength={16} />
          </Field>
          <Field id={"woR"} label={"Reason"}>
            <textarea className={"ta"} id={"woR"} maxLength={500} rows={2}></textarea>
          </Field>
          <Alert tone={"info"} icon={"info"} title={"Not a credit note"}>
            {"A write-off reduces what the client owes without a credit note to the client or a second approver. It’s recorded with your name and the reason. You’ll confirm with your authenticator."}
          </Alert>
        </LiveDialog>
      ) : null}
      {data.draft ? (
        <>
          <LiveDialog
            id={"dlgGovFee"}
            title={"Add a government fee"}
            submit={
              <button className={"btn p"} data-billing-act={"gov-fee"} data-org={org} data-invoice={data.invoiceId} data-today={data.today}>
                {"Add line"}
              </button>
            }
          >
            <Field id={"gfP"} label={"From the approved fee references"} hint={"Or leave this empty and type the fee with its source below"}>
              <select className={"sel"} id={"gfP"} aria-describedby={"gfP-h"}>
                <option value={""}>{data.draft.references.length ? "Type it below" : "No approved references yet"}</option>
                {data.draft.references.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={"gfN"} label={"Fee name"} hint={"As the official page names it"}>
              <input className={"inp"} id={"gfN"} type={"text"} autoComplete={"off"} aria-describedby={"gfN-h"} maxLength={300} />
            </Field>
            <div className={"g2"}>
              <Field id={"gfA"} label={"Amount (CAD)"}>
                <input className={"inp"} id={"gfA"} type={"text"} inputMode={"decimal"} autoComplete={"off"} placeholder={"0.00"} maxLength={16} />
              </Field>
              <Field id={"gfC"} label={"Date checked"}>
                <input className={"inp"} id={"gfC"} type={"date"} max={data.today} defaultValue={data.today} />
              </Field>
            </div>
            <Field id={"gfU"} label={"Official source URL"} hint={"An https page on canada.ca, like IRCC’s fee list"}>
              <input className={"inp"} id={"gfU"} type={"url"} autoComplete={"off"} aria-describedby={"gfU-h"} maxLength={500} />
            </Field>
            <Alert tone={"info"} icon={"info"} title={"Never invented"}>
              {"A government fee is a disbursement with its official source and the date it was checked. The client sees the name and amount on the invoice."}
            </Alert>
          </LiveDialog>
          <LiveDialog
            id={"dlgDiscard"}
            title={`Discard draft ${data.invoice}`}
            submit={
              <button className={"btn p"} data-billing-act={"discard"} data-org={org} data-invoice={data.invoiceId}>
                {"Discard draft"}
              </button>
            }
          >
            <Field id={"dcW"} label={"Reason"}>
              <textarea className={"ta"} id={"dcW"} maxLength={500} rows={2}></textarea>
            </Field>
            <Alert tone={"info"} icon={"info"} title={"It stays on record"}>
              {"The draft was never sent. Its time entries and instalments can be invoiced again; its number isn’t reused."}
            </Alert>
          </LiveDialog>
        </>
      ) : null}
    </>
  );
}
