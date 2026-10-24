/**
 * The Submissions tab's Submission checklist card, package manifest and their dialogs (GOV-01,
 * GOV-03). The Designer has no screen for them, so each is built from the Designer's own parts on
 * this tab: a `.panel` with an `h2` and `.r` badge, `.li` record rows with a dot, `<b>` and
 * `<small>` with `.sep` separators, the tickable `.clist` with `.ck` boxes, `.why` and `.mu` notes,
 * `.btn s sm` buttons, and the `.dlg wide` dialog (`.dh`, `.db`, `.g2` of `.fl` fields, `.df`).
 * Every value here comes from the firm's records; official steps and channel names show their
 * source page, form, dates and snapshot hash next to them.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, Sep } from "./frame";

const css = (style: Record<string, string>) => style as CSSProperties;

export type SubWire = Record<`data-${string}`, string>;
type Badge = { tone: string; label: string };
type Source = { href: string; text: string; facts: string[] };

export type ChecklistGateView = {
  key: string;
  title: string;
  detail: string;
  link: { href: string; label: string } | null;
  badge: Badge;
  dot: string;
  /** "Owner override: <reason>, <who>, <when>". */
  override: string | null;
};

export type OutsideStepView = { id: string; label: string; done: boolean; wire: SubWire | null; source: Source; by: string | null; retire: SubWire | null };
export type PendingView = { label: string; kind: string; source: Source; badge: Badge; approve: SubWire | null; reject: SubWire | null };
export type ManifestView = { title: string; hash: string | null; pinned: string; rows: { name: string; hash: string; note: string }[] };

export type SubmissionChecklistData = {
  badge: Badge;
  intro: string;
  /** Null when the checklist couldn't be read: said plainly, never shown as "all clear". */
  gates: ChecklistGateView[] | null;
  channel: { name: string; source: Source | null; note: string | null; retire: SubWire | null } | null;
  steps: OutsideStepView[];
  stepsEmpty: string | null;
  pending: PendingView[];
  fees: string | null;
  actions: { addStep: SubWire | null; fees: SubWire | null; override: SubWire | null };
  manifest: ManifestView | null;
};

function Pill({ badge }: { badge: Badge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.label}
    </span>
  );
}

/** Parts of a line, each separated by the Designer's `.sep`. */
function Parts({ parts }: { parts: ReactNode[] }) {
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(<span key={`p${index}`}>{index > 0 ? " " : ""}{part}{index < parts.length - 1 ? " " : ""}</span>);
  });
  return <>{out}</>;
}

function SourceLink({ source }: { source: Source }) {
  return (
    <a href={source.href} target={"_blank"} rel={"noopener noreferrer"}>
      {source.text}
    </a>
  );
}

export function SubmissionChecklist({ data, index = 0 }: { data: SubmissionChecklistData; index?: number }) {
  let at = index;
  return (
    <>
      <div className={"panel rv"} style={css({ "--i": String(at++) })} id={"subChecklist"}>
        <h2>
          <Icon name={"check-circle"} />
          {"Submission checklist"}
          <span className={"r"}>
            <Pill badge={data.badge} />
          </span>
        </h2>
        <p className={"mu"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
          {data.intro}
        </p>
        {data.gates ? (
          data.gates.map((gate) => (
            <div key={gate.key} className={"li"} data-gate={gate.key}>
              <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: gate.dot, flex: "none" }}></i>
              <div>
                <b>{gate.title}</b>
                <small>
                  <Parts
                    parts={[
                      ...(gate.detail ? [gate.detail] : []),
                      ...(gate.override ? [gate.override] : []),
                      ...(gate.link ? [<a key={"l"} href={gate.link.href}>{gate.link.label}</a>] : []),
                    ]}
                  />
                </small>
              </div>
              <span className={"r"}>
                <Pill badge={gate.badge} />
              </span>
            </div>
          ))
        ) : (
          <p className={"why"}>
            <Icon name={"alert"} cls={"ic s"} />
            <span>{"The checklist couldn’t load, so Record submission stays closed. Reload the page to try again."}</span>
          </p>
        )}

        <h3 style={{ marginTop: "18px" }}>{"Done outside Casevoya"}</h3>
        {data.channel ? (
          <p className={"mu"} style={{ fontSize: "13.5px", margin: "0 0 10px" }}>
            {"Channel: "}
            <b>{data.channel.name}</b>
            {data.channel.source ? (
              <>
                {" "}
                <Sep /> <SourceLink source={data.channel.source} /> <Sep /> {data.channel.source.facts.join(", ")}
              </>
            ) : null}
            {data.channel.note ? (
              <>
                {" "}
                <Sep /> {data.channel.note}
              </>
            ) : null}
            {data.channel.retire ? (
              <>
                {" "}
                <button className={"btn s sm"} {...data.channel.retire}>
                  {"Retire"}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {data.steps.length ? (
          <ul className={"clist"}>
            {data.steps.map((step) => (
              <li key={step.id} className={step.done ? "on" : ""}>
                <span
                  className={step.done ? "ck on" : "ck"}
                  role={"checkbox"}
                  aria-checked={step.done ? "true" : "false"}
                  aria-label={step.label}
                  tabIndex={0}
                  {...(step.wire ?? { "aria-readonly": "true" })}
                ></span>
                <div>
                  <b>{step.label}</b>
                  <small>
                    <Parts parts={[<SourceLink key={"s"} source={step.source} />, ...step.source.facts, ...(step.by ? [step.by] : [])]} />
                  </small>
                </div>
                {step.retire ? (
                  <button className={"btn s sm"} style={{ marginLeft: "auto" }} {...step.retire}>
                    {"Retire"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : data.stepsEmpty ? (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{data.stepsEmpty}</span>
          </p>
        ) : null}

        {data.pending.length ? (
          <>
            <h3 style={{ marginTop: "18px" }}>{"Waiting for licensed review"}</h3>
            {data.pending.map((row, n) => (
              <div key={n} className={"li"}>
                <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f0a200", flex: "none" }}></i>
                <div>
                  <b>{`${row.kind}: ${row.label}`}</b>
                  <small>
                    <Parts parts={[<SourceLink key={"s"} source={row.source} />, ...row.source.facts]} />
                  </small>
                </div>
                <span className={"r"}>
                  {row.approve ? (
                    <button className={"btn s sm"} {...row.approve}>
                      {"Approve"}
                    </button>
                  ) : null}
                  {row.reject ? (
                    <button className={"btn s sm"} {...row.reject}>
                      {"Reject"}
                    </button>
                  ) : null}
                  <Pill badge={row.badge} />
                </span>
              </div>
            ))}
          </>
        ) : null}

        {data.fees ? (
          <p className={"mu"} style={{ fontSize: "13.5px", margin: "14px 0 0" }}>
            {data.fees}
          </p>
        ) : null}
        {data.actions.addStep || data.actions.fees || data.actions.override ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {data.actions.fees ? (
              <button className={"btn s sm"} {...data.actions.fees}>
                <Icon name={"check-circle"} cls={"ic s"} />
                {"Confirm fee handling"}
              </button>
            ) : null}
            {data.actions.addStep ? (
              <button className={"btn s sm"} {...data.actions.addStep}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Add an official step or channel name"}
              </button>
            ) : null}
            {data.actions.override ? (
              <button className={"btn s sm"} {...data.actions.override}>
                <Icon name={"lock"} cls={"ic s"} />
                {"Override a gate"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {data.manifest ? (
        <div className={"panel rv"} style={css({ "--i": String(at++) })} id={"subManifest"}>
          <h2>
            <Icon name={"package"} />
            {data.manifest.title}
            <span className={"r"} style={{ display: "flex", gap: "6px" }}>
              {data.manifest.hash ? <span className={"pill num"}>{data.manifest.hash}</span> : null}
            </span>
          </h2>
          <p className={"mu"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
            {data.manifest.pinned}
          </p>
          {data.manifest.rows.map((row, n) => (
            <div key={n} className={"li"}>
              <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#2e9d5b", flex: "none" }}></i>
              <div>
                <b>{row.name}</b>
                <small>
                  <Parts parts={[row.note]} />
                </small>
              </div>
              <span className={"r"}>
                <span className={"pill num"}>{row.hash}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- dialogs */

export type SubmissionChecklistDialogsData = {
  requirement: {
    wire: SubWire;
    channels: { value: string; label: string }[];
    channel: string | null;
    program: { key: string; label: string } | null;
    today: string;
  } | null;
  fees: { wire: SubWire; confirmed: boolean; note: string | null } | null;
  override: { wire: SubWire; gates: { value: string; label: string }[] } | null;
  reject: { wire: SubWire } | null;
  retire: { wire: SubWire } | null;
};

function Head({ id, title }: { id: string; title: string }) {
  return (
    <div className={"dh"}>
      <h2 id={`${id}T`}>{title}</h2>
      <button className={"x"} aria-label={"Close"} data-x={""}>
        <Icon name={"close"} />
      </button>
    </div>
  );
}

function Foot({ label, wire }: { label: string; wire: SubWire }) {
  return (
    <div className={"df"}>
      <button className={"btn"} data-x={""}>
        {"Cancel"}
      </button>
      <button className={"btn p"} {...wire}>
        {label}
      </button>
    </div>
  );
}

export function SubmissionChecklistDialogs({ data }: { data: SubmissionChecklistDialogsData }) {
  return (
    <>
      {data.requirement ? (
        <dialog className={"dlg wide"} id={"dSubReq"} aria-labelledby={"dSubReqT"}>
          <Head id={"dSubReq"} title={"Add an official step or channel name"} />
          <div className={"db"}>
            <p className={"mu"} style={{ fontSize: "13px", margin: "0 0 10px" }}>
              {
                "Copy it from the official IRCC or Government of Canada page, word for word. Casevoya fetches the page and keeps its hash. A licensed consultant approves it before it reaches any checklist."
              }
            </p>
            <div className={"g2"}>
              <label className={"fl"}>
                {"What it is"}
                <select id={"sqK"} defaultValue={"outside_step"}>
                  <option value={"outside_step"}>{"A step done outside Casevoya"}</option>
                  <option value={"channel_name"}>{"IRCC’s official name for the channel"}</option>
                </select>
              </label>
              <label className={"fl"}>
                {"Channel"}
                <select id={"sqC"} defaultValue={data.requirement.channel ?? data.requirement.channels[0]?.value}>
                  {data.requirement.channels.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Applies to"}
                <select id={"sqP"} defaultValue={data.requirement.program?.key ?? ""}>
                  <option value={""}>{"Every program"}</option>
                  {data.requirement.program ? <option value={data.requirement.program.key}>{data.requirement.program.label}</option> : null}
                </select>
              </label>
              <label className={"fl"}>
                {"Step or name, as the page gives it"}
                <input id={"sqL"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Official page link (with its section anchor)"}
                <input id={"sqU"} type={"url"} placeholder={"https://www.canada.ca/…#section"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Section heading (if the link has no anchor)"}
                <input id={"sqS"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Form number (if a form)"}
                <input id={"sqF"} placeholder={"As printed on the form"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Form’s date modified"}
                <input id={"sqM"} type={"date"} max={data.requirement.today} />
              </label>
              <label className={"fl"}>
                {"Date you checked the page"}
                <input id={"sqD"} type={"date"} max={data.requirement.today} defaultValue={data.requirement.today} />
              </label>
              <label className={"fl"}>
                {"“Current to” date (if the page shows one)"}
                <input id={"sqT"} type={"date"} max={data.requirement.today} />
              </label>
            </div>
          </div>
          <Foot label={"Send for review"} wire={data.requirement.wire} />
        </dialog>
      ) : null}
      {data.fees ? (
        <dialog className={"dlg wide"} id={"dSubFee"} aria-labelledby={"dSubFeeT"}>
          <Head id={"dSubFee"} title={"Confirm fee handling"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"How the government fee was handled"}
              <textarea id={"sfN"} rows={3} defaultValue={data.fees.note ?? ""} placeholder={"For example: client paid in the portal; receipt saved to Documents"} />
            </label>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"Kept with this handoff with your name and the time. Casevoya doesn’t pay or check government fees."}
            </p>
          </div>
          <Foot label={data.fees.confirmed ? "Update confirmation" : "Confirm"} wire={data.fees.wire} />
        </dialog>
      ) : null}
      {data.override ? (
        <dialog className={"dlg wide"} id={"dSubOvr"} aria-labelledby={"dSubOvrT"}>
          <Head id={"dSubOvr"} title={"Override a gate"} />
          <div className={"db"}>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Gate"}
                <select id={"soG"} defaultValue={data.override.gates[0]?.value}>
                  {data.override.gates.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={"fl"}>
              {"Reason"}
              <textarea id={"soR"} rows={3} />
            </label>
            <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
              <Icon name={"info"} cls={"ic s"} />
              {"Firm owner only, after confirming with your authenticator. The reason is kept in the audit trail. The package release can’t be overridden."}
            </p>
          </div>
          <Foot label={"Override"} wire={data.override.wire} />
        </dialog>
      ) : null}
      {data.reject ? (
        <dialog className={"dlg wide"} id={"dSubRej"} aria-labelledby={"dSubRejT"}>
          <Head id={"dSubRej"} title={"Reject this entry"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why"}
              <textarea id={"sjN"} rows={3} />
            </label>
          </div>
          <Foot label={"Reject"} wire={data.reject.wire} />
        </dialog>
      ) : null}
      {data.retire ? (
        <dialog className={"dlg wide"} id={"dSubRet"} aria-labelledby={"dSubRetT"}>
          <Head id={"dSubRet"} title={"Retire this entry"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why (for example: the official page changed)"}
              <textarea id={"srtN"} rows={3} />
            </label>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"It stops showing on checklists. Ticks already recorded stay in the history."}
            </p>
          </div>
          <Foot label={"Retire"} wire={data.retire.wire} />
        </dialog>
      ) : null}
    </>
  );
}
