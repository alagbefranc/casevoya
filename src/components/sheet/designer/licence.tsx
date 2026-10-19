/**
 * The Designer's Licences page (`markup/licence.tsx`): the Licences tab (`tab-lic`), the Review
 * log tab (`tab-log`), and the Report a change (#dlgChg) and Add a licence (#dlgAdd) dialogs.
 * Same DOM, classes and order as the capture; values come from the firm's records.
 *
 * Live-only additions are data attributes, so use-sheet can save through the database:
 * `data-licence-add` on the top bar's Add a licence and the dialog's Add button,
 * `data-licence-report="<credential id>"` on a card's Report a change, `data-licence-send` on
 * the change dialog's Send, and `data-membership` on each consultant option. A captured card
 * without the reveal script's `k2-in` class is always rendered revealed (`k2-in`): nothing in the
 * app adds that class later, and `.k2-rv` alone is invisible.
 */
import { Fragment, type ReactNode } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export const LICENCE_CSS =
  ".ph.v{display:flex;gap:16px;align-items:flex-start}.lic{padding:0}.lic.x{border-color:#f0c4bc}.lic-hd{display:flex;gap:12px;align-items:center;padding:18px 20px 12px}.lic-hd .av{width:40px;height:40px}.lic-hd h2{font-size:20px;font-weight:400;display:block;margin:0}.lic-hd small{color:var(--t2);font-size:13.5px}.lic-st{margin-left:auto}\n.lic-b{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;padding:6px 20px 14px}.lic-dl{display:grid;gap:0}.lic-dl>div{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14.5px}.lic-dl>div:last-child{border:0}.lic-dl dt{color:var(--t2)}.lic-ev h3{font-size:13.5px;color:var(--t2);font-weight:500;margin-bottom:8px}\n.lic-src{padding:0 20px 12px}.lic-f{display:flex;gap:10px;align-items:center;padding:12px 20px 16px;border-top:1px solid var(--line)}.lic-f:empty{display:none}.lic-note{display:inline-flex;gap:6px;align-items:center;color:var(--t2);font-size:13.5px}\n.lg{display:grid;grid-template-columns:190px 1fr;gap:14px;padding:13px 18px;font-size:14.5px}.lg+.lg{border-top:1px solid var(--line)}.lg time{color:var(--t2)}.lg small{display:block;color:var(--t2);font-size:13px}\n@media (max-width:900px){.lic-b{grid-template-columns:1fr}.lic-dl>div{grid-template-columns:1fr;gap:2px}.lic-f{flex-wrap:wrap}.lg{grid-template-columns:1fr;gap:2px}.ph.v>svg{display:none}}";

export type LicenceTab = "lic" | "log";

/** A definition value: plain text, a number, a number with a trailing word, or two parts. */
export type LicenceValue =
  | string
  | { num: string; suffix?: string; after?: string }
  | { left: string; right: string };

export type LicenceProof =
  /** Live: `href` opens the proof through a short signed link (owner or the licence holder only). */
  | { kind: "file"; name: string; meta: string[]; date: string; states: MatterBadge[]; href?: string }
  | { kind: "none"; text: string };

export type LicenceSource = {
  publisher: string;
  url: string;
  linkText: string;
  appliesTo: string;
  version: string;
  checked: string;
  reviewer: string;
  state: MatterBadge;
};

export type LicenceCard = {
  person: SidebarPerson;
  name: string;
  sub: string | { left: string; right: string };
  /** The card's illustration: licence-card, licence-pending or licence-paused. */
  art: string | null;
  state: MatterBadge;
  /** An adverse register result: the Designer's `.lic.x` border. */
  adverse?: boolean;
  rows: { label: string; value: LicenceValue }[];
  proof: LicenceProof;
  source: LicenceSource | null;
  footer: { report?: string; note?: { icon: "lock" | "clock"; text: string } };
};

export type LicenceLogEntry = { at: string; title: string | { left: string; right: string }; parts: string[] };

export type LicencesData = {
  firmName: string;
  tab: LicenceTab;
  intro: string;
  cards: LicenceCard[];
  log: LicenceLogEntry[];
};

export type LicenceDialogsData = {
  /** Present on a real page: the Send and Add buttons carry it as data-org. */
  organizationId?: string;
  /** Consultants without a licence on file; `membershipId` absent in the Designer's sample. */
  consultants: { label: string; membershipId?: string }[];
  inviteLabel: string;
  regulators: string[];
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** "A <sep> B <sep> C", spaced as the capture spaces it. */
function Parts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => {
        const text = parts.length === 1 ? part : index === 0 ? `${part} ` : index === parts.length - 1 ? ` ${part}` : ` ${part} `;
        return (
          <Fragment key={index}>
            {index > 0 ? <Sep /> : null}
            {text}
          </Fragment>
        );
      })}
    </>
  );
}

function Value({ value }: { value: LicenceValue }) {
  if (typeof value === "string") return <>{value}</>;
  if ("left" in value) return <Pair left={value.left} right={value.right} />;
  return (
    <>
      <span className={"num"}>{value.num}</span>
      {value.suffix ?? null}
      {value.after ? (
        <>
          {" "}
          <Sep />
          {` ${value.after}`}
        </>
      ) : null}
    </>
  );
}

export function LicenceHeader({ firmName, tab }: { firmName: string; tab: LicenceTab }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Settings"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"id-card"} cls={"ic s"} />
          {"Licences"}
        </button>
        <span className={"pill"}>{firmName}</span>
        <span className={"acts"}>
          <button className={"btn p sm"} data-licence-add={"open"}>
            <Icon name={"plus"} cls={"ic s"} />
            {"Add a licence"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"lic"} className={tab === "lic" ? "on" : undefined}>
          {"Licences"}
        </button>
        <button role={"tab"} data-t={"log"} className={tab === "log" ? "on" : undefined}>
          {"Review log"}
        </button>
        <i className={"ul"} style={tab === "lic" ? { left: "0px", width: "52px" } : { left: "78px", width: "66px" }}></i>
      </div>
    </>
  );
}

function Searching() {
  return (
    <svg className={"mascot vo-pose p-search"} width={64} height={64} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo searching"} style={{ overflow: "visible" }}>
      <g className={"m-body"} style={{ transformOrigin: "50px 90px" }} transform={""}>
        <path d={"M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
        <ellipse cx={"50"} cy={"60"} rx={"32"} ry={"30"} fill={"#0075DE"} />
        <ellipse cx={"50"} cy={"64"} rx={"21"} ry={"17"} fill={"#fff"} />
        <ellipse cx={"42"} cy={"60"} rx={"3.4"} ry={"3.9"} fill={"#111"} />
        <ellipse cx={"58"} cy={"60"} rx={"3.4"} ry={"3.9"} fill={"#111"} />
        <circle cx={"43.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
        <circle cx={"59.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
        <path d={"M45 70 q5 4 10 0"} fill={"none"} stroke={"#111"} strokeWidth={"2.2"} strokeLinecap={"round"} />
        <ellipse cx={"34"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
        <ellipse cx={"66"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
      </g>
      <circle cx={"82"} cy={"72"} r={"11"} fill={"#fff"} fillOpacity={".6"} stroke={"#111"} strokeWidth={"3"} />
      <path d={"M90 80l8 8"} stroke={"#111"} strokeWidth={"4"} strokeLinecap={"round"} />
      <path className={""} d={"M76 64 q4 2 4 6"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
    </svg>
  );
}

function Proof({ proof }: { proof: LicenceProof }) {
  if (proof.kind === "none") return <p style={{ color: "var(--t2)", fontSize: "14px" }}>{proof.text}</p>;
  const items: ReactNode[] = [];
  proof.meta.forEach((item, index) => {
    if (index > 0) items.push(<span key={`s${index}`} className={"sep"}></span>);
    items.push(
      <span key={`m${index}`} className={/^v\d+$/.test(item) ? "num" : undefined}>
        {item}
      </span>,
    );
  });
  return (
    <article className={"fcard k2-spot"} data-spot={"1"}>
      <div className={"th"}>
        <Icon name={"file-pdf"} cls={"ic l"} />
      </div>
      <div>
        <h4>
          {proof.href ? (
            <a className={"tl"} href={proof.href} target={"_blank"} rel={"noopener"}>
              {proof.name}
            </a>
          ) : (
            proof.name
          )}
        </h4>
        <div className={"meta"}>
          {items}
          <span className={"sep"}></span>
          <time className={"num"}>{proof.date}</time>
        </div>
      </div>
      <div className={"states"}>
        {proof.states.map((state, index) => (
          <Badge key={index} badge={state} />
        ))}
      </div>
    </article>
  );
}

function Source({ source }: { source: LicenceSource }) {
  return (
    <div className={"lic-src"}>
      <details className={"src"}>
        <summary>
          <Icon name={"link"} cls={"ic s"} />
          <span>
            <b style={{ fontWeight: "500" }}>{"Source"}</b> <Sep />
            {` ${source.publisher}`}
          </span>
          <Badge badge={source.state} />
          <Icon name={"chevron-down"} cls={"ic s ch"} />
        </summary>
        <dl>
          <dt>{"Publisher"}</dt>
          <dd>{source.publisher}</dd>
          <dt>{"Link"}</dt>
          <dd>
            <a href={source.url} rel={"noopener"} target={"_blank"}>
              {`${source.linkText} `}
              <Icon name={"external-link"} cls={"ic s"} />
              <span className={"sr"}>{"(opens in a new tab)"}</span>
            </a>
          </dd>
          <dt>{"Applies to"}</dt>
          <dd>{source.appliesTo}</dd>
          <dt>{"Version"}</dt>
          <dd>{source.version}</dd>
          <dt>{"Checked"}</dt>
          <dd>
            <time className={"num"}>{source.checked}</time>
          </dd>
          <dt>{"Reviewer"}</dt>
          <dd>{source.reviewer}</dd>
        </dl>
      </details>
    </div>
  );
}

function Card({ card, index }: { card: LicenceCard; index: number }) {
  return (
    <article className={card.adverse ? "panel lic x k2-rv rv k2-in" : "panel lic k2-rv rv k2-in"} data-reveal={""} style={{ "--d": "0ms", "--i": String(index + 1) } as React.CSSProperties}>
      <header className={"lic-hd"}>
        <Avatar person={card.person} />
        <div>
          <h2>{card.name}</h2>
          <small>{typeof card.sub === "string" ? card.sub : <Pair left={card.sub.left} right={card.sub.right} />}</small>
        </div>
        {card.art ? (
          <span className={"art lic-art"} style={{ "--a": "40px" } as React.CSSProperties} aria-hidden={"true"}>
            <img
              src={`/assets/generated/b2/${card.art}-160@1x.webp`}
              srcSet={`/assets/generated/b2/${card.art}-160@2x.webp 2x`}
              width={40}
              height={40}
              alt={""}
              loading={"lazy"}
              decoding={"async"}
            />
          </span>
        ) : null}
        <span className={"lic-st"}>
          <Badge badge={card.state} />
        </span>
      </header>
      <div className={"lic-b"}>
        <dl className={"lic-dl"}>
          {card.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <Value value={row.value} />
              </dd>
            </div>
          ))}
        </dl>
        <div className={"lic-ev"}>
          <h3>{"Proof"}</h3>
          <Proof proof={card.proof} />
        </div>
      </div>
      {card.source ? <Source source={card.source} /> : null}
      <footer className={"lic-f"}>
        {card.footer.report !== undefined ? (
          <button className={"btn"} data-licence-report={card.footer.report || undefined}>
            <Icon name={"edit"} cls={"ic s"} />
            {"Report a change"}
          </button>
        ) : null}
        {card.footer.note ? (
          <span className={"lic-note"}>
            <Icon name={card.footer.note.icon} cls={"ic s"} />
            {card.footer.note.text}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

export function SheetLicences({ data }: { data: LicencesData }) {
  if (data.tab === "log") {
    return (
      <>
        <div className={"ph rv"} style={i(0)}>
          <h1 className={"display"}>{"Review log"}</h1>
          <p>{"Every check, who did it and what they saw. Entries can’t be edited or deleted."}</p>
        </div>
        <div className={"panel rv"} id={"lgL"} data-rb-list={"1"} style={i(1)}>
          {data.log.length === 0 ? (
            <Empty art={"licence-pending"} title={"Nothing logged yet"} copy={"Licences added, register checks and reported changes appear here."} />
          ) : (
            data.log.map((entry, index) => (
              <div key={index} className={"lg"}>
                <time className={"num"}>{entry.at}</time>
                <div>
                  <b style={{ fontWeight: "500" }}>{typeof entry.title === "string" ? entry.title : <Pair left={entry.title.left} right={entry.title.right} />}</b>
                  <small>
                    <Parts parts={entry.parts} />
                  </small>
                </div>
              </div>
            ))
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <Searching />
        <div>
          <h1 className={"display"}>{"Licences"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      {data.cards.map((card, index) => (
        <Card key={index} card={card} index={index} />
      ))}
    </>
  );
}

export function LicenceDialogs({ data }: { data: LicenceDialogsData }) {
  return (
    <>
      <dialog className={"dlg"} id={"dlgChg"} aria-labelledby={"chH"}>
        <div className={"dh"}>
          <h2 id={"chH"}>{"Report a change"}</h2>
          <button className={"x"} aria-label={"Close"} data-close={"dlgChg"}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        <div className={"db"}>
          <p style={{ marginBottom: "12px" }}>
            {"Tell us about a change to your licence, like a new class, a condition or a suspension. A reviewer checks the register again."}
          </p>
          <div className={"fld"}>
            <label htmlFor={"chW"}>{"What changed?"}</label>
            <textarea className={"ta"} id={"chW"}></textarea>
          </div>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={"dlgChg"}>
            {"Cancel"}
          </button>
          <button
            className={"btn p"}
            data-close={"dlgChg"}
            data-toast={"Change reported"}
            data-toast-sub={"Logged. A reviewer re-checks the register."}
            data-toast-kind={"ok"}
            data-licence-send={"1"}
            data-org={data.organizationId}
          >
            {"Send"}
          </button>
        </div>
      </dialog>
      <dialog className={"dlg"} id={"dlgAdd"} aria-labelledby={"adH"}>
        <div className={"dh"}>
          <h2 id={"adH"}>{"Add a licence"}</h2>
          <button className={"x"} aria-label={"Close"} data-close={"dlgAdd"}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        <div className={"db"}>
          <div className={"fld"}>
            <label htmlFor={"adP"}>{"Consultant"}</label>
            <select className={"sel"} id={"adP"}>
              {data.consultants.map((option) => (
                <option key={option.label} data-membership={option.membershipId}>
                  {option.label}
                </option>
              ))}
              <option>{data.inviteLabel}</option>
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"adR"}>{"Regulator"}</label>
            <select className={"sel"} id={"adR"}>
              {data.regulators.map((label) => (
                <option key={label}>{label}</option>
              ))}
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"adN"}>{"Licence number"}</label>
            <input className={"inp"} id={"adN"} placeholder={"R000000"} />
          </div>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={"dlgAdd"}>
            {"Cancel"}
          </button>
          <button
            className={"btn p"}
            data-close={"dlgAdd"}
            data-toast={"Licence added"}
            data-toast-sub={"Add proof next. It’s checked by hand."}
            data-toast-kind={"ok"}
            data-licence-add={"save"}
            data-org={data.organizationId}
          >
            {"Add"}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** What follows the frame: the two dialogs, then the page's stylesheet. */
export function LicenceAfter({ dialogs }: { dialogs: LicenceDialogsData }) {
  return (
    <>
      <LicenceDialogs data={dialogs} />
      <style dangerouslySetInnerHTML={{ __html: LICENCE_CSS }} />
    </>
  );
}
