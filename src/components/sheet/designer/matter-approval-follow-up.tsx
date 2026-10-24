/**
 * DEC-02 on the matter's Decisions tab: the approval follow-up checklist, the conditions summary
 * and the delivery record, with their dialogs. The Designer has no screen for them, so each is
 * built from the Designer's own parts on this tab, the same parts as the Submission checklist
 * (`matter-submissions-checklist.tsx`): a `.panel` with an `h2` and `.r` badge, the tickable
 * `.clist` with `.ck` boxes, `.li` record rows with a dot, `<b>` and `<small>` with `.sep`
 * separators, `.why` and `.mu` notes, `.btn s sm` buttons, and the `.dlg wide` dialog (`.dh`,
 * `.db`, `.g2` of `.fl` fields, `.df`). Every value comes from the firm's records; official steps
 * show their source page, form, dates and snapshot hash next to them.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, Sep } from "./frame";
import { PageAttestFields } from "./page-attestation";

const css = (style: Record<string, string>) => style as CSSProperties;

export type DecWire = Record<`data-${string}`, string>;
type Badge = { tone: string; label: string };
type Source = { href: string; text: string; facts: string[] };

export type FollowUpCheckItem = {
  id: string;
  label: string;
  done: boolean;
  note: string;
  source: Source | null;
  wire: DecWire | null;
  retire: DecWire | null;
};

export type ApprovalFollowUpData = {
  badge: Badge;
  intro: string;
  closure: FollowUpCheckItem[];
  official: FollowUpCheckItem[];
  officialTitle: string;
  officialEmpty: string | null;
  pending: { label: string; kind: string; source: Source; badge: Badge; approve: DecWire | null; reject: DecWire | null }[];
  addStep: DecWire | null;
  summary: {
    badge: Badge;
    current: { body: string; line: string[] } | null;
    draft: { body: string; line: string[]; approve: DecWire | null; edit: DecWire | null } | null;
    earlier: string[];
    write: DecWire | null;
    note: string;
  };
  deliveries: { title: string; parts: string[]; badge: Badge; ack: DecWire | null }[];
  deliveriesEmpty: string;
  recordDelivery: DecWire | null;
  deliveryNote: string | null;
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

function CheckList({ items }: { items: FollowUpCheckItem[] }) {
  return (
    <ul className={"clist"}>
      {items.map((item) => (
        <li key={item.id} className={item.done ? "on" : ""}>
          <span
            className={item.done ? "ck on" : "ck"}
            role={"checkbox"}
            aria-checked={item.done ? "true" : "false"}
            aria-label={item.label}
            tabIndex={0}
            {...(item.wire ?? { "aria-readonly": "true" })}
          ></span>
          <div>
            <b>{item.label}</b>
            <small>
              <Parts
                parts={[
                  ...(item.source ? [<SourceLink key={"s"} source={item.source} />, ...item.source.facts] : []),
                  ...(item.note ? [item.note] : []),
                ]}
              />
            </small>
          </div>
          {item.retire ? (
            <button className={"btn s sm"} style={{ marginLeft: "auto" }} {...item.retire}>
              {"Retire"}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const DOT_OK = "#2e9d5b";
const DOT_WAIT = "#f0a200";

export function ApprovalFollowUp({ data, index = 0 }: { data: ApprovalFollowUpData; index?: number }) {
  let at = index;
  const summary = data.summary;
  return (
    <>
      <div className={"panel rv"} style={css({ "--i": String(at++) })} id={"decFollow"}>
        <h2>
          <Icon name={"check-circle"} />
          {"Approval follow-up checklist"}
          <span className={"r"}>
            <Pill badge={data.badge} />
          </span>
        </h2>
        <p className={"mu"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
          {data.intro}
        </p>
        <h3>{"Closure tasks"}</h3>
        {data.closure.length ? (
          <CheckList items={data.closure} />
        ) : (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{"The closure tasks open when a licensed consultant confirms the approval."}</span>
          </p>
        )}
        <h3 style={{ marginTop: "18px" }}>{data.officialTitle}</h3>
        {data.official.length ? <CheckList items={data.official} /> : null}
        {data.officialEmpty ? (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{data.officialEmpty}</span>
          </p>
        ) : null}
        {data.pending.length ? (
          <>
            <h3 style={{ marginTop: "18px" }}>{"Waiting for licensed review"}</h3>
            {data.pending.map((row, n) => (
              <div key={n} className={"li"}>
                <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: DOT_WAIT, flex: "none" }}></i>
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
        {data.addStep ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            <button className={"btn s sm"} {...data.addStep}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add an official follow-up step"}
            </button>
          </div>
        ) : null}
      </div>

      <div className={"panel rv"} style={css({ "--i": String(at++) })} id={"decSummary"}>
        <h2>
          <Icon name={"note"} />
          {"Conditions summary"}
          <span className={"r"}>
            <Pill badge={summary.badge} />
          </span>
        </h2>
        <p className={"mu"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
          {summary.note}
        </p>
        {summary.current ? (
          <div className={"li"}>
            <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: DOT_OK, flex: "none" }}></i>
            <div>
              <b style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{summary.current.body}</b>
              <small>
                <Parts parts={summary.current.line} />
              </small>
            </div>
          </div>
        ) : null}
        {summary.draft ? (
          <div className={"li"}>
            <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: DOT_WAIT, flex: "none" }}></i>
            <div>
              <b style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{summary.draft.body}</b>
              <small>
                <Parts parts={summary.draft.line} />
              </small>
            </div>
            <span className={"r"}>
              {summary.draft.edit ? (
                <button className={"btn s sm"} {...summary.draft.edit}>
                  <Icon name={"edit"} cls={"ic s"} />
                  {"Edit draft"}
                </button>
              ) : null}
              {summary.draft.approve ? (
                <button className={"btn p sm"} {...summary.draft.approve}>
                  <Icon name={"check-circle"} cls={"ic s"} />
                  {"Approve and show to the client"}
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {summary.earlier.map((line, n) => (
          <div key={n} className={"li"}>
            <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#d9d5d0", flex: "none" }}></i>
            <div>
              <small>{line}</small>
            </div>
          </div>
        ))}
        {!summary.current && !summary.draft ? (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{"No conditions summary yet. The client sees nothing here until a licensed consultant approves one."}</span>
          </p>
        ) : null}
        {summary.write ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            <button className={"btn s sm"} {...summary.write}>
              <Icon name={"edit"} cls={"ic s"} />
              {summary.current ? "Write a new version" : "Write the summary"}
            </button>
          </div>
        ) : null}
      </div>

      <div className={"panel rv"} style={css({ "--i": String(at++) })} id={"decDelivery"}>
        <h2>
          <Icon name={"send"} />
          {"Decision documents delivered"}
        </h2>
        {data.deliveries.length ? (
          data.deliveries.map((row, n) => (
            <div key={n} className={"li"}>
              <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: row.ack ? DOT_WAIT : DOT_OK, flex: "none" }}></i>
              <div>
                <b>{row.title}</b>
                <small>
                  <Parts parts={row.parts} />
                </small>
              </div>
              <span className={"r"}>
                {row.ack ? (
                  <button className={"btn s sm"} {...row.ack}>
                    {"Record acknowledgement"}
                  </button>
                ) : null}
                <Pill badge={row.badge} />
              </span>
            </div>
          ))
        ) : (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{data.deliveriesEmpty}</span>
          </p>
        )}
        {data.deliveryNote ? (
          <p className={"mu"} style={{ fontSize: "13.5px", margin: "10px 0 0" }}>
            {data.deliveryNote}
          </p>
        ) : null}
        {data.recordDelivery ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            <button className={"btn s sm"} {...data.recordDelivery}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Record a delivery"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- dialogs */

export type ApprovalFollowUpDialogsData = {
  step: { wire: DecWire; program: { key: string; label: string }; today: string } | null;
  summary: { wire: DecWire; body: string; editing: boolean } | null;
  delivery: { wire: DecWire; files: { versionId: string; label: string }[]; methods: { value: string; label: string }[]; now: string; timezone: string } | null;
  ack: { wire: DecWire; files: { versionId: string; label: string }[]; today: string } | null;
  reject: { wire: DecWire } | null;
  retire: { wire: DecWire } | null;
  /** Approve a step without a page snapshot: the reviewer's attestation (2026-10-24). Optional for fidelity samples. */
  attest?: { wire: DecWire; today: string } | null;
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

function Foot({ label, wire }: { label: string; wire: DecWire }) {
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

export function ApprovalFollowUpDialogs({ data }: { data: ApprovalFollowUpDialogsData }) {
  return (
    <>
      {data.step ? (
        <dialog className={"dlg wide"} id={"dDecStep"} aria-labelledby={"dDecStepT"}>
          <Head id={"dDecStep"} title={"Add an official follow-up step"} />
          <div className={"db"}>
            <p className={"mu"} style={{ fontSize: "13px", margin: "0 0 10px" }}>
              {
                "Copy it from the official IRCC or Government of Canada page, word for word. Casevoya fetches the page and keeps its hash. A licensed consultant approves it before it reaches any checklist. Leave the timing empty unless the page states one."
              }
            </p>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Applies to"}
                <select id={"dsP"} defaultValue={data.step.program.key}>
                  <option value={data.step.program.key}>{data.step.program.label}</option>
                </select>
              </label>
              <label className={"fl"}>
                {"Step, as the page gives it"}
                <input id={"dsL"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Timing, as the page gives it (if any)"}
                <input id={"dsW"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Official page link (with its section anchor)"}
                <input id={"dsU"} type={"url"} placeholder={"https://www.canada.ca/…#section"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Section heading (if the link has no anchor)"}
                <input id={"dsS"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Form number (if a form)"}
                <input id={"dsF"} placeholder={"As printed on the form"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Form’s date modified"}
                <input id={"dsM"} type={"date"} max={data.step.today} />
              </label>
              <label className={"fl"}>
                {"Date you checked the page"}
                <input id={"dsD"} type={"date"} max={data.step.today} defaultValue={data.step.today} />
              </label>
              <label className={"fl"}>
                {"“Current to” date (if the page shows one)"}
                <input id={"dsT"} type={"date"} max={data.step.today} />
              </label>
            </div>
          </div>
          <Foot label={"Send for review"} wire={data.step.wire} />
        </dialog>
      ) : null}
      {data.summary ? (
        <dialog className={"dlg wide"} id={"dDecSum"} aria-labelledby={"dDecSumT"}>
          <Head id={"dDecSum"} title={data.summary.editing ? "Edit the conditions summary draft" : "Write the conditions summary"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Summary for the client, in plain words"}
              <textarea id={"dmB"} rows={8} defaultValue={data.summary.body} />
            </label>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"Write what the approval letter states, without adding to it. It stays a draft until a licensed consultant approves it; only then does the client see it, as the firm’s summary."}
            </p>
          </div>
          <Foot label={"Save draft"} wire={data.summary.wire} />
        </dialog>
      ) : null}
      {data.delivery ? (
        <dialog className={"dlg wide"} id={"dDecDel"} aria-labelledby={"dDecDelT"}>
          <Head id={"dDecDel"} title={"Record a delivery"} />
          <div className={"db"}>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Document"}
                <select id={"ddV"} defaultValue={data.delivery.files[0]?.versionId}>
                  {data.delivery.files.map((file) => (
                    <option key={file.versionId} value={file.versionId}>
                      {file.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"How"}
                <select id={"ddM"} defaultValue={data.delivery.methods[0]?.value}>
                  {data.delivery.methods.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {`When (${data.delivery.timezone})`}
                <input id={"ddT"} type={"datetime-local"} defaultValue={data.delivery.now} data-tz={data.delivery.timezone} />
              </label>
              <label className={"fl"}>
                {"Note (optional)"}
                <input id={"ddN"} autoComplete={"off"} />
              </label>
            </div>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"The client sees the delivery in the portal and can confirm they received it. Recording it doesn’t send anything."}
            </p>
          </div>
          <Foot label={"Record delivery"} wire={data.delivery.wire} />
        </dialog>
      ) : null}
      {data.ack ? (
        <dialog className={"dlg wide"} id={"dDecAck"} aria-labelledby={"dDecAckT"}>
          <Head id={"dDecAck"} title={"Record the client’s acknowledgement"} />
          <div className={"db"}>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Date acknowledged"}
                <input id={"daD"} type={"date"} max={data.ack.today} defaultValue={data.ack.today} />
              </label>
              <label className={"fl"}>
                {"Evidence file on the matter (optional)"}
                <select id={"daV"} defaultValue={""}>
                  <option value={""}>{"None, describe it below"}</option>
                  {data.ack.files.map((file) => (
                    <option key={file.versionId} value={file.versionId}>
                      {file.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={"fl"}>
              {"What shows it (for example: the client’s reply email of that date)"}
              <textarea id={"daN"} rows={3} />
            </label>
          </div>
          <Foot label={"Record acknowledgement"} wire={data.ack.wire} />
        </dialog>
      ) : null}
      {data.reject ? (
        <dialog className={"dlg wide"} id={"dDecRej"} aria-labelledby={"dDecRejT"}>
          <Head id={"dDecRej"} title={"Reject this step"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why"}
              <textarea id={"djN"} rows={3} />
            </label>
          </div>
          <Foot label={"Reject"} wire={data.reject.wire} />
        </dialog>
      ) : null}
      {data.attest ? (
        <dialog className={"dlg wide"} id={"dDecAtt"} aria-labelledby={"dDecAttT"}>
          <Head id={"dDecAtt"} title={"Approve without a page snapshot"} />
          <div className={"db"}>
            <p className={"mu"} style={{ fontSize: "13px", margin: "0" }}>
              {"Open the step’s official page (its link is on the step) and compare it word for word before you approve."}
            </p>
            <PageAttestFields today={data.attest.today} />
          </div>
          <Foot label={"Approve"} wire={data.attest.wire} />
        </dialog>
      ) : null}
      {data.retire ? (
        <dialog className={"dlg wide"} id={"dDecRet"} aria-labelledby={"dDecRetT"}>
          <Head id={"dDecRet"} title={"Retire this step"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why (for example: the official page changed)"}
              <textarea id={"dtN"} rows={3} />
            </label>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"It stops showing on new checklists. Ticks already recorded stay in the history."}
            </p>
          </div>
          <Foot label={"Retire"} wire={data.retire.wire} />
        </dialog>
      ) : null}
    </>
  );
}
