/**
 * Live only (SEC-01, SEC-05; the Designer's person tab has no consent or sign-in panel): the
 * person's consent history, the impact reviews their withdrawals opened (Mark review done with a
 * note), and their portal two-step with the staff-assisted reset. Built from the Designer's parts:
 * `.panel` with an `h2`, `.li` rows, `.tw` / `.t` tables, `.bd` badges, `.fp-pad` / `.fp-note`,
 * `.btn s sm`, and the `.dlg` dialog with `.fld` / `.inp` / `.ta` fields. The buttons are wired in
 * person-consent-acts; the database decides every change.
 */
import { Fragment } from "react";
import { CONSENT_REVIEW_DIALOG, TWO_STEP_RESET_DIALOG, type PersonConsentData } from "@/modules/sheet/person-consent-present";
import { Icon } from "./frame";
import { Badge } from "./matters";

export function PersonConsentPanels({ data }: { data: PersonConsentData }) {
  return (
    <>
      <section className={"panel"}>
        <h2>
          <Icon name={"privacy"} />
          {"Consent"}
        </h2>
        <div className={"fp-pad"}>
          {data.reviews.map((review) => (
            <Fragment key={review.id}>
              <div className={"li"}>
                <div>
                  <b>{review.title}</b>
                  <small>{review.line}</small>
                </div>
                <span className={"r"}>
                  <Badge badge={review.open ? { tone: "chg", label: "Review open" } : { tone: "ok", label: "Reviewed" }} />
                  {review.open ? (
                    <button className={"btn s sm"} style={{ background: "#fff" }} data-cr-open={review.id} data-cr-version={String(review.version)} data-org={data.organizationId}>
                      {"Mark review done"}
                    </button>
                  ) : null}
                </span>
              </div>
              {review.open
                ? review.impacts.map((impact) => (
                    <p key={impact} className={"fp-note"} style={{ margin: "0 0 4px" }}>
                      <Icon name={"info"} cls={"ic s"} />
                      {` ${impact}`}
                    </p>
                  ))
                : review.done
                  ? <p className={"fp-note"} style={{ margin: "0 0 4px" }}>{review.done}</p>
                  : null}
            </Fragment>
          ))}
          <p className={"fp-note"}>{"A withdrawal is saved at once and opens a review. Nothing is deleted: records stay for the firm’s retention period and under any legal hold."}</p>
        </div>
        {data.history.length ? (
          <div className={"tw"} role={"region"} aria-label={"Consent history"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Consent history"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Consent"}</th>
                  <th scope={"col"}>{"Choice"}</th>
                  <th scope={"col"}>{"Date"}</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row, index) => (
                  <tr key={index}>
                    <td>{row.consent}</td>
                    <td>
                      <Badge badge={row.choice} />
                    </td>
                    <td className={"num"}>{row.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={"fp-pad"}>
            <p className={"fp-note"} style={{ margin: "0" }}>{"No consent recorded for this person yet."}</p>
          </div>
        )}
      </section>
      {data.twoStep ? (
        <section className={"panel"}>
          <h2>
            <Icon name={"lock"} />
            {"Portal sign-in"}
          </h2>
          <div className={"fp-pad"}>
            <div className={"li"}>
              <div>
                <b>{"Two-step sign-in"}</b>
                <small>{data.twoStep.detail}</small>
              </div>
              <span className={"r"}>
                <Badge badge={data.twoStep.badge} />
                <button className={"btn s sm"} style={{ background: "#fff" }} data-open={TWO_STEP_RESET_DIALOG}>
                  {"Reset two-step"}
                </button>
              </span>
            </div>
            {data.twoStep.resets.map((line) => (
              <p key={line} className={"fp-note"} style={{ margin: "0 0 4px" }}>
                {line}
              </p>
            ))}
          </div>
        </section>
      ) : null}
      <dialog className={"dlg"} id={CONSENT_REVIEW_DIALOG} aria-labelledby={`${CONSENT_REVIEW_DIALOG}H`}>
        <div className={"dh"}>
          <h2 id={`${CONSENT_REVIEW_DIALOG}H`}>{"Mark review done"}</h2>
          <button className={"x"} aria-label={"Close"} data-close={CONSENT_REVIEW_DIALOG}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        <div className={"db"}>
          <div className={"fld"}>
            <label htmlFor={"crNote"}>{"What you did"}</label>
            <small className={"hint"} id={"crNote-h"}>
              {"For example: Vo drafts for this client discarded, client called. Kept with the review; not shown to the client."}
            </small>
            <textarea className={"ta"} id={"crNote"} rows={3} maxLength={2000} aria-describedby={"crNote-h"}></textarea>
          </div>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={CONSENT_REVIEW_DIALOG}>
            {"Cancel"}
          </button>
          <button className={"btn p"} data-cr-done={"1"} data-org={data.organizationId}>
            {"Mark done"}
          </button>
        </div>
      </dialog>
      {data.twoStep ? (
        <dialog className={"dlg"} id={TWO_STEP_RESET_DIALOG} aria-labelledby={`${TWO_STEP_RESET_DIALOG}H`}>
          <div className={"dh"}>
            <h2 id={`${TWO_STEP_RESET_DIALOG}H`}>{"Reset the client’s two-step"}</h2>
            <button className={"x"} aria-label={"Close"} data-close={TWO_STEP_RESET_DIALOG}>
              <Icon name={"close"} cls={"ic s"} />
            </button>
          </div>
          <div className={"db"}>
            <p>{"Only after you’ve confirmed who the client is, never from an email alone. Their sessions end and they set up two-step again if they want it."}</p>
            <div className={"fld"}>
              <label htmlFor={"tsrM"}>{"How you confirmed who they are"}</label>
              <small className={"hint"} id={"tsrM-h"}>{"For example: video call, matched their photo ID on file."}</small>
              <input className={"inp"} id={"tsrM"} maxLength={500} aria-describedby={"tsrM-h"} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"tsrN"}>{"Note (optional)"}</label>
              <textarea className={"ta"} id={"tsrN"} rows={2} maxLength={2000}></textarea>
            </div>
            <div className={"fld"}>
              <label htmlFor={"tsrC"}>{"Your six-digit code"}</label>
              <input className={"inp"} id={"tsrC"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} />
            </div>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={TWO_STEP_RESET_DIALOG}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-tsr={"1"} data-org={data.organizationId} data-person={data.personId}>
              {"Reset two-step"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
