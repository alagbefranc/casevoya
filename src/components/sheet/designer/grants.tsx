/**
 * The Designer's Access grants page (`markup/grants.tsx`): the Person and matter grants tab
 * (default), Support access (`tab-support`) and Office and team limits (`tab-limits`), with the
 * New access grant dialog (#dlgG). Same DOM, classes and order; values come from the firm.
 *
 * Live-only additions are data attributes: `data-grant-create` and `data-org` on Create grant,
 * `data-person` on each person option and `data-matter`/`data-subject` on each scope option.
 * Support access has no backend yet (SEC-09 is not built): the tab shows no request, an honest
 * empty history, and the capture's note that there is no hidden way in.
 */
import { Fragment } from "react";
import { Empty, Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type GrantsTab = "grants" | "support" | "limits";

type Text = string | { left: string; right: string };

export type GrantRow = { who: string; canSee: Text; why: string; grantedBy: string; expires: { num: string } | string; state: MatterBadge };

export type SupportRequest = {
  alert: { title: string; parts: string[] } | null;
  request: { from: string; scope: string; notIncluded: string; duration: string; reason: Text } | null;
  history: { when: string; who: string; scope: string; approvedBy: string; opened: string }[];
};

export type GrantsData = {
  tab: GrantsTab;
  pills: string[];
  grants: GrantRow[];
  support: SupportRequest;
  supportIntro: string;
  limits: { person: string; role: string; office: string; team: Text }[];
  limitsIntro: string;
  grantsNote: string;
};

export type GrantDialogData = {
  organizationId?: string;
  people: { label: string; personId?: string }[];
  scopes: { label: Text; matterId?: string; subjectId?: string }[];
};

const UL: Record<GrantsTab, React.CSSProperties> = {
  grants: { left: "0px", width: "144px" },
  support: { left: "170px", width: "87px" },
  limits: { left: "282px", width: "130px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Show({ text }: { text: Text }) {
  return typeof text === "string" ? <>{text}</> : <Pair left={text.left} right={text.right} />;
}

/** "A <sep> B <sep> C", spaced as the capture spaces it. */
function Parts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => {
        const text = parts.length === 1 ? part : index === 0 ? `${part} ` : index === parts.length - 1 ? ` ${part}` : ` ${part} `;
        return (
          <Fragment key={index}>
            {index > 0 ? <span className={"sep"} aria-hidden={"true"}></span> : null}
            {text}
          </Fragment>
        );
      })}
    </>
  );
}

export function GrantsHeader({ tab, pills }: { tab: GrantsTab; pills: string[] }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Practice"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"key"} cls={"ic s"} />
          {"Access grants"}
        </button>
        {pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          <button className={"btn p sm"} data-dlg={"dlgG"} data-fpd={"1"}>
            <Icon name={"plus"} cls={"ic s"} />
            {"New grant"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"grants"} className={tab === "grants" ? "on" : undefined}>
          {"Person and matter grants"}
        </button>
        <button role={"tab"} data-t={"support"} className={tab === "support" ? "on" : undefined}>
          {"Support access"}
        </button>
        <button role={"tab"} data-t={"limits"} className={tab === "limits" ? "on" : undefined}>
          {"Office and team limits"}
        </button>
        <i className={"ul"} style={UL[tab]}></i>
      </div>
    </>
  );
}

function Grants({ data }: { data: GrantsData }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/privacy-shield-160@1x.webp"}
            srcSet={"/assets/generated/b2/privacy-shield-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{"Access grants"}</h1>
          <p>{"Time-limited access for a named person to one matter or a set of records. Grants expire on their own, and every use is logged."}</p>
        </div>
      </div>
      {data.grants.length === 0 ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"privacy-shield"} title={"No grants yet"} copy={"Grants you give appear here, with who can see what, why and until when."} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Active grants"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Active grants"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Who"}</th>
                <th scope={"col"}>{"Can see"}</th>
                <th scope={"col"}>{"Why"}</th>
                <th scope={"col"}>{"Granted by"}</th>
                <th scope={"col"}>{"Expires"}</th>
                <th scope={"col"}>{"State"}</th>
              </tr>
            </thead>
            <tbody>
              {data.grants.map((row, index) => (
                <tr key={index}>
                  <td>{row.who}</td>
                  <td>
                    <Show text={row.canSee} />
                  </td>
                  <td>{row.why}</td>
                  <td>{row.grantedBy}</td>
                  <td>{typeof row.expires === "string" ? row.expires : <span className={"num"}>{row.expires.num}</span>}</td>
                  <td>
                    <Badge badge={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={"fp-note rv"} style={i(2)}>
        {data.grantsNote}
      </p>
    </>
  );
}

function Support({ data }: { data: GrantsData }) {
  const { alert, request, history } = data.support;
  let n = 1;
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Support access"}</h1>
          <p>{data.supportIntro}</p>
        </div>
      </div>
      {alert ? (
        <div className={"alert warn rv"} role={"alert"} style={i(n++)}>
          <Icon name={"clock"} />
          <div>
            <b>{alert.title}</b>
            <Parts parts={alert.parts} />
          </div>
          <div className={"acts"}>
            <button className={"btn sm"} data-toast={"Support access ended"} data-sub={"Logged in the audit trail."} data-fpb={"1"}>
              {"End now"}
            </button>
            <button className={"btn sm"} data-toast={"Extension requested"} data-sub={"Needs your approval again."} data-fpb={"1"}>
              {"Extend 30 min"}
            </button>
          </div>
        </div>
      ) : null}
      {request ? (
        <section className={"panel rv"} style={i(n++)}>
          <h2>
            <Icon name={"key"} />
            {"Request waiting for you"}
          </h2>
          <div className={"fp-pad"}>
            <dl className={"fp-dl"}>
              <div>
                <dt>{"From"}</dt>
                <dd>{request.from}</dd>
              </div>
              <div>
                <dt>{"Scope"}</dt>
                <dd>{request.scope}</dd>
              </div>
              <div>
                <dt>{"Not included"}</dt>
                <dd>{request.notIncluded}</dd>
              </div>
              <div>
                <dt>{"Duration"}</dt>
                <dd>{request.duration}</dd>
              </div>
              <div>
                <dt>{"Reason"}</dt>
                <dd>
                  <Show text={request.reason} />
                </dd>
              </div>
            </dl>
            <div className={"fp-row"} style={{ marginTop: "12px" }}>
              <button
                className={"btn p sm"}
                data-run={"ok"}
                data-done={"Support access approved"}
                data-sub={"Ends automatically. You’ll see each thing they open."}
                data-fpr={"1"}
              >
                <span className={"lab"}>{"Approve for 60 minutes"}</span>
                <span className={"spin"} aria-hidden={"true"}></span>
              </button>
              <button className={"btn sm"} data-toast={"Request declined"} data-sub={""} data-fpb={"1"}>
                {"Decline"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {history.length === 0 ? (
        <div className={"panel rv"} style={i(n++)}>
          <Empty art={"privacy-shield"} title={"No support access"} copy={"Casevoya support has never opened your firm’s records."} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Support access history"} tabIndex={0} style={i(n++)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Support access history"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"When"}</th>
                <th scope={"col"}>{"Who"}</th>
                <th scope={"col"}>{"Scope"}</th>
                <th scope={"col"}>{"Approved by"}</th>
                <th scope={"col"}>{"Opened"}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row, index) => (
                <tr key={index}>
                  <td>{row.when}</td>
                  <td>{row.who}</td>
                  <td>{row.scope}</td>
                  <td>{row.approvedBy}</td>
                  <td>{row.opened}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={"fp-note rv"} style={i(n)}>
        {"There’s no hidden “log in as this firm” button."}
      </p>
    </>
  );
}

function Limits({ data }: { data: GrantsData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Office and team limits"}</h1>
          <p>{data.limitsIntro}</p>
        </div>
      </div>
      <div className={"tw rv"} role={"region"} aria-label={"Limits"} tabIndex={0} style={i(1)}>
        <table className={"t"}>
          <caption className={"sr"}>{"Limits"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Person"}</th>
              <th scope={"col"}>{"Role"}</th>
              <th scope={"col"}>{"Office"}</th>
              <th scope={"col"}>{"Team"}</th>
            </tr>
          </thead>
          <tbody>
            {data.limits.map((row, index) => (
              <tr key={index}>
                <td>{row.person}</td>
                <td>{row.role}</td>
                <td>{row.office}</td>
                <td>
                  <Show text={row.team} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SheetGrants({ data }: { data: GrantsData }) {
  if (data.tab === "support") return <Support data={data} />;
  if (data.tab === "limits") return <Limits data={data} />;
  return <Grants data={data} />;
}

/** The Designer's New access grant dialog. It sits after the frame, beside the scrim. */
export function GrantDialog({ data }: { data: GrantDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgG"} aria-labelledby={"dlgGH"}>
      <div className={"dh"}>
        <h2 id={"dlgGH"}>{"New access grant"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgG"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"gW"}>{"Person"}</label>
          <select className={"sel"} id={"gW"}>
            {data.people.map((person, index) => (
              <option key={index} data-person={person.personId}>
                {person.label}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"gS"}>{"Scope"}</label>
          <select className={"sel"} id={"gS"}>
            {data.scopes.map((scope, index) => (
              <option key={index} data-matter={scope.matterId} data-subject={scope.subjectId}>
                <Show text={scope.label} />
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"gE"}>{"Expires"}</label>
          <small className={"hint"} id={"gE-h"}>
            {"Required. Grants never last forever."}
          </small>
          <input className={"inp"} id={"gE"} type={"text"} defaultValue={""} placeholder={"DD/MM/YYYY"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"gR"}>{"Reason"}</label>
          <input className={"inp"} id={"gR"} type={"text"} defaultValue={""} placeholder={""} />
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgG"}>
          {"Cancel"}
        </button>
        <button
          className={"btn p"}
          data-close={"dlgG"}
          data-toast={"Grant created"}
          data-toast-sub={"They get an email with a link that needs sign-in."}
          data-toast-kind={"ok"}
          data-grant-create={data.organizationId ? "1" : undefined}
          data-org={data.organizationId}
        >
          {"Create grant"}
        </button>
      </div>
    </dialog>
  );
}
