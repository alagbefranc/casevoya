/**
 * Compliance > Privacy requests (SEC-05, SEC-06). Same DOM, classes and order as the captured
 * Designer markup (`markup/privacy.tsx`): the requests table, the selected request's steps and
 * notes, its worklist panel and its "Deadline and delivery" panel. Live controls carry data
 * attributes (`data-dlg`, `data-privacy-*`) that use-sheet wires to the database; the Designer's
 * own sample buttons carry its `data-toast` attributes, given only by the fidelity test.
 */
import {
  Actions,
  ComplianceHeader,
  Dialog,
  DlRows,
  EmptyPanel,
  Heading,
  LineText,
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

export type PrivacyRow = {
  ref: string;
  person: string;
  type: Line;
  received: string;
  /** Null shows the Designer's dash. */
  due: string | null;
  state: StateBadge;
  /** Live: opening the row selects it (`?view=<id>`). */
  href?: string;
};

export type WorkCell = { text: Line } | { badge: StateBadge };
export type WorkRow = { cells: WorkCell[]; attrs?: Attrs };

/** The left panel of the second row: the redaction worklist, or what a request touches. */
export type Worklist = {
  icon: string;
  title: Line;
  label: string;
  columns: string[];
  rows: WorkRow[];
  /** Shown as one full-width row when there are no rows. */
  empty?: string;
};

export type PrivacySelected = {
  title: Line;
  steps: Step[];
  notes: string[];
  worklist: Worklist | null;
  deadline: { rows: DlRow[]; actions: Action[] };
};

export type PrivacyData = {
  /** Null: this person can't see privacy requests; the page explains who can. */
  rows: PrivacyRow[] | null;
  selected: PrivacySelected | null;
};

export type PrivacyHeaderData = { pills: string[]; actions: Action[] };

const COPY =
  "Requests to see or correct personal information. Each firm handles its own; closing someone’s login never erases the firm’s professional record.";

export function PrivacyHeader({ data }: { data: PrivacyHeaderData }) {
  return <ComplianceHeader icon={"privacy"} title={"Privacy requests"} pills={data.pills} actions={data.actions} />;
}

function RequestsTable({ rows }: { rows: PrivacyRow[] }) {
  return (
    <div className={"tw rv"} role={"region"} aria-label={"Privacy requests"} tabIndex={0} style={i(1)}>
      <table className={"t"}>
        <caption className={"sr"}>{"Privacy requests"}</caption>
        <thead>
          <tr>
            {["Ref", "Person", "Type", "Received", "Due", "State"].map((label) => (
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
              <td>{row.person}</td>
              <td>
                <LineText line={row.type} />
              </td>
              <td>{row.received}</td>
              <td>{row.due ? <span className={"num"}>{row.due}</span> : "—"}</td>
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

function WorklistPanel({ data }: { data: Worklist }) {
  return (
    <section className={"panel"}>
      <PanelTitle icon={data.icon} title={data.title} />
      <div className={"tw"} role={"region"} aria-label={data.label} tabIndex={0}>
        <table className={"t"}>
          <caption className={"sr"}>{data.label}</caption>
          <thead>
            <tr>
              {data.columns.map((label) => (
                <th key={label} scope={"col"}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && data.empty ? (
              <tr>
                <td colSpan={data.columns.length}>{data.empty}</td>
              </tr>
            ) : (
              data.rows.map((row, index) => (
                <tr key={index} {...row.attrs}>
                  {row.cells.map((cell, at) => (
                    <td key={at}>{"badge" in cell ? <StateBadgeView badge={cell.badge} /> : <LineText line={cell.text} />}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SheetPrivacy({ data }: { data: PrivacyData }) {
  const selected = data.selected;
  return (
    <>
      <Heading art={"privacy-shield"} title={"Privacy requests"} copy={COPY} />
      {data.rows === null ? (
        <EmptyPanel
          n={1}
          art={"privacy-shield"}
          title={"Privacy requests are limited"}
          copy={"The firm owner, licensed consultants and case managers handle privacy requests. Ask one of them."}
        />
      ) : data.rows.length === 0 ? (
        <EmptyPanel
          n={1}
          art={"privacy-shield"}
          title={"No privacy requests"}
          copy={"When someone asks to see, correct or delete their information, or withdraws a consent, record it here. It starts with checking who they are."}
        />
      ) : (
        <RequestsTable rows={data.rows} />
      )}
      {selected ? (
        <>
          <div className={"fp-g2 rv"} style={i(2)}>
            <div>
              <section className={"panel"}>
                <PanelTitle icon={"privacy"} title={selected.title} />
                <div className={"fp-pad"}>
                  <Steps steps={selected.steps} />
                </div>
              </section>
            </div>
            <div>
              <section className={"panel"}>
                <PanelTitle icon={"note"} title={"Notes"} />
                <div className={"fp-pad"}>
                  {selected.notes.map((note) => (
                    <p key={note} style={{ fontSize: "14.5px" }}>
                      {note}
                    </p>
                  ))}
                </div>
              </section>
            </div>
          </div>
          <div className={"fp-g2 rv"} style={{ marginTop: "6px", ...i(3) }}>
            {selected.worklist ? (
              <div>
                <WorklistPanel data={selected.worklist} />
              </div>
            ) : null}
            <div>
              <section className={"panel"}>
                <PanelTitle icon={"clock"} title={"Deadline and delivery"} />
                <div className={"fp-pad"}>
                  <DlRows rows={selected.deadline.rows} />
                  <Actions actions={selected.deadline.actions} />
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Live dialogs (the Designer has no privacy dialogs; these use its `.dlg` parts)
// ---------------------------------------------------------------------------

export type PrivacyDialogsData = {
  organizationId: string;
  /** Record a request (#dlgPR). Null when this person can't record one. */
  record: null | {
    today: string;
    people: (readonly [string, string])[];
    matters: (readonly [string, string])[];
    handlers: (readonly [string, string])[];
    me: string;
  };
  /** The selected request's next step (#dlgPStep). */
  step: null | { requestId: string; step: string; title: string; label: string; hint: string };
  /** Add or edit a redaction line (#dlgPRed). */
  redaction: null | { requestId: string; reference: string };
  /** Close the selected request (#dlgPClose). */
  close: null | {
    requestId: string;
    reference: string;
    outcomes: (readonly [string, string])[];
    consents: (readonly [string, string])[] | null;
    note: string;
  };
  /** The firm's response target (#dlgPS), for the firm owner. */
  settings: null | { days: string };
};

export const PRIVACY_DIALOG = { record: "dlgPR", step: "dlgPStep", redaction: "dlgPRed", close: "dlgPClose", settings: "dlgPS" } as const;

export const PRIVACY_KINDS = [
  ["access", "Access to their records"],
  ["correction", "Correction"],
  ["consent_withdrawal", "Withdraw a consent"],
  ["deletion", "Deletion request"],
] as const;

export const COMPLIANCE_CHANNELS = [
  ["email", "Email"],
  ["phone", "Phone"],
  ["letter", "Letter"],
  ["in_person", "In person"],
  ["portal", "Client portal message"],
  ["other", "Other"],
] as const;

export const REDACTION_STATES = [
  ["to_do", "To do"],
  ["redacted", "Redacted"],
  ["excluded", "Excluded (not about them)"],
  ["kept", "Kept, reviewed"],
] as const;

export function PrivacyDialogs({ data }: { data: PrivacyDialogsData }) {
  const org = data.organizationId;
  return (
    <>
      {data.record ? (
        <Dialog
          id={PRIVACY_DIALOG.record}
          title={"Record a privacy request"}
          fields={
            [
              { kind: "select", id: "prK", label: "Type", options: PRIVACY_KINDS },
              { kind: "text", id: "prN", label: "Requester", max: 200 },
              { kind: "select", id: "prP", label: "Client record", options: [["none", "Not linked"], ...data.record.people] },
              { kind: "select", id: "prM", label: "Matter", options: [["none", "Not linked"], ...data.record.matters] },
              { kind: "select", id: "prC", label: "How it arrived", options: COMPLIANCE_CHANNELS },
              { kind: "area", id: "prD", label: "What they asked for", max: 2000 },
              { kind: "text", id: "prR", label: "Received", value: data.record.today, placeholder: "DD/MM/YYYY" },
              { kind: "select", id: "prA", label: "Handled by", options: data.record.handlers, value: data.record.me },
            ] satisfies Field[]
          }
          save={{ label: "Save", attrs: { "data-privacy-new": "1", "data-org": org } }}
          note={"Next, check who they are before you search or share anything."}
        />
      ) : null}
      {data.step ? (
        <Dialog
          id={PRIVACY_DIALOG.step}
          title={data.step.title}
          fields={[{ kind: "area", id: "psN", label: data.step.label, max: 2000 }]}
          save={{ label: "Save", attrs: { "data-privacy-step": data.step.step, "data-request": data.step.requestId, "data-org": org } }}
          note={data.step.hint}
        />
      ) : null}
      {data.redaction ? (
        <Dialog
          id={PRIVACY_DIALOG.redaction}
          title={`Redaction line · ${data.redaction.reference}`}
          fields={[
            { kind: "text", id: "rdR", label: "Record", max: 200 },
            { kind: "text", id: "rdT", label: "Third party", max: 200 },
            { kind: "text", id: "rdW", label: "What’s removed", max: 500 },
            { kind: "select", id: "rdS", label: "State", options: REDACTION_STATES },
          ]}
          save={{ label: "Save", attrs: { "data-privacy-redaction": data.redaction.requestId, "data-org": org } }}
        />
      ) : null}
      {data.close ? (
        <Dialog
          id={PRIVACY_DIALOG.close}
          title={`Close ${data.close.reference}`}
          fields={[
            { kind: "select", id: "pcO", label: "Outcome", options: data.close.outcomes },
            ...(data.close.consents ? [{ kind: "select", id: "pcK", label: "Consent withdrawn", options: [["none", "None"], ...data.close.consents] } satisfies Field] : []),
            { kind: "text", id: "pcD", label: "Delivered by", placeholder: "Portal download, email, by hand", max: 200 },
            { kind: "area", id: "pcE", label: "Evidence of what was done", max: 2000 },
            { kind: "area", id: "pcR", label: "Reason for refusing (if refused)", max: 2000 },
            { kind: "area", id: "pcN", label: "Note", max: 2000 },
          ]}
          save={{ label: "Close request", attrs: { "data-privacy-close": data.close.requestId, "data-org": org } }}
          note={data.close.note}
        />
      ) : null}
      {data.settings ? (
        <Dialog
          id={PRIVACY_DIALOG.settings}
          title={"Response target"}
          fields={[{ kind: "text", id: "psD", label: "Days from receipt (your firm’s target)", value: data.settings.days, placeholder: "Leave blank for none", max: 3 }]}
          save={{ label: "Save", attrs: { "data-compliance-settings": "privacy", "data-org": org } }}
          note={"This is your firm’s own target, shown as a due date on new requests. Casevoya doesn’t set a legal deadline. Saving asks you to confirm it’s you."}
        />
      ) : null}
    </>
  );
}
