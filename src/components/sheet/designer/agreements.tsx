/**
 * The Designer's Agreements page, All agreements tab (`markup/agreements.tsx`), rendered from
 * the firm's records. Same DOM, classes and order. Rows carry `data-f` (the filter chips:
 * waiting, executed, quote, closed) so the kit can filter real rows; the captured rows have none.
 *
 * The header's button opens the Designer's `#dlgNewQ`. Given `live`, that dialog lists the firm's
 * matters and approved agreement templates, adds a scope field, and its submit button carries
 * `data-new-agreement` (create from the template, then send for in-house signature) in place of
 * the Designer's `data-close` / `data-goto-tab`. `#dlgTpl` (new agreement template, and approve a
 * draft) has no Designer original; it uses the Designer's dialog anatomy (`.dlg`, `.fld`, `.inp`,
 * `.ta`, `.li`) and only renders live.
 */
import type { ReactNode } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type AgreementsText = string | { left: string; right: string };

export type AgreementsKpi = {
  href: string;
  label: string;
  count: number;
  note: AgreementsText;
  warn?: boolean;
  /** Opens a dialog on this page in place of following the link. */
  dialog?: string;
};

export type AgreementRow = {
  key?: string;
  /** Filter chip tokens: "waiting", "executed", "quote", "closed". */
  flags?: string[];
  client: SidebarPerson;
  matter: string;
  record: { href: string; left: string; right: string };
  state: MatterBadge;
  signed: string;
  date: AgreementsText;
};

export type AgreementsData = {
  kpis: AgreementsKpi[];
  rows: AgreementRow[];
  /** No rows. `action` is the empty state's button: New agreement, or add a template first. */
  empty: null | { title: string; copy: string; action: { label: string; dialog: string } };
};

export type AgreementsHeaderData = { records: number; waiting: number; create: string };

export type DialogOption = { value?: string; left: string; right?: string };

export type NewAgreementDialogData = {
  title: string;
  matterLabel: string;
  templateLabel: string;
  matters: DialogOption[];
  templates: DialogOption[];
  submit: string;
  /** The real dialog: who saves it, and what to tell the person before they do. */
  live?: {
    organizationId: string;
    sampleMode: boolean;
    /** Why the dialog cannot send yet (no approved template, no matter with an applicant). */
    blocked: { title: string; copy: string; action?: { label: string; dialog: string } } | null;
  };
};

export type TemplateDialogData = {
  organizationId: string;
  kinds: { value: string; label: string }[];
  drafts: { id: string; name: string; kind: string }[];
  /** The signed-in person can approve: a licensed consultant, or an owner with a valid licence. */
  canApprove: boolean;
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Text({ value }: { value: AgreementsText }) {
  return typeof value === "string" ? <>{value}</> : <Pair left={value.left} right={value.right} />;
}

const UNDERLINE = { left: "0px", width: "88px" };

/** The Agreements page's own top bar and its tab strip, All agreements selected. */
export function AgreementsHeader({ data }: { data: AgreementsHeaderData }) {
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
          <Icon name={"signature"} cls={"ic s"} />
          {"Agreements"}
        </button>
        <span className={"pill"}>{`${data.records} ${data.records === 1 ? "record" : "records"}`}</span>
        <span className={"pill"}>{`${data.waiting} waiting for ${data.waiting === 1 ? "signature" : "signatures"}`}</span>
        <span className={"acts"}>
          <button className={"btn p sm"} data-dlg={"dlgNewQ"} data-fpd={"1"}>
            <Icon name={"plus"} cls={"ic s"} />
            {data.create}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"list"} className={"on"}>
          {"All agreements"}
        </button>
        <button role={"tab"} data-t={"quote"}>
          {"Quote builder"}
        </button>
        <button role={"tab"} data-t={"editor"}>
          {"Agreement editor"}
        </button>
        <button role={"tab"} data-t={"envelope"}>
          {"Envelope"}
        </button>
        <button role={"tab"} data-t={"compare"}>
          {"Compare versions"}
        </button>
        <button role={"tab"} data-t={"authority"}>
          {"Representation authority"}
        </button>
        <i className={"ul"} style={UNDERLINE}></i>
      </div>
    </>
  );
}

function Kpi({ kpi }: { kpi: AgreementsKpi }) {
  return (
    <a className={kpi.warn ? "fp-k warn k2-spot" : "fp-k k2-spot"} href={kpi.href} data-spot={"1"} data-dlg={kpi.dialog}>
      <small>{kpi.label}</small>
      <b className={"num"} data-count={String(kpi.count)} data-done={"1"}>
        {String(kpi.count)}
      </b>
      <span>
        <Text value={kpi.note} />
      </span>
    </a>
  );
}

function Row({ row }: { row: AgreementRow }) {
  return (
    <tr data-f={row.flags?.length ? row.flags.join(" ") : undefined}>
      <td>
        <span className={"fp-row"}>
          <Avatar person={row.client} />
          <b style={{ fontWeight: "500" }}>{row.client.name}</b>
        </span>
      </td>
      <td>
        <span className={"num"}>{row.matter}</span>
      </td>
      <td>
        <a href={row.record.href} style={{ color: "var(--blue)" }}>
          <Pair left={row.record.left} right={row.record.right} />
        </a>
      </td>
      <td>
        <Badge badge={row.state} />
      </td>
      <td>
        <span className={"num"}>{row.signed}</span>
      </td>
      <td>
        <span className={"num"}>
          <Text value={row.date} />
        </span>
      </td>
    </tr>
  );
}

export function SheetAgreements({ data }: { data: AgreementsData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Agreements"}</h1>
          <p>
            {
              "Quotes, consultation agreements and service agreements for every client. An accepted quote is not a signed agreement, and a signed agreement doesn’t prove government representation authority; that’s recorded separately."
            }
          </p>
        </div>
      </div>
      <div className={"fp-kpi rv"} style={i(1)}>
        {data.kpis.map((kpi) => (
          <Kpi key={kpi.label} kpi={kpi} />
        ))}
      </div>
      <div className={"bar fp-bar rv"} role={"search"} style={i(2)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search agreements, clients or matters"} aria-label={"Search agreements, clients or matters"} />
        <button className={"fchip on"} aria-pressed={"true"}>
          {"All"}
        </button>
        {["Waiting", "Executed", "Quotes", "Declined, voided, expired"].map((label) => (
          <button key={label} className={"fchip"} aria-pressed={"false"}>
            {label}
          </button>
        ))}
      </div>
      {data.empty ? (
        <div className={"panel rv"} style={i(3)}>
          <Empty art={"templates-empty"} title={data.empty.title} copy={data.empty.copy}>
            <button className={"btn p sm"} data-dlg={data.empty.action.dialog}>
              {data.empty.action.label}
            </button>
          </Empty>
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"All agreements"} tabIndex={0} style={i(3)}>
          <table className={"t"}>
            <caption className={"sr"}>{"All agreements"}</caption>
            <thead>
              <tr>
                {["Client", "Matter or lead", "Record", "State", "Signed", "Date"].map((head) => (
                  <th key={head} scope={"col"}>
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
        <Icon name={"info"} cls={"ic s"} />
        {
          " Declined, expired, voided and partially signed envelopes keep their full event history (AGR-04). Casevoya doesn’t judge whether an agreement is legally sufficient; your professional reviewer owns the mandatory clauses."
        }
      </p>
    </>
  );
}

function Option({ option }: { option: DialogOption }) {
  return <option value={option.value}>{option.right ? <Pair left={option.left} right={option.right} /> : option.left}</option>;
}

function Select({ id, label, options }: { id: string; label: string; options: DialogOption[] }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      <select className={"sel"} id={id}>
        {options.map((option, index) => (
          <Option key={option.value ?? index} option={option} />
        ))}
      </select>
    </div>
  );
}

function Alert({ tone, icon, title, children }: { tone: "warn" | "info"; icon: string; title: string; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} style={{ marginTop: "12px" }}>
      <Icon name={icon} />
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

/** The Designer's New quote dialog (`#dlgNewQ`); live, it creates an agreement from a template and sends it. */
export function NewAgreementDialog({ data }: { data: NewAgreementDialogData }) {
  const live = data.live;
  return (
    <dialog className={"dlg"} id={"dlgNewQ"} aria-labelledby={"dlgNewQH"}>
      <div className={"dh"}>
        <h2 id={"dlgNewQH"}>{data.title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgNewQ"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <Select id={"nqC"} label={data.matterLabel} options={data.matters} />
        <Select id={"nqT"} label={data.templateLabel} options={data.templates} />
        {live ? (
          <>
            <div className={"fld"}>
              <label htmlFor={"nqS"}>{"Scope of services"}</label>
              <small className={"hint"} id={"nqS-h"}>
                {"What the firm will do. The client sees it with the agreement text."}
              </small>
              <textarea className={"ta"} id={"nqS"} aria-describedby={"nqS-h"} maxLength={2000}></textarea>
            </div>
            {live.sampleMode ? (
              <Alert tone={"warn"} icon={"info"} title={"This firm is in sample mode"}>
                {"Only sample matters take agreements until sample mode is turned off. Nobody real is asked to sign."}
              </Alert>
            ) : null}
            {live.blocked ? (
              <Alert tone={"warn"} icon={"templates"} title={live.blocked.title}>
                {live.blocked.copy}
                {live.blocked.action ? (
                  <>
                    {" "}
                    <button className={"btn sm"} data-dlg={live.blocked.action.dialog} data-close={"dlgNewQ"}>
                      {live.blocked.action.label}
                    </button>
                  </>
                ) : null}
              </Alert>
            ) : (
              <Alert tone={"info"} icon={"signature"} title={"Sent for in-house signature"}>
                {"The applicant signs first, then the sponsor if there is one, in their portal. The text is locked with its SHA-256 hash when it is sent."}
              </Alert>
            )}
          </>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgNewQ"}>
          {"Cancel"}
        </button>
        {live ? (
          <button className={"btn p"} data-new-agreement={"1"} data-org={live.organizationId} disabled={live.blocked ? true : undefined}>
            {data.submit}
          </button>
        ) : (
          <button className={"btn p"} data-close={"dlgNewQ"} data-goto-tab={"quote"}>
            {data.submit}
          </button>
        )}
      </div>
    </dialog>
  );
}

/** New agreement template, and the drafts waiting for a licensed reviewer. Live only. */
export function TemplateDialog({ data }: { data: TemplateDialogData }) {
  return (
    <dialog className={"dlg wide"} id={"dlgTpl"} aria-labelledby={"dlgTplH"}>
      <div className={"dh"}>
        <h2 id={"dlgTplH"}>{"Agreement templates"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgTpl"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>
          {"A template starts as a draft. A licensed consultant approves it before it can be sent. Approval records the reviewer; Casevoya doesn’t certify the wording."}
        </p>
        <div className={"fld"}>
          <label htmlFor={"tpK"}>{"Kind"}</label>
          <select className={"sel"} id={"tpK"}>
            {data.kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"tpN"}>{"Name"}</label>
          <input className={"inp"} id={"tpN"} type={"text"} autoComplete={"off"} maxLength={200} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"tpB"}>{"Agreement text"}</label>
          <small className={"hint"} id={"tpB-h"}>
            {"The clauses the client signs. Your professional reviewer owns the mandatory clauses."}
          </small>
          <textarea className={"ta"} id={"tpB"} aria-describedby={"tpB-h"} rows={10} maxLength={20000}></textarea>
        </div>
        {data.drafts.length ? (
          <div className={"fld"}>
            <label>{"Waiting for approval"}</label>
            {data.drafts.map((draft) => (
              <div key={draft.id} className={"li"}>
                <div>
                  <b>{draft.name}</b>
                  <small>{draft.kind}</small>
                </div>
                <span className={"r"}>
                  {data.canApprove ? (
                    <button className={"btn sm"} data-approve-template={draft.id} data-org={data.organizationId}>
                      {"Approve"}
                    </button>
                  ) : (
                    <small>{"A licensed consultant approves it"}</small>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgTpl"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-new-template={"1"} data-org={data.organizationId}>
          {"Save draft"}
        </button>
      </div>
    </dialog>
  );
}
