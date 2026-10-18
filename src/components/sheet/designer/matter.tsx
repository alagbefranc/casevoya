/**
 * The Designer's matter page (`markup/matter.tsx`), rendered from the firm's records.
 * Same DOM, classes and order as the capture. Tabs whose records are not stored yet
 * show the Designer's empty-state panel instead of sample rows.
 */
import type { ReactNode } from "react";
import { gaugeArcs, percent } from "./home";
import { Badge, type MatterBadge } from "./matters";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { PersonEditDialog, personEditProps, type PersonEditDialogData } from "./person-edit";
import { PolicyMissingAlert } from "./portal-policies";
import { MatterDecisionsLive, MatterSubmissions, type MatterDecisionsData, type MatterSubmissionsData } from "./matter-government";
import type { PolicyKind } from "@/modules/portal-policies/defaults";
import type { PersonEditData } from "@/modules/sheet/edit-person";
import { ChatError, ChatView } from "@/components/messages/chat";
import type { ChatData } from "@/modules/messages/present";

export const MATTER_TABS = [
  ["overview", "Overview"],
  ["intake", "Intake"],
  ["forms", "Forms"],
  ["documents", "Documents"],
  ["submissions", "Submissions"],
  ["decisions", "Decisions"],
  ["people", "People"],
  ["agreements", "Agreements"],
  ["tasks", "Tasks and deadlines"],
  ["messages", "Messages"],
  ["billing", "Billing"],
  ["closure", "Closure"],
  ["timeline", "Timeline"],
  ["audit", "Audit"],
] as const;

export type MatterTab = (typeof MATTER_TABS)[number][0];

/** Where the Designer measured each tab's underline. The kit re-measures it on load. */
const UNDERLINE: Record<MatterTab, [number, number]> = {
  overview: [0, 57],
  intake: [83, 36],
  forms: [145, 37],
  documents: [208, 66],
  submissions: [301, 73],
  decisions: [400, 57],
  people: [483, 39],
  agreements: [549, 70],
  tasks: [645, 116],
  messages: [786, 56],
  billing: [869, 40],
  closure: [935, 45],
  timeline: [1006, 52],
  audit: [1084, 33],
};

export function matterTab(raw: string | undefined): MatterTab {
  return MATTER_TABS.some(([key]) => key === raw) ? (raw as MatterTab) : "overview";
}

const css = (style: Record<string, string>) => style as React.CSSProperties;

/** "A " · " B " · " C" — the Designer's separated facts, each a single text run. */
function Joined({ parts }: { parts: string[] }): ReactNode {
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    const last = index === parts.length - 1;
    out.push(`${index === 0 ? "" : " "}${part}${last ? "" : " "}`);
  });
  return <>{out}</>;
}

function Plain({ badge }: { badge: MatterBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.label}
    </span>
  );
}

/* ---------------------------------------------------------------- header */

export type MatterHeaderData = {
  client: SidebarPerson;
  pills: string[];
  hold: null | { reason: string | null; parts: string[] };
  tab: MatterTab;
  /** Wires Resume and sends Request document to the Documents tab. */
  wire?: MatterWire | null;
  /** Shows "Record deadline" on the Tasks and deadlines tab. Only when wired and the role may record one. */
  deadline?: boolean;
};

export function MatterTopBar({ data }: { data: MatterHeaderData }) {
  const [left, width] = UNDERLINE[data.tab];
  return (
    <>
      <header className={"top"}>
        <a className={"back"} href={"/sheet/matters"} aria-label={"Back"}>
          <Icon name={"chevron-left"} cls={"ic s"} />
        </a>
        <button className={"crumb"}>
          <Icon name={"folder"} cls={"ic s"} />
          {"Matters"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Avatar person={data.client} />
          {data.client.name}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        {data.pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          <button className={"btn s sm"} data-hold={""}>
            <Icon name={"clock"} cls={"ic s"} />
            {"On hold"}
          </button>
          <button className={"btn s sm"} data-letter={""}>
            <Icon name={"mail"} cls={"ic s"} />
            {"Record letter"}
          </button>
          <button className={"btn s sm"} data-stage={""}>
            <Icon name={"workflow"} cls={"ic s"} />
            {"Change stage"}
          </button>
          {data.wire && data.deadline && data.tab === "tasks" ? (
            <button className={"btn s sm"} data-open={"dDeadline"}>
              <Icon name={"alarm"} cls={"ic s"} />
              {"Record deadline"}
            </button>
          ) : null}
          <button className={"btn p sm"} data-goto-tab={data.wire ? "documents" : undefined}>
            <Icon name={"upload"} cls={"ic s"} />
            {"Request document"}
          </button>
        </span>
      </header>
      {data.hold ? (
        <div className={"hold"} id={"holdBar"} role={"status"}>
          <Icon name={"clock"} cls={"ic s"} />
          <div>
            <b>{data.hold.reason ? <Pair left={"On hold"} right={data.hold.reason} /> : "On hold"}</b>
            <small>
              <Joined parts={data.hold.parts} />
            </small>
          </div>
          <button className={"btn s sm"} id={"holdOff"} {...wireProps("resume", data.wire)}>
            {"Resume"}
          </button>
        </div>
      ) : null}
      <div className={"tabs"} role={"tablist"}>
        {MATTER_TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === data.tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={{ left: `${left}px`, width: `${width}px` }}></i>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- overview */

export type MatterEvent = { dot: string; title: string; parts: string[]; badge: MatterBadge; when: string };

export type MatterOverviewData = {
  client: SidebarPerson;
  facts: string[];
  badges: MatterBadge[];
  stage: { index: number; total: number; label: string };
  documents: { accepted: number; review: number; outstanding: number };
  requests: { person: SidebarPerson; title: string; badge: MatterBadge }[];
  blockers: { blocking: boolean; text: string }[];
  people: { person: SidebarPerson; role: string; locked?: boolean }[];
  events: MatterEvent[];
};

const GROW = "@keyframes grow{from{transform:scaleX(0)}}";

function segmentColor(index: number, current: number): string {
  if (index < current) return "var(--blue)";
  if (index === current) return "#62aef0";
  return "var(--muted)";
}

function EventRow({ event, index }: { event: MatterEvent; index: number }) {
  return (
    <div className={"li rv"} style={css({ "--i": String(index) })}>
      <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: event.dot, flex: "none" }}></i>
      <div>
        <b>{event.title}</b>
        <small>
          <Joined parts={event.parts} />
        </small>
      </div>
      <span className={"r"}>
        <Plain badge={event.badge} />
        <small className={"num"} style={{ color: "var(--t2)", fontSize: "13px", minWidth: "70px", textAlign: "right" }}>
          {event.when}
        </small>
      </span>
    </div>
  );
}

export function MatterOverview({ data }: { data: MatterOverviewData }) {
  const gauge = [
    { label: "Accepted", count: data.documents.accepted, color: "#0075DE" },
    { label: "In review", count: data.documents.review, color: "#62aef0" },
    { label: "Outstanding", count: data.documents.outstanding, color: "#d9d5d0" },
  ];
  const total = gauge.reduce((sum, segment) => sum + segment.count, 0);
  const arcs = gaugeArcs(gauge);
  return (
    <>
      <div style={css({ display: "flex", gap: "18px", alignItems: "center", flexWrap: "wrap", "--i": "0" })} className={"rv"}>
        <Avatar person={data.client} cls={"av xl"} />
        <div>
          <h1 className={"display"} style={{ fontSize: "36px" }}>
            {data.client.name}
          </h1>
          <p style={{ color: "var(--t2)" }}>
            <Joined parts={data.facts} />
          </p>
        </div>
      </div>
      <div style={css({ display: "flex", gap: "8px", flexWrap: "wrap", margin: "14px 0px 4px", "--i": "1" })} className={"rv"}>
        {data.badges.map((badge) => (
          <Badge key={badge.label} badge={badge} />
        ))}
      </div>
      <div
        role={"img"}
        style={css({ display: "flex", gap: "4px", margin: "16px 0px 22px", "--i": "2" })}
        aria-label={`Stage ${data.stage.index + 1} of ${data.stage.total}: ${data.stage.label}`}
        className={"rv"}
      >
        {Array.from({ length: data.stage.total }, (_, index) => (
          <i
            key={index}
            style={{
              flex: "1",
              height: "6px",
              borderRadius: "4px",
              background: segmentColor(index, data.stage.index),
              transformOrigin: "left",
              animation: `grow 300ms var(--ease) ${index * 20}ms backwards`,
            }}
          ></i>
        ))}
      </div>
      <style dangerouslySetInnerHTML={{ __html: GROW }} />
      <div className={"panel matov rv"} style={css({ "--i": "4" })}>
        <h2>
          <Icon name={"dashboard"} />
          {"File health"}
        </h2>
        <div className={"split"}>
          <div>
            <h3>
              <Icon name={"file-check"} cls={"ic s"} />
              {"Document completion"}
            </h3>
            <div className={"gauge"} id={"g"}>
              <svg viewBox={"0 0 190 104"} aria-hidden={"true"}>
                {arcs.map((arc) => (
                  <path
                    key={arc.color}
                    d={"M 15 96 A 80 80 0 0 1 175 96"}
                    fill={"none"}
                    stroke={arc.color}
                    strokeWidth={"16"}
                    strokeLinecap={"butt"}
                    strokeDasharray={arc.dash}
                    strokeDashoffset={arc.offset}
                    data-d={arc.dash}
                    data-o={arc.offset}
                  />
                ))}
              </svg>
              <div className={"c"}>
                <b className={"num"} data-count={String(total)} data-done={"1"}>
                  {String(total)}
                </b>
                <small>{"documents in checklist"}</small>
              </div>
            </div>
            <div className={"leg"}>
              {gauge.map((segment) => (
                <div key={segment.label}>
                  <i style={{ background: segment.color }}></i>
                  {segment.label}
                  <span className={"num"}>
                    <b>{String(segment.count)}</b>
                  </span>
                  <span className={"num"}>{percent(segment.count, total)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>
              <Icon name={"upload"} cls={"ic s"} />
              {"Outstanding requests"}
            </h3>
            <div className={"rank"}>
              {data.requests.length === 0 ? (
                <div>{"No open requests"}</div>
              ) : (
                data.requests.map((request, index) => (
                  <a key={index} href={"?tab=documents"}>
                    <Avatar person={request.person} />
                    <span style={{ flex: "1", minWidth: "0" }}>{request.title}</span>
                    <Plain badge={request.badge} />
                  </a>
                ))
              )}
            </div>
            <a className={"btn s sm"} href={"?tab=documents"} style={{ width: "100%", marginTop: "8px" }}>
              {"View all documents"}
            </a>
          </div>
          <div>
            <h3>
              <Icon name={"info"} cls={"ic s"} />
              {"Blockers and people"}
            </h3>
            <div className={"rank"}>
              {data.blockers.length === 0 ? (
                <div>{"Nothing blocking"}</div>
              ) : (
                data.blockers.map((blocker, index) =>
                  blocker.blocking ? (
                    <div key={index}>
                      <Icon name={"alert"} cls={"ic s"} />
                      <span style={{ flex: "1" }}>{blocker.text}</span>
                      <span className={"bd chg"}>
                        <i></i>
                        {"Blocking"}
                      </span>
                    </div>
                  ) : (
                    <div key={index}>
                      <Icon name={"clock"} cls={"ic s"} />
                      <span>{blocker.text}</span>
                    </div>
                  ),
                )
              )}
            </div>
            <h3 style={{ marginTop: "12px" }}>
              <Icon name={"users"} cls={"ic s"} />
              {"Key people"}
            </h3>
            <div className={"rank"}>
              {data.people.length === 0 ? (
                <div>{"No people on this matter yet"}</div>
              ) : (
                data.people.map((row, index) => (
                  <div key={index}>
                    <Avatar person={row.person} />
                    <span style={{ flex: "1" }}>
                      {row.person.name}
                      <br />
                      <small style={{ color: "var(--t2)", fontSize: "13px" }}>{row.locked ? <Pair left={row.role} right={"locked"} /> : row.role}</small>
                    </span>
                    {row.locked ? <Icon name={"lock"} cls={"ic s"} /> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      <h3 className={"sub rv"} style={css({ "--i": "5" })}>
        <Icon name={"history"} cls={"ic s"} />
        {" Recent events"}
      </h3>
      {data.events.length === 0 ? (
        <div className={"li rv"} style={css({ "--i": "6" })}>
          <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#c9c5c0", flex: "none" }}></i>
          <div>
            <b>{"No activity recorded yet"}</b>
            <small>{"Uploads, signatures and stage changes appear here."}</small>
          </div>
        </div>
      ) : (
        data.events.map((event, index) => <EventRow key={index} event={event} index={6 + index} />)
      )}
    </>
  );
}

/* ------------------------------------------------------------ right column */

export type MatterRbarData = {
  /** The Vo draft card. Absent until Vo is switched on and has a draft for this matter. */
  vo?: { draft: string; sources: string } | null;
  agreement: { title: string; state: string | null; parts: string[] };
  /** Recorded separately from the agreement. Absent until the firm stores it. */
  representation?: { title: string; note: string } | null;
  /** A staff-only pinned note. Absent until notes are stored. */
  note?: { text: string; parts: string[] } | null;
};

function MatterVo({ draft, sources }: { draft: string; sources: string }) {
  return (
    <div className={"ai"} id={"voAssist"}>
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
      <small style={{ display: "block", marginTop: "6px" }}>{sources}</small>
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

export function MatterRbar({ data }: { data: MatterRbarData }) {
  return (
    <aside id={"rbar"} aria-label={"Details"}>
      {data.vo ? (
        <>
          <h4>{"Assist"}</h4>
          <MatterVo draft={data.vo.draft} sources={data.vo.sources} />
        </>
      ) : null}
      <h4>{"Agreement"}</h4>
      <div className={"card"} style={{ display: "flex", gap: "10px" }}>
        <span style={{ color: "#f0a200" }}>
          <Icon name={"download"} cls={"ic s"} />
        </span>
        <div>
          {data.agreement.state ? <Pair left={data.agreement.title} right={data.agreement.state} /> : data.agreement.title}
          <small>
            <Joined parts={data.agreement.parts} />
          </small>
        </div>
      </div>
      {data.representation ? (
        <>
          <h4>{"Representation"}</h4>
          <div className={"card"} style={{ display: "flex", gap: "10px" }}>
            <Icon name={"check-circle"} cls={"ic s"} />
            <div>
              {data.representation.title}
              <small>{data.representation.note}</small>
            </div>
          </div>
        </>
      ) : null}
      {data.note ? (
        <>
          <h4>{"Pinned note"}</h4>
          <div className={"card"}>
            {data.note.text}
            <small>
              <Joined parts={data.note.parts} />
            </small>
          </div>
        </>
      ) : null}
    </aside>
  );
}

/* --------------------------------------------------------------- dialogs */

/** What each stage needs before a matter can enter it (the Designer's stage list). */
export const STAGE_ENTRY = [
  ["Engagement pending", "Named consultant and proposed scope"],
  ["Intake", "Executed service agreement, or a documented exception"],
  ["Evidence collection", "Questionnaire assigned"],
  ["Preparation", "Required facts reviewed, blockers tracked"],
  ["Consultant review", "Draft package version and review checklist"],
  ["Client confirmation", "Consultant-reviewed package ready for the client"],
  ["Ready to submit", "Valid approvals, required authority, completed checklist"],
  ["Submitted", "External reference, submission time and receipt evidence"],
  ["Government processing", "Verified submission"],
  ["Decision review", "Official decision evidence"],
  ["Post decision", "Consultant-confirmed outcome and a follow-up plan"],
  ["Closed", "Closure checklist and a calculated retention date"],
] as const;

/**
 * The Designer's "Invite to the portal" dialog (captured on Settings > People and invitations,
 * Clients and family tab), opened here from a person card on the People tab.
 */
export type MatterInviteData = {
  /** The one matter it invites to: this one. */
  matter: { client: string; reference: string | null };
  /** The email field's starting value. The page fills it from the person card that opens the dialog. */
  email: string;
  /** "What the email says": the outbox email's own copy (lead in bold). */
  mail: { lead: string; rest: string };
  /** "Preview their screens". */
  preview: string;
  /** A real (not sample) matter while the firm is in sample mode: real client invitations are locked. */
  locked: boolean;
  /** Which matter the Send button saves to. Absent, the button is the Designer's inert one. */
  wire?: { organizationId: string; matterId: string } | null;
  /** The Designer's toast on its inert Send button. */
  toast?: { title: string; sub: string };
  /**
   * Someone this dialog can invite has no date of birth on file. The dialog then carries a
   * "Date of birth" field in the Designer's own `.fld` / `.inp` markup, hidden until it is
   * opened for such a person. Absent, the dialog is exactly the captured one.
   */
  birthDate?: { max: string } | null;
  /**
   * The firm's portal documents that are not published yet. A client cannot accept any invitation
   * until both are, so the dialog says so, links to Settings > Client portal, and does not send.
   * Absent or empty, the dialog is exactly the captured one.
   */
  policiesMissing?: readonly PolicyKind[] | null;
};

const ROLE_OPTIONS = ["Adult dependant", "Applicant", "Sponsor", "Guardian", "Employer contact"] as const;

export function MatterInviteDialog({ data }: { data: MatterInviteData }) {
  const missing = data.policiesMissing?.length ? data.policiesMissing : null;
  const send = missing
    ? { disabled: true }
    : data.wire
    ? { "data-invite": "1", "data-org": data.wire.organizationId, "data-matter": data.wire.matterId }
    : {
        "data-close": "dlgC",
        ...(data.toast ? { "data-toast": data.toast.title, "data-toast-sub": data.toast.sub, "data-toast-kind": "ok" } : {}),
      };
  return (
    <dialog className={"dlg"} id={"dlgC"} aria-labelledby={"dcH"}>
      <div className={"dh"}>
        <h2 id={"dcH"}>{"Invite to the portal"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgC"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        {data.locked ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"Real client invitations are locked"}</b>
              {"They open once the sample steps and your licence check are done. Until then the firm refuses a real client’s invitation. "}
              <a className={"tl"} href={"/sheet/sample-mode"}>
                {"See what’s left"}
              </a>
            </div>
          </div>
        ) : null}
        {missing ? <PolicyMissingAlert kinds={missing} style={{ marginBottom: "12px" }} /> : null}
        <div className={"fld"}>
          <label htmlFor={"cM"}>{"Matter"}</label>
          <select className={"sel"} id={"cM"}>
            <option>{data.matter.reference ? <Pair left={data.matter.client} right={data.matter.reference} /> : data.matter.client}</option>
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"cR"}>{"Their role"}</label>
          <select className={"sel"} id={"cR"}>
            {ROLE_OPTIONS.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
          <span className={"hint"}>{"Adult dependants get their own consent step. Guardians need authority on file."}</span>
        </div>
        <div className={"fld"}>
          <label htmlFor={"cE"}>{"Email"}</label>
          <input className={"inp"} id={"cE"} type={"email"} defaultValue={data.email} />
        </div>
        {data.birthDate ? (
          <div className={"fld"} id={"cDF"} hidden>
            <label htmlFor={"cD"}>{"Date of birth"}</label>
            <input className={"inp"} id={"cD"} type={"date"} min={"1900-01-01"} max={data.birthDate.max} aria-describedby={"cD-h"} />
            <span className={"hint"} id={"cD-h"}>
              {"Only adults get a portal login. It is saved on their record."}
            </span>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"cL"}>{"Language"}</label>
          <select className={"sel"} id={"cL"}>
            <option>{"English"}</option>
            <option>{"Français"}</option>
          </select>
        </div>
        <div className={"mailp"}>
          <small>{"What the email says"}</small>
          <p>
            <b style={{ fontWeight: "500" }}>{data.mail.lead}</b>
            {` ${data.mail.rest}`}
          </p>
          <small>{"No case details are put in the email."}</small>
        </div>
      </div>
      <div className={"df"}>
        <a className={"btn"} href={data.preview}>
          {"Preview their screens"}
        </a>
        <button className={"btn p"} {...send}>
          {"Send invitation"}
        </button>
      </div>
    </dialog>
  );
}

export type MatterDialogsData = {
  current: number;
  /** The stage picked by default (the next one), or null at the last stage. */
  target: number | null;
  version: number;
  /** Per stage after the current one; null when the evidence is not tracked. */
  evidence: (MatterBadge | null)[];
  reason: string;
  /** Staff who can own a hold. `id` is the membership the hold is saved with. */
  owners: { name: string; id?: string }[];
  reviewOn: string;
  receivedOn: string;
  /** Which matter the confirm buttons save to. Absent, the buttons are the Designer's inert ones. */
  wire?: MatterWire | null;
  /** The portal invitation dialog, for staff who may invite. Absent, it is not rendered. */
  invite?: MatterInviteData | null;
  /** The Record a deadline dialog. Only rendered when wired; the Designer has no deadline dialog. */
  deadline?: MatterDeadlineDialog | null;
  /** Edit details, opened from a client's People card. Absent, it is not rendered. */
  edit?: PersonEditDialogData | null;
};

export type MatterDeadlineDialog = {
  /** The firm's timezone, offered as the official one. */
  timezone: string;
  /** The firm is in sample mode and this matter is real: the database refuses the deadline. */
  sampleMode: boolean;
  kinds: readonly { value: string; label: string }[];
  /** Government letters on the matter; the deadline is linked to the one chosen (T037). */
  letters?: { id: string; label: string }[];
};

/** The record a dialog's confirm button saves to; the kit reads these from the button. */
export type MatterWire = { organizationId: string; matterId: string; version: number };

export type MatterAct = "stage" | "hold" | "letter" | "resume" | "outcome" | "deadline";

/** `data-act` and the matter it saves to, or nothing for the Designer's inert buttons. */
export function wireProps(act: MatterAct, wire: MatterWire | null | undefined) {
  if (!wire) return {};
  return { "data-act": act, "data-org": wire.organizationId, "data-matter": wire.matterId, "data-version": String(wire.version) };
}

function Close() {
  return (
    <button className={"x"} aria-label={"Close"} data-x={""}>
      <Icon name={"close"} />
    </button>
  );
}

function Go({ id, label, act, wire }: { id: string; label: string; act: MatterAct; wire?: MatterWire | null }) {
  return (
    <button className={"btn p"} id={id} {...wireProps(act, wire)}>
      {label}
    </button>
  );
}

function StageOption({ index, data }: { index: number; data: MatterDialogsData }) {
  const [label, entry] = STAGE_ENTRY[index];
  const current = index === data.current;
  const back = index < data.current;
  const evidence = back ? ({ tone: "gr", label: "Going back" } as MatterBadge) : current ? null : data.evidence[index] ?? null;
  return (
    <label className={current ? "st cur" : "st"}>
      <input type={"radio"} {...(current ? { disabled: true } : {})} name={"stg"} {...(index === data.target ? { defaultChecked: true } : {})} value={String(index)} />
      <span className={"num"}>{String(index + 1)}</span>
      <div>
        <b>{current ? <Pair left={label} right={"current"} /> : label}</b>
        <small>{entry}</small>
      </div>
      <em className={"ev"}>{evidence ? <Plain badge={evidence} /> : null}</em>
    </label>
  );
}

export function MatterDialogs({ data }: { data: MatterDialogsData }) {
  const currentLabel = STAGE_ENTRY[data.current]?.[0] ?? "";
  const targetLabel = data.target == null ? null : STAGE_ENTRY[data.target]?.[0];
  return (
    <>
      <dialog className={"dlg wide"} id={"dStage"} aria-labelledby={"dStageT"}>
        <div className={"dh"}>
          <h2 id={"dStageT"}>{"Change stage"}</h2>
          <Close />
        </div>
        <div className={"db"}>
          <p className={"mu"} style={{ fontSize: "14px", marginBottom: "12px" }}>
            {"Now: "}
            <b style={{ fontWeight: "500", color: "var(--ink)" }}>{currentLabel}</b>
            {" "}
            <Sep />
            {` version ${data.version}. Pick the next stage. Each stage needs its entry evidence.`}
          </p>
          <div className={"stl k2-gr"} role={"radiogroup"} aria-label={"Target stage"} data-glide={"1"} style={{ position: "relative" }}>
            <span
              className={"k2-gs-p k2-gr-p"}
              aria-hidden={"true"}
              style={{ height: "0px", transform: "translate3d(0px, 0px, 0px)", opacity: "1" }}
            ></span>
            {STAGE_ENTRY.map((_, index) => (
              <StageOption key={index} index={index} data={data} />
            ))}
          </div>
          <label className={"fl"}>
            {"Reason (kept in the history)"}
            <textarea rows={2} defaultValue={data.reason} />
          </label>
          <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
            {"Going back keeps history and only cancels automations that no longer apply. If someone changed this matter since you opened it, you’ll be asked to reload first."}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-x={""}>
            {"Cancel"}
          </button>
          <Go id={"stGo"} label={targetLabel ? `Move to ${targetLabel}` : "Change stage"} act={"stage"} wire={data.wire} />
        </div>
      </dialog>
      <dialog className={"dlg"} id={"dHold"} aria-labelledby={"dHoldT"}>
        <div className={"dh"}>
          <h2 id={"dHoldT"}>{"Put this matter on hold?"}</h2>
          <Close />
        </div>
        <div className={"db"}>
          <label className={"fl"}>
            {"Reason"}
            <select>
              <option>{"Waiting on client"}</option>
              <option>{"Waiting on third party"}</option>
              <option>{"Fees outstanding"}</option>
              <option>{"Other"}</option>
            </select>
          </label>
          <label className={"fl"}>
            {"Owner"}
            <select>
              {data.owners.map((owner, index) => (
                <option key={index} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          <label className={"fl"}>
            {"Review on"}
            <input type={"date"} defaultValue={data.reviewOn} />
          </label>
          <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
            <Icon name={"alarm"} cls={"ic s"} />
            {"On hold is a flag, not a stage. Government deadline alerts keep running."}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-x={""}>
            {"Cancel"}
          </button>
          <Go id={"holdGo"} label={"Put on hold"} act={"hold"} wire={data.wire} />
        </div>
      </dialog>
      <dialog className={"dlg wide"} id={"dLetter"} aria-labelledby={"dLetterT"}>
        <div className={"dh"}>
          <h2 id={"dLetterT"}>{"Record a government letter"}</h2>
          <Close />
        </div>
        <div className={"db"}>
          <div className={"drop"}>
            <span className={"spot"}>
              <img
                src={"/assets/generated/spots/letter@1x.webp"}
                srcSet={"/assets/generated/spots/letter@2x.webp 2x"}
                width={88}
                height={88}
                alt={""}
              />
            </span>
            <div>
              <b>{"Drop the letter here"}</b>
              <small>
                <Pair left={"PDF or photo"} right={"it’s stored with a hash and never sent to clients by default"} />
              </small>
            </div>
            <button className={"btn s sm"}>
              <Icon name={"upload"} cls={"ic s"} />
              {"Choose file"}
            </button>
          </div>
          <div className={"g2"}>
            <label className={"fl"}>
              {"Type"}
              <select>
                <option>{"Request for documents"}</option>
                <option>{"Acknowledgement of receipt"}</option>
                <option>{"Biometrics instruction"}</option>
                <option>{"Procedural fairness letter"}</option>
                <option>{"Decision"}</option>
              </select>
            </label>
            <label className={"fl"}>
              {"Received on"}
              <input type={"date"} defaultValue={data.receivedOn} />
            </label>
            <label className={"fl"}>
              {"How it arrived"}
              <select>
                <option>{"IRCC portal message"}</option>
                <option>{"Email"}</option>
                <option>{"Mail"}</option>
              </select>
            </label>
            <label className={"fl"}>
              {"Deadline in the letter"}
              <input placeholder={"Type exactly as written"} />
            </label>
          </div>
          <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
            {"Vo can read the date, but a person confirms it before it becomes a deadline. A decision letter also needs a consultant to confirm the outcome."}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-x={""}>
            {"Cancel"}
          </button>
          <Go id={"letGo"} label={"Record letter"} act={"letter"} wire={data.wire} />
        </div>
      </dialog>
      {data.invite ? <MatterInviteDialog data={data.invite} /> : null}
      {data.edit ? <PersonEditDialog data={data.edit} /> : null}
      {data.wire && data.deadline ? <DeadlineDialog data={data.deadline} wire={data.wire} /> : null}
    </>
  );
}

/**
 * Record a deadline. The Designer has no deadline dialog, so this is its "Record a government
 * letter" dialog (`#dLetter`: `.g2` of `.fl` fields, a `.mu` note, Cancel and a primary button)
 * holding public.record_deadline's fields, with the hold dialog's `.lock` note and the
 * New matter dialog's sample-mode `.alert`. Saving is wired in matter-acts (`data-act="deadline"`).
 */
function DeadlineDialog({ data, wire }: { data: MatterDeadlineDialog; wire: MatterWire }) {
  return (
    <dialog className={"dlg wide"} id={"dDeadline"} aria-labelledby={"dDeadlineT"}>
      <div className={"dh"}>
        <h2 id={"dDeadlineT"}>{"Record a deadline"}</h2>
        <Close />
      </div>
      <div className={"db"}>
        {data.sampleMode ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"This firm is in sample mode"}</b>
              {"Only sample matters accept new deadlines until sample mode is turned off. The firm will refuse this one."}
            </div>
          </div>
        ) : null}
        <div className={"g2"}>
          <label className={"fl"}>
            {"What is due"}
            <input id={"ddL"} placeholder={"For example: Respond to IRCC request"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Kind"}
            <select id={"ddK"} defaultValue={data.kinds[0]?.value}>
              {data.kinds.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <label className={"fl"}>
            {"Due on"}
            <input id={"ddD"} type={"date"} />
          </label>
          <label className={"fl"}>
            {"Due time (optional)"}
            <input id={"ddT"} type={"time"} />
          </label>
          <label className={"fl"}>
            {"Official timezone"}
            <input id={"ddZ"} defaultValue={data.timezone} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Where it’s written"}
            <input id={"ddE"} placeholder={"For example: IRCC request letter, page 2"} autoComplete={"off"} />
          </label>
          {data.letters?.length ? (
            <label className={"fl"}>
              {"From a government letter (optional)"}
              <select id={"ddC"} defaultValue={""}>
                <option value={""}>{"None"}</option>
                {data.letters.map((letter) => (
                  <option key={letter.id} value={letter.id}>
                    {letter.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className={"fl"}>
            {"Official source URL"}
            <input id={"ddU"} type={"url"} placeholder={"https://www.canada.ca/…"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Source retrieved on"}
            <input id={"ddR"} type={"date"} />
          </label>
        </div>
        <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
          {"A legal or letter deadline cites the official government page it comes from and the date you retrieved it. Casevoya doesn’t calculate deadlines or skip weekends."}
        </p>
        <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
          <Icon name={"alarm"} cls={"ic s"} />
          {"It stays tentative until a licensed consultant confirms it. Reminders are proposed from the due date."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-x={""}>
          {"Cancel"}
        </button>
        <Go id={"ddGo"} label={"Record deadline"} act={"deadline"} wire={wire} />
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ tabs */

function Panel({ index = 0, children }: { index?: number; children: ReactNode }) {
  return (
    <div className={"panel rv"} style={css({ "--i": String(index) })}>
      {children}
    </div>
  );
}

export type MatterPersonCard = {
  person: SidebarPerson;
  role: string;
  parts: string[];
  pill: { label: string; detail?: string };
  /**
   * A client on this matter without portal access: the card's Manage button opens the invitation.
   * `birthDateMissing`: no date of birth on file, so the dialog asks for one.
   */
  invite?: { personId: string; role: string; email: string; birthDateMissing?: boolean } | null;
  /**
   * A client whose details the viewer may edit: Manage opens Edit details instead, and the
   * invitation (when `invite` is set too) is offered from that dialog's footer.
   */
  edit?: PersonEditData | null;
};

/** The Manage button's `data-*`: Edit details, the invitation dialog, or nothing for the Designer's inert button. */
function manageProps(card: MatterPersonCard) {
  if (card.edit) {
    return {
      ...personEditProps(card.edit),
      ...(card.invite ? { "data-role": card.invite.role, ...(card.invite.birthDateMissing ? { "data-dob": "missing" } : {}) } : {}),
    };
  }
  if (!card.invite) return {};
  return {
    "data-invite-open": "1",
    "data-person": card.invite.personId,
    "data-role": card.invite.role,
    "data-email": card.invite.email,
    "data-name": card.person.name,
    ...(card.invite.birthDateMissing ? { "data-dob": "missing" } : {}),
  };
}
export type MatterRelationship = { from: string; relation: string; to: string; evidence: string; sharing: MatterBadge | null };

export function MatterPeople({ cards, relationships }: { cards: MatterPersonCard[]; relationships: MatterRelationship[] }) {
  if (cards.length === 0) {
    return (
      <Panel>
        <Empty art={"clients-empty"} title={"No people on this matter yet"} copy={"Applicants, sponsors, dependants and staff appear here once they are added to the file."} />
      </Panel>
    );
  }
  return (
    <>
      <div className={"pgrid rv"} style={css({ "--i": "0" })}>
        {cards.map((card, index) => (
          <div key={index} className={"pc k2-spot"} data-spot={"1"}>
            <Avatar person={card.person} />
            <div>
              <b>{card.person.name}</b>
              <small>{card.role}</small>
              <p>
                <Joined parts={card.parts} />
              </p>
              <span className={"pill"}>
                {card.pill.detail ? (
                  <span>
                    <Pair left={card.pill.label} right={card.pill.detail} />
                  </span>
                ) : (
                  card.pill.label
                )}
              </span>
            </div>
            <button className={"btn s sm"} aria-label={`Manage ${card.person.name}`} {...manageProps(card)}>
              <Icon name={"more"} cls={"ic s"} />
            </button>
          </div>
        ))}
      </div>
      {relationships.length > 0 ? (
        <>
          <h3 className={"sub rv"} style={css({ "--i": "1" })}>
            {"Relationships"}
          </h3>
          <div className={"tw rv"} style={css({ "--i": "2" })}>
            <table className={"t"}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: "18px" }}>{"From"}</th>
                  <th>{"Relationship"}</th>
                  <th>{"To"}</th>
                  <th>{"Evidence"}</th>
                  <th>{"Sharing"}</th>
                </tr>
              </thead>
              <tbody>
                {relationships.map((row, index) => (
                  <tr key={index}>
                    <td style={{ paddingLeft: "18px" }}>{row.from}</td>
                    <td>{row.relation}</td>
                    <td>{row.to}</td>
                    <td className={"mu"}>{row.evidence}</td>
                    <td>{row.sharing ? <Plain badge={row.sharing} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

export type MatterDocumentRow = {
  title: string;
  kind: string;
  person: SidebarPerson;
  upload: MatterBadge;
  review: MatterBadge;
  version: string;
};

export function MatterDocuments({ checklist, people, rows }: { checklist: string | null; people: string[]; rows: MatterDocumentRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel>
        <Empty art={"review-queue-empty"} title={"No documents on this matter yet"} copy={"Requests and uploads appear here as the team works on the file."} />
      </Panel>
    );
  }
  return (
    <>
      <Panel>
        <h2>
          <Icon name={"document-scan"} />
          <span>{checklist ? <Pair left={"Checklist"} right={checklist} /> : "Checklist"}</span>
          <span className={"r"} style={{ display: "flex", gap: "6px" }}>
            <span className={"fchip on"}>{"Everyone"}</span>
            {people.map((name) => (
              <span key={name} className={"fchip"} style={{ background: "transparent" }}>
                {name}
              </span>
            ))}
          </span>
        </h2>
        <div className={"tw"}>
          <table className={"t"}>
            <thead>
              <tr>
                <th style={{ paddingLeft: "18px" }}>{"Document"}</th>
                <th>{"Person"}</th>
                <th>{"Upload"}</th>
                <th>{"Firm review"}</th>
                <th>{"Version"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className={""}>
                  <td style={{ paddingLeft: "18px" }}>
                    {row.title}
                    <br />
                    <small>{row.kind}</small>
                  </td>
                  <td>
                    <Avatar person={row.person} />
                  </td>
                  <td>
                    <Badge badge={row.upload} />
                  </td>
                  <td>
                    <Badge badge={row.review} />
                  </td>
                  <td className={"num"} style={{ color: "var(--t2)" }}>
                    {row.version}
                  </td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p style={css({ color: "var(--t2)", fontSize: "13px", margin: "-10px 0px 22px", "--i": "1" })} className={"rv"}>
        {"Upload state and firm review are separate. Accepted means accepted by the firm for this purpose, not validated by IRCC."}
      </p>
    </>
  );
}

export type MatterAgreementRow = {
  title: string;
  version: string[];
  parties: string;
  signatures: string;
  state: MatterBadge;
  href: string;
  action: string;
  /** Live only: the action opens this dialog on the page (the signed-in consultant's countersignature). */
  dialog?: string;
};
export type MatterSigning = {
  title: string;
  signers: { person: SidebarPerson; order: number; note: string; signed: boolean }[];
  hash: string | null;
};

/** `create` is the New agreement dialog on the Agreements page, opened for this matter. */
export function MatterAgreements({ rows, signing, create }: { rows: MatterAgreementRow[]; signing: MatterSigning | null; create?: string | null }) {
  if (rows.length === 0) {
    return (
      <Panel>
        <Empty art={"templates-empty"} title={"No agreements yet"} copy={"Quotes and service agreements start from an approved template."}>
          {create ? (
            <a className={"btn p sm"} href={create}>
              {"New agreement"}
            </a>
          ) : null}
        </Empty>
      </Panel>
    );
  }
  return (
    <>
      <div className={"tw rv"} style={css({ "--i": "0" })}>
        <table className={"t"}>
          <thead>
            <tr>
              <th style={{ paddingLeft: "18px" }}>{"Agreement"}</th>
              <th>{"Version"}</th>
              <th>{"Parties"}</th>
              <th>{"Signatures"}</th>
              <th>{"State"}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td style={{ paddingLeft: "18px" }}>{row.title}</td>
                <td className={"mu"}>
                  <Joined parts={row.version} />
                </td>
                <td>{row.parties}</td>
                <td className={"num"}>{row.signatures}</td>
                <td>
                  <Plain badge={row.state} />
                </td>
                <td>
                  <a className={"btn s sm"} href={row.href} data-dlg={row.dialog}>
                    {row.action}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {signing ? (
        <div className={"panel rv"} style={css({ marginTop: "22px", "--i": "1" })}>
          <h2>
            <Icon name={"signature"} />
            <span>
              <Pair left={signing.title} right={"signing order"} />
            </span>
          </h2>
          <div className={"sorder"}>
            {signing.signers.map((signer, index) => (
              <div key={index} className={"so"}>
                <Avatar person={signer.person} />
                <div>
                  <b>{`${signer.order}. ${signer.person.name}`}</b>
                  <small>{signer.note}</small>
                </div>
                <Icon name={signer.signed ? "check-circle" : "clock"} cls={"ic s"} />
              </div>
            ))}
          </div>
          <p className={"mu"} style={{ fontSize: "13.5px", marginTop: "12px" }}>
            {signing.hash ? `Signed copy hash ${signing.hash}. ` : ""}
            {"Casevoya doesn’t certify the agreement is legally sufficient. "}
            <a href={"/sheet/agreements"}>{"All agreements"}</a>
          </p>
        </div>
      ) : null}
    </>
  );
}

export type MatterDeadline = {
  label: string;
  due: string;
  verified: MatterBadge;
  source: string[];
  origin: string;
  reminders: { label: string; date: string; badge: MatterBadge }[];
  timezone: string;
};
export type MatterTaskRow = { title: string; parts: string[]; badge: MatterBadge; owner: SidebarPerson };

export function MatterTasks({ deadline, tasks, record = false }: { deadline: MatterDeadline | null; tasks: MatterTaskRow[]; record?: boolean }) {
  if (!deadline && tasks.length === 0) {
    return (
      <Panel>
        <Empty art={"portal-nothing-due"} title={"No open tasks"} copy={"Client tasks and internal tasks appear here with owners and due dates."}>
          {record ? (
            <button className={"btn p sm"} data-open={"dDeadline"}>
              {"Record a deadline"}
            </button>
          ) : null}
        </Empty>
      </Panel>
    );
  }
  const offset = deadline ? 1 : 0;
  return (
    <>
      {deadline ? (
        <Panel>
          <h2>
            <Icon name={"alarm"} />
            <span>
              <Pair left={deadline.label} right={deadline.due} />
            </span>
            <span className={"r"}>
              <Plain badge={deadline.verified} />
            </span>
          </h2>
          <div className={"split"}>
            <div>
              <h3>{"Source evidence"}</h3>
              <p style={{ fontSize: "14px" }}>
                <Joined parts={deadline.source} />
              </p>
              <p style={{ fontSize: "13px", color: "var(--t2)", marginTop: "8px" }}>{deadline.origin}</p>
            </div>
            <div>
              <h3>{"Reminders (proposed)"}</h3>
              <div className={"rank"}>
                {deadline.reminders.length === 0 ? (
                  <div>{"No reminders scheduled"}</div>
                ) : (
                  deadline.reminders.map((reminder, index) => (
                    <div key={index}>
                      <Icon name={"bell"} cls={"ic s"} />
                      <span style={{ flex: "1" }}>{reminder.label}</span>
                      <span className={"num"} style={{ color: "var(--t2)", fontSize: "13px" }}>
                        {reminder.date}
                      </span>
                      <Plain badge={reminder.badge} />
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <h3>{"Timezones"}</h3>
              <p style={{ fontSize: "14px" }}>{deadline.timezone}</p>
            </div>
          </div>
        </Panel>
      ) : null}
      <h3 className={"sub rv"} style={css({ "--i": String(offset) })}>
        {"Tasks"}
      </h3>
      {tasks.length === 0 ? (
        <div className={"li rv"} style={css({ "--i": String(offset + 1) })}>
          <div>
            <b>{"No open tasks"}</b>
            <small>{"Client tasks and internal tasks appear here with owners and due dates."}</small>
          </div>
        </div>
      ) : (
        tasks.map((task, index) => (
          <div key={index} className={"li rv"} style={css({ "--i": String(offset + 1 + index) })}>
            <span className={"ck"}></span>
            <div>
              <b>{task.title}</b>
              <small>
                <Joined parts={task.parts} />
              </small>
            </div>
            <span className={"r"}>
              <Plain badge={task.badge} />
              <Avatar person={task.owner} />
            </span>
          </div>
        ))
      )}
    </>
  );
}

/** The Designer's decision tab: nothing recorded until an official letter and a consultant confirm it. */
export type MatterOutcomeConfirm = { options: { value: string; label: string }[]; wire: MatterWire };

export function MatterDecisions({ outcome, confirm }: { outcome: string | null; confirm?: MatterOutcomeConfirm | null }) {
  if (!outcome && confirm) {
    // Decision evidence is on file: a licensed consultant confirms the outcome (Designer classes, no captured screen).
    return (
      <div className={"empty rv"} style={css({ "--i": "0" })}>
        <span className={"spot"}>
          <img src={"/assets/generated/spots/decision@1x.webp"} srcSet={"/assets/generated/spots/decision@2x.webp 2x"} width={88} height={88} alt={""} />
        </span>
        <div>
          <h3>{"Confirm the outcome"}</h3>
          <p>{"The decision letter is on file. A licensed consultant confirms the outcome before it counts; pending is not an outcome."}</p>
          <label className={"fl"}>
            {"Outcome"}
            <select id={"outSel"} defaultValue={confirm.options[0]?.value}>
              {confirm.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={"fl"}>
            {"Note (kept in the history)"}
            <textarea id={"outNote"} rows={2} />
          </label>
          <div className={"ea"}>
            <button className={"btn p sm"} {...wireProps("outcome", confirm.wire)}>
              <Icon name={"check-circle"} cls={"ic s"} />
              {"Confirm outcome"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!outcome) {
    return (
      <div className={"empty rv"} style={css({ "--i": "0" })}>
        <span className={"spot"}>
          <img src={"/assets/generated/spots/decision@1x.webp"} srcSet={"/assets/generated/spots/decision@2x.webp 2x"} width={88} height={88} alt={""} />
        </span>
        <div>
          <h3>{"No decision recorded"}</h3>
          <p>
            {"A decision needs the official letter as evidence and a consultant to confirm it. Pending is not an outcome, so nothing shows here until a letter arrives."}
          </p>
          <div className={"ea"}>
            <button className={"btn p sm"} data-letter={""}>
              <Icon name={"mail"} cls={"ic s"} />
              {"Record a government letter"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Panel>
      <h2>
        <Icon name={"check-circle"} />
        <span>{outcome}</span>
        <span className={"r"}>
          <Plain badge={{ tone: "ok", label: "Outcome recorded" }} />
        </span>
      </h2>
    </Panel>
  );
}

/** Closure: an open matter shows the Designer's "still open" state; a closed one its retention date. */
export function MatterClosure({ closed, retention }: { closed: boolean; retention: string | null }) {
  if (!closed) {
    return (
      <div className={"empty rv"} style={css({ "--i": "0" })}>
        <span className={"spot"}>
          <img src={"/assets/generated/spots/archive@1x.webp"} srcSet={"/assets/generated/spots/archive@2x.webp 2x"} width={88} height={88} alt={""} />
        </span>
        <div>
          <h3>{"This matter is still open"}</h3>
          <p>{"Closing is a controlled step: finish the checklist and the retention date is set. You can reopen later, and the closure stays on record."}</p>
          <div className={"ea"}>
            <button className={"btn s sm"} data-stage={""}>
              <Icon name={"workflow"} cls={"ic s"} />
              {"Change stage"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Panel>
      <h2>
        <Icon name={"folder"} />
        {"Closure"}
      </h2>
      <div className={"kv"}>
        <span>{"Records kept until"}</span>
        <b className={"num"}>{retention ?? "Not set yet"}</b>
      </div>
    </Panel>
  );
}

/** Tabs whose records are not stored yet: the Designer's empty-state panel, never sample rows. */
export const MATTER_TAB_EMPTY: Partial<Record<MatterTab, { art: string; title: string; copy: string }>> = {
  intake: { art: "clients-empty", title: "Intake isn’t shown here yet", copy: "Questionnaire answers stay on the client’s record. This tab doesn’t read them yet." },
  forms: { art: "templates-empty", title: "No prepared forms yet", copy: "Prepared government forms are not stored yet. Casevoya does not fill IRCC forms for you." },
  submissions: { art: "review-queue-empty", title: "No submission packages yet", copy: "Submission packages are not stored yet. Casevoya does not submit to IRCC." },
  messages: { art: "inbox-empty", title: "Inbox is clear", copy: "New emails linked to a matter will land here for triage." },
  billing: { art: "invoice-plain", title: "No invoices yet", copy: "Invoices you issue from a matter appear here." },
  timeline: { art: "filter-empty", title: "The timeline isn’t shown here yet", copy: "Changes are kept in the firm’s audit log. This tab doesn’t read it yet." },
  audit: { art: "privacy-shield", title: "The audit view isn’t shown here yet", copy: "Entries are kept in the firm’s audit log. This tab doesn’t read it yet." },
};

export type MatterPageData = {
  tab: MatterTab;
  overview: MatterOverviewData;
  people: { cards: MatterPersonCard[]; relationships: MatterRelationship[] };
  documents: { checklist: string | null; people: string[]; rows: MatterDocumentRow[] };
  agreements: { rows: MatterAgreementRow[]; signing: MatterSigning | null; create?: string | null };
  /** `record` offers the Record a deadline dialog from the empty state. */
  tasks: { deadline: MatterDeadline | null; tasks: MatterTaskRow[]; record?: boolean };
  outcome: string | null;
  /** Set when decision evidence is on file and no outcome is recorded yet. */
  confirmOutcome?: MatterOutcomeConfirm | null;
  closure: { closed: boolean; retention: string | null };
  /** Messages tab: the chat view's data (null: it failed to load; absent: another tab). */
  messages?: ChatData | null;
  /** T036 submission handoff; absent, the tab keeps its empty state. */
  submissions?: MatterSubmissionsData | null;
  /** T037 and T038 letters and decisions; absent, the tab keeps the outcome-only view. */
  decisions?: MatterDecisionsData | null;
};

/** The open tab's content. */
export function SheetMatter({ data }: { data: MatterPageData }) {
  switch (data.tab) {
    case "overview":
      return <MatterOverview data={data.overview} />;
    case "people":
      return <MatterPeople cards={data.people.cards} relationships={data.people.relationships} />;
    case "documents":
      return <MatterDocuments checklist={data.documents.checklist} people={data.documents.people} rows={data.documents.rows} />;
    case "agreements":
      return <MatterAgreements rows={data.agreements.rows} signing={data.agreements.signing} create={data.agreements.create} />;
    case "tasks":
      return <MatterTasks deadline={data.tasks.deadline} tasks={data.tasks.tasks} record={data.tasks.record} />;
    case "submissions":
      return data.submissions ? <MatterSubmissions data={data.submissions} /> : <MatterTabEmpty tab={data.tab} />;
    case "decisions":
      return data.decisions ? <MatterDecisionsLive data={data.decisions} /> : <MatterDecisions outcome={data.outcome} confirm={data.confirmOutcome} />;
    case "closure":
      return <MatterClosure closed={data.closure.closed} retention={data.closure.retention} />;
    // Redesigned as a chat view at the owner's request (2026-10-18); the other tabs keep the Designer's markup.
    case "messages":
      if (data.messages === undefined) return <MatterTabEmpty tab={data.tab} />;
      return data.messages ? <ChatView data={data.messages} /> : <ChatError />;
    default:
      return <MatterTabEmpty tab={data.tab} />;
  }
}

export function MatterTabEmpty({ tab }: { tab: MatterTab }) {
  const empty = MATTER_TAB_EMPTY[tab];
  if (!empty) return null;
  return (
    <Panel>
      <Empty art={empty.art} title={empty.title} copy={empty.copy} />
    </Panel>
  );
}
