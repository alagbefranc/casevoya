/**
 * Settings > Team and seats, firm transfers (ORG-06). Live only: the Designer has no transfer
 * screen, so the panel and its dialogs are built from its parts (`.panel`, `.t`, `.bd`, `.dlg`,
 * `.fld`, `.inp`, `.ta`, `.why`). Shown to the firm owner under Continuity contact.
 */
import type { CSSProperties } from "react";
import { Icon } from "./frame";
import { Badge } from "./matters";
import { TRANSFER_CLOSE_DIALOG, TRANSFER_NEW_DIALOG, TRANSFER_REVIEW_DIALOG, type FirmTransfersData } from "@/modules/sheet/firm-transfers-present";

export function FirmTransfersPanel({ data }: { data: FirmTransfersData }) {
  return (
    <section className={"panel rv"} style={{ "--i": "4" } as CSSProperties} aria-labelledby={"xferH"}>
      <h2 id={"xferH"}>
        <Icon name={"folder"} />
        {"Firm transfers"}
      </h2>
      <div style={{ padding: "18px 20px" }}>
        <p style={{ margin: "0 0 14px", maxWidth: "68ch" }}>
          {"If the firm closes or a consultant’s clients move to another firm, record it here. For each matter you review the client’s authority and make a client-file export to hand over. Nothing moves on its own: the receiving firm gets only what you give them, and onboards each client separately."}
        </p>
        <div className={"fp-row"} style={{ marginBottom: "14px" }}>
          <button className={"btn sm"} data-dlg={TRANSFER_NEW_DIALOG} disabled={data.matters.length === 0} title={data.matters.length ? undefined : "There are no matters to transfer."}>
            <Icon name={"plus"} cls={"ic s"} />
            {"Record a firm transfer"}
          </button>
        </div>
        {data.transfers.length === 0 ? (
          <p className={"mu"}>{"No firm transfers recorded."}</p>
        ) : (
          data.transfers.map((transfer) => (
            <div key={transfer.id} className={"xfer"} data-transfer={transfer.id}>
              <div className={"xfer-h"}>
                <div>
                  <b>{transfer.title}</b>
                  <small>{transfer.meta}</small>
                </div>
                <Badge badge={transfer.status} />
              </div>
              {transfer.note ? <p className={"mu"} style={{ margin: "6px 0 0" }}>{transfer.note}</p> : null}
              <div className={"tw"} role={"region"} aria-label={`${transfer.title}: matters`} tabIndex={0} style={{ marginTop: "10px" }}>
                <table className={"t"}>
                  <caption className={"sr"}>{`${transfer.title}: matters`}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"Matter"}</th>
                      <th scope={"col"}>{"Client authority"}</th>
                      <th scope={"col"}>{"Export"}</th>
                      <th scope={"col"}>
                        <span className={"sr"}>{"Actions"}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfer.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.matter}</td>
                        <td>
                          <Badge badge={item.authority} />
                          {item.note ? <small className={"xfer-note"}>{item.note}</small> : null}
                        </td>
                        <td>{item.export.href ? <a className={"tl"} href={item.export.href}>{item.export.label}</a> : item.export.label}</td>
                        <td style={{ textAlign: "right" }}>
                          {item.canReview ? (
                            <button className={"btn sm"} data-dlg={TRANSFER_REVIEW_DIALOG} data-xfer-item={item.id} data-xfer-matter={item.matter}>
                              {item.authority.label === "Authority not reviewed" ? "Review authority" : "Review again"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={"xfer-f"}>
                <small>{transfer.progress}</small>
                {transfer.open ? (
                  <button className={"btn sm"} data-dlg={TRANSFER_CLOSE_DIALOG} data-xfer-close={transfer.id} data-xfer-complete={transfer.canComplete ? "1" : "0"}>
                    {"Close transfer"}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
        <p className={"fp-note"} style={{ marginTop: "12px" }}>
          <Icon name={"info"} cls={"ic s"} />
          {" Casevoya never sends a client’s records to another firm because that firm asks. Exports are made and downloaded by you, with your authenticator, and are logged."}
        </p>
      </div>
    </section>
  );
}

function Close({ id }: { id: string }) {
  return (
    <button className={"x"} aria-label={"Close"} data-close={id}>
      <Icon name={"close"} cls={"ic s"} />
    </button>
  );
}

const STEP_UP = "Saving asks you to confirm it’s you. The change is logged.";

export function FirmTransferDialogs({ data }: { data: FirmTransfersData }) {
  const org = data.organizationId;
  return (
    <>
      <dialog className={"dlg wide"} id={TRANSFER_NEW_DIALOG} aria-labelledby={"xfNH"}>
        <div className={"dh"}>
          <h2 id={"xfNH"}>{"Record a firm transfer"}</h2>
          <Close id={TRANSFER_NEW_DIALOG} />
        </div>
        <div className={"db"}>
          <div className={"fld"}>
            <label htmlFor={"xfF"}>{"Receiving firm"}</label>
            <input className={"inp"} id={"xfF"} maxLength={200} autoComplete={"off"} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"xfC"}>{"Their contact (optional)"}</label>
            <input className={"inp"} id={"xfC"} maxLength={200} autoComplete={"off"} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"xfE"}>{"Contact email (optional)"}</label>
            <input className={"inp"} id={"xfE"} type={"email"} maxLength={320} autoComplete={"off"} />
            <span className={"hint"}>{"Kept with the record. Casevoya doesn’t email them."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"xfN"}>{"Why (optional)"}</label>
            <textarea className={"ta"} id={"xfN"} maxLength={2000} rows={2} />
          </div>
          <fieldset className={"fld"} style={{ border: "0", padding: "0", margin: "0" }}>
            <legend>{"Matters in scope"}</legend>
            <div className={"xfer-pick"}>
              {data.matters.map((matter) => (
                <label key={matter.id} className={"check"}>
                  <input type={"checkbox"} name={"xfM"} value={matter.id} />
                  <span>{matter.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className={"why"}>
            <Icon name={"shield"} cls={"ic s"} />
            {STEP_UP}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={TRANSFER_NEW_DIALOG}>
            {"Cancel"}
          </button>
          <button className={"btn p"} data-xfer-act={"record"} data-org={org}>
            {"Record transfer"}
          </button>
        </div>
      </dialog>

      <dialog className={"dlg"} id={TRANSFER_REVIEW_DIALOG} aria-labelledby={"xfRH"}>
        <div className={"dh"}>
          <h2 id={"xfRH"}>{"Review client authority"}</h2>
          <Close id={TRANSFER_REVIEW_DIALOG} />
        </div>
        <div className={"db"}>
          <p className={"mu"} data-xfer-label={""} style={{ margin: "0 0 12px" }}></p>
          <fieldset className={"fld"} style={{ border: "0", padding: "0", margin: "0" }}>
            <legend>{"Did the client authorise moving this matter to the receiving firm?"}</legend>
            <label className={"check"}>
              <input type={"radio"} name={"xfA"} value={"yes"} />
              <span>{"Yes, I’ve confirmed the client’s authority"}</span>
            </label>
            <label className={"check"}>
              <input type={"radio"} name={"xfA"} value={"no"} />
              <span>{"No, the client hasn’t authorised it"}</span>
            </label>
          </fieldset>
          <div className={"fld"}>
            <label htmlFor={"xfRN"}>{"Note"}</label>
            <textarea className={"ta"} id={"xfRN"} maxLength={1000} rows={3} placeholder={"How and when the client confirmed, or why not"} />
            <span className={"hint"}>{"Kept with the transfer record; the audit log records only yes or no."}</span>
          </div>
          <p className={"why"}>
            <Icon name={"shield"} cls={"ic s"} />
            {STEP_UP}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={TRANSFER_REVIEW_DIALOG}>
            {"Cancel"}
          </button>
          <button className={"btn p"} data-xfer-act={"review"} data-org={org}>
            {"Save review"}
          </button>
        </div>
      </dialog>

      <dialog className={"dlg"} id={TRANSFER_CLOSE_DIALOG} aria-labelledby={"xfCH"}>
        <div className={"dh"}>
          <h2 id={"xfCH"}>{"Close transfer"}</h2>
          <Close id={TRANSFER_CLOSE_DIALOG} />
        </div>
        <div className={"db"}>
          <div className={"fld"}>
            <label htmlFor={"xfS"}>{"Outcome"}</label>
            <select className={"sel"} id={"xfS"} defaultValue={"completed"}>
              <option value={"completed"}>{"Completed: the files were handed over"}</option>
              <option value={"cancelled"}>{"Cancelled"}</option>
            </select>
            <span className={"hint"}>{"Completed needs the client’s authority reviewed on every matter."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"xfCN"}>{"Note (optional)"}</label>
            <textarea className={"ta"} id={"xfCN"} maxLength={2000} rows={2} />
          </div>
          <p className={"why"}>
            <Icon name={"shield"} cls={"ic s"} />
            {STEP_UP}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={TRANSFER_CLOSE_DIALOG}>
            {"Cancel"}
          </button>
          <button className={"btn p"} data-xfer-act={"close"} data-org={org}>
            {"Close transfer"}
          </button>
        </div>
      </dialog>
    </>
  );
}
