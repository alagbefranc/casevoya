/**
 * The Designer's Quote builder tab (`markup/agreements.tsx`, variant tab-quote), live: one quote's
 * scope and services, fees by category, government-fee note, instalments, refund policy and
 * actions, from public.agreements, agreement_versions, quote_lines and quote_instalments. Same
 * DOM, classes and order as the capture. Live-only additions, stripped in the fidelity test:
 * an "Edit quote" button first in the action row, `data-agreement-act` on Send quote in place of
 * the Designer's `data-run` toast, `data-dlg` on Preview as client and Turn into agreement.
 *
 * The Edit quote (`#dlgQEdit`), Preview as client (`#dlgQPrev`), Turn into agreement
 * (`#dlgQConv`) and New quote (`#dlgNewQ`, the Designer's own, wired) dialogs are built from the
 * Designer's dialog anatomy (`.dlg wide`, `.fld`, `.inp`, `.sel`, `.ta`, `.t`). The pick list
 * (`?tab=quote` with no `view`) uses the Designer's `.li` rows.
 */
import type { ReactNode } from "react";
import { Empty, Icon, Pair, Sep } from "./frame";
import type { MatterBadge } from "./matters";
import { Badge } from "./matters";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** "a · b · c" with the Designer's separators (the envelope view's Parts). */
export function Parts({ parts }: { parts: readonly string[] }) {
  const last = parts.length - 1;
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(`${index === 0 ? "" : " "}${part}${index === last ? "" : " "}`);
  });
  return <>{out}</>;
}

export type QuoteLineView = { key?: string; category: string; description: string[]; amount: string };
export type QuoteInstalmentView = { key?: string; when: string; amount: string; paidAs: string[] };

export type QuoteViewData = {
  /** "Quote Q-0044" and the client's name. */
  title: string;
  client: string;
  intro: string;
  facts: {
    scope: string;
    services: string[];
    exclusions: string;
    deliverables: string[];
    feeStructure: string;
    expiry: { date: string; note: string };
  };
  /** The table's money column heading: the currency code. */
  currency: string;
  lines: QuoteLineView[];
  total: { label: string; amount: string };
  government: { title: string; copy: string };
  instalments: QuoteInstalmentView[];
  /** Shown in place of the instalments table when there are none. */
  instalmentsEmpty?: string | null;
  instalmentsNote: string;
  refund: string;
  actions: {
    /** Live only: opens #dlgQEdit. Absent for an accepted quote. */
    edit?: { label: string } | null;
    /** Send quote (a draft). `attrs` is live wiring; the Designer's toast attributes are the default. */
    send: { attrs: Record<string, string> } | null;
    /** Preview as client: `attrs` is live wiring (opens #dlgQPrev). */
    preview: { attrs: Record<string, string> };
    /** Turn into agreement: a link to the editor; live, `dialog` opens #dlgQConv first; `blocked` says why not yet. */
    convert: { href: string; dialog?: string; blocked?: string };
  };
};

export function SheetAgreementQuote({ data }: { data: QuoteViewData }) {
  const right = { textAlign: "right" } as React.CSSProperties;
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/forms-mapping-160@1x.webp"}
            srcSet={"/assets/generated/b2/forms-mapping-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>
            <Pair left={data.title} right={data.client} />
          </h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"fp-g2 rv"} style={i(1)}>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"briefcase"} />
              {"Scope and services"}
            </h2>
            <div className={"fp-pad"}>
              <dl className={"fp-dl"}>
                <div>
                  <dt>{"Scope"}</dt>
                  <dd>{data.facts.scope}</dd>
                </div>
                <div>
                  <dt>{"Services"}</dt>
                  <dd>
                    <Parts parts={data.facts.services} />
                  </dd>
                </div>
                <div>
                  <dt>{"Not included"}</dt>
                  <dd>{data.facts.exclusions}</dd>
                </div>
                <div>
                  <dt>{"Deliverables"}</dt>
                  <dd>
                    <Parts parts={data.facts.deliverables} />
                  </dd>
                </div>
                <div>
                  <dt>{"Fee structure"}</dt>
                  <dd>{data.facts.feeStructure}</dd>
                </div>
                <div>
                  <dt>{"Expiry"}</dt>
                  <dd>
                    <span className={"num"}>{data.facts.expiry.date}</span> <Sep />
                    {` ${data.facts.expiry.note}`}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <section className={"panel"}>
            <h2>
              <Icon name={"invoice"} />
              {"Fees, by category"}
            </h2>
            <div className={"tw"} role={"region"} aria-label={"Quote lines"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Quote lines"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Category"}</th>
                    <th scope={"col"}>{"Description"}</th>
                    <th scope={"col"} style={right}>
                      {data.currency}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line, index) => (
                    <tr key={line.key ?? index}>
                      <td>{line.category}</td>
                      <td>
                        <Parts parts={line.description} />
                      </td>
                      <td className={"num"} style={right}>
                        {line.amount}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <b>{data.total.label}</b>
                    </td>
                    <td></td>
                    <td className={"num"} style={right}>
                      <b>{data.total.amount}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={"fp-pad"}>
              <div className={"alert info"} style={{ margin: "0" }}>
                <Icon name={"globe"} />
                <div>
                  <b>{data.government.title}</b>
                  {data.government.copy}
                </div>
              </div>
            </div>
          </section>
        </div>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"calendar"} />
              {"Instalments"}
            </h2>
            {data.instalmentsEmpty ? (
              <div className={"fp-pad"}>
                <p>{data.instalmentsEmpty}</p>
              </div>
            ) : (
              <div className={"tw"} role={"region"} aria-label={"Instalments"} tabIndex={0}>
                <table className={"t"}>
                  <caption className={"sr"}>{"Instalments"}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"When"}</th>
                      <th scope={"col"} style={right}>
                        {data.currency}
                      </th>
                      <th scope={"col"}>{"Paid as"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.instalments.map((row, index) => (
                      <tr key={row.key ?? index}>
                        <td>{row.when}</td>
                        <td className={"num"} style={right}>
                          {row.amount}
                        </td>
                        <td>
                          <Parts parts={row.paidAs} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={"fp-pad"}>
              <p className={"fp-note"} style={{ margin: "0" }}>
                {data.instalmentsNote}
              </p>
            </div>
          </section>
          <section className={"panel"}>
            <h2>
              <Icon name={"refund"} />
              {"Refund policy"}
            </h2>
            <div className={"fp-pad"}>
              <p style={{ fontSize: "14.5px" }}>{data.refund}</p>
            </div>
          </section>
          <div className={"fp-row"}>
            {data.actions.edit ? (
              <button className={"btn sm"} data-dlg={"dlgQEdit"}>
                {data.actions.edit.label}
              </button>
            ) : null}
            {data.actions.send ? (
              <button className={"btn p sm"} {...data.actions.send.attrs}>
                <span className={"lab"}>
                  <Icon name={"send"} cls={"ic s"} />
                  {" Send quote"}
                </span>
                <span className={"spin"} aria-hidden={"true"}></span>
              </button>
            ) : null}
            <button className={"btn sm"} {...data.actions.preview.attrs}>
              {"Preview as client"}
            </button>
            <a
              className={"btn sm"}
              href={data.actions.convert.href}
              data-dlg={data.actions.convert.dialog}
              aria-disabled={data.actions.convert.blocked ? "true" : undefined}
              title={data.actions.convert.blocked}
            >
              {"Turn into agreement"}
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

/** A `.fld` textarea with a hint, the Designer's dialog anatomy. */
function Area({ id, label, hint, max, rows, value }: { id: string; label: string; hint?: string; max: number; rows: number; value: string }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      <textarea className={"ta"} id={id} aria-describedby={hint ? `${id}-h` : undefined} maxLength={max} rows={rows} defaultValue={value}></textarea>
    </div>
  );
}

function Alert({ tone, title, children }: { tone: "warn" | "info"; title: string; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} style={{ marginTop: "12px" }}>
      <Icon name={"info"} />
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

export const QUOTE_LINE_CATEGORIES = [
  { value: "professional_fee", label: "Professional fee" },
  { value: "tax", label: "Tax" },
  { value: "disbursement", label: "Disbursement" },
  { value: "government_fee", label: "Government fee" },
] as const;

export const QUOTE_PAID_AS = [
  { value: "advance", label: "Advance (client account)" },
  { value: "invoice_after_delivery", label: "Invoice after delivery" },
] as const;

/** One editable line as the dialog starts with it (amounts in major units, "1600.00"). */
export type QuoteLineInput = { category: string; description: string; amount: string; taxRate: string; sourceNote: string };
export type QuoteInstalmentInput = { label: string; amount: string; paidAs: string };

export type QuoteEditDialogData = {
  organizationId: string;
  agreementId: string;
  currency: string;
  fields: {
    scope: string;
    services: string;
    exclusions: string;
    deliverables: string;
    feeStructure: string;
    refund: string;
    /** YYYY-MM-DD. */
    expiry: string;
    government: string;
  };
  /** The earliest expiry: the firm's today. */
  today: string;
  lines: QuoteLineInput[];
  instalments: QuoteInstalmentInput[];
  /** The quote was sent: saving makes a new version and the client must accept it again. */
  revises: boolean;
  sample: boolean;
};

function LineRow({ line, index }: { line: QuoteLineInput; index: number }) {
  return (
    <tr data-quote-line={"1"}>
      <td>
        <select className={"sel"} aria-label={`Line ${index + 1} category`} data-field={"category"} defaultValue={line.category}>
          {QUOTE_LINE_CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input className={"inp"} type={"text"} aria-label={`Line ${index + 1} description`} data-field={"description"} maxLength={300} defaultValue={line.description} autoComplete={"off"} />
      </td>
      <td>
        <input className={"inp"} type={"text"} inputMode={"decimal"} aria-label={`Line ${index + 1} amount`} data-field={"amount"} maxLength={16} placeholder={"0.00"} defaultValue={line.amount} autoComplete={"off"} />
      </td>
      <td>
        <input className={"inp"} type={"text"} inputMode={"decimal"} aria-label={`Line ${index + 1} tax rate percent`} data-field={"taxRate"} maxLength={6} placeholder={"%"} defaultValue={line.taxRate} autoComplete={"off"} />
      </td>
      <td>
        <input
          className={"inp"}
          type={"text"}
          aria-label={`Line ${index + 1} source`}
          data-field={"sourceNote"}
          maxLength={500}
          placeholder={"Government fee: the official fee list and the date you read it"}
          defaultValue={line.sourceNote}
          autoComplete={"off"}
        />
      </td>
      <td>
        <button className={"btn sm"} type={"button"} data-quote-remove={"1"} aria-label={`Remove line ${index + 1}`}>
          {"Remove"}
        </button>
      </td>
    </tr>
  );
}

function InstalmentRow({ row, index }: { row: QuoteInstalmentInput; index: number }) {
  return (
    <tr data-quote-instalment={"1"}>
      <td>
        <input className={"inp"} type={"text"} aria-label={`Instalment ${index + 1} label`} data-field={"label"} maxLength={200} placeholder={"On signing, or a milestone"} defaultValue={row.label} autoComplete={"off"} />
      </td>
      <td>
        <input className={"inp"} type={"text"} inputMode={"decimal"} aria-label={`Instalment ${index + 1} amount`} data-field={"amount"} maxLength={16} placeholder={"0.00"} defaultValue={row.amount} autoComplete={"off"} />
      </td>
      <td>
        <select className={"sel"} aria-label={`Instalment ${index + 1} paid as`} data-field={"paidAs"} defaultValue={row.paidAs}>
          {QUOTE_PAID_AS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <button className={"btn sm"} type={"button"} data-quote-remove={"1"} aria-label={`Remove instalment ${index + 1}`}>
          {"Remove"}
        </button>
      </td>
    </tr>
  );
}

const EMPTY_LINE: QuoteLineInput = { category: "professional_fee", description: "", amount: "", taxRate: "", sourceNote: "" };
const EMPTY_INSTALMENT: QuoteInstalmentInput = { label: "", amount: "", paidAs: "advance" };

/** Edit quote: scope, texts, expiry, lines and instalments. Save carries `data-agreement-act="quote-save"`. */
export function QuoteEditDialog({ data }: { data: QuoteEditDialogData }) {
  return (
    <dialog className={"dlg wide"} id={"dlgQEdit"} aria-labelledby={"dlgQEditH"}>
      <div className={"dh"}>
        <h2 id={"dlgQEditH"}>{"Edit quote"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgQEdit"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <Area id={"qeS"} label={"Scope"} hint={"What the firm will do for this client. The client sees it in their portal."} max={2000} rows={3} value={data.fields.scope} />
        <div className={"g2"}>
          <Area id={"qeV"} label={"Services"} hint={"One per line."} max={2000} rows={3} value={data.fields.services} />
          <Area id={"qeD"} label={"Deliverables"} hint={"One per line."} max={2000} rows={3} value={data.fields.deliverables} />
        </div>
        <div className={"g2"}>
          <Area id={"qeX"} label={"Not included"} max={2000} rows={2} value={data.fields.exclusions} />
          <div>
            <div className={"fld"}>
              <label htmlFor={"qeF"}>{"Fee structure"}</label>
              <input className={"inp"} id={"qeF"} type={"text"} maxLength={500} placeholder={"Milestones (flat per stage)"} defaultValue={data.fields.feeStructure} autoComplete={"off"} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"qeE"}>{"Expiry"}</label>
              <small className={"hint"} id={"qeE-h"}>
                {"After that the quote needs a new version."}
              </small>
              <input className={"inp"} id={"qeE"} type={"date"} min={data.today} defaultValue={data.fields.expiry} aria-describedby={"qeE-h"} />
            </div>
          </div>
        </div>
        <div className={"fld"}>
          <label>{`Fees, by category (${data.currency})`}</label>
          <small className={"hint"} id={"qeL-h"}>
            {"Amounts in major units, like 1,600.00. The professional fee is the sum of its lines; the total to the firm is every line except government fees. A tax line is entered by hand with its rate."}
          </small>
          <div className={"tw"} role={"region"} aria-label={"Quote lines"} tabIndex={0}>
            <table className={"t"} id={"qeLines"}>
              <caption className={"sr"}>{"Quote lines"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Category"}</th>
                  <th scope={"col"}>{"Description"}</th>
                  <th scope={"col"}>{data.currency}</th>
                  <th scope={"col"}>{"Tax %"}</th>
                  <th scope={"col"}>{"Source"}</th>
                  <th scope={"col"}>
                    <span className={"sr"}>{"Remove"}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data.lines.length ? data.lines : [EMPTY_LINE]).map((line, index) => (
                  <LineRow key={index} line={line} index={index} />
                ))}
              </tbody>
            </table>
          </div>
          <template id={"qeLineRow"}>
            <LineRow line={EMPTY_LINE} index={0} />
          </template>
          <div className={"fp-row"} style={{ marginTop: "8px" }}>
            <button className={"btn sm"} type={"button"} data-quote-add={"qeLines"}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add a line"}
            </button>
          </div>
        </div>
        <div className={"fld"}>
          <label>{`Instalments (${data.currency})`}</label>
          <small className={"hint"} id={"qeI-h"}>
            {"When each part is paid. They add up to the total to the firm. Money paid before the work is done is an advance held in the client account."}
          </small>
          <div className={"tw"} role={"region"} aria-label={"Instalments"} tabIndex={0}>
            <table className={"t"} id={"qeInst"}>
              <caption className={"sr"}>{"Instalments"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"When"}</th>
                  <th scope={"col"}>{data.currency}</th>
                  <th scope={"col"}>{"Paid as"}</th>
                  <th scope={"col"}>
                    <span className={"sr"}>{"Remove"}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.instalments.map((row, index) => (
                  <InstalmentRow key={index} row={row} index={index} />
                ))}
              </tbody>
            </table>
          </div>
          <template id={"qeInstRow"}>
            <InstalmentRow row={EMPTY_INSTALMENT} index={0} />
          </template>
          <div className={"fp-row"} style={{ marginTop: "8px" }}>
            <button className={"btn sm"} type={"button"} data-quote-add={"qeInst"}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add an instalment"}
            </button>
          </div>
        </div>
        <Area id={"qeR"} label={"Refund policy"} hint={"When fees are refunded. Your professional reviewer owns the wording."} max={2000} rows={2} value={data.fields.refund} />
        <Area
          id={"qeG"}
          label={"Government fees"}
          hint={"Government fees are paid by the client to IRCC, never through the firm. Don’t state an amount unless you checked the IRCC fee list; a government-fee line records the date you did."}
          max={500}
          rows={2}
          value={data.fields.government}
        />
        {data.revises ? (
          <Alert tone={"warn"} title={"This quote was already sent"}>
            {"Saving makes a new version and takes the quote back to draft. Send it again so the client can accept the new version."}
          </Alert>
        ) : null}
        {data.sample ? (
          <Alert tone={"info"} title={"Sample matter"}>
            {"This quote is on a sample matter. Nobody real is sent anything."}
          </Alert>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgQEdit"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-agreement-act={"quote-save"} data-agreement={data.agreementId} data-org={data.organizationId}>
          {"Save quote"}
        </button>
      </div>
    </dialog>
  );
}

export type QuotePreviewDialogData = {
  firmName: string;
  title: string;
  status: string;
  facts: { term: string; value: string }[];
  lines: QuoteLineView[];
  total: { label: string; amount: string };
  currency: string;
  instalments: QuoteInstalmentView[];
  government: string;
  refund: string;
  accept: string;
};

/** Preview as client: the quote as the portal shows it, read-only. */
export function QuotePreviewDialog({ data }: { data: QuotePreviewDialogData }) {
  const right = { textAlign: "right" } as React.CSSProperties;
  return (
    <dialog className={"dlg wide"} id={"dlgQPrev"} aria-labelledby={"dlgQPrevH"}>
      <div className={"dh"}>
        <h2 id={"dlgQPrevH"}>{"Preview as client"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgQPrev"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{`Shown the way the client sees it in their portal, under Agreements at ${data.firmName}. ${data.status}`}</p>
        <div className={"li"}>
          <div>
            <b>{data.title}</b>
            <small>{"Quote · not an agreement"}</small>
          </div>
        </div>
        <dl className={"fp-dl"} style={{ marginTop: "12px" }}>
          {data.facts.map((fact) => (
            <div key={fact.term}>
              <dt>{fact.term}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
        <div className={"tw"} role={"region"} aria-label={"Quote lines as the client sees them"} tabIndex={0} style={{ marginTop: "12px" }}>
          <table className={"t"}>
            <caption className={"sr"}>{"Quote lines as the client sees them"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Category"}</th>
                <th scope={"col"}>{"Description"}</th>
                <th scope={"col"} style={right}>
                  {data.currency}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={line.key ?? index}>
                  <td>{line.category}</td>
                  <td>{line.description.join(" · ")}</td>
                  <td className={"num"} style={right}>
                    {line.amount}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>{data.total.label}</b>
                </td>
                <td></td>
                <td className={"num"} style={right}>
                  <b>{data.total.amount}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {data.instalments.length ? (
          <dl className={"fp-dl"} style={{ marginTop: "12px" }}>
            {data.instalments.map((row, index) => (
              <div key={row.key ?? index}>
                <dt>{row.when}</dt>
                <dd>{`${data.currency} ${row.amount} · ${row.paidAs.join(" · ")}`}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p style={{ marginTop: "12px" }}>{data.government}</p>
        <p style={{ marginTop: "8px" }}>{data.refund}</p>
        <p style={{ marginTop: "12px" }}>
          <small>{data.accept}</small>
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgQPrev"}>
          {"Close"}
        </button>
      </div>
    </dialog>
  );
}

export type QuoteConvertDialogData = {
  organizationId: string;
  agreementId: string;
  /** Approved service templates. Empty: blocked. */
  templates: { value: string; label: string }[];
  blocked: { title: string; copy: string } | null;
};

/** Turn into agreement: a service-agreement draft from an approved service template. */
export function QuoteConvertDialog({ data }: { data: QuoteConvertDialogData }) {
  const blocked = data.blocked ?? (data.templates.length ? null : { title: "No approved service template", copy: "Add a service agreement template and have a licensed consultant approve it first." });
  return (
    <dialog className={"dlg"} id={"dlgQConv"} aria-labelledby={"dlgQConvH"}>
      <div className={"dh"}>
        <h2 id={"dlgQConvH"}>{"Turn into agreement"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgQConv"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>
          {"Makes a service-agreement draft on the same matter with this quote’s scope, fee, exclusions, refund policy and government-fee note. The text comes from the template; you can edit clauses before sending it for signature."}
        </p>
        <div className={"fld"}>
          <label htmlFor={"qcT"}>{"Approved service template"}</label>
          <select className={"sel"} id={"qcT"}>
            {data.templates.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {blocked ? <Alert title={blocked.title} tone={"warn"}>{blocked.copy}</Alert> : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgQConv"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-agreement-act={"quote-convert"} data-agreement={data.agreementId} data-org={data.organizationId} disabled={blocked ? true : undefined}>
          {"Create the draft"}
        </button>
      </div>
    </dialog>
  );
}

export type NewQuoteDialogData = {
  organizationId: string;
  /** Open matters with an applicant: value matter id. */
  matters: { value: string; label: string }[];
  /** Approved quote templates: value template id. "Blank quote" is added last. */
  templates: { value: string; label: string }[];
  blocked: { title: string; copy: string } | null;
  sampleMode: boolean;
};

/**
 * The Designer's New quote dialog (`#dlgNewQ`), live on the Quote builder tab: client (a matter
 * with an applicant) and Start from (an approved quote template, or blank). A live-only Title
 * field; Create quote carries `data-agreement-act="quote-new"` in place of `data-goto-tab`.
 */
export function NewQuoteDialog({ data }: { data: NewQuoteDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgNewQ"} aria-labelledby={"dlgNewQH"}>
      <div className={"dh"}>
        <h2 id={"dlgNewQH"}>{"New quote"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgNewQ"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"nqC"}>{"Client or lead"}</label>
          <select className={"sel"} id={"nqC"}>
            {data.matters.length ? (
              data.matters.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            ) : (
              <option value={""}>{"No open matter with an applicant"}</option>
            )}
          </select>
          <small className={"hint"}>{"A quote is made on a matter. A lead gets one once it is converted to a matter."}</small>
        </div>
        <div className={"fld"}>
          <label htmlFor={"nqT"}>{"Start from"}</label>
          <select className={"sel"} id={"nqT"}>
            {data.templates.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={""}>{"Blank quote"}</option>
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"nqN"}>{"Title"}</label>
          <small className={"hint"} id={"nqN-h"}>
            {"Optional. The template’s name, or “Quote”, when left blank."}
          </small>
          <input className={"inp"} id={"nqN"} type={"text"} maxLength={200} aria-describedby={"nqN-h"} autoComplete={"off"} />
        </div>
        {data.sampleMode ? (
          <Alert tone={"warn"} title={"This firm is in sample mode"}>
            {"Only sample matters take quotes until sample mode is turned off. Nobody real is sent anything."}
          </Alert>
        ) : null}
        {data.blocked ? (
          <Alert tone={"warn"} title={data.blocked.title}>
            {data.blocked.copy}
          </Alert>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgNewQ"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-agreement-act={"quote-new"} data-org={data.organizationId} disabled={data.blocked || !data.matters.length ? true : undefined}>
          {"Create quote"}
        </button>
      </div>
    </dialog>
  );
}

/** A tab opened without an agreement: the firm's agreements of that kind to pick from. */
export type AgreementsPickData = {
  title: string;
  intro: string;
  rows: { key: string; href: string; title: string; note: string[]; state: MatterBadge }[];
  empty: { title: string; copy: string; action: { label: string; href?: string; dialog?: string } | null };
};

export function SheetAgreementsPick({ data }: { data: AgreementsPickData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{data.title}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"panel rv"} style={i(1)}>
        {data.rows.length ? (
          <div className={"fp-pad"}>
            {data.rows.map((row) => (
              <div key={row.key} className={"li"}>
                <div>
                  <b>{row.title}</b>
                  <small>
                    <Parts parts={row.note} />
                  </small>
                </div>
                <span className={"r"}>
                  <Badge badge={row.state} />{" "}
                  <a className={"btn sm"} href={row.href}>
                    {"Open"}
                  </a>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty art={"templates-empty"} title={data.empty.title} copy={data.empty.copy}>
            {data.empty.action ? (
              data.empty.action.href ? (
                <a className={"btn p sm"} href={data.empty.action.href}>
                  {data.empty.action.label}
                </a>
              ) : (
                <button className={"btn p sm"} data-dlg={data.empty.action.dialog}>
                  {data.empty.action.label}
                </button>
              )
            ) : null}
          </Empty>
        )}
      </div>
    </>
  );
}
