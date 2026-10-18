/**
 * The Designer's Automations page (`markup/automations.tsx`): the Builder tab (default) and Run
 * history (`tab-runs`), with the Settings column. Same DOM, classes and order; the steps, runs and
 * settings come from the firm's deadline-reminder configuration and its reminder schedules.
 * Automations are fixed rules here (OPS-07: no free-form scripting): a step list states what the
 * reminder job does, it is not an editor.
 */
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, VoCard } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type AutomationsTab = "builder" | "runs";

type Text = string | { left: string; right: string };

export type AutomationStep = { icon: string; title: string; text: Text; badge: { tone?: "chg"; label: string }; warn?: boolean };
export type AutomationRun = { title: Text; note: Text; state: MatterBadge; when: string };
export type AutomationSetting = { label: string; value: string; icon?: string; person?: SidebarPerson };

export type AutomationsData = {
  tab: AutomationsTab;
  name: string;
  pills: string[];
  /** The capture's "Test with sample matter" and "Save version" buttons. Absent on a real page: there is no editor. */
  actions: { test: string; save: string } | null;
  intro: string;
  steps: AutomationStep[];
  addStep: boolean;
  runs: AutomationRun[];
  settings: AutomationSetting[];
  others: { label: string; on: boolean }[];
  vo: { draft: string; sources: string } | null;
};

const STEP: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px 1fr auto",
  gap: "14px",
  alignItems: "center",
  padding: "14px",
  borderRadius: "14px",
  background: "var(--canvas)",
  marginBottom: "10px",
};

const MARK: React.CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "12px",
  background: "#fff",
  display: "grid",
  placeItems: "center",
  color: "var(--blue)",
};

function Show({ text }: { text: Text }) {
  return typeof text === "string" ? <>{text}</> : <Pair left={text.left} right={text.right} />;
}

export function AutomationsHeader({ data }: { data: AutomationsData }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"lightning"} cls={"ic s"} />
          {"Automations"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          {data.name}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        {data.pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          {data.actions ? (
            <>
              <button className={"btn s sm"}>{data.actions.test}</button>
              <button className={"btn p sm"}>{data.actions.save}</button>
            </>
          ) : null}
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"builder"} className={data.tab === "builder" ? "on" : undefined}>
          {"Builder"}
        </button>
        <button role={"tab"} data-t={"runs"} className={data.tab === "runs" ? "on" : undefined}>
          {"Run history"}
        </button>
        <i className={"ul"} style={data.tab === "builder" ? { left: "0px", width: "44px" } : { left: "70px", width: "68px" }}></i>
      </div>
    </>
  );
}

export function SheetAutomations({ data }: { data: AutomationsData }) {
  if (data.tab === "runs") {
    return (
      <>
        <div className={"ph rv"} style={{ "--i": "0" } as React.CSSProperties}>
          <h1 className={"display"}>{"Run history"}</h1>
          <p>{"Every run records the trigger, the matter, what was proposed and who approved it."}</p>
        </div>
        {data.runs.length === 0 ? (
          <div className={"panel rv"} style={{ "--i": "1" } as React.CSSProperties}>
            <Empty art={"templates-empty"} title={"No reminders yet"} copy={"Reminders appear here when a deadline with a due date is saved on a matter."} />
          </div>
        ) : (
          data.runs.map((run, index) => (
            <div key={index} className={"li rv"} style={{ "--i": String(index + 1) } as React.CSSProperties}>
              <div>
                <b>
                  <Show text={run.title} />
                </b>
                <small>
                  <Show text={run.note} />
                </small>
              </div>
              <span className={"r"}>
                <Badge badge={run.state} />
                <small className={"num"} style={{ color: "var(--t2)", fontSize: "13px" }}>
                  {run.when}
                </small>
              </span>
            </div>
          ))
        )}
      </>
    );
  }
  return (
    <>
      <div className={"ph rv"} style={{ "--i": "0" } as React.CSSProperties}>
        <h1 className={"display"}>{data.name}</h1>
        <p>{data.intro}</p>
      </div>
      <div id={"flow"} style={{ maxWidth: "640px", "--i": "1" } as React.CSSProperties} className={"rv"}>
        {data.steps.map((step, index) => (
          <div key={index} className={"step"} style={step.warn ? { ...STEP, background: "var(--warn-bg)" } : STEP}>
            <span style={step.warn ? { ...MARK, color: "var(--warn)" } : MARK}>
              <Icon name={step.icon} />
            </span>
            <div>
              <b style={{ fontWeight: "600" }}>{step.title}</b>
              <br />
              <span style={{ color: "var(--t2)", fontSize: "14px" }}>
                <Show text={step.text} />
              </span>
            </div>
            <span className={step.badge.tone ? `bd ${step.badge.tone}` : "bd"}>{step.badge.label}</span>
          </div>
        ))}
        {data.addStep ? (
          <button className={"btn s"} id={"add"}>
            <Icon name={"plus"} cls={"ic s"} />
            {"Add a step"}
          </button>
        ) : null}
      </div>
    </>
  );
}

/** The Settings column, in place of the calendar column. */
export function AutomationsSettings({ data }: { data: AutomationsData }) {
  return (
    <aside id={"rbar"} aria-label={"Details"}>
      <h4>{"Settings"}</h4>
      <div className={"rank"} style={{ fontSize: "13.5px" }}>
        {data.settings.map((setting) => (
          <div key={setting.label}>
            {setting.icon ? (
              <>
                <Icon name={setting.icon} cls={"ic s"} />
                {` ${setting.label}`}
              </>
            ) : (
              setting.label
            )}
            <span className={"r"}>
              {setting.person ? (
                <>
                  <Avatar person={setting.person} />
                  {` ${setting.value}`}
                </>
              ) : (
                setting.value
              )}
            </span>
          </div>
        ))}
      </div>
      {data.others.length ? (
        <>
          <h4 style={{ marginTop: "18px" }}>{"Other automations"}</h4>
          <div className={"rank"} style={{ fontSize: "13.5px" }}>
            {data.others.map((other) => (
              <div key={other.label}>
                {other.label}
                <span className={other.on ? "tog on" : "tog"} style={{ marginLeft: "auto" }}></span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {data.vo ? <VoCard draft={data.vo.draft} sources={data.vo.sources} marginTop={"16px"} /> : null}
    </aside>
  );
}
