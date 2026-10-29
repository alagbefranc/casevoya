/**
 * PREP-01 and PREP-03 on the matter page. Built from the design system's panels, tables and
 * dialogs. The catalogue starts empty: a licensed reviewer adds a template from an official page.
 * Casevoya does not ship form fields or fill a government PDF.
 */
import { SUBMISSION_CHANNEL_OPTIONS } from "@/modules/government/present";
import type { MatterBundleData, MatterFormsData } from "@/modules/sheet/prep-present";
import { Icon } from "./frame";

const muted = { color: "var(--t2)", fontSize: "13px", margin: "0 0 12px" } as const;

function statusTone(status: string): string {
  if (status === "Filled") return "ok";
  if (status === "Missing") return "bad";
  if (status === "Not provided") return "chg";
  return "unv";
}

export function MatterForms({ data }: { data: MatterFormsData }) {
  return (
    <>
      <div className={"panel"}>
        <h2>
          <Icon name={"file"} />
          {"Form templates"}
        </h2>
        <p style={muted}>
          {"A template is what a licensed reviewer transcribed from an official page: the form identifier, the version printed on it, and the fields. Casevoya does not ship a form list, and it does not fill a government PDF. A stale version is flagged and blocks package release until you pin the current template."}
        </p>
        {data.catalogueEmpty ? (
          <p style={muted}>{"No form template is on file for this firm yet. Add one from the official form page. The catalogue stays empty until a licensed reviewer approves it."}</p>
        ) : null}
        {data.canPropose ? (
          <button className={"btn s sm"} data-open={"dFormTpl"} type={"button"}>
            <Icon name={"plus"} cls={"ic s"} />
            {"Add a form template"}
          </button>
        ) : null}
      </div>

      {data.pins.map((pin) => (
        <div className={"panel"} key={pin.title}>
          <h2>
            {pin.title}
            {pin.stale ? <span className={"bd chg"} style={{ marginLeft: "8px" }}>{"Stale form version"}</span> : <span className={"bd ok"} style={{ marginLeft: "8px" }}>{"Current"}</span>}
          </h2>
          <p style={muted}>
            {pin.meta}
            {pin.href ? (
              <>
                {" · "}
                <a href={pin.href}>{"Official page"}</a>
              </>
            ) : null}
            {" · "}
            {pin.counts}
          </p>
          {pin.stale ? <p className={"alert"}>{pin.stale}</p> : null}
          <p style={muted}>{pin.output}</p>
          {pin.fields.length ? (
            <div className={"tw"}>
              <table className={"t"}>
                <caption className={"sr"}>{"Fields and the approved facts they come from"}</caption>
                <thead>
                  <tr>
                    <th>{"Field"}</th>
                    <th>{"Status"}</th>
                    <th>{"From approved facts"}</th>
                  </tr>
                </thead>
                <tbody>
                  {pin.fields.map((field) => (
                    <tr key={field.key}>
                      <td>
                        {field.label}
                        {field.required ? <small>{" Required on the form"}</small> : null}
                        {field.factKey ? <small>{` Fact key ${field.factKey}`}</small> : null}
                      </td>
                      <td>
                        <span className={`bd ${statusTone(field.statusLabel)}`}>{field.statusLabel}</span>
                      </td>
                      <td>
                        {field.facts.length
                          ? field.facts.map((fact) => (
                              <div key={`${fact.person}-${fact.label}`}>
                                <b>{fact.person}</b>
                                {` · ${fact.label} · ${fact.value}`}
                              </div>
                            ))
                          : field.status === "manual"
                            ? "Completed by hand"
                            : "No approved fact with this key"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ))}

      {data.approved.length && data.canPin ? (
        <div className={"panel"}>
          <h2>{"Pin a template on this matter"}</h2>
          <form className={"fl"} data-prep-form={"pin"}>
            <label className={"fl"}>
              {"Approved template"}
              <select id={"pfPin"} defaultValue={data.approved.find((row) => !row.disabled)?.id ?? ""}>
                {data.approved.map((row) => (
                  <option key={row.id} value={row.id} disabled={Boolean(row.disabled)}>
                    {row.disabled ? `${row.label} (${row.disabled})` : row.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={"btn p sm"}
              type={"button"}
              data-prep={"pin"}
              data-org={data.organizationId}
              data-matter={data.matterId}
            >
              {"Pin on this matter"}
            </button>
          </form>
        </div>
      ) : null}

      {data.pending.length ? (
        <div className={"panel"}>
          <h2>{"Waiting for a licensed review"}</h2>
          {data.pending.map((row) => (
            <div className={"li"} key={row.id}>
              <div>
                <b>{row.label}</b>
                <small>{row.snapshot ? "Page captured" : "Page not captured by Casevoya"}</small>
                {row.href ? (
                  <small>
                    {" "}
                    <a href={row.href}>{"Official page"}</a>
                  </small>
                ) : null}
              </div>
              {data.canReview ? (
                <span style={{ display: "flex", gap: "8px" }}>
                  <button
                    className={"btn s sm"}
                    type={"button"}
                    data-prep={row.snapshot ? "approve" : "attest-open"}
                    data-org={data.organizationId}
                    data-id={row.id}
                    data-version={String(row.version)}
                    {...(row.snapshot ? {} : { "data-open": "dFormAtt" })}
                  >
                    {"Approve"}
                  </button>
                  <button className={"btn s sm"} type={"button"} data-open={"dFormRej"} data-prep-reject={row.id} data-version={String(row.version)}>
                    {"Reject"}
                  </button>
                </span>
              ) : (
                <small>{"A licensed consultant approves this."}</small>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {data.canPropose ? <AddTemplateDialog data={data} /> : null}
      {data.canReview ? <ReviewDialogs data={data} /> : null}
    </>
  );
}

function AddTemplateDialog({ data }: { data: MatterFormsData }) {
  return (
    <dialog className={"dlg wide"} id={"dFormTpl"} aria-labelledby={"dFormTplT"}>
      <div className={"dh"}>
        <h2 id={"dFormTplT"}>{"Add a form template"}</h2>
        <button className={"x"} aria-label={"Close"} data-x={""} type={"button"}>
          <Icon name={"close"} />
        </button>
      </div>
      <div className={"db"}>
        <p className={"alert"}>
          {"Type the identifier, version and fields as the official page prints them. Do not guess a version or a date. Leave the effective date blank when the page does not state one. Casevoya fetches the page and keeps its hash when it can."}
        </p>
        <div className={"g2"}>
          <label className={"fl"}>
            {"Jurisdiction"}
            <input id={"ftJ"} defaultValue={""} placeholder={"As the page states it, for example CA"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Program key"}
            <input id={"ftP"} defaultValue={data.programKey ?? ""} placeholder={"Optional. Leave blank if it is not tied to one program."} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Form identifier"}
            <input id={"ftI"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Form version, as printed"}
            <input id={"ftV"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Official page"}
            <input id={"ftU"} type={"url"} placeholder={"https://www.canada.ca/…#section"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Section heading"}
            <input id={"ftS"} placeholder={"Or put the section anchor in the link"} autoComplete={"off"} />
          </label>
          <label className={"fl"}>
            {"Date you checked the page"}
            <input id={"ftD"} type={"date"} defaultValue={data.today} />
          </label>
          <label className={"fl"}>
            {"Effective date, only if the page states one"}
            <input id={"ftE"} type={"date"} />
          </label>
        </div>
        <label className={"fl"}>
          {"Output"}
          <select id={"ftO"} defaultValue={"field_review"}>
            <option value={"field_review"}>{"Field review — show filled and missing fields"}</option>
            <option value={"manual_completion"}>{"Manual completion — finish the form by hand and upload it"}</option>
          </select>
        </label>
        <label className={"fl"}>
          {"Fields, one per line"}
          <textarea id={"ftF"} rows={6} placeholder={"family_name | Family name | yes | family_name"} />
          <span className={"hint"}>{"key | label as printed | yes or no | intake fact key. Leave the fact key off when the field is completed by hand. Leave this empty for manual completion."}</span>
        </label>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-x={""} type={"button"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} type={"button"} data-prep={"propose"} data-org={data.organizationId} data-matter={data.matterId}>
          {"Save for review"}
        </button>
      </div>
    </dialog>
  );
}

function ReviewDialogs({ data }: { data: MatterFormsData }) {
  return (
    <>
      <dialog className={"dlg wide"} id={"dFormAtt"} aria-labelledby={"dFormAttT"}>
        <div className={"dh"}>
          <h2 id={"dFormAttT"}>{"Approve without a page snapshot"}</h2>
          <button className={"x"} aria-label={"Close"} data-x={""} type={"button"}>
            <Icon name={"close"} />
          </button>
        </div>
        <div className={"db"}>
          <p className={"alert"}>{"Casevoya could not fetch the official page. Approve only if you opened it yourself and the template matches it."}</p>
          <label className={"fl"}>
            {"Date you opened the official page"}
            <input id={"ftAttD"} type={"date"} defaultValue={data.today} />
          </label>
          <label className={"check"}>
            <input id={"ftAttC"} type={"checkbox"} />
            {"I opened the official page myself on this date and the template matches it."}
          </label>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-x={""} type={"button"}>
            {"Cancel"}
          </button>
          <button className={"btn p"} type={"button"} data-prep={"attest"} data-org={data.organizationId}>
            {"Approve"}
          </button>
        </div>
      </dialog>
      <dialog className={"dlg"} id={"dFormRej"} aria-labelledby={"dFormRejT"}>
        <div className={"dh"}>
          <h2 id={"dFormRejT"}>{"Reject this template"}</h2>
          <button className={"x"} aria-label={"Close"} data-x={""} type={"button"}>
            <Icon name={"close"} />
          </button>
        </div>
        <div className={"db"}>
          <label className={"fl"}>
            {"Why"}
            <textarea id={"ftRej"} rows={3} />
          </label>
        </div>
        <div className={"df"}>
          <button className={"btn"} data-x={""} type={"button"}>
            {"Cancel"}
          </button>
          <button className={"btn p"} type={"button"} data-prep={"reject"} data-org={data.organizationId}>
            {"Reject"}
          </button>
        </div>
      </dialog>
    </>
  );
}

export function MatterBundle({ data }: { data: MatterBundleData }) {
  return (
    <div className={"panel"}>
      <h2>
        <Icon name={"package"} />
        {"Evidence bundle"}
      </h2>
      <p style={muted}>
        {"Choose the documents and their order. Casevoya builds one PDF: a cover page, an index, then the documents, with a page number on every page. PDF, JPEG and PNG are copied in. Other files stay in the index and are kept as their own files."}
      </p>
      <p style={muted}>{data.ruleLabel}</p>
      {data.candidates.length === 0 ? <p style={muted}>{"No current documents on this matter yet. Upload a file, then select it here."}</p> : null}
      {data.canEdit && data.candidates.length ? (
        <div data-prep-bundle={""}>
          <label className={"fl"}>
            {"Channel"}
            <select id={"bdCh"} defaultValue={data.channel}>
              {data.channels.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>
          <div className={"tw"}>
            <table className={"t"}>
              <caption className={"sr"}>{"Documents to include, in order"}</caption>
              <thead>
                <tr>
                  <th>{"Include"}</th>
                  <th>{"Order"}</th>
                  <th>{"Document"}</th>
                </tr>
              </thead>
              <tbody>
                {data.candidates.map((row, index) => (
                  <tr key={row.versionId}>
                    <td>
                      <input type={"checkbox"} data-bundle-version={row.versionId} defaultChecked={row.selected} aria-label={`Include ${row.name}`} />
                    </td>
                    <td>
                      <input data-bundle-order={row.versionId} type={"number"} min={1} max={100} defaultValue={row.selected ? data.index.find((item) => item.name === row.name)?.place ?? String(index + 1) : String(index + 1)} aria-label={`Order for ${row.name}`} style={{ width: "4.5rem" }} />
                    </td>
                    <td>
                      {row.name}
                      <br />
                      <small>{`${row.purpose} · ${row.note}`}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className={"btn p sm"} type={"button"} data-prep={"bundle"} data-org={data.organizationId} data-matter={data.matterId}>
            {"Save selection"}
          </button>
        </div>
      ) : null}
      {data.index.length ? (
        <>
          <h3 style={{ marginTop: "16px" }}>{"Document index"}</h3>
          <ol>
            {data.index.map((row) => (
              <li key={`${row.place}-${row.name}`}>
                <b>{row.place}</b>
                {` ${row.name} — ${row.purpose}`}
              </li>
            ))}
          </ol>
          {data.downloadHref ? (
            <a className={"btn p sm"} href={data.downloadHref}>
              {"Download evidence bundle"}
            </a>
          ) : null}
        </>
      ) : null}
      {data.canSetRule ? (
        <details style={{ marginTop: "16px" }}>
          <summary>{"Channel file name and size"}</summary>
          <p style={muted}>{"A product setting for this firm. It does not come from IRCC. The size must be between 1 and 100 MB."}</p>
          <label className={"fl"}>
            {"Channel"}
            <select id={"bdRuleCh"} defaultValue={data.channel}>
              {SUBMISSION_CHANNEL_OPTIONS.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>
          <label className={"fl"}>
            {"File name pattern"}
            <input id={"bdPat"} defaultValue={data.pattern} autoComplete={"off"} />
            <span className={"hint"}>{"Use {reference}, {channel} and {date}. Must end in .pdf."}</span>
          </label>
          <label className={"fl"}>
            {"Maximum size (MB)"}
            <input id={"bdMax"} type={"number"} min={1} max={100} defaultValue={data.maxMb} />
          </label>
          <button className={"btn s sm"} type={"button"} data-prep={"channel-rule"} data-org={data.organizationId}>
            {"Save channel rule"}
          </button>
        </details>
      ) : null}
    </div>
  );
}
