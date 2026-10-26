/**
 * Reports > Scheduled (REP-03), live parts. The Designer's Scheduled tab has the table but no way
 * to make or manage a schedule, so these are built from its parts (`.btn`, `.acts`, `.fp-note`,
 * `.dlg`, `.dh`, `.db`, `.fld`, `.inp`, `.sel`, `.check`, `.why`, `.df`): a New schedule button,
 * each row's actions (Edit, Pause or Resume, Run now (test), Delete), the last sends (counts only)
 * and the schedule dialog. Absent when the Designer's own sample values are rendered.
 */
import type { CSSProperties } from "react";
import { Icon } from "./frame";
import { PERIOD_LABEL, WEEKDAYS, type ScheduleDialogData, type ScheduledLive, type ScheduledRowLive } from "@/modules/sheet/scheduled-reports-present";

export const SCHEDULE_DIALOG = "dlgSched";

export function ScheduledNewButton({ live }: { live: ScheduledLive }) {
  if (!live.canCreate) return null;
  return (
    <button className={"btn p sm"} data-sched-act={"new"} data-org={live.organizationId} data-self={live.selfUserId ?? undefined}>
      <Icon name={"plus"} cls={"ic s"} />
      {"New schedule"}
    </button>
  );
}

export function ScheduledActionsHead() {
  return (
    <th scope={"col"}>
      <span className={"sr"}>{"Actions"}</span>
    </th>
  );
}

export function ScheduledRowActions({ row, organizationId }: { row: ScheduledRowLive; organizationId: string }) {
  if (!row.canEdit) {
    return (
      <td style={{ textAlign: "right" }}>
        <span className={"mu"}>{"Made by a colleague"}</span>
      </td>
    );
  }
  const common = { "data-org": organizationId, "data-sched-id": row.id };
  return (
    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      <button className={"btn sm"} data-sched-act={"edit"} data-sched={row.form} {...common}>
        {"Edit"}
      </button>{" "}
      <button className={"btn sm"} data-sched-act={row.paused ? "resume" : "pause"} {...common}>
        {row.paused ? "Resume" : "Pause"}
      </button>{" "}
      <button className={"btn sm"} data-sched-act={"test"} {...common} title={"Sends the link to the recipients now. The next scheduled send doesn’t change."}>
        {"Run now (test)"}
      </button>{" "}
      <button className={"btn sm"} data-sched-act={"delete"} {...common}>
        {"Delete"}
      </button>
    </td>
  );
}

export function ScheduledNotes({ live, n }: { live: ScheduledLive; n: number }) {
  return (
    <>
      {live.error ? (
        <p className={"fp-note rv"} role={"alert"} style={{ "--i": String(n) } as CSSProperties}>
          {live.error}
        </p>
      ) : null}
      {live.runs.map((line, index) => (
        <p key={index} className={"fp-note rv"} style={{ "--i": String(n) } as CSSProperties}>
          {line}
        </p>
      ))}
      <p className={"fp-note rv"} style={{ "--i": String(n) } as CSSProperties}>
        {live.note}
      </p>
    </>
  );
}

export function ScheduleReportDialog({ data }: { data: ScheduleDialogData }) {
  return (
    <dialog className={"dlg"} id={SCHEDULE_DIALOG} aria-labelledby={"dlgSchedH"} data-org={data.organizationId}>
      <div className={"dh"}>
        <h2 id={"dlgSchedH"}>{"Schedule a report"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={SCHEDULE_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"srN"}>{"Name"}</label>
          <input className={"inp"} id={"srN"} type={"text"} maxLength={120} autoComplete={"off"} placeholder={"For example: Monday workload"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"srT"}>{"Report"}</label>
          <select className={"sel"} id={"srT"} data-sched-tab={""}>
            {data.tabs.map((tab) => (
              <option key={tab.value} value={tab.value}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"srR"}>{"Period"}</label>
          <select className={"sel"} id={"srR"}>
            {(["90d", "month", "year"] as const).map((key) => (
              <option key={key} value={key}>
                {PERIOD_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"srF"}>{"Every"}</label>
          <select className={"sel"} id={"srF"} data-sched-freq={""}>
            <option value={"weekly"}>{"Week"}</option>
            <option value={"monthly"}>{"Month"}</option>
          </select>
        </div>
        <div className={"fld"} data-sched-when={"weekly"}>
          <label htmlFor={"srW"}>{"Day"}</label>
          <select className={"sel"} id={"srW"}>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={String(index + 1)}>
                {day}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"} data-sched-when={"monthly"} hidden>
          <label htmlFor={"srD"}>{"Day of the month"}</label>
          <select className={"sel"} id={"srD"}>
            {Array.from({ length: 28 }, (_, index) => (
              <option key={index} value={String(index + 1)}>
                {String(index + 1)}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"srH"}>{"Time"}</label>
          <input className={"inp"} id={"srH"} type={"time"} step={300} defaultValue={"08:00"} aria-describedby={"srH-h"} />
          <span className={"hint"} id={"srH-h"}>{`In the firm’s timezone, ${data.timezone}.`}</span>
        </div>
        <fieldset className={"fld"} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>{"Recipients"}</legend>
          {data.staff.map((person) => (
            <label key={person.userId} className={"check"} data-sched-person={person.tabs.join(" ")}>
              <input type={"checkbox"} value={person.userId} data-sched-recipient={""} />
              <span>{person.name}</span>
            </label>
          ))}
          <span className={"hint"}>{"Staff of this firm whose role sees the chosen report."}</span>
        </fieldset>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Recipients are checked again at every send; anyone who has left or can no longer see this report is skipped. They get a link in Casevoya, never the report itself."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={SCHEDULE_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-sched-act={"save"} data-org={data.organizationId}>
          {"Save schedule"}
        </button>
      </div>
    </dialog>
  );
}
