/**
 * The Designer's Client-file exports page (`markup/exports.tsx`), rendered from the firm's export
 * jobs (T040). Same DOM, classes and order as the capture.
 *
 * Live-only additions (absent when the Designer's own values are given): `data-export-act` on New
 * export, Cancel, a ready job's Download and a ready history row (use-sheet runs them against
 * /api/exports); the dialog's Matter field (the Designer's own `.fld`/`.sel`) when no matter is
 * chosen yet; an empty state when nothing has been exported; and the contents note in words that
 * match what an export holds.
 */
import type { CSSProperties } from "react";
import { Empty, Icon, Sep } from "./frame";

export type ExportJobStep = { label: string; state: "done" | "now" | "todo"; time: string };
export type ExportState = { tone: "blue" | "ok" | "bad" | "gr"; label: string; detail?: string };

export type ExportJob = {
  title: [string, string, string];
  steps: ExportJobStep[];
  progress: number;
  /** Cancel while building (Designer: toasts), or Download once ready. */
  action:
    | { kind: "cancel"; toast?: { label: string; sub: string }; attrs?: Record<string, string> }
    | { kind: "download"; attrs: Record<string, string> };
};

export type ExportRow = {
  key: string;
  started: string;
  matter: string;
  by: string;
  files: string;
  size: string;
  state: ExportState;
  attrs?: Record<string, string>;
};

export type ExportsHeaderData = { newAttrs?: Record<string, string> };

export type ExportsDialogData = {
  /** Matters the person can export, when the page wasn't opened for one. Live only. */
  matters?: { value: string; label: string }[] | null;
  /** The live Confirm button's attributes; without them it toasts as in the capture. */
  confirm?: Record<string, string> | null;
};

export type ExportsData = {
  header: ExportsHeaderData;
  job: ExportJob | null;
  rows: ExportRow[];
  note: string;
  dialog: ExportsDialogData;
};

const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;

export function ExportsHeader({ data }: { data: ExportsHeaderData }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"privacy"} cls={"ic s"} />
        {"Compliance"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"cs"} aria-hidden={"true"}>
        {"/"}
      </span>
      <button className={"crumb"}>
        <Icon name={"download"} cls={"ic s"} />
        {"Client-file exports"}
      </button>
      <span className={"pill"}>{"Links expire after 24 hours"}</span>
      <span className={"acts"}>
        <button className={"btn p sm"} data-dlg={"dlgX"} data-fpd={"1"} {...data.newAttrs}>
          <Icon name={"plus"} cls={"ic s"} />
          {"New export"}
        </button>
      </span>
    </header>
  );
}

function Pair3({ parts }: { parts: [string, string, string] }) {
  return (
    <span>
      {`${parts[0]} `}
      <Sep />
      {` ${parts[1]} `}
      <Sep />
      {` ${parts[2]}`}
    </span>
  );
}

function Job({ job }: { job: ExportJob }) {
  return (
    <div className={"panel rv"} style={i(1)}>
      <div className={"fp-pad"}>
        <h3 style={{ fontSize: "15px", fontWeight: "500", marginBottom: "10px" }}>
          <Pair3 parts={job.title} />
        </h3>
        <div className={"job"}>
          {job.steps.map((step) => (
            <div key={step.label} className={step.state === "todo" ? undefined : step.state}>
              <span className={"st"}>{step.state === "done" ? <Icon name={"check-circle"} cls={"ic s"} /> : null}</span>
              <span>{step.label}</span>
              <small>{step.time}</small>
            </div>
          ))}
        </div>
        <div className={"prog"} style={{ marginTop: "12px" }}>
          <i style={{ width: `${job.progress}%` }}></i>
        </div>
        {job.action.kind === "cancel" ? (
          <button
            className={"btn sm"}
            style={{ marginTop: "12px" }}
            data-toast={job.action.toast?.label}
            data-toast-sub={job.action.toast?.sub}
            {...job.action.attrs}
          >
            {"Cancel"}
          </button>
        ) : (
          <button className={"btn sm"} style={{ marginTop: "12px" }} {...job.action.attrs}>
            {"Download"}
          </button>
        )}
      </div>
    </div>
  );
}

function State({ state }: { state: ExportState }) {
  return (
    <span className={`bd ${state.tone}`}>
      <i></i>
      {state.detail ? (
        <span>
          {`${state.label} `}
          <Sep />
          {` ${state.detail}`}
        </span>
      ) : (
        state.label
      )}
    </span>
  );
}

export function SheetExports({ data }: { data: ExportsData }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/migration-box-320@1x.webp"}
            srcSet={"/assets/generated/b2/migration-box-320@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{"Client-file exports"}</h1>
          <p>{"A full copy of a client’s file, with the audit trail. Starting one asks you to confirm it’s you."}</p>
        </div>
      </div>
      {data.job ? <Job job={data.job} /> : null}
      {data.rows.length ? (
        <div className={"tw rv"} role={"region"} aria-label={"Export history"} tabIndex={0} style={i(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Export history"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Started"}</th>
                <th scope={"col"}>{"Matter"}</th>
                <th scope={"col"}>{"By"}</th>
                <th scope={"col"}>{"Files"}</th>
                <th scope={"col"}>{"Size"}</th>
                <th scope={"col"}>{"State"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key} {...row.attrs}>
                  <td>{row.started}</td>
                  <td>{row.matter}</td>
                  <td>{row.by}</td>
                  <td>{row.files}</td>
                  <td>{row.size}</td>
                  <td>
                    <State state={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={"panel rv"} style={i(2)}>
          <Empty art={"migration-box"} title={"No exports yet"} copy={"Start one with New export. Each export is listed here with who made it and when."} />
        </div>
      )}
      <div className={"panel rv"} style={{ marginTop: "6px", "--i": "3" } as CSSProperties}>
        <div className={"fp-pad"} style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <img
            src={"/assets/docs/client-file-export-600.webp"}
            alt={"Contents of a client-file export: documents, agreements, invoices and receipts, messages, tasks and audit trail folders"}
            width={160}
            style={{ borderRadius: "8px", border: "1px solid var(--line)" }}
          />
          <p className={"fp-note"} style={{ margin: "0" }}>
            {data.note}
          </p>
        </div>
      </div>
    </>
  );
}

/** The Designer's "Confirm it's you" dialog. Live, it also asks which matter (when not chosen) and starts or downloads. */
export function ExportsDialog({ data }: { data: ExportsDialogData }) {
  const live = Boolean(data.confirm);
  return (
    <dialog className={"dlg"} id={"dlgX"} aria-labelledby={"dlgXH"}>
      <div className={"dh"}>
        <h2 id={"dlgXH"}>{"Confirm it’s you"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgX"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{"Exports contain a whole client file. Enter the code from your authenticator app."}</p>
        {data.matters ? (
          <div className={"fld"} data-export-matter-field={"1"}>
            <label htmlFor={"xM"}>{"Matter"}</label>
            <select className={"sel"} id={"xM"}>
              {data.matters.map((matter) => (
                <option key={matter.value} value={matter.value}>
                  {matter.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"xC"}>{"Six-digit code"}</label>
          <input className={"inp"} id={"xC"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} />
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgX"}>
          {"Cancel"}
        </button>
        <button
          className={"btn p"}
          data-close={live ? undefined : "dlgX"}
          data-toast={live ? undefined : "Export started"}
          data-toast-sub={live ? undefined : "We’ll notify you when it’s ready."}
          data-toast-kind={live ? undefined : "ok"}
          {...data.confirm}
        >
          {"Confirm and export"}
        </button>
      </div>
    </dialog>
  );
}
