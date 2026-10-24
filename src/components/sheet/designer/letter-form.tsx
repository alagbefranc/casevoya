/**
 * GOV-04 live-only parts of the matter page's government letters. The Designer has no screen for
 * them, so each is built from its own dialog and list parts, like the Record a deadline dialog:
 *
 * - LetterFormFields: inside "Record a government letter" (`#dLetter`), the Issuer (the firm's
 *   approved list, with each issuer's official source shown under the field, or "Other (type the
 *   issuer)"), the Letter date (separate from Received on), a file from an email already filed to
 *   this matter (OPS-06 File to matter) as the letter, and "Tasks from this letter" (`.g2` rows of
 *   `.fl` fields: description, owner (staff or a client on the matter) and due date).
 * - IssuerList: the firm's issuer list on the Decisions tab (`.sub` heading, `.li` rows, `.bd`
 *   badges), with Add an issuer (`#dIssuer`, a `.dlg wide` with `.dh`, `.db`, `.g2`, `.mu`, `.lock`
 *   and `.df`) and, for a licensed member, Approve, Reject and Retire.
 *
 * Saving is wired in letter-acts (`data-letter-*`, `data-issuer`); matter-acts' Record letter reads
 * these fields when they are present.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, Sep } from "./frame";

const css = (style: Record<string, string>) => style as CSSProperties;

export type LetterWire = Record<`data-${string}`, string>;
export type LetterBadge = { tone: string; label: string };

function Joined({ parts }: { parts: string[] }): ReactNode {
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    const last = index === parts.length - 1;
    out.push(`${index === 0 ? "" : " "}${part}${last ? "" : " "}`);
  });
  return <>{out}</>;
}

/* ------------------------------------------------------- letter dialog */

export type LetterFormData = {
  /** The firm's today (YYYY-MM-DD): the latest letter date, the earliest task due date. */
  today: string;
  /** Approved issuers, with their source parts (URL, date checked, what the server read). */
  issuers: { id: string; name: string; source: string[] }[];
  /** Task owners: active staff ("staff:<membership>") then the clients on the matter ("client:<person>"). */
  owners: { value: string; label: string }[];
  defaultOwner: string;
  /** Files from emails filed to this matter (OPS-06), as stored document versions. */
  filed: { versionId: string; label: string }[];
  /** How many task rows the dialog holds (the first shows; Add another task shows the next). */
  rows: number;
};

const OTHER = "other";

export function LetterFormFields({ data }: { data: LetterFormData }) {
  const first = data.issuers[0];
  return (
    <div data-letter-form={""} data-today={data.today}>
      <div className={"g2"}>
        <label className={"fl"}>
          {"Issuer"}
          <select id={"ltI"} defaultValue={first ? first.id : OTHER}>
            {data.issuers.map((issuer) => (
              <option key={issuer.id} value={issuer.id} data-src={issuer.source.join(" · ")}>
                {issuer.name}
              </option>
            ))}
            <option value={OTHER} data-src={""}>
              {"Other (type the issuer)"}
            </option>
          </select>
        </label>
        <label className={"fl"} id={"ltIoL"} hidden={Boolean(first)}>
          {"Issuer, as written on the letter"}
          <input id={"ltIo"} autoComplete={"off"} maxLength={200} />
        </label>
        <label className={"fl"}>
          {"Letter date (printed on it)"}
          <input id={"ltDd"} type={"date"} max={data.today} />
        </label>
        {data.filed.length ? (
          <label className={"fl"}>
            {"Or use a file from a filed email"}
            <select id={"ltE"} defaultValue={""}>
              <option value={""}>{"None (choose a file above)"}</option>
              {data.filed.map((file) => (
                <option key={file.versionId} value={file.versionId}>
                  {file.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className={"mu"} id={"ltIs"} style={{ fontSize: "13px", marginTop: "8px" }}>
        {first
          ? first.source.join(" · ")
          : "The firm’s issuer list is empty. Type the issuer as written; add official names with their source on the Decisions tab."}
      </p>
      <h3 className={"sub"} style={{ marginTop: "14px" }}>
        {"Tasks from this letter"}
      </h3>
      {Array.from({ length: data.rows }, (_, index) => (
        <div key={index} className={"g2"} data-letter-task={""} hidden={index > 0}>
          <label className={"fl"}>
            {"Task"}
            <input className={"lt-t"} autoComplete={"off"} maxLength={200} placeholder={"What needs doing"} />
          </label>
          <label className={"fl"}>
            {"Owner"}
            <select className={"lt-o"} defaultValue={data.defaultOwner}>
              {data.owners.map((owner) => (
                <option key={owner.value} value={owner.value}>
                  {owner.label}
                </option>
              ))}
            </select>
          </label>
          <label className={"fl"}>
            {"Due"}
            <input className={"lt-d"} type={"date"} min={data.today} />
          </label>
        </div>
      ))}
      <div className={"ea"} style={{ marginTop: "10px" }}>
        <button className={"btn s sm"} data-letter-add={""}>
          <Icon name={"plus"} cls={"ic s"} />
          {"Add another task"}
        </button>
      </div>
      <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
        {"Each task is linked to this letter. A client’s task shows in their portal; a staff task stays with the firm. Leave a row empty to skip it."}
      </p>
    </div>
  );
}

/* --------------------------------------------------------- issuer list */

export type IssuerListRow = {
  id: string;
  name: string;
  source: string[];
  badge: LetterBadge;
  note?: string | null;
  approve?: LetterWire | null;
  reject?: LetterWire | null;
  retire?: LetterWire | null;
};

export type IssuerListData = {
  rows: IssuerListRow[];
  /** Staff may add an issuer (`#dIssuer`). */
  add?: { wire: LetterWire; today: string } | null;
};

function Badge({ badge }: { badge: LetterBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.label}
    </span>
  );
}

export function IssuerList({ data, start }: { data: IssuerListData; start: number }) {
  let index = start;
  return (
    <>
      <h3 className={"sub rv"} style={css({ "--i": String(index++) })}>
        {"Issuers of government letters"}
      </h3>
      {data.rows.length ? (
        data.rows.map((row) => {
          const reviewing = Boolean(row.reject || row.retire);
          return (
            <div key={row.id} className={"li rv"} style={css({ "--i": String(index++) })} data-issuer-row={row.id}>
              <div>
                <b>{row.name}</b>
                <small>
                  <Joined parts={row.source} />
                </small>
                {row.note ? <small>{row.note}</small> : null}
                {reviewing ? (
                  <label className={"fl"}>
                    {row.retire ? "Why it’s retired" : "Why it’s rejected (to reject)"}
                    <input data-issuer-note={""} autoComplete={"off"} maxLength={500} />
                  </label>
                ) : null}
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
                {row.retire ? (
                  <button className={"btn s sm"} {...row.retire}>
                    {"Retire"}
                  </button>
                ) : null}
                <Badge badge={row.badge} />
              </span>
            </div>
          );
        })
      ) : (
        <div className={"li rv"} style={css({ "--i": String(index++) })}>
          <div>
            <b>{"No issuers yet"}</b>
            <small>{"Add each issuer’s official name from its Government of Canada page, with the page’s address and the date you checked it. A licensed member approves it before it’s offered."}</small>
          </div>
        </div>
      )}
      {data.add ? (
        <>
          <div className={"ea rv"} style={css({ "--i": String(index++) })}>
            <button className={"btn s sm"} data-dlg={"dIssuer"}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add an issuer"}
            </button>
          </div>
          <IssuerDialog wire={data.add.wire} today={data.add.today} />
        </>
      ) : null}
    </>
  );
}

function IssuerDialog({ wire, today }: { wire: LetterWire; today: string }) {
  return (
    <dialog className={"dlg wide"} id={"dIssuer"} aria-labelledby={"dIssuerT"}>
      <div className={"dh"}>
        <h2 id={"dIssuerT"}>{"Add an issuer"}</h2>
        <button className={"x"} aria-label={"Close"} data-x={""}>
          <Icon name={"close"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"g2"}>
          <label className={"fl"}>
            {"Official name"}
            <input id={"isN"} autoComplete={"off"} maxLength={200} placeholder={"As the official page writes it"} />
          </label>
          <label className={"fl"}>
            {"Date you checked the page"}
            <input id={"isC"} type={"date"} max={today} defaultValue={today} />
          </label>
          <label className={"fl"}>
            {"Official page address"}
            <input id={"isU"} type={"url"} autoComplete={"off"} placeholder={"https://www.canada.ca/…#section"} />
          </label>
        </div>
        <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
          {"Use the Government of Canada page that names this issuer (canada.ca or a gc.ca site), with the section’s anchor if it has one. Casevoya reads the page when it can and keeps its fingerprint and Date modified; it never fills in a name for you."}
        </p>
        <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
          <Icon name={"shield"} cls={"ic s"} />
          {"It’s offered in Record a government letter only after a licensed member approves it."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-x={""}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...wire}>
          {"Add issuer"}
        </button>
      </div>
    </dialog>
  );
}
