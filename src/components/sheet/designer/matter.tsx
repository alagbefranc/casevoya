/**
 * The Designer's matter page (`markup/matter.tsx`), rendered from the firm's records.
 * Same DOM, classes and order as the capture. Tabs whose records are not stored yet
 * show the Designer's empty-state panel instead of sample rows.
 */
import { Fragment, type ReactNode } from "react";
import { gaugeArcs, percent } from "./home";
import { Badge, type MatterBadge } from "./matters";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { PersonEditDialog, personEditProps, type PersonEditDialogData } from "./person-edit";
import { PersonHistoryList } from "./person-history";
import { ApplyChecklist, type ApplyChecklistData } from "./apply-checklist";
import { VoAutoRead } from "./vo-auto-read";
import { PolicyMissingAlert } from "./portal-policies";
import { MatterDecisionsLive, MatterSubmissions, type MatterDecisionsData, type MatterSubmissionsData } from "./matter-government";
import { MatterDocumentReview, type MatterDocumentReviewData } from "./vo-doc-review";
import { DOC_REQUEST_DIALOG, DocRequestDialog, type DocRequestDialogData } from "./doc-request";
import { MatterIntake, type MatterIntakeData } from "./matter-intake";
import { MatterWork, type MatterWorkData } from "./billing-live";
import { InboundAddress, type InboundAddressData } from "./inbound-filing";
import { MatterLetters, type LetterAttrs, type MatterLettersData } from "./matter-letters";
import { MatterRulePin } from "./matter-rule-pin";
import type { MatterRulePinData } from "@/modules/sheet/rule-pin-present";
import type { PolicyKind } from "@/modules/portal-policies/defaults";
import type { PersonHistoryPanel } from "@/modules/sheet/person-history-present";
import type { PersonEditData } from "@/modules/sheet/edit-person";
import { ChatError, ChatView } from "@/components/messages/chat";
import { TaskEditDialog, TasksDialog, type TaskEditDialogData, type TasksDialogData } from "./tasks";
import { LetterFormFields, type LetterFormData } from "./letter-form";
import type { ChatData } from "@/modules/messages/present";
import { NoAccessPanel } from "./state-views";
import { MATTER_BILLING_DENIED } from "@/modules/sheet/states-present";

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
  /** Live only: Request document opens the Request a document dialog (`#dReq`) instead of the Documents tab. */
  request?: boolean;
  /**
   * Live only: where the header crumbs go. "Matters" opens the matters list; the client crumb
   * opens the client's record (null when the viewer can't open one). Absent, they are the Designer's.
   */
  crumbs?: { client: string | null } | null;
  /** Live only: "Add task" on the Tasks and deadlines tab opens New task (`#dlgTask`) for this matter. */
  addTask?: boolean;
};

export function MatterTopBar({ data }: { data: MatterHeaderData }) {
  const [left, width] = UNDERLINE[data.tab];
  // While the matter is on hold, the header's hold button resumes it (live) instead of reopening the hold dialog.
  const resume = Boolean(data.hold && data.wire);
  return (
    <>
      <header className={"top"}>
        <a className={"back"} href={"/sheet/matters"} aria-label={"Back"}>
          <Icon name={"chevron-left"} cls={"ic s"} />
        </a>
        <button className={"crumb"} {...(data.crumbs ? { "data-nav": "/sheet/matters" } : {})}>
          <Icon name={"folder"} cls={"ic s"} />
          {"Matters"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button
          className={"crumb"}
          {...(data.crumbs?.client ? { "data-nav": data.crumbs.client } : data.crumbs ? { disabled: true, title: "You can’t open this client’s record" } : {})}
        >
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
          {resume ? (
            <button className={"btn s sm"} {...wireProps("resume", data.wire)}>
              <Icon name={"clock"} cls={"ic s"} />
              {"Resume"}
            </button>
          ) : (
            <button className={"btn s sm"} data-hold={""}>
              <Icon name={"clock"} cls={"ic s"} />
              {"On hold"}
            </button>
          )}
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
          {data.wire && data.addTask && data.tab === "tasks" ? (
            <button className={"btn s sm"} data-dlg={"dlgTask"}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add task"}
            </button>
          ) : null}
          <button
            className={"btn p sm"}
            data-goto-tab={data.wire && !data.request ? "documents" : undefined}
            data-open={data.request ? DOC_REQUEST_DIALOG : undefined}
          >
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
  /** Live: events come from the firm's audit log, which only the firm owner can read. */
  eventsOwnerOnly?: boolean;
  /** Live only (SRC-05, SRC-12): the pinned rule pack and IRCC form versions, or the honest "No approved rule pack". */
  rules?: MatterRulePinData | null;
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
      {data.rules ? <MatterRulePin data={data.rules} /> : null}
      <h3 className={"sub rv"} style={css({ "--i": "5" })}>
        <Icon name={"history"} cls={"ic s"} />
        {" Recent events"}
      </h3>
      {data.events.length === 0 ? (
        <div className={"li rv"} style={css({ "--i": "6" })}>
          <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#c9c5c0", flex: "none" }}></i>
          <div>
            <b>{data.eventsOwnerOnly ? "Shown to the firm owner" : "No activity recorded yet"}</b>
            <small>
              {data.eventsOwnerOnly
                ? "Uploads, signatures and stage changes are kept in the firm’s audit log, which only the firm owner can read."
                : "Uploads, signatures and stage changes appear here."}
            </small>
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
  /**
   * The Vo draft card. Absent until Vo is switched on and has a draft for this matter. Live only
   * (AI-01): `accept`, `edit` and `reject` wire its buttons to the Vo letter draft it shows.
   */
  vo?: { draft: string; sources: string; accept?: LetterAttrs; edit?: LetterAttrs; reject?: LetterAttrs } | null;
  /** Live only (AI-01): the matter's letters, Draft letter with Vo and New letter. */
  letters?: MatterLettersData | null;
  agreement: { title: string; state: string | null; parts: string[] };
  /** Recorded separately from the agreement. Absent until the firm stores it. */
  representation?: { title: string; note: string } | null;
  /** A staff-only pinned note. Absent until notes are stored. */
  note?: { text: string; parts: string[] } | null;
  /** Live only (OPS-06): the matter's inbound email address, with a Copy button. */
  inbound?: InboundAddressData | null;
};

function MatterVo({ draft, sources, accept, edit, reject }: { draft: string; sources: string; accept?: LetterAttrs; edit?: LetterAttrs; reject?: LetterAttrs }) {
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
        <button className={"btn sm p"} data-ai={"ok"} {...accept}>
          {"Accept"}
        </button>
        <button className={"btn sm"} data-ai={"edit"} {...edit}>
          {"Edit"}
        </button>
        <button className={"btn sm"} data-ai={"no"} {...reject}>
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
          <MatterVo draft={data.vo.draft} sources={data.vo.sources} accept={data.vo.accept} edit={data.vo.edit} reject={data.vo.reject} />
        </>
      ) : null}
      {data.letters ? <MatterLetters data={data.letters} /> : null}
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
      {data.inbound ? (
        <>
          <h4>{"Email into this matter"}</h4>
          <div className={"card"}>
            <InboundAddress data={data.inbound} />
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
  /** Live only: Request a document, for staff who may request one. Absent, it is not rendered. */
  request?: DocRequestDialogData | null;
  /**
   * Live only: the stages (indexes) the database allows from the current one. The others are
   * disabled with the reason, and the internal version number is not shown.
   */
  allowed?: number[] | null;
  /** Live only: the earliest review date a hold accepts (the day after the firm's today). */
  minReview?: string | null;
  /** Live only: New task for this matter (`#dlgTask`). */
  newTask?: TasksDialogData | null;
  /** Live only: the Task dialog (`#dTask`): edit, reassign or complete one task. */
  task?: TaskEditDialogData | null;
  /** Live only (ORG-06): Change consultant (`#dCons`), opened from the responsible consultant's card. */
  consultant?: ConsultantDialogData | null;
  /** Live only (GOV-04): Record a government letter's issuer, letter date, filed-email file and tasks. */
  letterForm?: LetterFormData | null;
};

/**
 * ORG-06: Change consultant. The Designer has no such dialog, so it is built from its dialog
 * parts (`.dlg`, `.fld`, `.sel`, `.why`) like the other live dialogs. It shows who will be told
 * before anything is saved: the people on the matter with a portal account.
 */
export type ConsultantDialogData = {
  /** Active consultants with a verified licence; the current one first. */
  consultants: { id: string; name: string }[];
  current: string | null;
  audience: { name: string; role: string; emailed: boolean }[];
  /** A sample matter: nobody is told. */
  sample: boolean;
};

export function ConsultantDialog({ data, wire }: { data: ConsultantDialogData; wire?: MatterWire | null }) {
  return (
    <dialog className={"dlg"} id={"dCons"} aria-labelledby={"dConsH"}>
      <div className={"dh"}>
        <h2 id={"dConsH"}>{"Change consultant"}</h2>
        <Close />
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"consSel"}>{"Responsible consultant"}</label>
          <select className={"sel"} id={"consSel"} defaultValue={data.current ?? ""} data-current={data.current ?? ""}>
            {data.current ? null : <option value={""}>{"Choose a consultant"}</option>}
            {data.consultants.map((consultant) => (
              <option key={consultant.id} value={consultant.id}>
                {consultant.id === data.current ? `${consultant.name} (now)` : consultant.name}
              </option>
            ))}
          </select>
          <span className={"hint"}>{"Only consultants with a verified licence can be responsible for a matter."}</span>
        </div>
        <fieldset className={"fld"} style={{ border: "0", padding: "0", margin: "0" }}>
          <legend>{"Who will be told"}</legend>
          {data.sample ? (
            <p className={"mu"}>{"Nobody: this is a sample matter."}</p>
          ) : data.audience.length ? (
            <ul className={"cons-aud"}>
              {data.audience.map((person, index) => (
                <li key={index}>
                  <b>{person.name}</b>
                  <small>{`${person.role} · ${person.emailed ? "portal notice and email" : "portal notice only (email notices are off or there is no email)"}`}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className={"mu"}>{"Nobody yet: no one on this matter has a portal account. Tell the client yourself."}</p>
          )}
        </fieldset>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"The email only says their consultant changed; the portal shows the new name. Saving asks you to confirm it’s you and is logged."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-x={""}>
          {"Cancel"}
        </button>
        <Go id={"consGo"} label={"Change consultant"} act={"consultant"} wire={wire} />
      </div>
    </dialog>
  );
}

export type MatterDeadlineDialog = {
  /** The firm's timezone, offered as the official one. */
  timezone: string;
  /** The firm is in sample mode and this matter is real: the database refuses the deadline. */
  sampleMode: boolean;
  kinds: readonly { value: string; label: string }[];
  /** Government letters on the matter; the deadline is linked to the one chosen (T037). */
  letters?: { id: string; label: string }[];
  /** The firm's today (`YYYY-MM-DD`): the earliest due date the dialog offers. */
  today?: string;
};

/** The record a dialog's confirm button saves to; the kit reads these from the button. */
export type MatterWire = { organizationId: string; matterId: string; version: number };

export type MatterAct = "stage" | "hold" | "letter" | "resume" | "outcome" | "deadline" | "consultant";

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
  // Live: a stage the database won't move to from here is disabled, and says why.
  const blocked = !current && Boolean(data.allowed) && !data.allowed?.includes(index);
  const evidence = blocked
    ? ({ tone: "unv", label: "Not a next step" } as MatterBadge)
    : back
      ? ({ tone: "gr", label: "Going back" } as MatterBadge)
      : current
        ? null
        : data.evidence[index] ?? null;
  return (
    <label
      className={current ? "st cur" : "st"}
      {...(blocked ? { title: `A matter at ${STAGE_ENTRY[data.current]?.[0] ?? "this stage"} can’t move straight to ${label}. Move one stage at a time.`, "aria-disabled": "true" } : {})}
    >
      <input type={"radio"} {...(current || blocked ? { disabled: true } : {})} name={"stg"} {...(index === data.target ? { defaultChecked: true } : {})} value={String(index)} />
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
            {data.allowed
              ? " Pick where it moves next. Each stage needs its entry evidence; stages the matter can’t move to from here are greyed out."
              : ` version ${data.version}. Pick the next stage. Each stage needs its entry evidence.`}
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
            <input type={"date"} defaultValue={data.reviewOn} {...(data.minReview ? { min: data.minReview } : {})} />
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
              {data.wire ? <input id={"ltD"} type={"date"} /> : <input placeholder={"Type exactly as written"} />}
            </label>
          </div>
          {data.wire && data.letterForm ? <LetterFormFields data={data.letterForm} /> : null}
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
      {data.request ? <DocRequestDialog data={data.request} /> : null}
      {data.newTask ? <TasksDialog data={data.newTask} /> : null}
      {data.task ? <TaskEditDialog data={data.task} /> : null}
      {data.consultant && data.wire ? <ConsultantDialog data={data.consultant} wire={data.wire} /> : null}
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
            <input id={"ddD"} type={"date"} {...(data.today ? { min: data.today } : {})} />
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
  /** Live only: a staff member's card. Manage opens Settings, where staff are managed. */
  staff?: string | null;
  /** Live only (ORG-06): the responsible consultant's card; Manage opens Change consultant. */
  consultant?: boolean;
  /** Live only: why Manage does nothing for this card; the button is disabled with this as its title. */
  inert?: string | null;
};

/** The Manage button's `data-*`: Edit details, the invitation dialog, or nothing for the Designer's inert button. */
function manageProps(card: MatterPersonCard) {
  if (card.consultant) return { "data-dlg": "dCons", title: "Change consultant" };
  if (card.staff) return { "data-nav": card.staff, title: "Manage staff in Settings" };
  if (card.inert && !card.edit && !card.invite) return { disabled: true, title: card.inert };
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

export function MatterPeople({ cards, relationships, history }: { cards: MatterPersonCard[]; relationships: MatterRelationship[]; history?: PersonHistoryPanel[] }) {
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
      {history?.length ? <PersonHistoryList panels={history} /> : null}
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
  /** The Designer's "Review" link to the review panel below (`#ocr`), on the row it shows. */
  open?: { href: string; label: string } | null;
  /** Live only: the person chip that shows this row (their first name). */
  who?: string | null;
};

export function MatterDocuments({
  checklist,
  people,
  rows,
  vo,
  filter = false,
  request = false,
  apply = null,
  autoRead = null,
}: {
  checklist: string | null;
  people: string[];
  rows: MatterDocumentRow[];
  vo?: MatterDocumentReviewData | null;
  /** Live only: the person chips filter the rows (`data-who-chip`, `data-who`). */
  filter?: boolean;
  /** Live only: the empty state offers Request a document (the header's dialog). */
  request?: boolean;
  /** Live only (DOC-01): Apply checklist, from the firm's approved checklists. */
  apply?: ApplyChecklistData | null;
  /** Live only (DOC-05): new uploads Vo reads now, with "Read documents on upload" on. */
  autoRead?: { organizationId: string; versionIds: string[] } | null;
}) {
  if (rows.length === 0) {
    return (
      <Panel>
        <Empty art={"review-queue-empty"} title={"No documents on this matter yet"} copy={"Requests and uploads appear here as the team works on the file."}>
          {request ? (
            <button className={"btn p sm"} data-open={DOC_REQUEST_DIALOG}>
              <Icon name={"upload"} cls={"ic s"} />
              {"Request a document"}
            </button>
          ) : null}
          {apply?.templates.length ? <ApplyChecklist data={apply} /> : null}
        </Empty>
      </Panel>
    );
  }
  return (
    <>
      {autoRead ? <VoAutoRead data={autoRead} /> : null}
      {apply?.templates.length ? (
        <div className={"ph-act"}>
          <ApplyChecklist data={apply} />
        </div>
      ) : null}
      <Panel>
        <h2>
          <Icon name={"document-scan"} />
          <span>{checklist ? <Pair left={"Checklist"} right={checklist} /> : "Checklist"}</span>
          <span className={"r"} style={{ display: "flex", gap: "6px" }}>
            <span className={"fchip on"} {...(filter ? { "data-who-chip": "", role: "button", tabIndex: 0, "aria-pressed": "true" as const } : {})}>
              {"Everyone"}
            </span>
            {people.map((name) => (
              <span
                key={name}
                className={"fchip"}
                style={{ background: "transparent" }}
                {...(filter ? { "data-who-chip": name, role: "button", tabIndex: 0, "aria-pressed": "false" as const } : {})}
              >
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
                <tr
                  key={index}
                  className={row.open ? "sel" : ""}
                  {...(row.open ? { "aria-current": "true" as const, title: "Open in the review panel below" } : {})}
                  {...(filter && row.who ? { "data-who": row.who } : {})}
                >
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
                  <td>
                    {row.open ? (
                      <a className={"btn p sm"} href={row.open.href}>
                        {row.open.label}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p style={css({ color: "var(--t2)", fontSize: "13px", margin: "-10px 0px 22px", "--i": "1" })} className={"rv"}>
        {"Upload state and firm review are separate. Accepted means accepted by the firm for this purpose, not validated by IRCC."}
        {filter ? (
          <>
            {" Review, accept or open files in "}
            <a className={"tl"} href={"/sheet/documents"}>
              {"Documents"}
            </a>
            {"."}
          </>
        ) : null}
      </p>
      {vo ? <MatterDocumentReview data={vo} /> : null}
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
      {/* Live: an amendment or a further agreement on a matter that already has one (AGR-04). */}
      {create ? (
        <div style={{ marginTop: "12px" }}>
          <a className={"btn s sm"} href={create}>
            <Icon name={"plus"} cls={"ic s"} />
            {"New agreement"}
          </a>
        </div>
      ) : null}
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
  /** Live only: "Confirm" beside "Not verified yet", for someone the database lets confirm it. */
  confirm?: Record<`data-${string}`, string> | null;
  /** Live only: why this tentative deadline can't be confirmed here; shown as the badge's title. */
  confirmWhy?: string | null;
  /** Live only: its date has passed. It stays listed, marked, so a missed deadline doesn't vanish. */
  pastDue?: boolean;
};
export type MatterTaskRow = {
  title: string;
  parts: string[];
  badge: MatterBadge;
  owner: SidebarPerson;
  /** Live only: the row's tick marks the task done (`data-task-done`). Null: shown, not clickable. */
  done?: Record<`data-${string}`, string> | null;
  /** Live only: the task is finished, so its tick shows as ticked. */
  completed?: boolean;
  /** Live only: the row's Manage button opens the Task dialog (`data-task-open`). */
  manage?: Record<`data-${string}`, string> | null;
};

export function MatterTasks({
  deadlines,
  tasks,
  record = false,
  add = false,
}: {
  deadlines: MatterDeadline[];
  tasks: MatterTaskRow[];
  record?: boolean;
  /** Live only: the empty state also offers "Add a task" (New task for this matter). */
  add?: boolean;
}) {
  if (deadlines.length === 0 && tasks.length === 0) {
    return (
      <Panel>
        <Empty art={"portal-nothing-due"} title={"No open tasks"} copy={"Client tasks and internal tasks appear here with owners and due dates."}>
          {record || add ? (
            <>
              {record ? (
                <button className={"btn p sm"} data-open={"dDeadline"}>
                  {"Record a deadline"}
                </button>
              ) : null}
              {add ? (
                <button className={"btn s sm"} data-dlg={"dlgTask"}>
                  {"Add a task"}
                </button>
              ) : null}
            </>
          ) : null}
        </Empty>
      </Panel>
    );
  }
  const offset = deadlines.length;
  return (
    <>
      {deadlines.map((deadline, at) => (
        <DeadlinePanel key={at} deadline={deadline} index={at} />
      ))}
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
            <span
              className={task.completed ? "ck on" : "ck"}
              {...(task.done
                ? { role: "checkbox", "aria-checked": "false" as const, tabIndex: 0, "aria-label": `Mark “${task.title}” done`, ...task.done }
                : task.done === null
                  ? // Live, but this person can't change it (or it's finished): a status mark, not a control.
                    { "aria-readonly": "true" as const, "aria-hidden": "true" as const }
                  : {})}
            ></span>
            <div>
              <b>{task.title}</b>
              <small>
                <Joined parts={task.parts} />
              </small>
            </div>
            <span className={"r"}>
              <Plain badge={task.badge} />
              <Avatar person={task.owner} />
              {task.manage ? (
                <button className={"btn s sm"} aria-label={`Manage ${task.title}`} {...task.manage}>
                  <Icon name={"more"} cls={"ic s"} />
                </button>
              ) : null}
            </span>
          </div>
        ))
      )}
    </>
  );
}

function DeadlinePanel({ deadline, index }: { deadline: MatterDeadline; index: number }) {
  return (
        <Panel index={index}>
          <h2>
            <Icon name={"alarm"} />
            <span>
              <Pair left={deadline.label} right={deadline.due} />
            </span>
            <span className={"r"} {...(deadline.confirm || deadline.pastDue ? { style: { display: "flex", gap: "6px" } } : {})} {...(deadline.confirmWhy ? { title: deadline.confirmWhy } : {})}>
              {deadline.pastDue ? <Plain badge={{ tone: "bad", label: "Past due" }} /> : null}
              <Plain badge={deadline.verified} />
              {deadline.confirm ? (
                <button className={"btn s sm"} {...deadline.confirm}>
                  <Icon name={"check-circle"} cls={"ic s"} />
                  {"Confirm"}
                </button>
              ) : null}
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
  );
}

/* --------------------------------------------------------------- billing */

/** The matter's Billing tab (Designer `tab-billing`): money held and invoiced, then its invoices. */
export type MatterBillingData = {
  /** Client account (advance): what is held for this matter, and what waits for verification. */
  held: { amount: string; count: number; note: string };
  invoiced: { amount: string; count: number; note: string[] };
  invoices: { number: string; categories: string[]; issued: string; state: MatterBadge; total: string; payment: string[] }[];
  /** Nobody on this matter may read its invoices (they are shown to the firm owner and finance). */
  hidden?: boolean;
  /** Live only (FIN-06): time on the matter, accepted quotes and instalments, after the invoices. */
  work?: MatterWorkData | null;
};

export function MatterBilling({ data }: { data: MatterBillingData | null }) {
  if (!data || data.hidden || (data.invoices.length === 0 && data.held.count === 0)) {
    // DES-04: a role that can't read this matter's billing gets the shared permission-denied view.
    const empty = data?.hidden ? (
      <NoAccessPanel data={MATTER_BILLING_DENIED} />
    ) : (
      <Panel>
        <Empty
          art={"invoice-plain"}
          title={data?.hidden ? "Invoices are shown to billing staff" : "No invoices yet"}
          copy={data?.hidden ? "The firm owner and the matter’s finance user see this matter’s invoices and client funds." : "Invoices you issue from a matter appear here."}
        />
      </Panel>
    );
    return data?.work ? (
      <>
        {empty}
        <MatterWork data={data.work} />
      </>
    ) : (
      empty
    );
  }
  return (
    <>
      <p className={"fp-note rv"} style={css({ margin: "0px 0px 12px", "--i": "0" })}>
        <Icon name={"wallet"} cls={"ic s"} />
        {" Firm-wide invoices, client funds and reconciliation are in "}
        <a href={"/sheet/finance"} style={{ color: "var(--blue)" }}>
          {"Finance"}
        </a>
        {"."}
      </p>
      <div className={"panel rv"} style={css({ "--i": "1" })}>
        <h2>
          <Icon name={"wallet"} />
          {"Money for this matter"}
          <span className={"r"}>
            <span className={"pill"}>{"CAD"}</span>
          </span>
        </h2>
        <div className={"split"} style={css({ "--n": "2" })}>
          <div>
            <h3>{"Client account (advance)"}</h3>
            <b className={"display num"} style={{ fontSize: "30px", display: "block" }}>
              {data.held.amount}
            </b>
            <small style={{ color: "var(--t2)", fontSize: "13px" }}>{data.held.note}</small>
          </div>
          <div>
            <h3>{"Invoiced (earned fees)"}</h3>
            <b className={"display num"} style={{ fontSize: "30px", display: "block" }}>
              {data.invoiced.amount}
            </b>
            <small style={{ color: "var(--t2)", fontSize: "13px" }}>
              <Joined parts={data.invoiced.note} />
            </small>
          </div>
        </div>
      </div>
      <h3 className={"sub rv"} style={css({ "--i": "2" })}>
        {"Invoices"}
      </h3>
      {data.invoices.length === 0 ? (
        <div className={"li rv"} style={css({ "--i": "3" })}>
          <div>
            <b>{"No invoices yet"}</b>
            <small>{"Invoices you issue from a matter appear here."}</small>
          </div>
        </div>
      ) : (
        <div className={"tw rv"} style={css({ "--i": "3" })}>
          <table className={"t"}>
            <thead>
              <tr>
                <th>{"Number"}</th>
                <th>{"Line categories"}</th>
                <th>{"Issued"}</th>
                <th>{"State"}</th>
                <th style={{ textAlign: "right" }}>{"Total"}</th>
                <th>{"Payment"}</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((row) => (
                <tr key={row.number}>
                  <td className={"num"}>{row.number}</td>
                  <td>
                    <Joined parts={row.categories} />
                  </td>
                  <td className={"num"}>{row.issued}</td>
                  <td>
                    <Plain badge={row.state} />
                  </td>
                  <td className={"num"} style={{ textAlign: "right" }}>
                    {row.total}
                  </td>
                  <td>
                    <Joined parts={row.payment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.work ? <MatterWork data={data.work} /> : null}
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

/** The Designer's closure checklist panel, from the matter's own records (T040). */
export type ClosurePanelData = {
  status: { tone: "gr" | "ok" | "chg"; label: string; detail: string };
  items: { label: string; done: boolean; note?: string }[];
  /** The Retention column's key/value rows (no slider: the period is the firm's setting, not chosen per matter). */
  retention: [string, string][];
  note: string;
  /** Live: the export page with this matter already chosen. */
  exportHref?: string;
};

function ClosureChecklist({ data }: { data: ClosurePanelData }) {
  return (
    <div className={"panel rv"} style={css({ "--i": "0" })}>
      <h2>
        <Icon name={"folder"} />
        {"Closure checklist"}
        <span className={"r"}>
          <span className={`bd ${data.status.tone}`}>
            <i></i>
            <span>
              {`${data.status.label} `}
              <Sep />
              {` ${data.status.detail}`}
            </span>
          </span>
        </span>
      </h2>
      <div className={"split"} style={css({ "--n": "2" })}>
        <div>
          <ul className={"clist"}>
            {data.items.map((item) => (
              <li key={item.label}>
                {/* Read only: each tick is worked out from the matter's records, never clicked. */}
                <span
                  className={item.done ? "ck on" : "ck"}
                  role={"checkbox"}
                  aria-checked={item.done ? "true" : "false"}
                  aria-readonly={"true"}
                  aria-label={item.label}
                ></span>
                <div>
                  <b>{item.label}</b>
                  {item.note ? <small>{item.note}</small> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>{"Retention"}</h3>
          <div className={"kv"} style={css({ marginTop: "14px" })}>
            {data.retention.map(([label, value]) => (
              <Fragment key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </Fragment>
            ))}
          </div>
          <p className={"mu"} style={css({ fontSize: "13.5px", marginTop: "12px" })}>
            {data.note}
          </p>
          {/* Lifecycle step 12: hand over or keep a copy of the client file before closing (SEC-10). */}
          <p className={"mu"} style={css({ fontSize: "13.5px", marginTop: "8px" })}>
            <a className={"tl"} href={data.exportHref ?? "/sheet/exports"}>
              {"Export the client file"}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Closure: the checklist (when loaded), then the Designer's "still open" state, or a closed matter's retention date. */
export function MatterClosure({ closed, retention, panel }: { closed: boolean; retention: string | null; panel?: ClosurePanelData | null }) {
  if (panel) {
    return (
      <>
        <ClosureChecklist data={panel} />
        {closed ? null : <StillOpen index={1} />}
      </>
    );
  }
  if (!closed) return <StillOpen index={0} />;
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

function StillOpen({ index }: { index: number }) {
  return (
    <div className={"empty rv"} style={css({ "--i": String(index) })}>
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

/* -------------------------------------------------------------- timeline */

/**
 * The Designer's Timeline tab (`tab-timeline`): its search-and-chips bar, then one `.li` row per
 * event (the Overview's event rows). Live (OPS-06) it shows the matter's inbound email records:
 * the bar is left out (its chips filter the audit trail, which this tab doesn't read yet) and a
 * plain line says what is shown.
 */
export type MatterTimelineData = {
  /** The Designer's filter chips; live omits the bar. */
  filters?: string[];
  /** Live only: what the rows are. */
  note?: string;
  events: MatterEvent[];
};

export function MatterTimeline({ data }: { data: MatterTimelineData }) {
  return (
    <>
      {data.filters ? (
        <div className={"bar rv"} style={css({ "--i": "0" })}>
          <Icon name={"search"} cls={"ic s"} />
          <input placeholder={"Search the audit trail"} aria-label={"Search the audit trail"} />
          {data.filters.map((label, index) => (
            <span key={label} className={index === 0 ? "fchip on" : "fchip"}>
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {data.note ? (
        <p className={"mu rv"} style={css({ "--i": "0", fontSize: "13px", margin: "0 0 8px" })}>
          {data.note}
        </p>
      ) : null}
      {data.events.length === 0 && !data.filters ? (
        <Panel>
          <Empty art={"inbox-empty"} title={"No email on this matter yet"} copy={"Email sent to this matter’s address, or filed to it from Email to triage, appears here."} />
        </Panel>
      ) : (
        data.events.map((event, index) => <EventRow key={index} event={event} index={1 + index} />)
      )}
    </>
  );
}

/** Tabs whose records are not stored yet: the Designer's empty-state panel, never sample rows. */
export const MATTER_TAB_EMPTY: Partial<Record<MatterTab, { art: string; title: string; copy: string }>> = {
  // The Intake tab reads live forms and answers; this shows only when that read failed.
  intake: { art: "clients-empty", title: "Intake couldn’t load", copy: "Reload the page to try again. Questionnaire answers are kept on the client’s record." },
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
  /** `history`, live only (INT-05): each client's names, passports and addresses, and their flags. */
  people: { cards: MatterPersonCard[]; relationships: MatterRelationship[]; history?: PersonHistoryPanel[] };
  /** `vo`: Vo's reading of one document, in the Designer's review panel (`#ocr`). */
  /** `request` (live): the person may request documents, so the empty tab offers it (#dReq). */
  documents: { checklist: string | null; people: string[]; rows: MatterDocumentRow[]; vo?: MatterDocumentReviewData | null; filter?: boolean; request?: boolean; apply?: ApplyChecklistData | null; autoRead?: { organizationId: string; versionIds: string[] } | null };
  agreements: { rows: MatterAgreementRow[]; signing: MatterSigning | null; create?: string | null };
  /** Every upcoming deadline, soonest first. `record` and `add` offer Record a deadline and New task from the empty state. */
  tasks: { deadlines: MatterDeadline[]; tasks: MatterTaskRow[]; record?: boolean; add?: boolean };
  /** The Billing tab's invoices and money; absent, the tab keeps its empty state. */
  billing?: MatterBillingData | null;
  outcome: string | null;
  /** Set when decision evidence is on file and no outcome is recorded yet. */
  confirmOutcome?: MatterOutcomeConfirm | null;
  closure: { closed: boolean; retention: string | null; panel?: ClosurePanelData | null };
  /** Messages tab: the chat view's data (null: it failed to load; absent: another tab). */
  messages?: ChatData | null;
  /** T036 submission handoff; absent, the tab keeps its empty state. */
  submissions?: MatterSubmissionsData | null;
  /** T037 and T038 letters and decisions; absent, the tab keeps the outcome-only view. */
  decisions?: MatterDecisionsData | null;
  /** Intake delivery: the people's intake forms and answers; absent, the tab keeps its empty state. */
  intake?: MatterIntakeData | null;
  /** OPS-06: the Timeline tab's inbound email records; absent, the tab keeps its empty state. */
  timeline?: MatterTimelineData | null;
};

/** The open tab's content. */
export function SheetMatter({ data }: { data: MatterPageData }) {
  switch (data.tab) {
    case "overview":
      return <MatterOverview data={data.overview} />;
    case "people":
      return <MatterPeople cards={data.people.cards} relationships={data.people.relationships} history={data.people.history} />;
    case "documents":
      return (
        <MatterDocuments
          checklist={data.documents.checklist}
          people={data.documents.people}
          rows={data.documents.rows}
          vo={data.documents.vo}
          filter={data.documents.filter}
          request={data.documents.request}
          apply={data.documents.apply}
          autoRead={data.documents.autoRead}
        />
      );
    case "agreements":
      return <MatterAgreements rows={data.agreements.rows} signing={data.agreements.signing} create={data.agreements.create} />;
    case "tasks":
      return <MatterTasks deadlines={data.tasks.deadlines} tasks={data.tasks.tasks} record={data.tasks.record} add={data.tasks.add} />;
    case "billing":
      return data.billing === undefined ? <MatterTabEmpty tab={data.tab} /> : <MatterBilling data={data.billing} />;
    case "submissions":
      return data.submissions ? <MatterSubmissions data={data.submissions} /> : <MatterTabEmpty tab={data.tab} />;
    case "decisions":
      return data.decisions ? <MatterDecisionsLive data={data.decisions} /> : <MatterDecisions outcome={data.outcome} confirm={data.confirmOutcome} />;
    case "intake":
      return data.intake ? <MatterIntake data={data.intake} /> : <MatterTabEmpty tab={data.tab} />;
    case "closure":
      return <MatterClosure closed={data.closure.closed} retention={data.closure.retention} panel={data.closure.panel} />;
    // Redesigned as a chat view at the owner's request (2026-10-18); the other tabs keep the Designer's markup.
    case "messages":
      if (data.messages === undefined) return <MatterTabEmpty tab={data.tab} />;
      return data.messages ? <ChatView data={data.messages} /> : <ChatError />;
    case "timeline":
      return data.timeline ? <MatterTimeline data={data.timeline} /> : <MatterTabEmpty tab={data.tab} />;
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
