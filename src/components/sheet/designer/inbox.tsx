/**
 * The Designer's Inbox page (`markup/inbox.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for each tab: Conversations, Email to triage, Delivery problems
 * and Announcements, and the New message dialog. Values and button attributes come from props:
 * live, the triage buttons carry `data-inbox-file` / `data-inbox-dismiss` (use-sheet saves them)
 * instead of the Designer's toasts.
 */
import type { ReactNode } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";

export type InboxTab = "conv" | "triage" | "bounced" | "notes";
export type InboxTone = "ok" | "rev" | "chg" | "bad" | "gr" | "blue";
export type InboxChip = { tone: InboxTone; label: string };
/** Plain words, or two parts with the Designer's separator. */
export type Text2 = string | [string, string];
type Attrs = Record<string, string>;

export type ThreadItem = {
  href: string;
  selected: boolean;
  person: SidebarPerson;
  unread: boolean;
  /** Matter reference, then the latest message. */
  line: [string, string];
  when: string;
  /** Live only: the channel chip tokens (portal, email, whatsapp), as `data-f`. */
  flags?: string[];
};

export type ThreadMail = { meta: string[]; body: string; files?: [string, string] | null };

export type ThreadView = {
  title: [string, string];
  role: InboxChip | null;
  mails: ThreadMail[];
  vo?: { draft: string; sources: [string, string] } | null;
  audience: { title: string; copy: string };
  reply: {
    send: { label: string; attrs: Attrs };
    note: Attrs;
    acknowledge: string;
    /** Live only: the acknowledgement checkbox's attributes (its id when it applies, or disabled with why). */
    ackAttrs?: Attrs;
  };
};

export type TriageAttachment = { label: string; name: string; doc?: string; image?: string | null };
export type TriageAction = { label: string; primary?: boolean; attrs?: Attrs; href?: string };
export type TriageRow = {
  from: string;
  subject: string;
  attachments: TriageAttachment[];
  suggestion: Text2;
  why: Text2;
  actions: TriageAction[];
};

export type BouncedRow = { sent: string; to: string; notice: string; problem: Text2; followUp: Text2; state: InboxChip };
export type AnnouncementCard = { title: string; audience: Text2; when: Text2 };

export type InboxData = {
  tab: InboxTab;
  /** `filterEmpty` (live only): a hidden "Nothing matches" line in the list for the chips and search. */
  conv?: { filters: string[]; threads: ThreadItem[]; view: ThreadView | null; filterEmpty?: boolean };
  triage?: {
    copy: string;
    sources: { logo: string | null; parts: [string, string] }[];
    rows: TriageRow[];
  };
  bounced?: { alert: { title: string; parts: string[]; href: string } | null; rows: BouncedRow[] };
  notes?: { cards: AnnouncementCard[] };
};

export type ComposeData = {
  to: [string, string][];
  /** Live only: each To option's value (matter and person), in the same order as `to`. */
  toValues?: string[];
  templates: string[];
  /** The Designer's toast, or live: the Send button's attributes (use-sheet sends the email). */
  send: { toast: string; kind: string; sub?: string } | { attrs: Attrs };
};

const UNDERLINE: Record<InboxTab, { left: string; width: string }> = {
  conv: { left: "0px", width: "83px" },
  triage: { left: "109px", width: "86px" },
  bounced: { left: "221px", width: "108px" },
  notes: { left: "355px", width: "94px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Chip({ chip }: { chip: InboxChip }) {
  return (
    <span className={`bd ${chip.tone}`}>
      <i></i>
      {chip.label}
    </span>
  );
}

function T2({ value }: { value: Text2 }) {
  return typeof value === "string" ? <>{value}</> : <Pair left={value[0]} right={value[1]} />;
}

/** "Rafael · today 08:41 · via portal": parts with the Designer's separators. */
function Parts({ parts }: { parts: string[] }) {
  const last = parts.length - 1;
  return (
    <>
      {parts.map((part, index) => (
        <PartText key={index} first={index === 0} text={`${index === 0 ? "" : " "}${part}${index === last ? "" : " "}`} />
      ))}
    </>
  );
}

function PartText({ first, text }: { first: boolean; text: string }) {
  return (
    <>
      {first ? null : <Sep />}
      {text}
    </>
  );
}

export function InboxHeader({ tab, pills }: { tab: InboxTab; pills: string[] }) {
  const tabs: [InboxTab, string][] = [
    ["conv", "Conversations"],
    ["triage", "Email to triage"],
    ["bounced", "Delivery problems"],
    ["notes", "Announcements"],
  ];
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
          <Icon name={"inbox"} cls={"ic s"} />
          {"Inbox"}
        </button>
        {pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          <button className={"btn p sm"} data-dlg={"dlgMsg"} data-fpd={"1"}>
            <Icon name={"edit"} cls={"ic s"} />
            {"Compose"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {tabs.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[tab]}></i>
      </div>
    </>
  );
}

function Heading({ title, copy, art }: { title: string; copy: string; art?: string }) {
  return (
    <div className={art ? "ph v rv" : "ph rv"} style={i(0)}>
      {art ? (
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={`/assets/generated/b2/${art}-160@1x.webp`}
            srcSet={`/assets/generated/b2/${art}-160@2x.webp 2x`}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
      ) : null}
      <div>
        <h1 className={"display"}>{title}</h1>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function EmptyPanel({ n, art, title, copy }: { n: number; art: string; title: string; copy: string }) {
  return (
    <div className={"panel rv"} style={i(n)}>
      <Empty art={art} title={title} copy={copy} />
    </div>
  );
}

const LI_STYLE = { margin: "0", borderRadius: "0", borderBottom: "1px solid var(--line)" };

function VoDraft({ draft, sources }: { draft: string; sources: [string, string] }) {
  return (
    <div className={"ai"}>
      <div className={"vohd"}>
        <svg className={"mascot m-done"} width={30} height={30} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo, the Casevoya assistant, draft ready"}>
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
            <circle cx={"80"} cy={"22"} r={"11"} fill={"#205c38"} />
            <path d={"M75 22.5l3.4 3.4 6.4-7"} fill={"none"} stroke={"#fff"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"} />
          </g>
        </svg>
        <small>
          <Pair left={"Drafted by Vo"} right={"needs your review"} />
        </small>
      </div>
      <p style={{ marginTop: "8px" }}>{draft}</p>
      <small style={{ display: "block", marginTop: "6px" }}>
        <Pair left={sources[0]} right={sources[1]} />
      </small>
      <div className={"row"}>
        <button className={"btn sm p"} data-ai={"ok"}>
          {"Accept"}
        </button>
        <button className={"btn sm"} data-ai={"edit"}>
          {"Edit"}
        </button>
        <button className={"btn sm"} data-ai={"no"}>
          {"Reject"}
        </button>
      </div>
    </div>
  );
}

function Thread({ view }: { view: ThreadView }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={"message"} />
        <span>
          <Pair left={view.title[0]} right={view.title[1]} />
        </span>
        {view.role ? (
          <span className={"r"}>
            <Chip chip={view.role} />
          </span>
        ) : null}
      </h2>
      <div className={"fp-pad"} style={{ display: "grid", gap: "12px" }}>
        {view.mails.map((mail, index) => (
          <div key={index} className={"fp-mail"}>
            <small style={{ color: "var(--t2)" }}>
              <Parts parts={mail.meta} />
            </small>
            <p style={{ marginTop: "4px" }}>{mail.body}</p>
            {mail.files ? (
              <small style={{ color: "var(--t2)" }}>
                <Icon name={"paperclip"} cls={"ic s"} />
                {` ${mail.files[0]} `}
                <Sep />
                {` ${mail.files[1]}`}
              </small>
            ) : null}
          </div>
        ))}
        {view.vo ? <VoDraft draft={view.vo.draft} sources={view.vo.sources} /> : null}
        <div className={"alert info"} style={{ margin: "0" }}>
          <Icon name={"users"} />
          <div>
            <b>{view.audience.title}</b>
            {view.audience.copy}
          </div>
        </div>
        <div className={"fld"}>
          <label htmlFor={"rp"}>{"Reply"}</label>
          <textarea className={"ta"} id={"rp"}></textarea>
        </div>
        <div className={"fp-row"}>
          <button className={"btn p sm"} {...view.reply.send.attrs}>
            <span className={"lab"}>
              <Icon name={"send"} cls={"ic s"} />
              {` ${view.reply.send.label}`}
            </span>
            <span className={"spin"} aria-hidden={"true"}></span>
          </button>
          <button className={"btn sm"} {...view.reply.note}>
            {"Staff-only note"}
          </button>
          <label className={"check"} title={typeof view.reply.ackAttrs?.title === "string" ? view.reply.ackAttrs.title : undefined}>
            <input type={"checkbox"} {...view.reply.ackAttrs} />
            <span>{view.reply.acknowledge}</span>
          </label>
        </div>
      </div>
    </section>
  );
}

function Conversations({ data }: { data: NonNullable<InboxData["conv"]> }) {
  return (
    <>
      <Heading title={"Inbox"} copy={"Every client conversation, across matters. Each reply shows who will see it before you send."} />
      <div className={"bar fp-bar rv"} role={"search"} style={i(1)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search messages"} aria-label={"Search messages"} />
        {data.filters.map((label, index) => (
          <button key={label} className={index === 0 ? "fchip on" : "fchip"} aria-pressed={index === 0 ? "true" : "false"}>
            {label}
          </button>
        ))}
      </div>
      {data.threads.length === 0 || !data.view ? (
        <EmptyPanel
          n={2}
          art={"inbox-empty"}
          title={"No conversations yet"}
          copy={"Portal and WhatsApp messages on a matter, and email from a client once it is filed to their matter, appear here as conversations."}
        />
      ) : (
        <div className={"fp-g2 rv"} style={i(2)}>
          <div className={"panel"} id={"cvL"}>
            {data.threads.map((thread, index) => (
              <a
                key={index}
                className={thread.selected ? "li sel" : "li"}
                href={thread.href}
                data-i={String(index)}
                data-f={thread.flags?.length ? thread.flags.join(" ") : undefined}
                style={{ background: thread.selected ? "var(--tint)" : "#fff", ...LI_STYLE }}
              >
                <Avatar person={thread.person} />
                <div style={{ minWidth: "0" }}>
                  <b>
                    {thread.unread ? `${thread.person.name} ` : thread.person.name}
                    {thread.unread ? (
                      <span className={"bd blue"} style={{ marginLeft: "6px" }}>
                        <i></i>
                        {"Unread"}
                      </span>
                    ) : null}
                  </b>
                  <small style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <Pair left={thread.line[0]} right={thread.line[1]} />
                  </small>
                </div>
                <span className={"r num"} style={{ fontSize: "13px", color: "var(--t2)" }}>
                  {thread.when}
                </span>
              </a>
            ))}
            {data.filterEmpty ? (
              <div className={"fp-fe"} hidden>
                <Empty art={"filter-empty"} title={"Nothing matches"} copy={"Try another filter or clear the search."} />
              </div>
            ) : null}
          </div>
          <div>
            <Thread view={data.view} />
          </div>
        </div>
      )}
    </>
  );
}

function Attachment({ file }: { file: TriageAttachment }) {
  const title = `${file.label} · ${file.name}`;
  return (
    <button type={"button"} className={"doct"} data-doc={file.doc} data-doc-t={file.doc ? title : undefined} aria-label={file.doc ? `Preview ${title}` : title}>
      {file.image ? <img src={`/assets/docs/${file.image}-600.webp`} alt={""} width={48} height={64} loading={"lazy"} decoding={"async"} /> : null}
      <span>
        <Pair left={file.label} right={file.name} />
      </span>
    </button>
  );
}

function Actions({ actions }: { actions: TriageAction[] }) {
  const nodes: ReactNode[] = [];
  actions.forEach((action, index) => {
    if (index > 0) nodes.push(" ");
    const cls = action.primary ? "btn p sm" : "btn sm";
    nodes.push(
      action.href ? (
        <a key={index} className={cls} href={action.href}>
          {action.label}
        </a>
      ) : (
        <button key={index} className={cls} {...action.attrs}>
          {action.label}
        </button>
      ),
    );
  });
  return <>{nodes}</>;
}

function Triage({ data }: { data: NonNullable<InboxData["triage"]> }) {
  return (
    <>
      <Heading art={"inbox-empty"} title={"Email to triage"} copy={data.copy} />
      <div className={"fp-row rv"} style={{ margin: "-6px 0px 14px", gap: "14px", ...i(1) }}>
        {data.sources.map((source, index) => (
          <span key={index} className={"fp-tag"}>
            {source.logo ? <img src={source.logo} alt={""} width={16} height={16} style={{ verticalAlign: "-3px" }} /> : null}
            <span>
              {` ${source.parts[0]} `}
              <Sep />
              {` ${source.parts[1]}`}
            </span>
          </span>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <EmptyPanel n={2} art={"inbox-empty"} title={"Nothing to triage"} copy={"Email nobody could match to a client waits here until someone files or dismisses it."} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Imported email to triage"} tabIndex={0} style={i(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Imported email to triage"}</caption>
            <thead>
              <tr>
                {["From", "Subject", "Suggested match", "Why", "Action"].map((label) => (
                  <th key={label} scope={"col"}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.from}</td>
                  <td>
                    {row.subject}
                    {row.attachments.length ? (
                      <div className={"doct-row"} style={{ margin: "8px 0 0" }}>
                        {row.attachments.map((file, at) => (
                          <Attachment key={at} file={file} />
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <T2 value={row.suggestion} />
                  </td>
                  <td>
                    <T2 value={row.why} />
                  </td>
                  <td>
                    <Actions actions={row.actions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Bounced({ data }: { data: NonNullable<InboxData["bounced"]> }) {
  return (
    <>
      <Heading title={"Delivery problems"} copy={"Notices that bounced, weren’t sent or failed. When a critical notice on a matter bounces, Casevoya opens a follow-up task for the firm owner; follow up the others yourself."} />
      {data.alert ? (
        <div className={"alert bad rv"} role={"alert"} style={i(1)}>
          <Icon name={"mail"} />
          <div>
            <b>{data.alert.title}</b>
            <Parts parts={data.alert.parts} />
          </div>
          <div className={"acts"}>
            <a className={"btn sm"} href={data.alert.href}>
              {"Open task"}
            </a>
          </div>
        </div>
      ) : null}
      {data.rows.length === 0 ? (
        <EmptyPanel n={2} art={"inbox-empty"} title={"Every notice was delivered"} copy={"A notice that bounces or can’t be sent appears here with who follows it up."} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Delivery problems"} tabIndex={0} style={i(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Delivery problems"}</caption>
            <thead>
              <tr>
                {["Sent", "To", "Notice", "Problem", "Follow-up", "State"].map((label) => (
                  <th key={label} scope={"col"}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.sent}</td>
                  <td>{row.to}</td>
                  <td>{row.notice}</td>
                  <td>
                    <T2 value={row.problem} />
                  </td>
                  <td>
                    <T2 value={row.followUp} />
                  </td>
                  <td>
                    <Chip chip={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Notes({ data }: { data: NonNullable<InboxData["notes"]> }) {
  return (
    <>
      <Heading title={"Announcements"} copy={"Short notices to many clients at once, using approved templates. Each shows its audience before sending."} />
      {data.cards.length === 0 ? (
        <EmptyPanel n={1} art={"inbox-empty"} title={"No announcements yet"} copy={"Casevoya doesn’t send announcements to many clients at once yet."} />
      ) : (
        <div className={"fp-cards rv"} style={i(1)}>
          {data.cards.map((card, index) => (
            <div key={index} className={"fp-card"}>
              <h3>{card.title}</h3>
              <p>
                <T2 value={card.audience} />
              </p>
              <small style={{ color: "var(--t2)" }}>
                <T2 value={card.when} />
              </small>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function SheetInbox({ data }: { data: InboxData }) {
  if (data.tab === "triage") return <Triage data={data.triage ?? { copy: "", sources: [], rows: [] }} />;
  if (data.tab === "bounced") return <Bounced data={data.bounced ?? { alert: null, rows: [] }} />;
  if (data.tab === "notes") return <Notes data={data.notes ?? { cards: [] }} />;
  return <Conversations data={data.conv ?? { filters: ["All"], threads: [], view: null }} />;
}

/**
 * The Designer's New message dialog. Live, each To option carries its matter and person as its
 * value, and Send carries `data-inbox-compose` (use-sheet sends the email) instead of the toast.
 */
export function ComposeDialog({ data }: { data: ComposeData }) {
  return (
    <dialog className={"dlg"} id={"dlgMsg"} aria-labelledby={"dlgMsgH"}>
      <div className={"dh"}>
        <h2 id={"dlgMsgH"}>{"New message"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgMsg"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"nmT"}>{"To"}</label>
          <select className={"sel"} id={"nmT"}>
            {data.to.map(([name, matter], index) => (
              <option key={index} value={data.toValues?.[index]}>
                {`${name} `}
                <Sep />
                {` ${matter}`}
              </option>
            ))}
          </select>
        </div>
        {/* Live, with no approved message templates, the template choice is not shown. */}
        {data.templates.length ? (
          <div className={"fld"}>
            <label htmlFor={"nmTp"}>{"Start from a template"}</label>
            <select className={"sel"} id={"nmTp"}>
              {data.templates.map((label) => (
                <option key={label}>{label}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"nmB"}>{"Message"}</label>
          <textarea className={"ta"} id={"nmB"}></textarea>
        </div>
        <div className={"alert info"}>
          <Icon name={"users"} />
          <div>
            <b>{"Audience shown before you send"}</b>
            {"Only the person you pick and staff on the file."}
          </div>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgMsg"}>
          {"Cancel"}
        </button>
        {"attrs" in data.send ? (
          <button className={"btn p"} data-close={"dlgMsg"} {...data.send.attrs}>
            {"Send"}
          </button>
        ) : (
          <button className={"btn p"} data-close={"dlgMsg"} data-toast={data.send.toast} data-toast-kind={data.send.kind} data-toast-sub={data.send.sub}>
            {"Send"}
          </button>
        )}
      </div>
    </dialog>
  );
}
