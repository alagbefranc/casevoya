/**
 * The Designer's licence-suspended home (`markup/licence-suspended.tsx`): the Sheet home for a
 * consultant whose CICC licence check recorded an adverse result, with the alert, the "What still
 * works, and what's paused" panel and the Reassign work dialog (#dlgRe, inside #content as the
 * capture has it). Same DOM, classes and order; the rest of the page is SheetHome.
 *
 * Live-only additions are data attributes: `data-open="dlgRe"` on Reassign work (the Designer's
 * own dialog opener), `data-reassign-from`/`data-org` on the dialog's Reassign button,
 * `data-membership`/`data-name` on each receiving consultant and `data-matter` on each matter.
 */
import { Icon, Pair, Sep } from "./frame";

export const SUSPENDED_CSS = ".sus{margin:6px 0 18px}.sus-p{padding:0}.sus-hd{display:flex;gap:14px;align-items:center;padding:18px 20px 6px}.sus-hd h2{font-size:22px;font-weight:300;display:block}.sus-hd p{color:var(--t2);font-size:14.5px}\n.who2{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 20px}.who2>div{border-radius:12px;padding:14px 16px;font-size:14.5px;line-height:1.55}.who2 h4{display:flex;gap:8px;align-items:center;font-size:14px;font-weight:600;margin-bottom:4px}.who2 ul{padding-left:18px}.who2 .y{background:var(--ok-bg);color:#143d25}.who2 .n{background:var(--canvas);color:#3d3a37}\n.sus-f{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:12px 20px 18px}.sus-f small{display:block;color:var(--t2);font-size:13.5px}\n@media (max-width:900px){.who2{grid-template-columns:1fr;padding:10px 14px}.sus-f{flex-direction:column;align-items:stretch;padding:10px 14px 16px}.sus-hd{padding:14px}}";

export type SuspendedData = {
  alert: { title: string; body: string; href: string; action: string };
  /** The panel's two lists. */
  stillWorks: string[];
  paused: string[];
  footer: { title: string; note: string };
  reassign: {
    organizationId?: string;
    fromMembershipId?: string;
    note: string;
    targets: { name: string; parts: string[]; membershipId?: string }[];
    matters: { name: string; reference: string; note: string; checked: boolean; matterId?: string }[];
    reason: string;
  };
};

/** `firmHref`: live only, where the firm-name button goes (`data-nav`). */
export type SuspendedTop = { firmName: string; pills: string[]; newTitle: string; firmHref?: string };

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The home top bar with New paused, as the capture has it. */
export function SuspendedTopBar({ data }: { data: SuspendedTop }) {
  return (
    <header className={"top"}>
      <button className={"crumb"} data-nav={data.firmHref}>
        <Icon name={"home"} cls={"ic s"} />
        {data.firmName}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      {data.pills.map((pill) => (
        <span key={pill} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}>
        <button className={"btn s sm"} data-palette={"1"}>
          <Icon name={"search"} cls={"ic s"} />
          {"Search"}
        </button>
        <button className={"btn p sm"} id={"newB"} aria-disabled={"true"} title={data.newTitle}>
          <Icon name={"plus"} cls={"ic s"} />
          {"New"}
        </button>
      </span>
    </header>
  );
}

/** "Grace Lin · RCIC · verified 2 Oct", spaced as the capture spaces it. */
function TargetText({ name, parts }: { name: string; parts: string[] }) {
  if (parts.length === 0) return <>{name}</>;
  if (parts.length === 1) return <Pair left={name} right={parts[0]} />;
  return (
    <>
      {`${name} `}
      <Sep />
      {` ${parts[0]} `}
      <Sep />
      {` ${parts.slice(1).join(", ")}`}
    </>
  );
}

/** The alert first in #content, as the capture has it. */
export function SuspendedAlert({ data }: { data: SuspendedData }) {
  return (
    <div className={"alert bad sus rv"} role={"alert"} style={i(0)}>
      <Icon name={"alert"} />
      <div>
        <b>{data.alert.title}</b>
        {data.alert.body}
      </div>
      <div className={"acts"}>
        <a className={"btn sm p"} href={data.alert.href}>
          {data.alert.action}
        </a>
      </div>
    </div>
  );
}

/** The panel and the Reassign work dialog, between the greeting and the quick actions. */
export function SuspendedPanel({ data }: { data: SuspendedData }) {
  const checked = data.reassign.matters.filter((matter) => matter.checked).length;
  const target = data.reassign.targets[0]?.name ?? "";
  return (
    <>
      <section className={"panel sus-p rv"} style={i(2)}>
        <div className={"sus-hd"}>
          <span className={"art"} style={{ "--a": "44px" } as React.CSSProperties} aria-hidden={"true"}>
            <img
              src={"/assets/generated/b2/licence-paused-160@1x.webp"}
              srcSet={"/assets/generated/b2/licence-paused-160@2x.webp 2x"}
              width={44}
              height={44}
              alt={""}
              loading={"lazy"}
              decoding={"async"}
            />
          </span>
          <div>
            <h2>{"What still works, and what’s paused"}</h2>
            <p>{"Nothing is deleted. Evidence and audit history stay exactly as they are."}</p>
          </div>
        </div>
        <div className={"who2"}>
          <div className={"y"}>
            <h4>
              <Icon name={"check-circle"} cls={"ic s"} />
              {"Still works"}
            </h4>
            <ul>
              {data.stillWorks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className={"n"}>
            <h4>
              <Icon name={"lock"} cls={"ic s"} />
              {"Paused for you"}
            </h4>
            <ul>
              {data.paused.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className={"sus-f"}>
          <div>
            <b style={{ fontWeight: "500" }}>{data.footer.title}</b>
            <small>{data.footer.note}</small>
          </div>
          <button className={"btn"} data-open={data.reassign.organizationId ? "dlgRe" : undefined}>
            <Icon name={"users"} cls={"ic s"} />
            {"Reassign work"}
          </button>
        </div>
      </section>
      <dialog className={"dlg rv"} id={"dlgRe"} aria-labelledby={"reH"} style={i(3)}>
        <div className={"dh"}>
          <h2 id={"reH"}>{"Reassign work"}</h2>
          <button className={"x"} aria-label={"Close"} data-close={"dlgRe"}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        <div className={"db"}>
          <p style={{ marginBottom: "12px" }}>{data.reassign.note}</p>
          <div className={"fld"}>
            <label htmlFor={"toC"}>{"Reassign to"}</label>
            <select className={"sel"} id={"toC"}>
              {data.reassign.targets.map((option) => (
                <option key={option.name} data-membership={option.membershipId} data-name={option.membershipId ? option.name : undefined}>
                  <TargetText name={option.name} parts={option.parts} />
                </option>
              ))}
            </select>
          </div>
          {data.reassign.matters.map((matter, index) => (
            <label key={index} className={"check"}>
              <input type={"checkbox"} defaultChecked={matter.checked} data-matter={matter.matterId} />
              <span>
                <Pair left={matter.name} right={matter.reference} />
                <small>{matter.note}</small>
              </span>
            </label>
          ))}
          <div className={"fld"} style={{ marginTop: "14px" }}>
            <label htmlFor={"reN"}>{"Note for the audit log"}</label>
            <textarea className={"ta"} id={"reN"} defaultValue={data.reassign.reason}></textarea>
          </div>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={"dlgRe"}>
            {"Cancel"}
          </button>
          <button
            className={"btn p"}
            data-close={"dlgRe"}
            data-toast={`${checked} matter${checked === 1 ? "" : "s"} reassigned to ${target}`}
            data-toast-sub={data.reassign.organizationId ? "Logged in the audit trail." : "Clients notified. Logged in the audit trail."}
            data-toast-kind={"ok"}
            data-reassign-from={data.reassign.fromMembershipId}
            data-org={data.reassign.organizationId}
          >
            {`Reassign ${checked} matter${checked === 1 ? "" : "s"}`}
          </button>
        </div>
      </dialog>
    </>
  );
}
