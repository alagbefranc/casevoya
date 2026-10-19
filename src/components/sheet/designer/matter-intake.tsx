/**
 * The matter's Intake tab, the Designer's `tab-intake` (`markup/matter.tsx`): the questionnaire
 * panel (state, progress, sections, answer versions), "Needs your review" with each answer's
 * source and state and the Designer's Mark reviewed fuse button, and the restricted-answers note.
 * One panel and table per person's form, from the firm's records (PRD INT-03 to INT-06).
 *
 * Live-only additions, stripped in the fidelity test: "Send a form" and "Freeze snapshot" buttons in
 * the panel's header (`.btn s sm`, the Designer has no send control), `data-intake-*` attributes,
 * a reviewed row's fuse shown settled, a third source part (when) and a correction number, and the
 * Send a form dialog (`#dIntakeSend`, built from the Designer's dialog parts like Request a document).
 */
import { Fragment } from "react";
import { Empty, Icon, Sep } from "./frame";
import type { IntakeBadge, IntakePanel, IntakeReviewRow } from "@/modules/sheet/matter-intake-present";

export const INTAKE_SEND_DIALOG = "dIntakeSend";

export type IntakeSendDialogData = {
  organizationId: string;
  matterId: string;
  forms: { id: string; label: string }[];
  people: { id: string; label: string }[];
  today: string;
  sampleMode: boolean;
};

export type MatterIntakeData = {
  organizationId: string;
  panels: IntakePanel[];
  /** The person may review answers and freeze a snapshot (firm owner, licensed consultant, case manager). */
  reviewer: boolean;
  /** Send a form; null when this member may not send one. */
  send: IntakeSendDialogData | null;
  note: string;
};

const css = (style: Record<string, string>) => style as React.CSSProperties;

function Joined({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <Sep /> : null}
          {`${index === 0 ? "" : " "}${part}${index === parts.length - 1 ? "" : " "}`}
        </Fragment>
      ))}
    </>
  );
}

function Badge({ badge }: { badge: IntakeBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.label}
    </span>
  );
}

/** The Designer's Mark reviewed fuse (`.k2-fb`). A reviewed answer shows it settled. */
function Fuse({ row, organizationId, reviewer }: { row: IntakeReviewRow; organizationId: string; reviewer: boolean }) {
  const settled = row.reviewed;
  const live = reviewer && row.answerId && !row.reviewed;
  return (
    <span className={"k2-fb"} data-phase={settled ? "settled" : "idle"} data-ms={"4000"} {...(live ? { "data-intake-review": row.answerId as string, "data-org": organizationId } : {})}>
      <button type={"button"} className={"btn s sm k2-fb-f k2-fb-idle"} {...(settled ? { hidden: true } : {})} {...(!live && !settled ? { disabled: true } : {})}>
        <Icon name={"check-circle"} cls={"ic s"} />
        {"Mark reviewed"}
      </button>
      <button type={"button"} className={"btn s sm k2-fb-f k2-fb-undo"} tabIndex={-1} aria-hidden={"true"} {...(settled ? { hidden: true } : {})}>
        <Icon name={"undo"} cls={"ic s k2-fb-ui"} />
        {"Undo"}
      </button>
      <span className={"btn s sm k2-fb-f k2-fb-done"} aria-hidden={settled ? "false" : "true"}>
        <Icon name={"check-circle"} cls={"ic s"} />
        {"Reviewed"}
      </span>
      <svg className={"k2-fb-rim"} aria-hidden={"true"}>
        <rect pathLength={1}></rect>
      </svg>
      <span className={"k2-sr"} role={"status"} aria-live={"polite"}></span>
    </span>
  );
}

function Questionnaire({ panel, index, data, first }: { panel: IntakePanel; index: number; data: MatterIntakeData; first: boolean }) {
  return (
    <div className={"panel rv"} style={css({ "--i": String(index) })}>
      <h2>
        <Icon name={"task"} />
        <span>
          <Joined parts={panel.title} />
        </span>
        <span className={"r"}>
          <Badge badge={panel.badge} />
          {first && data.send ? (
            <button className={"btn s sm"} data-open={INTAKE_SEND_DIALOG}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Send a form"}
            </button>
          ) : null}
          {data.reviewer && panel.submitted && !panel.frozen ? (
            <button className={"btn s sm"} data-intake-freeze={panel.responseId} data-org={data.organizationId}>
              <Icon name={"lock"} cls={"ic s"} />
              {"Freeze snapshot"}
            </button>
          ) : null}
        </span>
      </h2>
      <div className={"split"}>
        <div>
          <h3>{"Progress"}</h3>
          <b className={"display num"} style={css({ fontSize: "34px", display: "block" })}>
            <span data-count={String(panel.answered)} data-done={"1"}>
              {String(panel.answered)}
            </span>
            {` of ${panel.total}`}
          </b>
          <small className={"mu"}>
            <Joined parts={panel.by} />
          </small>
          <div className={"meter"}>
            <i style={css({ width: `${panel.percent}%` })}></i>
          </div>
        </div>
        <div>
          <h3>{"Sections"}</h3>
          <div className={"rank"}>
            {panel.sections.map((section) => (
              <div key={section.label}>
                <span style={css({ flex: "1" })}>{section.label}</span>
                <Badge badge={section.badge} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>{"Answer versions"}</h3>
          <p className={"mu"} style={css({ fontSize: "14px" })}>
            {panel.versions}
          </p>
        </div>
      </div>
    </div>
  );
}

function ReviewTable({ rows, index, data }: { rows: IntakeReviewRow[]; index: number; data: MatterIntakeData }) {
  return (
    <div className={"tw rv"} style={css({ "--i": String(index) })}>
      <table className={"t"}>
        <thead>
          <tr>
            <th style={css({ paddingLeft: "18px" })}>{"Question"}</th>
            <th>{"Answer"}</th>
            <th>{"Source"}</th>
            <th>{"State"}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td style={css({ paddingLeft: "18px" })}>{row.question}</td>
              <td>{row.answer}</td>
              <td className={"mu"}>
                <Joined parts={row.source} />
              </td>
              <td>
                <Badge badge={row.badge} />
              </td>
              <td>{row.answerId ? <Fuse row={row} organizationId={data.organizationId} reviewer={data.reviewer} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatterIntake({ data }: { data: MatterIntakeData }) {
  if (data.panels.length === 0) {
    return (
      <>
        <div className={"panel rv"} style={css({ "--i": "0" })}>
          <Empty
            art={"clients-empty"}
            title={"No intake form sent yet"}
            copy={data.send ? (data.send.forms.length ? "Send a published form to someone on this matter. They answer it in their portal; answers appear here as they save." : "Publish a form on the Intake form builder first, then send it from here.") : "When someone on the team sends a form, the client’s answers appear here."}
          >
            {data.send && data.send.forms.length ? (
              <button className={"btn p sm"} data-open={INTAKE_SEND_DIALOG}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Send a form"}
              </button>
            ) : null}
          </Empty>
        </div>
        {data.send ? <IntakeSendDialog data={data.send} /> : null}
      </>
    );
  }
  let index = 0;
  return (
    <>
      {data.panels.map((panel, at) => (
        <Fragment key={panel.responseId}>
          <Questionnaire panel={panel} index={index++} data={data} first={at === 0} />
          {panel.rows.length ? (
            <>
              <h3 className={"sub rv"} style={css({ "--i": String(index++) })}>
                {panel.submitted ? "Needs your review" : "Answers so far"}
              </h3>
              <ReviewTable rows={panel.rows} index={index++} data={data} />
            </>
          ) : null}
        </Fragment>
      ))}
      <p className={"note rv"} style={css({ "--i": String(index) })}>
        <Icon name={"lock"} cls={"ic s"} />
        {data.note}
      </p>
      {data.send ? <IntakeSendDialog data={data.send} /> : null}
    </>
  );
}

/**
 * "Send a form": the Designer has no send dialog, so this is built from its dialog parts as Request
 * a document is (`.dlg wide`, `.dh`/`.db`/`.df`, `.g2` of `.fld`, the sample-mode `.alert warn`,
 * the `.lock` note). Saving is wired in intake-delivery-acts (`data-intake-send`).
 */
export function IntakeSendDialog({ data }: { data: IntakeSendDialogData }) {
  const none = data.people.length === 0 || data.forms.length === 0;
  return (
    <dialog className={"dlg wide"} id={INTAKE_SEND_DIALOG} aria-labelledby={"dIntakeSendT"}>
      <div className={"dh"}>
        <h2 id={"dIntakeSendT"}>{"Send a form"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={INTAKE_SEND_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        {data.sampleMode ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"This firm is in sample mode"}</b>
              {"Only sample matters accept new work until sample mode is turned off. The firm will refuse this one."}
            </div>
          </div>
        ) : null}
        {data.forms.length === 0 ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"No published form yet"}</b>
              {"Publish a form on the Intake form builder first."}
            </div>
          </div>
        ) : null}
        <div className={"g2"}>
          <div className={"fld"}>
            <label htmlFor={"isF"}>{"Form"}</label>
            <select className={"sel"} id={"isF"} defaultValue={data.forms[0]?.id}>
              {data.forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.label}
                </option>
              ))}
            </select>
            <span className={"hint"}>{"The published version is sent. A later version doesn’t change what they already have."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"isP"}>{"Who it’s for"}</label>
            <select className={"sel"} id={"isP"} defaultValue={data.people[0]?.id}>
              {data.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
            <span className={"hint"}>{"They answer it in their portal. Others on the matter don’t see their answers."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"isD"}>{"Due on (optional)"}</label>
            <input className={"inp"} id={"isD"} type={"date"} min={data.today} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"isM"}>{"Message (optional)"}</label>
            <textarea className={"ta"} id={"isM"} maxLength={2000} placeholder={"Shown above the questions in their portal."}></textarea>
          </div>
        </div>
        <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
          <Icon name={"info"} cls={"ic s"} />
          {"It appears in their portal as a task. No email is sent: Casevoya has no approved email for this yet."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={INTAKE_SEND_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-intake-send={"1"} data-org={data.organizationId} data-matter={data.matterId} {...(none ? { disabled: true } : {})}>
          {"Send"}
        </button>
      </div>
    </dialog>
  );
}
