/**
 * The Designer's Government status page (`markup/government.tsx`), rendered from the firm's
 * records (PRD §14 GOV-03 to GOV-05). Same DOM, classes and order as the capture. It is a record
 * kept by the firm, never a live feed: every row says who recorded it, from what evidence, and
 * when it was verified and last checked.
 *
 * Live-only additions, all in the Designer's own classes: a "Verify" button in a row's Verified
 * cell for staff who may verify, and a "Record status" button under the Record a status fields
 * (in the alert panel's button row). Both are absent when the Designer's sample data is rendered.
 *
 * GOV-05 live-only additions, also absent with the Designer's sample data: a row's source line
 * and evidence link (Evidence cell), "Share with client" or "Shared with client …" (Status cell),
 * "Mark checked" (Last checked cell), "Review" for an IRCC estimate (Verified cell), "Add IRCC
 * estimate" next to Record status, and the GOV-05 dialogs (gov-status-dialogs.tsx).
 */
import type { CSSProperties } from "react";
import { Icon, Pair } from "./frame";
import { GovStatusDialogs, type GovStatusDialogsData } from "./gov-status-dialogs";
import { Avatar, type SidebarPerson } from "./sidebar";

/** The page's own stylesheet, as captured. */
export const GOVERNMENT_CSS: readonly string[] = [
  ".g2>div+div{border:0}.g2>div{padding:0}.fl{display:block;font-size:14px;font-weight:500;margin-bottom:12px}.fl select,.fl input{display:block;width:100%;margin-top:6px;height:42px;border:1px solid #d9d5d0;border-radius:8px;padding:0 12px;background:#fff;font-weight:400;font-size:14.5px}",
];

const css = (style: Record<string, string>) => style as CSSProperties;

/** Data attributes a live control carries to the Sheet's government acts (`data-gov`). */
export type GovWire = Record<`data-${string}`, string>;

export type GovernmentHeaderData = {
  back: string;
  /** The matter's client; absent on the firm-wide view. */
  client: SidebarPerson | null;
  pills: string[];
};

export function GovernmentHeader({ data }: { data: GovernmentHeaderData }) {
  return (
    <header className={"top"}>
      <a className={"back"} href={data.back} aria-label={"Back"}>
        <Icon name={"chevron-left"} cls={"ic s"} />
      </a>
      <button className={"crumb"}>
        <Icon name={"folder"} cls={"ic s"} />
        {"Matters"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"cs"} aria-hidden={"true"}>
        {"/"}
      </span>
      {data.client ? (
        <>
          <button className={"crumb"}>
            <Avatar person={data.client} />
            {data.client.name}
            <Icon name={"sort"} cls={"ic dd"} />
          </button>
          <span className={"cs"} aria-hidden={"true"}>
            {"/"}
          </span>
        </>
      ) : null}
      <button className={"crumb"}>
        <Icon name={"globe"} cls={"ic s"} />
        {"Government status"}
      </button>
      {data.pills.map((pill, index) => (
        <span key={index} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}></span>
    </header>
  );
}

export type GovStatusBadge = { tone: string; label: string; detail?: string };

export type GovernmentRow = {
  item: string;
  status: GovStatusBadge;
  recordedBy: string;
  evidence: string;
  verified: string;
  lastChecked: string;
  /** A live Verify button in the Verified cell. */
  verify?: GovWire | null;
  /** Live only: Attach evidence in the Verified cell, for a letter recorded without it. */
  attach?: GovWire | null;
  /** The firm-wide view: the row opens its matter. */
  href?: string | null;
  /** Live only (GOV-05): where the status came from, under the evidence. */
  source?: string | null;
  /** Live only: the evidence file opens (`data-doc-open`, a signed link after an access check). */
  evidenceOpen?: GovWire | null;
  /** Live only: the evidence is an official page (an IRCC estimate's source). */
  evidenceHref?: string | null;
  /** Live only: opens the Share with client preview. */
  share?: GovWire | null;
  /** Live only: "Shared with client 24 Oct 2026". */
  shared?: string | null;
  /** Live only: Mark checked. */
  check?: GovWire | null;
  /** Live only: Review, for an estimate waiting for a licensed member. */
  review?: GovWire | null;
};

export type GovernmentAlert = {
  copy: string;
  upload?: GovWire | null;
  manual?: GovWire | null;
};

export type GovernmentPageData = {
  intro: string;
  alert: GovernmentAlert | null;
  rows: GovernmentRow[];
  /** Record a status and History; absent on the firm-wide view. */
  record: { options: { value?: string; label: string }[]; save?: GovWire | null } | null;
  history: { text: string; when: string }[] | null;
  /** Live only (GOV-05): opens Add IRCC estimate, next to Record status. */
  estimate?: GovWire | null;
  /** Live only (GOV-05): Share with client, Add IRCC estimate and Review estimate dialogs. */
  dialogs?: GovStatusDialogsData | null;
};

function StatusBadge({ badge }: { badge: GovStatusBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.detail ? (
        <span>
          <Pair left={badge.label} right={badge.detail} />
        </span>
      ) : (
        badge.label
      )}
    </span>
  );
}

export function SheetGovernment({ data }: { data: GovernmentPageData }) {
  return (
    <>
      <div className={"ph rv"} style={css({ "--i": "0" })}>
        <h1 className={"display"}>{"Government status"}</h1>
        <p>{data.intro}</p>
      </div>
      {data.alert ? (
        <div className={"panel rv"} style={css({ borderColor: "rgb(240, 195, 109)", boxShadow: "rgb(255, 242, 210) 0px 0px 0px 3px", "--i": "1" })}>
          <h2 style={{ border: "0", paddingBottom: "6px" }}>
            <Icon name={"info"} />
            {"Submission unverified"}
            <span className={"r"}>
              <span className={"bd unv"}>
                <i></i>
                {"Needs evidence"}
              </span>
            </span>
          </h2>
          <div className={"pad"} style={{ paddingTop: "0" }}>
            <p style={{ fontSize: "14px" }}>{data.alert.copy}</p>
            <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
              <button className={"btn p"} {...(data.alert.upload ?? {})}>
                <Icon name={"upload"} cls={"ic s"} />
                {"Upload confirmation"}
              </button>
              <button className={"btn s"} {...(data.alert.manual ?? {})}>
                {"Record manually"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={"tw rv"} style={css({ marginBottom: "22px", "--i": "2" })}>
        <table className={"t"}>
          <thead>
            <tr>
              <th>{"Item"}</th>
              <th>{"Status"}</th>
              <th>{"Recorded by"}</th>
              <th>{"Evidence"}</th>
              <th>{"Verified"}</th>
              <th>{"Last checked"}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, index) => (
              <tr key={index} {...(row.href ? { "data-href": row.href } : {})}>
                <td className={""}>{row.item}</td>
                <td className={""}>
                  <StatusBadge badge={row.status} />
                  {row.share ? (
                    <button className={"btn s sm"} style={{ display: "flex", marginTop: "6px" }} {...row.share}>
                      {"Share with client"}
                    </button>
                  ) : row.shared ? (
                    <small style={{ display: "block", marginTop: "4px", color: "var(--t2)", fontSize: "13px" }}>{row.shared}</small>
                  ) : null}
                </td>
                <td className={""}>{row.recordedBy}</td>
                <td className={""}>
                  {row.evidenceOpen ? (
                    <a href={"#"} style={{ textDecoration: "underline" }} {...row.evidenceOpen}>
                      {row.evidence}
                    </a>
                  ) : row.evidenceHref ? (
                    <a href={row.evidenceHref} target={"_blank"} rel={"noopener noreferrer"} style={{ textDecoration: "underline" }}>
                      {row.evidence}
                    </a>
                  ) : (
                    row.evidence
                  )}
                  {row.source ? <small style={{ display: "block", marginTop: "4px", color: "var(--t2)", fontSize: "13px" }}>{row.source}</small> : null}
                </td>
                <td className={""}>
                  {row.verify ? (
                    <button className={"btn s sm"} {...row.verify}>
                      {"Verify"}
                    </button>
                  ) : row.attach ? (
                    <button className={"btn s sm"} {...row.attach}>
                      {"Attach evidence"}
                    </button>
                  ) : row.review ? (
                    <button className={"btn s sm"} {...row.review}>
                      {"Review"}
                    </button>
                  ) : (
                    row.verified
                  )}
                </td>
                <td className={"num"}>
                  {row.lastChecked}
                  {row.check ? (
                    <button className={"btn s sm"} style={{ display: "flex", marginTop: "6px" }} {...row.check}>
                      {"Mark checked"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.record && data.history ? (
        <div className={"split g2 rv"} style={css({ "--n": "2", gap: "16px", "--i": "3" })}>
          <div className={"panel"} style={{ margin: "0" }}>
            <h2 style={{ border: "0" }}>
              <Icon name={"edit"} />
              {"Record a status"}
            </h2>
            <div className={"pad"} style={{ paddingTop: "0" }}>
              <label className={"fl"}>
                {"Status"}
                <select>
                  {data.record.options.map((option, index) => (
                    <option key={index} {...(option.value ? { value: option.value } : {})}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Evidence"}
                <input placeholder={"Attach the IRCC letter or screenshot"} {...(data.record.save ? { readOnly: true, "data-gov-file": "1" } : {})} />
              </label>
              <small style={{ color: "var(--t2)", fontSize: "13px" }}>
                {data.record.save
                  ? "Required for a letter or a status change. “Checked, no change” needs none. Without evidence the entry stays “unverified”."
                  : "Required. Without evidence the entry stays “unverified”."}
              </small>
              {data.record.save ? (
                <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
                  <button className={"btn p"} {...data.record.save}>
                    {"Record status"}
                  </button>
                  {data.estimate ? (
                    <button className={"btn s"} {...data.estimate}>
                      {"Add IRCC estimate"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className={"panel"} style={{ margin: "0" }}>
            <h2 style={{ border: "0" }}>
              <Icon name={"history"} />
              {"History"}
            </h2>
            <div className={"pad"} style={{ paddingTop: "0" }}>
              {data.history.map((item, index) => (
                <div key={index} className={"nf"}>
                  <div>
                    {item.text}
                    <small className={"num"}>{item.when}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {data.dialogs ? <GovStatusDialogs data={data.dialogs} /> : null}
    </>
  );
}
