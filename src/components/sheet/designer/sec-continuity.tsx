/**
 * Settings > Subscription, after cancelling (SEC-10), and the banner across the app. Live only:
 * the Designer has no cancellation screen, so the panel, the Cancel subscription and After the
 * export window dialogs and the banner are built from its parts (`.panel`, `.fp-pad`, `dl.fp-dl`,
 * `.fp-row`, `.btn`, `.alert`, `.dlg`, `.dh`, `.db`, `.fld`, `.sel`, `.check`, `.why`, `.df`).
 */
import type { CSSProperties } from "react";
import { Icon } from "./frame";
import type { CancelDialogData, ContinuityPanelData, EndArrangementDialogData } from "@/modules/sheet/sec-present";

export const CANCEL_DIALOG = "dlgCancelSub";
export const ARRANGEMENT_DIALOG = "dlgEndArr";

export function ContinuityPanel({ data, index = 2 }: { data: ContinuityPanelData; index?: number }) {
  return (
    <section className={"panel rv"} style={{ "--i": String(index) } as CSSProperties} aria-labelledby={"contH"}>
      <h2 id={"contH"}>
        <Icon name={"archive"} />
        {"After cancelling"}
      </h2>
      <div className={"fp-pad"}>
        <dl className={"fp-dl"}>
          {data.rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {data.exportNext || data.canIndex || data.canChoose ? (
          <div className={"fp-row"} style={{ marginTop: "12px" }}>
            {data.exportNext ? (
              <a className={"btn p sm"} href={data.exportNext.href}>
                {data.exportNext.label}
              </a>
            ) : null}
            {data.canIndex ? (
              <button className={"btn sm"} data-sec-act={"firm-index"} data-org={data.organizationId}>
                {"Download firm index"}
              </button>
            ) : null}
            {data.canChoose ? (
              <button className={"btn sm"} data-dlg={ARRANGEMENT_DIALOG}>
                {"After the window…"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CancelSubscriptionDialog({ data }: { data: CancelDialogData }) {
  return (
    <dialog className={"dlg"} id={CANCEL_DIALOG} aria-labelledby={"dlgCancelSubH"}>
      <div className={"dh"}>
        <h2 id={"dlgCancelSubH"}>{"Cancel subscription"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={CANCEL_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ margin: "0 0 10px" }}>{`Your paid period ends on ${data.periodEnd}. Until then nothing changes.`}</p>
        <p style={{ margin: "0 0 10px" }}>{"After that, new matters and staff or client invitations stop. Everyone at the firm keeps read-only access to the records."}</p>
        <p style={{ margin: "0 0 10px" }}>{`Client files can be exported for at least ${data.windowDays} days, until ${data.windowEnd} at the earliest. Then the records stay in Casevoya’s custodial archive, or go to a firm you transfer them to.`}</p>
        <p style={{ margin: "0 0 10px" }}>{"Cancelling never deletes records."}</p>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Continuing asks you to confirm it’s you, then Stripe (test mode during the pilot) stops renewing at the end of the paid period. Before then you can keep the subscription from Manage billing."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={CANCEL_DIALOG}>
          {"Keep subscription"}
        </button>
        <button className={"btn p"} data-sec-act={"cancel-sub"} data-org={data.organizationId}>
          {"Cancel at period end"}
        </button>
      </div>
    </dialog>
  );
}

export function EndArrangementDialog({ data }: { data: EndArrangementDialogData }) {
  return (
    <dialog className={"dlg"} id={ARRANGEMENT_DIALOG} aria-labelledby={"dlgEndArrH"}>
      <div className={"dh"}>
        <h2 id={"dlgEndArrH"}>{"After the export window"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={ARRANGEMENT_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <fieldset className={"fld"} style={{ border: "0", padding: "0", margin: "0" }}>
          <legend>{"What happens to the records"}</legend>
          <label className={"check"}>
            <input type={"radio"} name={"earA"} value={"custodial_archive"} defaultChecked={data.current === "custodial_archive"} />
            <span>{"Custodial archive: Casevoya keeps them read-only under each matter’s retention"}</span>
          </label>
          <label className={"check"}>
            <input type={"radio"} name={"earA"} value={"transfer"} defaultChecked={data.current === "transfer"} disabled={data.transfers.length === 0} />
            <span>{"Transfer to another firm (Settings › Team and seats, Firm transfers)"}</span>
          </label>
        </fieldset>
        <div className={"fld"}>
          <label htmlFor={"earT"}>{"Firm transfer"}</label>
          <select className={"sel"} id={"earT"} defaultValue={data.transferId ?? ""} disabled={data.transfers.length === 0}>
            {data.transfers.length === 0 ? <option value={""}>{"No firm transfer recorded"}</option> : null}
            {data.transfers.map((transfer) => (
              <option key={transfer.id} value={transfer.id}>
                {transfer.label}
              </option>
            ))}
          </select>
          <span className={"hint"}>{"A transfer counts only once you mark it completed, after reviewing each client’s authority. If it isn’t completed by the end of the window, the records go into the custodial archive."}</span>
        </div>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Saving asks you to confirm it’s you. Neither choice deletes anything."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={ARRANGEMENT_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-sec-act={"arrangement"} data-org={data.organizationId}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}
