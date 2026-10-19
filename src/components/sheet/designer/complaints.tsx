/**
 * Compliance > Complaints (ADM-05): the firm's complaints register. Same DOM, classes and order as
 * the captured Designer markup (`markup/complaints.tsx`): the register table, the selected
 * complaint's milestones, its "Evidence and hold" panel and the Record a complaint dialog
 * (#dlgC). Live-only additions (milestone buttons, the extra dialog fields, the escalation row)
 * use the Designer's own parts and appear only when the data carries them.
 */
import { Icon } from "./frame";
import {
  Actions,
  ComplianceHeader,
  Dialog,
  DlRows,
  EmptyPanel,
  FieldView,
  Heading,
  PanelTitle,
  StateBadgeView,
  Steps,
  i,
  type Action,
  type Attrs,
  type DlRow,
  type Field,
  type Line,
  type StateBadge,
  type Step,
} from "./compliance";

export type ComplaintRow = {
  ref: string;
  complainant: string;
  matter: string;
  issue: string;
  received: string;
  owner: string;
  next: string;
  state: StateBadge;
  href?: string;
};

export type ComplaintSelected = {
  title: Line;
  steps: Step[];
  rows: DlRow[];
  actions: Action[];
};

export type ComplaintsData = {
  firmName: string;
  /** Null: this person isn't a designated complaint handler; the page says so. */
  rows: ComplaintRow[] | null;
  selected: ComplaintSelected | null;
};

export type ComplaintsHeaderData = { pills: string[]; actions: Action[] };

export function ComplaintsHeader({ data }: { data: ComplaintsHeaderData }) {
  return <ComplianceHeader icon={"flag"} title={"Complaints"} pills={data.pills} actions={data.actions} />;
}

function Register({ rows }: { rows: ComplaintRow[] }) {
  return (
    <div className={"tw rv"} role={"region"} aria-label={"Complaints register"} tabIndex={0} style={i(1)}>
      <table className={"t"}>
        <caption className={"sr"}>{"Complaints register"}</caption>
        <thead>
          <tr>
            {["Ref", "Complainant", "Matter", "Issue", "Received", "Owner", "Next milestone", "State"].map((label) => (
              <th key={label} scope={"col"}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ref} data-href={row.href}>
              <td>{row.ref}</td>
              <td>{row.complainant}</td>
              <td>{row.matter}</td>
              <td>{row.issue}</td>
              <td>{row.received}</td>
              <td>{row.owner}</td>
              <td>{row.next}</td>
              <td>
                <StateBadgeView badge={row.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SheetComplaints({ data }: { data: ComplaintsData }) {
  const selected = data.selected;
  return (
    <>
      <Heading
        art={"complaints-empty"}
        title={"Complaints"}
        copy={`Complaints about ${data.firmName}’s professional service. Problems with the Casevoya software go to Casevoya support instead.`}
      />
      {data.rows === null ? (
        <EmptyPanel
          n={1}
          art={"complaints-empty"}
          title={"Only designated staff see complaints"}
          copy={"The firm owner chooses who handles complaints. Ask them if you need access."}
        />
      ) : data.rows.length === 0 ? (
        <EmptyPanel
          n={1}
          art={"complaints-empty"}
          title={"No complaints recorded"}
          copy={"Record a complaint about the firm’s service when one arrives, by any channel. Each one is acknowledged, reviewed, answered and resolved here."}
        />
      ) : (
        <Register rows={data.rows} />
      )}
      {selected ? (
        <div className={"fp-g2 rv"} style={{ marginTop: "6px", ...i(2) }}>
          <div>
            <section className={"panel"}>
              <PanelTitle icon={"flag"} title={selected.title} />
              <div className={"fp-pad"}>
                <Steps steps={selected.steps} />
              </div>
            </section>
          </div>
          <div>
            <section className={"panel"}>
              <PanelTitle icon={"shield"} title={"Evidence and hold"} />
              <div className={"fp-pad"}>
                <DlRows rows={selected.rows} />
                <Actions actions={selected.actions} />
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export type ComplaintDialogData = {
  /** The "About" choices: the firm's professional service, or the Casevoya software. */
  about: (readonly [string, string])[];
  received: string;
  save: Attrs;
  /** Live-only fields, after the Designer's four. */
  more?: Field[];
};

/** The Designer's Record a complaint dialog (#dlgC). */
export function ComplaintDialog({ data }: { data: ComplaintDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgC"} aria-labelledby={"dlgCH"}>
      <div className={"dh"}>
        <h2 id={"dlgCH"}>{"Record a complaint"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgC"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <FieldView field={{ kind: "select", id: "cK", label: "About", options: data.about }} />
        <div className={"fld"}>
          <label htmlFor={"cW"}>{"Complainant"}</label>
          <input className={"inp"} id={"cW"} type={"text"} defaultValue={""} placeholder={""} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"cI"}>{"Issue"}</label>
          <textarea className={"ta"} id={"cI"}></textarea>
        </div>
        <div className={"fld"}>
          <label htmlFor={"cD"}>{"Received"}</label>
          <input className={"inp"} id={"cD"} type={"text"} defaultValue={data.received} placeholder={""} />
        </div>
        {(data.more ?? []).map((field) => (
          <FieldView key={field.id} field={field} />
        ))}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgC"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...data.save}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}

export type ComplaintsDialogsData = {
  organizationId: string;
  record: ComplaintDialogData | null;
  /** The selected complaint's next milestone (#dlgCStep). */
  step: null | { complaintId: string; step: string; title: string; dated: boolean; today: string; label: string; note?: string };
  /** The firm owner's settings (#dlgCS): targets, escalation path, handlers. */
  settings: null | { ackDays: string; responseDays: string; escalation: string; staff: (readonly [string, string])[]; handlers: string[] };
};

export const COMPLAINT_DIALOG = { record: "dlgC", step: "dlgCStep", settings: "dlgCS" } as const;

export const COMPLAINT_CATEGORIES = [
  ["fees_billing", "Fees or billing"],
  ["communication", "Communication"],
  ["service_quality", "Quality of service"],
  ["conduct", "Professional conduct"],
  ["privacy", "Privacy"],
  ["other", "Other"],
] as const;

export function ComplaintsDialogs({ data }: { data: ComplaintsDialogsData }) {
  const org = data.organizationId;
  return (
    <>
      {data.record ? <ComplaintDialog data={data.record} /> : null}
      {data.step ? (
        <Dialog
          key={`${data.step.complaintId}-${data.step.step}`}
          id={COMPLAINT_DIALOG.step}
          title={data.step.title}
          fields={[
            ...(data.step.dated ? [{ kind: "text", id: "csD", label: "Date", value: data.step.today, placeholder: "DD/MM/YYYY" } satisfies Field] : []),
            { kind: "area", id: "csN", label: data.step.label, max: 2000 },
          ]}
          save={{ label: "Save", attrs: { "data-complaint-step": data.step.step, "data-complaint": data.step.complaintId, "data-org": org } }}
          note={data.step.note}
        />
      ) : null}
      {data.settings ? (
        <Dialog
          id={COMPLAINT_DIALOG.settings}
          title={"Complaint settings"}
          fields={[
            { kind: "select", id: "chH", label: "Who handles complaints (with the firm owner)", options: data.settings.staff, multiple: true, values: data.settings.handlers },
            { kind: "text", id: "chA", label: "Acknowledge within (days, your firm’s target)", value: data.settings.ackDays, placeholder: "Leave blank for none", max: 2 },
            { kind: "text", id: "chR", label: "Respond within (days, your firm’s target)", value: data.settings.responseDays, placeholder: "Leave blank for none", max: 3 },
            { kind: "area", id: "chE", label: "Escalation path (your firm’s own words)", value: data.settings.escalation, max: 2000 },
          ]}
          save={{ label: "Save", attrs: { "data-compliance-settings": "complaints", "data-org": org } }}
          note={"Targets are your firm’s own, not legal deadlines. Write the escalation path the way you tell clients; Casevoya doesn’t supply one. Saving asks you to confirm it’s you."}
        />
      ) : null}
    </>
  );
}
