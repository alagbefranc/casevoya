/**
 * DEC-02: the Decisions tab's Expiry and renewal card, its official IRCC timings and its dialogs.
 * The Designer has no screen for them, so each is built from the Designer's own parts on this tab,
 * as the Submission checklist card is: a `.panel` with an `h2` and `.r` badge, `.li` record rows
 * with a dot, `<b>` and `<small>` with `.sep` separators, `.why` and `.mu` notes, `.btn s sm`
 * buttons, and the `.dlg wide` dialog (`.dh`, `.db`, `.g2` of `.fl` fields, `.df`). Every value
 * comes from the firm's records; an IRCC timing or fee shows its source next to it.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, Sep } from "./frame";
import { PageAttestFields } from "./page-attestation";

const css = (style: Record<string, string>) => style as CSSProperties;

export type RenewalWire = Record<`data-${string}`, string>;
type Badge = { tone: string; label: string };
type Source = { href: string; text: string; facts: string[] };
type Option = { value: string; label: string };

export type RenewalRowView = {
  id: string;
  title: string;
  parts: string[];
  basis: { text: string; source: Source | null };
  client: string[];
  fee: { text: string; href: string | null } | null;
  lead: { href: string; label: string } | null;
  badge: Badge;
  dot: string;
  set: RenewalWire | null;
  cancel: RenewalWire | null;
};

export type RenewalPanelData = {
  badge: Badge;
  intro: string;
  contact: { allowed: boolean; text: string };
  rows: RenewalRowView[];
  empty: string | null;
  timings: { label: string; source: Source; retire: RenewalWire | null }[];
  timingsEmpty: string | null;
  pending: { label: string; source: Source; badge: Badge; approve: RenewalWire | null; reject: RenewalWire | null }[];
  actions: { record: RenewalWire | null; timing: RenewalWire | null };
  dialogs: {
    expiry: { wire: RenewalWire; today: string; files: { id: string; label: string }[]; timings: Option[] } | null;
    set: { wire: RenewalWire; client: string; fees: Option[] } | null;
    cancel: { wire: RenewalWire } | null;
    timing: { wire: RenewalWire; program: { key: string; label: string } | null; today: string } | null;
    reject: { wire: RenewalWire } | null;
    retire: { wire: RenewalWire } | null;
    /** Approve a timing without a page snapshot: the reviewer's attestation (2026-10-24). Optional for fidelity samples. */
    attest?: { wire: RenewalWire; today: string } | null;
  };
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

function Dot({ color }: { color: string }) {
  return <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flex: "none" }}></i>;
}

export function RenewalPanel({ data, index = 0 }: { data: RenewalPanelData; index?: number }) {
  return (
    <>
      <div className={"panel rv"} style={css({ "--i": String(index) })} id={"renewalPanel"}>
        <h2>
          <Icon name={"calendar"} />
          {"Expiry and renewal"}
          <span className={"r"}>
            <Pill badge={data.badge} />
          </span>
        </h2>
        <p className={"mu"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
          {data.intro}
        </p>
        <p className={"why"}>
          <Icon name={data.contact.allowed ? "check-circle" : "info"} cls={"ic s"} />
          <span>{data.contact.text}</span>
        </p>
        {data.rows.map((row) => (
          <div key={row.id} className={"li"} data-renewal={row.id}>
            <Dot color={row.dot} />
            <div>
              <b>{row.title}</b>
              <small>
                <Parts parts={row.parts} />
              </small>
              <small>
                <Parts parts={[row.basis.text, ...(row.basis.source ? [<SourceLink key={"s"} source={row.basis.source} />, ...row.basis.source.facts] : [])]} />
              </small>
              {row.client.map((line) => (
                <small key={line}>{line}</small>
              ))}
              {row.fee ? (
                <small>
                  {row.fee.href ? (
                    <Parts parts={[row.fee.text, <a key={"f"} href={row.fee.href} target={"_blank"} rel={"noopener noreferrer"}>{"IRCC fee list"}</a>]} />
                  ) : (
                    row.fee.text
                  )}
                </small>
              ) : null}
              {row.lead ? (
                <small>
                  <a href={row.lead.href}>{row.lead.label}</a>
                </small>
              ) : null}
            </div>
            <span className={"r"}>
              {row.set ? (
                <button className={"btn s sm"} {...row.set}>
                  {"Set renewal reminder"}
                </button>
              ) : null}
              {row.cancel ? (
                <button className={"btn s sm"} {...row.cancel}>
                  {"Cancel"}
                </button>
              ) : null}
              <Pill badge={row.badge} />
            </span>
          </div>
        ))}
        {data.empty ? (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{data.empty}</span>
          </p>
        ) : null}

        <h3 style={{ marginTop: "18px" }}>{"IRCC renewal timings"}</h3>
        {data.timings.map((row, n) => (
          <div key={n} className={"li"}>
            <Dot color={"#2e9d5b"} />
            <div>
              <b>{row.label}</b>
              <small>
                <Parts parts={[<SourceLink key={"s"} source={row.source} />, ...row.source.facts]} />
              </small>
            </div>
            {row.retire ? (
              <span className={"r"}>
                <button className={"btn s sm"} {...row.retire}>
                  {"Retire"}
                </button>
              </span>
            ) : null}
          </div>
        ))}
        {data.timingsEmpty ? (
          <p className={"why"}>
            <Icon name={"info"} cls={"ic s"} />
            <span>{data.timingsEmpty}</span>
          </p>
        ) : null}
        {data.pending.length ? (
          <>
            <h3 style={{ marginTop: "18px" }}>{"Waiting for licensed review"}</h3>
            {data.pending.map((row, n) => (
              <div key={n} className={"li"}>
                <Dot color={"#f0a200"} />
                <div>
                  <b>{row.label}</b>
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

        {data.actions.record || data.actions.timing ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {data.actions.record ? (
              <button className={"btn s sm"} {...data.actions.record}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Record an expiry"}
              </button>
            ) : null}
            {data.actions.timing ? (
              <button className={"btn s sm"} {...data.actions.timing}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Add an IRCC renewal timing"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <RenewalDialogs data={data.dialogs} />
    </>
  );
}

/* --------------------------------------------------------------- dialogs */

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

function Foot({ label, wire }: { label: string; wire: RenewalWire }) {
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

function RenewalDialogs({ data }: { data: RenewalPanelData["dialogs"] }) {
  return (
    <>
      {data.expiry ? (
        <dialog className={"dlg wide"} id={"dRenExp"} aria-labelledby={"dRenExpT"}>
          <Head id={"dRenExp"} title={"Record an expiry"} />
          <div className={"db"}>
            <p className={"mu"} style={{ fontSize: "13px", margin: "0 0 10px" }}>
              {"Type the expiry exactly as it is shown on the client’s issued document. Casevoya adds an internal reminder task; nothing is sent to the client."}
            </p>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Issued document, as it reads"}
                <input id={"reL"} placeholder={"For example: the permit or card"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Expiry date shown on it"}
                <input id={"reE"} type={"date"} />
              </label>
              <label className={"fl"}>
                {"Read from (optional)"}
                <select id={"reV"} defaultValue={""}>
                  <option value={""}>{"Not a stored file"}</option>
                  {data.expiry.files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Reminder date set by"}
                <select id={"reT"} defaultValue={""}>
                  <option value={""}>{"The firm’s choice"}</option>
                  {data.expiry.timings.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Reminder date (the firm’s choice)"}
                <input id={"reD"} type={"date"} min={data.expiry.today} />
              </label>
            </div>
            <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
              <Icon name={"info"} cls={"ic s"} />
              {"No date is set for you. With an approved IRCC timing the date follows it; otherwise the date you choose is shown as the firm’s choice."}
            </p>
          </div>
          <Foot label={"Record expiry"} wire={data.expiry.wire} />
        </dialog>
      ) : null}
      {data.set ? (
        <dialog className={"dlg wide"} id={"dRenSet"} aria-labelledby={"dRenSetT"}>
          <Head id={"dRenSet"} title={"Set a renewal reminder"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Scope of the new service"}
              <textarea id={"rsS"} rows={3} placeholder={"What the firm would do for the renewal, and what it doesn’t include"} />
            </label>
            <div className={"g2"}>
              <label className={"fl"}>
                {"IRCC fee to show the client (optional)"}
                <select id={"rsF"} defaultValue={""}>
                  <option value={""}>{"No fee"}</option>
                  {data.set.fees.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {`${data.set.client} sees the reminder in the portal only; no email is sent. It creates a lead in the Pipeline for the new work. Nothing is billed. A fee shows only while it is in the approved IRCC fee list.`}
            </p>
          </div>
          <Foot label={"Set reminder"} wire={data.set.wire} />
        </dialog>
      ) : null}
      {data.cancel ? (
        <dialog className={"dlg wide"} id={"dRenCan"} aria-labelledby={"dRenCanT"}>
          <Head id={"dRenCan"} title={"Cancel this expiry"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why"}
              <textarea id={"rcN"} rows={3} />
            </label>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"Its open reminder task is cancelled and the client no longer sees it. A lead already created stays in the Pipeline."}
            </p>
          </div>
          <Foot label={"Cancel expiry"} wire={data.cancel.wire} />
        </dialog>
      ) : null}
      {data.timing ? (
        <dialog className={"dlg wide"} id={"dRenTim"} aria-labelledby={"dRenTimT"}>
          <Head id={"dRenTim"} title={"Add an IRCC renewal timing"} />
          <div className={"db"}>
            <p className={"mu"} style={{ fontSize: "13px", margin: "0 0 10px" }}>
              {
                "Copy it from the official IRCC or Government of Canada page, word for word. Enter a number of days only if the page states one. Casevoya fetches the page and keeps its hash. A licensed consultant approves it before it sets any reminder."
              }
            </p>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Document or status, as the page names it"}
                <input id={"rtA"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Applies to"}
                <select id={"rtP"} defaultValue={data.timing.program?.key ?? ""}>
                  <option value={""}>{"Every program"}</option>
                  {data.timing.program ? <option value={data.timing.program.key}>{data.timing.program.label}</option> : null}
                </select>
              </label>
              <label className={"fl"}>
                {"Timing, word for word"}
                <input id={"rtW"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Days before expiry (only if the page states it)"}
                <input id={"rtN"} type={"number"} min={1} max={1095} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Official page link (with its section anchor)"}
                <input id={"rtU"} type={"url"} placeholder={"https://www.canada.ca/…#section"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Section heading (if the link has no anchor)"}
                <input id={"rtS"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Form number (if a form)"}
                <input id={"rtF"} placeholder={"As printed on the form"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Form’s date modified"}
                <input id={"rtM"} type={"date"} max={data.timing.today} />
              </label>
              <label className={"fl"}>
                {"Date you checked the page"}
                <input id={"rtD"} type={"date"} max={data.timing.today} defaultValue={data.timing.today} />
              </label>
              <label className={"fl"}>
                {"“Current to” date (if the page shows one)"}
                <input id={"rtC"} type={"date"} max={data.timing.today} />
              </label>
            </div>
          </div>
          <Foot label={"Send for review"} wire={data.timing.wire} />
        </dialog>
      ) : null}
      {data.attest ? (
        <dialog className={"dlg wide"} id={"dRenAtt"} aria-labelledby={"dRenAttT"}>
          <Head id={"dRenAtt"} title={"Approve without a page snapshot"} />
          <div className={"db"}>
            <p className={"mu"} style={{ fontSize: "13px", margin: "0" }}>
              {"Open the timing’s official page (its link is on the timing) and compare it word for word before you approve."}
            </p>
            <PageAttestFields today={data.attest.today} />
          </div>
          <Foot label={"Approve"} wire={data.attest.wire} />
        </dialog>
      ) : null}
      {data.reject ? (
        <dialog className={"dlg wide"} id={"dRenRej"} aria-labelledby={"dRenRejT"}>
          <Head id={"dRenRej"} title={"Reject this timing"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why"}
              <textarea id={"rjN"} rows={3} />
            </label>
          </div>
          <Foot label={"Reject"} wire={data.reject.wire} />
        </dialog>
      ) : null}
      {data.retire ? (
        <dialog className={"dlg wide"} id={"dRenRet"} aria-labelledby={"dRenRetT"}>
          <Head id={"dRenRet"} title={"Retire this timing"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"Why (for example: the official page changed)"}
              <textarea id={"rrN"} rows={3} />
            </label>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"It stops setting new reminder dates. Reminders already recorded keep their date and source."}
            </p>
          </div>
          <Foot label={"Retire"} wire={data.retire.wire} />
        </dialog>
      ) : null}
    </>
  );
}
