/**
 * Settings > Retention, deletion (SEC-07). Live only: the Designer has no deletion screen, so the
 * panels and the Approve deletion dialog are built from its parts (`.panel`, `.tw`/`.t` table,
 * `.bd` badge, `.fp-note`, `.dlg`, `.dh`, `.db`, `.fld`, `.ta`, `.why`, `.df`). Shown to the firm
 * owner under the Policy panel. Approve deletion removes nothing itself: the deletion runner does.
 */
import type { CSSProperties } from "react";
import { Icon } from "./frame";
import type { RetentionDeletionData } from "@/modules/sheet/sec-present";

export const DELETE_DIALOG = "dlgDelete";

function i(n: number) {
  return { "--i": String(n) } as CSSProperties;
}

export function RetentionDeletionPanels({ data, index = 3 }: { data: RetentionDeletionData; index?: number }) {
  return (
    <>
      <section className={"panel rv"} style={i(index)} aria-labelledby={"delEH"}>
        <h2 id={"delEH"}>
          <Icon name={"trash"} />
          {"Eligible for deletion"}
        </h2>
        <div style={{ padding: "18px 20px" }}>
          <p style={{ margin: "0 0 14px", maxWidth: "68ch" }}>
            {"Closed matters whose retention period has ended and that are not under a legal hold. Nothing is deleted until you approve it, and only the matter’s files and what was made from them are removed; a tombstone records what went."}
          </p>
          {data.eligible.length === 0 ? (
            <p className={"mu"}>{"No closed matter is past its retention end."}</p>
          ) : (
            <div className={"tw"} role={"region"} aria-label={"Eligible for deletion"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Closed matters eligible for deletion"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Matter"}</th>
                    <th scope={"col"}>{"Closed"}</th>
                    <th scope={"col"}>{"Retention ended"}</th>
                    <th scope={"col"}>{"Policy"}</th>
                    <th scope={"col"}>
                      <span className={"sr"}>{"Actions"}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.eligible.map((row) => (
                    <tr key={row.matterId}>
                      <td>{row.sample ? `${row.matter} (sample)` : row.matter}</td>
                      <td>{row.closed}</td>
                      <td>{row.ended}</td>
                      <td>{row.policy}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className={"btn sm"} data-sec-act={"open-delete"} data-matter={row.matterId} data-matter-label={row.matter}>
                          {"Approve deletion"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.heldNote ? (
            <p className={"fp-note"} style={{ marginTop: "12px" }}>
              <Icon name={"lock"} cls={"ic s"} />
              {` ${data.heldNote}`}
            </p>
          ) : null}
        </div>
      </section>
      {data.jobs.length ? (
        <section className={"panel rv"} style={i(index + 1)} aria-labelledby={"delJH"}>
          <h2 id={"delJH"}>
            <Icon name={"hourglass"} />
            {"Deletion jobs"}
          </h2>
          <div style={{ padding: "18px 20px" }}>
            <div className={"tw"} role={"region"} aria-label={"Deletion jobs"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Deletion jobs not finished"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Matter"}</th>
                    <th scope={"col"}>{"State"}</th>
                    <th scope={"col"}>{"Detail"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.matter}</td>
                      <td>
                        <span className={`bd ${job.badge.tone}`}>
                          <i></i>
                          {job.badge.label}
                        </span>
                      </td>
                      <td>{job.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
      <section className={"panel rv"} style={i(index + 2)} aria-labelledby={"delTH"}>
        <h2 id={"delTH"}>
          <Icon name={"history"} />
          {"Deleted under retention"}
        </h2>
        <div style={{ padding: "18px 20px" }}>
          {data.tombstones.length === 0 ? (
            <p className={"mu"}>{"No files have been deleted under the retention policy."}</p>
          ) : (
            <div className={"tw"} role={"region"} aria-label={"Deleted under retention"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Tombstones of deleted files"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Matter"}</th>
                    <th scope={"col"}>{"When and who"}</th>
                    <th scope={"col"}>{"What"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tombstones.map((tomb) => (
                    <tr key={tomb.id}>
                      <td>{tomb.matter}</td>
                      <td>
                        {tomb.when}
                        <br />
                        <small>{tomb.who}</small>
                        <br />
                        <small>{tomb.policy}</small>
                      </td>
                      <td>
                        {tomb.removed}
                        {tomb.kept ? (
                          <>
                            <br />
                            <small>{tomb.kept}</small>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={"fp-note"} style={{ marginTop: "12px" }}>
            <Icon name={"info"} cls={"ic s"} />
            {" The matter, its closure record, the list of its documents and the audit trail stay as the record. Casevoya stores no embeddings; short-lived download links expire within minutes. Each tombstone keeps the removed storage keys so a restored backup can have them removed again."}
          </p>
        </div>
      </section>
    </>
  );
}

export function DeletionDialog({ organizationId }: { organizationId: string }) {
  return (
    <dialog className={"dlg"} id={DELETE_DIALOG} aria-labelledby={"dlgDeleteH"} data-org={organizationId}>
      <div className={"dh"}>
        <h2 id={"dlgDeleteH"}>{"Approve deletion"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={DELETE_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p className={"mu"} data-del-label={""} style={{ margin: "0 0 12px" }}></p>
        <p style={{ margin: "0 0 12px" }}>
          {"This removes the matter’s stored files (originals, derived copies and translations), its client-file exports, Vo’s readings of its documents and any unsent Vo drafts. A document that is also on another matter, and an executed agreement, are kept."}
        </p>
        <div className={"fld"}>
          <label htmlFor={"delR"}>{"Reason"}</label>
          <textarea className={"ta"} id={"delR"} maxLength={1000} rows={3} placeholder={"For example: retention period under policy R-2 ended; no hold, complaint or claim open"} />
          <span className={"hint"}>{"At least 10 characters. Kept with the job and the tombstone."}</span>
        </div>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Approving asks you to confirm it’s you. The deletion runner removes the files within minutes, checking for a legal hold before each one. It can’t be undone."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={DELETE_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-sec-act={"approve-delete"} data-org={organizationId}>
          {"Approve deletion"}
        </button>
      </div>
    </dialog>
  );
}
