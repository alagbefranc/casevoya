/**
 * The Agreements page's other tabs, live: Representation authority (the Designer's table and
 * `#dlgAuth`, from public.representation_authorities), one agreement's own view (the Designer's
 * Envelope tab: signers, events, integrity, signed copies, and `#dlgVoid`), and an honest
 * "not built yet" panel for Quote builder, Agreement editor and Compare versions. Same classes
 * as the captured tabs; never the Designer's sample firm. Buttons carry data attributes that
 * use-sheet wires (agreement-acts.ts).
 */
import type { ReactNode } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/**
 * A tab whose workflow Casevoya does not have yet, inside the live shell: the tab's heading and
 * an honest empty panel with where the work is done today.
 */
export type AgreementsPendingData = {
  title: string;
  intro: string;
  empty: { title: string; copy: string };
  action: { label: string; href?: string; dialog?: string } | null;
};

export function SheetAgreementsPending({ data }: { data: AgreementsPendingData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{data.title}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"panel rv"} style={i(1)}>
        <Empty art={"templates-empty"} title={data.empty.title} copy={data.empty.copy}>
          {data.action ? (
            data.action.href ? (
              <a className={"btn p sm"} href={data.action.href}>
                {data.action.label}
              </a>
            ) : (
              <button className={"btn p sm"} data-dlg={data.action.dialog}>
                {data.action.label}
              </button>
            )
          ) : null}
        </Empty>
      </div>
    </>
  );
}

/** One row of the Representation authority tab (the Designer's table). */
export type AuthorityRow = {
  key: string;
  client: SidebarPerson;
  scope: string;
  evidence: string;
  effective: string;
  state: MatterBadge;
};

export type AuthorityData = {
  rows: AuthorityRow[];
  empty: { title: string; copy: string } | null;
  /** Record authority: opens #dlgAuth, or is disabled with the reason. */
  record: { disabled: boolean; why: string | null };
};

export function SheetAgreementsAuthority({ data }: { data: AuthorityData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Representation authority"}</h1>
          <p>{"Recorded apart from the service agreement. A signed agreement doesn’t prove you can represent someone to the government."}</p>
        </div>
      </div>
      {data.empty ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"templates-empty"} title={data.empty.title} copy={data.empty.copy} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Representation authority"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Representation authority"}</caption>
            <thead>
              <tr>
                {["Client", "Scope", "Evidence", "Effective", "State"].map((head) => (
                  <th key={head} scope={"col"}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className={"fp-row"}>
                      <Avatar person={row.client} />
                      {row.client.name}
                    </span>
                  </td>
                  <td>{row.scope}</td>
                  <td>{row.evidence}</td>
                  <td>
                    <span className={"num"}>{row.effective}</span>
                  </td>
                  <td>
                    <Badge badge={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={"fp-row rv"} style={{ marginTop: "12px", "--i": "2" } as React.CSSProperties}>
        <button
          className={"btn p sm"}
          data-dlg={data.record.disabled ? undefined : "dlgAuth"}
          data-fpd={"1"}
          disabled={data.record.disabled ? true : undefined}
          title={data.record.why ?? undefined}
        >
          <Icon name={"plus"} cls={"ic s"} />
          {"Record authority"}
        </button>
      </div>
    </>
  );
}

function Alert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={"alert warn"} style={{ marginTop: "12px" }}>
      <Icon name={"info"} />
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

export type AuthorityDialogData = {
  organizationId: string;
  /** Each person on an open matter: value `matterId:personId`. */
  clients: { value: string; label: string }[];
  today: string;
  blocked: { title: string; copy: string } | null;
};

/**
 * The Designer's Record representation authority dialog (`#dlgAuth`), live: the client, scope,
 * where the signed authority is kept (a text field; the Designer's upload button is not built)
 * and the effective date. Save carries `data-authority-save` in place of the Designer's toast.
 */
export function AuthorityDialog({ data }: { data: AuthorityDialogData }) {
  const blocked = data.blocked ?? (data.clients.length ? null : { title: "No client to record", copy: "Representation authority is recorded for a person on an open matter." });
  return (
    <dialog className={"dlg"} id={"dlgAuth"} aria-labelledby={"dlgAuthH"}>
      <div className={"dh"}>
        <h2 id={"dlgAuthH"}>{"Record representation authority"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgAuth"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"raC"}>{"Client"}</label>
          <select className={"sel"} id={"raC"}>
            {data.clients.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"raS"}>{"Scope"}</label>
          <input className={"inp"} id={"raS"} type={"text"} maxLength={1000} placeholder={"The application it covers"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"raE"}>{"Evidence"}</label>
          <small className={"hint"} id={"raE-h"}>
            {"Where the signed government form or other authority is kept, like its name in the matter’s documents"}
          </small>
          <input className={"inp"} id={"raE"} type={"text"} maxLength={300} aria-describedby={"raE-h"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"raD"}>{"Effective date"}</label>
          <input className={"inp"} id={"raD"} type={"date"} defaultValue={data.today} />
        </div>
        {blocked ? <Alert title={blocked.title}>{blocked.copy}</Alert> : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgAuth"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-authority-save={"1"} data-org={data.organizationId} disabled={blocked ? true : undefined}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}

/** One agreement's own view (the Designer's Envelope tab). */
export type EnvelopeStep = { state: "done" | "now" | ""; name: string; note: string[] };
export type EnvelopeAction = { label: string; primary?: boolean; href?: string; attrs?: Record<string, string> };

export type EnvelopeViewData = {
  title: string;
  intro: string;
  signers: { badge: MatterBadge | null; steps: EnvelopeStep[]; empty: string | null };
  events: { key: string; when: string; event: string[]; id: string }[];
  integrity: { term: string; value: string }[];
  /** Download the signed PDF and certificate, send a draft, void, countersign, open the matter. */
  actions: EnvelopeAction[];
  note: string;
};

/** "a · b · c" with the Designer's separators. */
function Parts({ parts }: { parts: string[] }) {
  const last = parts.length - 1;
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(`${index === 0 ? "" : " "}${part}${index === last ? "" : " "}`);
  });
  return <>{out}</>;
}

function EnvelopeButton({ action }: { action: EnvelopeAction }) {
  const cls = action.primary ? "btn p sm" : "btn sm";
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

export function SheetAgreementEnvelope({ data }: { data: EnvelopeViewData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>
            <Pair left={"Envelope"} right={data.title} />
          </h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"fp-g2 rv"} style={i(1)}>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"users"} />
              {"Signers, in order"}
              {data.signers.badge ? (
                <span className={"r"}>
                  <Badge badge={data.signers.badge} />
                </span>
              ) : null}
            </h2>
            <div className={"fp-pad"}>
              {data.signers.empty ? (
                <p>{data.signers.empty}</p>
              ) : (
                <ol className={"fp-steps"}>
                  {data.signers.steps.map((step, index) => (
                    <li key={index} className={step.state}>
                      <span className={"d"} aria-hidden={"true"}>
                        {step.state === "done" ? <Icon name={"check-circle"} cls={"ic s"} /> : null}
                      </span>
                      <div>
                        <b>{step.name}</b>
                        <small>
                          <Parts parts={step.note} />
                        </small>
                      </div>
                      {step.state === "now" ? <span className={"sr"}>{"current step"}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
          <section className={"panel"}>
            <h2>
              <Icon name={"history"} />
              {"Signing events"}
            </h2>
            {data.events.length ? (
              <div className={"tw"} role={"region"} aria-label={"Envelope events"} tabIndex={0}>
                <table className={"t"}>
                  <caption className={"sr"}>{"Envelope events"}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"When"}</th>
                      <th scope={"col"}>{"Event"}</th>
                      <th scope={"col"}>{"Event ID"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={event.key}>
                        <td>{event.when}</td>
                        <td>
                          <Parts parts={event.event} />
                        </td>
                        <td>
                          <span className={"num"}>{event.id}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={"fp-pad"}>
                <p>{"No signing events yet. Sending the agreement records the first one."}</p>
              </div>
            )}
          </section>
        </div>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"shield"} />
              {"Integrity"}
            </h2>
            <div className={"fp-pad"}>
              <dl className={"fp-dl"}>
                {data.integrity.map((row) => (
                  <div key={row.term}>
                    <dt>{row.term}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
          <div className={"panel"}>
            <div className={"fp-pad"}>
              <div className={"fp-row"} style={{ flexWrap: "wrap", gap: "8px" }}>
                {data.actions.map((action) => (
                  <EnvelopeButton key={action.label} action={action} />
                ))}
              </div>
              <small style={{ color: "var(--t2)", display: "block", marginTop: "8px" }}>{data.note}</small>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The Designer's Void envelope dialog (`#dlgVoid`), live: a reason is required and kept (the
 * database refuses a void without one). Void carries `data-agreement-void` in place of the toast.
 */
export function VoidEnvelopeDialog({ data }: { data: { organizationId: string; envelopeId: string; who: string } }) {
  return (
    <dialog className={"dlg"} id={"dlgVoid"} aria-labelledby={"dlgVoidH"}>
      <div className={"dh"}>
        <h2 id={"dlgVoidH"}>{"Void this envelope?"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgVoid"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p>{`${data.who} won’t be able to sign this version any more. The envelope and its events stay on record. You can send a new version afterwards.`}</p>
        <div className={"fld"} style={{ marginTop: "12px" }}>
          <label htmlFor={"voR"}>{"Reason"}</label>
          <textarea className={"ta"} id={"voR"} rows={3} maxLength={500}></textarea>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgVoid"}>
          {"Keep it"}
        </button>
        <button className={"btn p"} style={{ background: "#a12c20" }} data-agreement-void={data.envelopeId} data-org={data.organizationId}>
          {"Void envelope"}
        </button>
      </div>
    </dialog>
  );
}
