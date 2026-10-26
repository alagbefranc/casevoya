/**
 * Live only (#188, decisions 2026-10-25): the live official claims in Source review, built from the
 * Designer's own parts (`.panel`, `.tw` / `.t` tables, `.dlg` dialogs, `.fld` fields, badges and
 * `details.src` evidence). A captured official claim is live with no label; a firm's licensed edit
 * shows only its stamp; "Source changed since your edit" shows the new official text beside the
 * firm's wording. Buttons carry `data-claim-act` (source-claim-acts.ts); the database decides who
 * may edit, and asks for a fresh step-up every time.
 */
import type { LiveClaimsData, OfficialClaimView } from "@/modules/sheet/official-claims-present";
import { SOURCE_CHANGED } from "@/modules/sheet/official-claims-present";
import { Icon } from "./frame";
import { Badge } from "./matters";
import { ClaimEvidenceList } from "./source-claims";

/** Source review: the live official claims, searchable, each with its last check, state and stamp. */
export function LiveOfficialClaims({ data }: { data: LiveClaimsData }) {
  return (
    <section className={"panel rv"} id={"live-claims"} style={{ "--i": "3", marginTop: "16px" } as React.CSSProperties}>
      <h2>
        <Icon name={"link"} />
        {`Live official claims (${data.total.toLocaleString("en-CA")})`}
      </h2>
      <div className={"fp-pad"}>
        <p className={"fp-note"} style={{ marginTop: 0 }}>
          {"Captured from official IRCC and Government of Canada pages, each with its page, section, capture and dates. A licensed member can edit your firm’s wording; other firms keep the official text."}
        </p>
        <form className={"fp-row"} method={"get"} action={"#live-claims"} data-live={"1"} role={"search"} style={{ margin: "10px 0" }}>
          <input type={"hidden"} name={"tab"} value={"sources"} />
          <label className={"sr"} htmlFor={"cq"}>
            {"Search live official claims"}
          </label>
          <input className={"inp"} id={"cq"} name={"cq"} type={"search"} maxLength={120} defaultValue={data.query} placeholder={"Search by key, wording, section or program"} />
          <button className={"btn sm"} type={"submit"}>
            {"Search"}
          </button>
        </form>
        {data.rows.length === 0 ? (
          <p className={"mu"}>{data.query ? "No live official claim matches that search." : "No official claims are loaded yet."}</p>
        ) : (
          <div className={"tw"} role={"region"} aria-label={"Live official claims"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Live official claims"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Claim"}</th>
                  <th scope={"col"}>{"Program"}</th>
                  <th scope={"col"}>{"Last checked"}</th>
                  <th scope={"col"}>{"Status"}</th>
                  <th scope={"col"}>
                    <span className={"sr"}>{"Actions"}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.definitionId} data-claim={row.key}>
                    <td>
                      <a href={row.href} style={{ color: "var(--blue)" }}>
                        {row.key}
                      </a>
                      <div style={{ fontSize: "13px" }}>{row.claim}</div>
                      {row.stamp ? <div className={"fp-note"}>{row.stamp}</div> : null}
                      {row.sourceChanged ? (
                        <div>
                          <Badge badge={{ tone: "rev", label: SOURCE_CHANGED }} />
                        </div>
                      ) : null}
                    </td>
                    <td>{`${row.category} · ${row.program}`}</td>
                    <td>{row.lastChecked}</td>
                    <td>
                      <Badge badge={row.state} />
                    </td>
                    <td>
                      <span className={"fp-row"}>
                        <a className={"btn sm"} href={`${row.href}&dlg=dlgClaimEdit`}>
                          {"Edit"}
                        </a>
                        <a className={"btn sm"} href={`${row.href}#claim-history`}>
                          {"History"}
                        </a>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.range ? (
          <div className={"fp-row"} style={{ marginTop: "10px" }}>
            <span className={"mu"} style={{ fontSize: "13px" }}>
              {data.range}
            </span>
            {data.previous ? (
              <a className={"btn sm"} href={data.previous}>
                {"Previous"}
              </a>
            ) : null}
            {data.next ? (
              <a className={"btn sm"} href={data.next}>
                {"Next"}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Rule detail for one live official claim: the claim (the firm's wording when edited, with its stamp), evidence, history and the firm's actions. */
export function OfficialClaimDetail({ view }: { view: OfficialClaimView }) {
  return (
    <>
      <div className={"ph rv"} style={{ "--i": "0" } as React.CSSProperties}>
        <div>
          <h1 className={"display"}>
            {view.title.left} <span className={"mu"}>{view.title.right}</span>
          </h1>
          <p>{view.summary}</p>
        </div>
      </div>
      <div className={"fp-g2 rv"} style={{ "--i": "1" } as React.CSSProperties}>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"note"} />
              {"Claim"}
            </h2>
            <div className={"fp-pad"}>
              <p style={{ fontSize: "15px" }}>{view.claim}</p>
              {view.value && !view.claim.includes(view.value) ? <p style={{ marginTop: "6px" }}>{`Value: ${view.value}`}</p> : null}
              {view.stamp ? <p className={"fp-note"}>{view.stamp}</p> : null}
              <p style={{ marginTop: "8px" }}>
                <Badge badge={view.state} />
              </p>
            </div>
          </section>
          {view.sourceChanged ? (
            <section className={"panel"}>
              <h2>
                <Icon name={"repeat"} />
                {SOURCE_CHANGED}
              </h2>
              <div className={"fp-pad"}>
                <p className={"fp-note"} style={{ marginTop: 0 }}>
                  {"The official page changed after your firm’s edit. Your wording stays until a licensed member keeps it or reverts to the official text."}
                </p>
                <p style={{ fontSize: "15px" }}>{view.sourceChanged.officialClaim}</p>
                {view.sourceChanged.officialValue && !view.sourceChanged.officialClaim.includes(view.sourceChanged.officialValue) ? (
                  <p style={{ marginTop: "6px" }}>{`Value: ${view.sourceChanged.officialValue}`}</p>
                ) : null}
              </div>
            </section>
          ) : null}
          <ClaimEvidenceList items={[view.evidence]} />
          <section className={"panel"} id={"claim-history"}>
            <h2>
              <Icon name={"clock"} />
              {`History (${view.history.length})`}
            </h2>
            <div className={"tw"} role={"region"} aria-label={"Claim history"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Claim history"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"When"}</th>
                    <th scope={"col"}>{"What"}</th>
                    <th scope={"col"}>{"Wording and evidence"}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.history.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <time className={"num"}>{row.when}</time>
                      </td>
                      <td>{row.what}</td>
                      <td>
                        {row.text ? <div>{row.text}</div> : null}
                        {row.detail ? <div className={"fp-note"}>{row.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div>
          <div className={"panel"}>
            <div className={"fp-pad"}>
              <h3 style={{ fontSize: "15px", fontWeight: "500", marginBottom: "10px" }}>{"Your firm’s wording"}</h3>
              <div className={"fp-row"}>
                <button className={"btn sm"} data-dlg={"dlgClaimEdit"} disabled={view.licensed ? undefined : true}>
                  {"Edit"}
                </button>
                {view.sourceChanged ? (
                  <button className={"btn sm"} data-dlg={"dlgClaimKeep"} disabled={view.licensed ? undefined : true}>
                    {"Keep my edit"}
                  </button>
                ) : null}
                {view.edited ? (
                  <button className={"btn sm"} data-dlg={"dlgClaimRevert"} disabled={view.licensed ? undefined : true}>
                    {"Revert to official"}
                  </button>
                ) : null}
              </div>
              <p className={"fp-note"}>
                {view.licensed
                  ? "Each edit is your firm’s only and needs a fresh step-up. It shows “Edited by”, your name, licence and the date; the official text and every earlier version are kept."
                  : "A firm owner or licensed consultant edits your firm’s wording. Each edit is stamped and kept."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function DialogHead({ id, title }: { id: string; title: string }) {
  return (
    <div className={"dh"}>
      <h2 id={`${id}H`}>{title}</h2>
      <button className={"x"} aria-label={"Close"} data-close={id}>
        <Icon name={"close"} cls={"ic s"} />
      </button>
    </div>
  );
}

function Field({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help ? <small style={{ color: "var(--t2)", display: "block", marginTop: "6px" }}>{help}</small> : null}
    </div>
  );
}

/** Edit, Keep and Revert: each a stamped change for this firm only, with a fresh step-up. */
export function OfficialClaimDialogs({ view }: { view: OfficialClaimView }) {
  if (!view.licensed) return null;
  const ids = { "data-org": view.organizationId, "data-def": view.definitionId, "data-base": view.baseVersionId };
  const official = (
    <div className={"fld"}>
      <label>{"Official text"}</label>
      <p style={{ fontSize: "14px" }}>{view.officialClaim}</p>
      {view.officialValue && !view.officialClaim.includes(view.officialValue) ? <p className={"fp-note"}>{`Value: ${view.officialValue}`}</p> : null}
    </div>
  );
  return (
    <>
      <dialog className={"dlg"} id={"dlgClaimEdit"} aria-labelledby={"dlgClaimEditH"}>
        <DialogHead id={"dlgClaimEdit"} title={"Edit your firm’s wording"} />
        <div className={"db"}>
          {official}
          <Field id={"ceT"} label={"Your firm’s wording"} help={"Only your firm sees it. Other firms keep the official text."}>
            <textarea className={"ta"} id={"ceT"} name={"ceT"} maxLength={2000} defaultValue={view.draft.claim}></textarea>
          </Field>
          <Field id={"ceV"} label={"Value (optional)"}>
            <input className={"inp"} id={"ceV"} name={"ceV"} maxLength={200} defaultValue={view.draft.value} />
          </Field>
          <Field id={"ceR"} label={"Why"} help={"Kept with the edit and shown in History."}>
            <textarea className={"ta"} id={"ceR"} name={"ceR"} maxLength={1000}></textarea>
          </Field>
          <p className={"fp-note"}>{"Saving needs a fresh step-up, every time."}</p>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-close={"dlgClaimEdit"}>
            {"Cancel"}
          </button>
          <button className={"btn p"} data-claim-act={"edit"} {...ids}>
            {"Save edit"}
          </button>
        </div>
      </dialog>
      {view.sourceChanged ? (
        <dialog className={"dlg"} id={"dlgClaimKeep"} aria-labelledby={"dlgClaimKeepH"}>
          <DialogHead id={"dlgClaimKeep"} title={"Keep your firm’s edit"} />
          <div className={"db"}>
            {official}
            <div className={"fld"}>
              <label>{"Your firm’s wording"}</label>
              <p style={{ fontSize: "14px" }}>{view.claim}</p>
            </div>
            <Field id={"ckR"} label={"Why it still holds"}>
              <textarea className={"ta"} id={"ckR"} name={"ckR"} maxLength={1000}></textarea>
            </Field>
            <p className={"fp-note"}>{"Keeping it stamps it again against the new official version. It needs a fresh step-up."}</p>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimKeep"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"keep"} data-text={view.claim} data-value={view.value ?? ""} {...ids}>
              {"Keep my edit"}
            </button>
          </div>
        </dialog>
      ) : null}
      {view.edited ? (
        <dialog className={"dlg"} id={"dlgClaimRevert"} aria-labelledby={"dlgClaimRevertH"}>
          <DialogHead id={"dlgClaimRevert"} title={"Revert to the official text"} />
          <div className={"db"}>
            {official}
            <Field id={"crvR"} label={"Why"}>
              <textarea className={"ta"} id={"crvR"} name={"crvR"} maxLength={1000}></textarea>
            </Field>
            <p className={"fp-note"}>{"Your firm then shows the official text. The edit stays in History. It needs a fresh step-up."}</p>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimRevert"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"revert"} {...ids}>
              {"Revert"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
