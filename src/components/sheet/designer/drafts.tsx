/**
 * The Designer's Vo drafts page (`markup/drafts.tsx`). Same DOM, classes and order as the capture;
 * the drafts, the abstention, the switches and the week's counts come from the firm's Vo runs and
 * drafts (PRD AI-01..AI-03). Vo drafts only: Accept and Edit open the draft in the conversation's
 * composer, where a person edits and sends it; Reject discards it. Nothing here sends anything.
 */
import { Empty, Icon, Pair, Sep } from "./frame";

export type Attrs = Record<string, string | boolean>;

export type DraftsHeaderData = {
  pills: string[];
  /** The capture's "Ask Vo" toast. Absent on a real page (there is no free-form Ask Vo). */
  ask: Attrs | null;
  settings: Attrs;
};

export type DraftTimeline = {
  id: string;
  /** The `data-s` summary: sources, "run logged", seconds. */
  summary: string;
  done: boolean;
  /** "Checked 3 sources in 0.3s" once done. */
  said: string;
  /** Seconds shown while still running. */
  clock: string;
  items: string[];
};

export type DraftCard = {
  id: string;
  meta: string[];
  title: string;
  sub: { left: string; right: string };
  body: string;
  timeline: DraftTimeline;
  accept: Attrs;
  edit: Attrs;
  reject: Attrs;
};

export type DraftSwitch = { id: string; label: string; on: boolean; attrs: Attrs };

export type DraftsData = {
  heading: string;
  intro: string;
  /** The "Vo is checking…" line under the heading, only while a run is in progress. */
  loading: { label: string; clock: string } | null;
  cards: DraftCard[];
  /** A run still drafting. */
  running: { started: string; text: string } | null;
  /** The latest request Vo declined to draft because it needs a consultant. */
  abstain: { meta: { left: string; right: string }; title: string; copy: string } | null;
  empty: { title: string; copy: string } | null;
  lock: string;
  switches: DraftSwitch[];
  week: string[];
  weekNote: string;
};

/** "a · b · c" as the capture writes it: the first part with a trailing space, the last with a leading one. */
function joined(parts: string[]) {
  const out: React.ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(index === 0 ? (parts.length === 1 ? part : `${part} `) : index === parts.length - 1 ? ` ${part}` : ` ${part} `);
  });
  return out;
}

export function DraftsHeader({ data }: { data: DraftsHeaderData }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"sparkles"} cls={"ic s"} />
        {"Vo drafts"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      {data.pills.map((pill) => (
        <span key={pill} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}>
        {data.ask ? (
          <button className={"btn s sm"} {...data.ask}>
            <Icon name={"ai-chat"} cls={"ic s"} />
            {"Ask Vo"}
          </button>
        ) : null}
        <button className={"btn s sm"} {...data.settings}>
          <Icon name={"settings"} cls={"ic s"} />
          {"AI settings"}
        </button>
      </span>
    </header>
  );
}

function CiteMascot() {
  return (
    <svg className={"mascot vo-pose p-cite"} width={64} height={64} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo showing its sources"} style={{ overflow: "visible" }}>
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
      <g transform={"rotate(6 76 76)"}>
        <rect x={"66"} y={"58"} width={26} height={34} rx={"3"} fill={"#fff"} stroke={"#111"} strokeWidth={"2"} />
        <rect x={"62"} y={"62"} width={26} height={34} rx={"3"} fill={"#fff"} stroke={"#111"} strokeWidth={"2"} />
        <path d={"M67 70h15M67 76h15M67 82h9"} stroke={"#c9c5c0"} strokeWidth={"2.4"} strokeLinecap={"round"} />
        <path d={"M80 62v12l3 -3 3 3v-12"} fill={"#0075DE"} />
      </g>
      <path className={""} d={"M22 66 q-8 6 -6 14"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
    </svg>
  );
}

function ReviewMascot() {
  return (
    <svg className={"mascot m-review"} width={30} height={30} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo, the Casevoya assistant, needs review"}>
      <g className={"m-body"} style={{ transformOrigin: "50px 90px" }}>
        <path d={"M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
        <ellipse cx={"50"} cy={"60"} rx={"32"} ry={"30"} fill={"#0075DE"} />
        <ellipse cx={"50"} cy={"64"} rx={"21"} ry={"17"} fill={"#fff"} />
        <g className={"m-eyes"} style={{ transformOrigin: "50px 60px" }}>
          <ellipse cx={"42"} cy={"60"} rx={"3.4"} ry={"3.9099999999999997"} fill={"#111"} />
          <ellipse cx={"58"} cy={"60"} rx={"3.4"} ry={"3.9099999999999997"} fill={"#111"} />
          <circle cx={"43.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
          <circle cx={"59.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
        </g>
        <path className={"m-mouth"} d={"M45 70 q5 4 10 0"} fill={"none"} stroke={"#111"} strokeWidth={"2.2"} strokeLinecap={"round"} />
        <ellipse cx={"34"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
        <ellipse cx={"66"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
      </g>
      <g className={"m-badge"}>
        <circle cx={"80"} cy={"22"} r={"11"} fill={"#ffb110"} />
        <path d={"M80 16v7"} stroke={"#111"} strokeWidth={"2.6"} strokeLinecap={"round"} />
        <circle cx={"80"} cy={"27.5"} r={"1.6"} fill={"#111"} />
      </g>
    </svg>
  );
}

function AbstainMascot() {
  return (
    <svg className={"mascot vo-pose p-abstain"} width={56} height={56} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo pointing you to your consultant"} style={{ overflow: "visible" }}>
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
      <g>
        <path d={"M66 14 h28 a6 6 0 0 1 6 6 v16 a6 6 0 0 1 -6 6 h-16 l-7 7 v-7 h-5 a6 6 0 0 1 -6 -6 v-16 a6 6 0 0 1 6 -6z"} fill={"#fff"} stroke={"#111"} strokeWidth={"2"} />
        <circle cx={"80"} cy={"23"} r={"4"} fill={"#0075DE"} />
        <path d={"M72 36 q8 -9 16 0"} fill={"#0075DE"} />
      </g>
      <path className={""} d={"M78 66 q8 -2 10 -10"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
    </svg>
  );
}

const LOADING_DELAYS = ["0ms", "108ms", "216ms", "756ms", null, "324ms", "648ms", "540ms", "432ms"];

const SMALL: React.CSSProperties = { color: "var(--t2)", fontSize: "13px" };
const H3: React.CSSProperties = { fontSize: "17px", fontWeight: "500", color: "var(--ink)", margin: "6px 0 4px" };

/** The Designer's "Checking sources…" timeline, closed once the run is done. */
export function SourceTimeline({ data, style }: { data: DraftTimeline; style?: React.CSSProperties }) {
  return (
    <div className={data.done ? "tlh k2-tl is-done shut" : "tlh k2-tl"} data-s={data.summary} style={style}>
      <button type={"button"} className={"k2-tl-h"} aria-expanded={data.done ? "false" : "true"} aria-controls={data.id} disabled={data.done ? undefined : true}>
        <Icon name={"sparkles"} cls={"ic s k2-tl-g"} />
        <span className={"k2-tl-say"}>
          <span className={"k2-tl-w k2-shiny"}>{"Checking sources…"}</span>
          <span className={"k2-tl-d"}>{data.done ? data.said : null}</span>
        </span>
        <span className={"k2-tl-c num"}>{data.done ? null : data.clock}</span>
        <Icon name={"chevron-down"} cls={"ic s k2-tl-ch"} />
      </button>
      <div className={"k2-tl-b"} id={data.id}>
        <ol>
          {data.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Card({ card }: { card: DraftCard }) {
  return (
    <div
      className={"panel dr"}
      style={{ padding: "18px 18px 16px", display: "grid", gridTemplateColumns: "36px 1fr auto", gap: "12px", marginBottom: "12px" }}
    >
      <ReviewMascot />
      <div>
        <small style={SMALL}>{joined(card.meta)}</small>
        <h3 style={H3}>{card.title}</h3>
        <small style={SMALL}>
          <Pair left={card.sub.left} right={card.sub.right} />
        </small>
        <div style={{ background: "var(--canvas)", borderRadius: "10px", padding: "12px 14px", margin: "12px 0 10px", fontSize: "14.5px" }}>
          {card.body}
        </div>
        <SourceTimeline data={card.timeline} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "80px" }}>
        <button className={"btn p sm"} data-a={"ok"} {...card.accept}>
          {"Accept"}
        </button>
        <button className={"btn s sm"} data-a={"edit"} {...card.edit}>
          {"Edit"}
        </button>
        <button className={"btn sm"} data-a={"no"} style={{ background: "none" }} {...card.reject}>
          {"Reject"}
        </button>
      </div>
    </div>
  );
}

export function SheetDrafts({ data }: { data: DraftsData }) {
  return (
    <>
      <div className={"ph v rv"} style={{ "--i": "0" } as React.CSSProperties}>
        <CiteMascot />
        <div>
          <h1 className={"display"} id={"hi"}>
            {data.heading}
          </h1>
          <p>{data.intro}</p>
          {data.loading ? (
            <div id={"ll"} style={{ marginTop: "12px" }} className={"k2-ll"} role={"status"}>
              <span className={"k2-ll-g"} aria-hidden={"true"} style={{ "--cyc": "864ms" } as React.CSSProperties}>
                {LOADING_DELAYS.map((delay, index) => (delay ? <i key={index} style={{ animationDelay: delay }}></i> : <i key={index} className={"x"}></i>))}
              </span>
              <span className={"k2-ll-t"}>
                <span className={"k2-ll-l k2-shiny"}>{data.loading.label}</span>{" "}
                <span className={"k2-ll-s num"} aria-hidden={"true"}>
                  {data.loading.clock}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div id={"dl"} className={"rv"} style={{ "--i": "1" } as React.CSSProperties}>
        {data.cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
        {data.empty && data.cards.length === 0 ? (
          <div className={"panel"} style={{ marginBottom: "12px" }}>
            <Empty art={"review-queue-empty"} title={data.empty.title} copy={data.empty.copy} />
          </div>
        ) : null}
        {data.running ? (
          <div className={"panel dr"} aria-live={"polite"} style={{ padding: "18px", display: "grid", gridTemplateColumns: "48px 1fr", gap: "12px", alignItems: "center", background: "#fbfaf9" }}>
            <img src={"/assets/vo/vo-thinking-96.png"} srcSet={"/assets/vo/vo-thinking-192.png 2x"} width={48} height={48} alt={""} />
            <div>
              <small style={SMALL}>
                <Icon name={"wand"} cls={"ic s"} />
                {" Vo is drafting "}
                <Sep />
                {` started ${data.running.started}`}
              </small>
              <p style={{ margin: "4px 0 0", fontSize: "15px" }}>{data.running.text}</p>
            </div>
          </div>
        ) : null}
      </div>
      {data.abstain ? (
        <div
          className={"panel ab rv"}
          style={
            {
              display: "grid",
              gridTemplateColumns: "64px 1fr",
              gap: "14px",
              alignItems: "center",
              padding: "16px 18px",
              marginBottom: "12px",
              background: "rgb(250, 249, 248)",
              "--i": "2",
            } as React.CSSProperties
          }
        >
          <AbstainMascot />
          <div>
            <small style={SMALL}>
              <Pair left={data.abstain.meta.left} right={data.abstain.meta.right} />
            </small>
            <h3 style={H3}>{data.abstain.title}</h3>
            <small style={SMALL}>{data.abstain.copy}</small>
          </div>
        </div>
      ) : null}
      <div className={"lock rv"} style={{ fontSize: "13.5px", "--i": "3" } as React.CSSProperties}>
        <Icon name={"shield"} cls={"ic s"} />
        {data.lock}
      </div>
    </>
  );
}

export function DraftsRbar({ data }: { data: DraftsData }) {
  return (
    <aside id={"rbar"} aria-label={"Details"}>
      <h4>{"What Vo can draft"}</h4>
      <div className={"rank"} style={{ fontSize: "13.5px" }}>
        {data.switches.map((item) => (
          <div key={item.id} style={{ padding: "8px 4px" }}>
            {item.label}
            <span style={{ marginLeft: "auto" }}>
              <button type={"button"} className={"k2-sw"} role={"switch"} aria-checked={item.on ? "true" : "false"} id={item.id} {...item.attrs}>
                <span className={"k2-th"} aria-hidden={"true"}></span>
                <span className={"k2-sr"}>{item.label}</span>
              </button>
            </span>
          </div>
        ))}
      </div>
      <h4>{"This week"}</h4>
      <p style={{ fontSize: "13.5px" }}>{joined(data.week)}</p>
      <p style={{ fontSize: "13px", color: "var(--t2)", marginTop: "6px" }}>{data.weekNote}</p>
    </aside>
  );
}

export type AskVoData = { organizationId: string; matters: { id: string; label: string }[] };

/**
 * Ask Vo (live-only, in the Designer's dialog anatomy): a question about one matter, answered for
 * the staff member only from the firm's records, with the records it read. Vo abstains when the
 * question needs a rule, a fee, a deadline or a legal judgement. The answer is shown, not stored.
 */
export function AskVoDialog({ data }: { data: AskVoData }) {
  return (
    <dialog className={"dlg"} id={"dlgAsk"} aria-labelledby={"dlgAskH"}>
      <div className={"dh"}>
        <h2 id={"dlgAskH"}>{"Ask Vo"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgAsk"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"askM"}>{"Matter"}</label>
          <select className={"sel"} id={"askM"}>
            {data.matters.map((matter) => (
              <option key={matter.id} value={matter.id}>
                {matter.label}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"askQ"}>{"Question"}</label>
          <small className={"hint"} id={"askQ-h"}>
            {"Vo answers from this matter’s records only, for you. It won’t give legal advice or state a rule, fee or deadline."}
          </small>
          <textarea className={"ta"} id={"askQ"} aria-describedby={"askQ-h"} maxLength={1000} rows={3}></textarea>
        </div>
        <div id={"askOut"} aria-live={"polite"} hidden style={{ background: "var(--canvas)", borderRadius: "10px", padding: "12px 14px", fontSize: "14.5px" }}>
          <p id={"askText"} style={{ margin: 0 }}></p>
          <small id={"askSrc"} style={{ display: "block", marginTop: "6px", color: "var(--t2)", fontSize: "13px" }}></small>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgAsk"}>
          {"Close"}
        </button>
        <button className={"btn p"} data-vo-ask={"1"} data-org={data.organizationId} disabled={data.matters.length ? undefined : true}>
          {"Ask"}
        </button>
      </div>
    </dialog>
  );
}
