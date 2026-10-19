/**
 * "Request a document", opened by the matter header's Request document button. The Designer has
 * no request dialog, so this is built only from its dialog parts as the live New lead and Invite
 * to the portal dialogs use them: `.dlg wide` with `.dh`/`.db`/`.df`, `.g2` of `.fld` fields
 * (`.inp`, `.sel`, `.ta`, `.hint`), `fieldset.fld` with `label.check` boxes, the sample-mode
 * `.alert warn` and the hold dialog's `.lock` note. Saving is wired in doc-request-act
 * (`data-doc-request`) through createDocumentRequest (public.create_document_request).
 */
import { Icon } from "./frame";
import { DOC_REQUEST_AUDIENCES, DOC_REQUEST_FORMATS, DOC_REQUEST_SENSITIVITIES } from "@/modules/sheet/doc-request";

export const DOC_REQUEST_DIALOG = "dReq";

export type DocRequestDialogData = {
  organizationId: string;
  matterId: string;
  /** People on the matter (matter_participants), applicant first. `label` names their role and portal state. */
  people: { id: string; label: string }[];
  /** The firm's today (YYYY-MM-DD): the earliest due date. */
  today: string;
  /** The firm is in sample mode and this matter is real: the database refuses the request. */
  sampleMode: boolean;
};

export function DocRequestDialog({ data }: { data: DocRequestDialogData }) {
  const none = data.people.length === 0;
  return (
    <dialog className={"dlg wide"} id={DOC_REQUEST_DIALOG} aria-labelledby={"dReqT"}>
      <div className={"dh"}>
        <h2 id={"dReqT"}>{"Request a document"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={DOC_REQUEST_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        {data.sampleMode ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"This firm is in sample mode"}</b>
              {"Only sample matters accept new requests until sample mode is turned off. The firm will refuse this one."}
            </div>
          </div>
        ) : null}
        {none ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"No one on this matter yet"}</b>
              {"A request goes to a person on the matter. Add the client to the matter first."}
            </div>
          </div>
        ) : null}
        <div className={"g2"}>
          <div className={"fld"}>
            <label htmlFor={"drqP"}>{"Who it’s for"}</label>
            <select className={"sel"} id={"drqP"} defaultValue={data.people[0]?.id}>
              {data.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
            <span className={"hint"}>{"They see it in their portal once they have access."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"drqW"}>{"Which document"}</label>
            <input className={"inp"} id={"drqW"} maxLength={200} placeholder={"For example: Passport, all pages"} autoComplete={"off"} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"drqD"}>{"Due on (optional)"}</label>
            <input className={"inp"} id={"drqD"} type={"date"} min={data.today} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"drqS"}>{"Sensitivity"}</label>
            <select className={"sel"} id={"drqS"} defaultValue={"ordinary"}>
              {DOC_REQUEST_SENSITIVITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"drqE"}>{"What to tell the client"}</label>
            <textarea className={"ta"} id={"drqE"} maxLength={2000} placeholder={"In plain words: what the file should show, and why it’s needed."}></textarea>
            <span className={"hint"}>{"Shown in their portal with the request. The email only says a document was asked for."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"drqR"}>{"Review criteria (optional)"}</label>
            <textarea className={"ta"} id={"drqR"} maxLength={2000} placeholder={"For example: every page, readable, not expired"}></textarea>
            <span className={"hint"}>{"Only the firm sees these."}</span>
          </div>
          <div className={"fld"}>
            <label htmlFor={"drqA"}>{"Who may see it"}</label>
            <select className={"sel"} id={"drqA"} defaultValue={"subject"}>
              {DOC_REQUEST_AUDIENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className={"hint"}>{"Others on the matter see it only when it’s ordinary. Firm staff only hides it from the portal."}</span>
          </div>
          <fieldset className={"fld"}>
            <legend>{"Accepted formats"}</legend>
            {DOC_REQUEST_FORMATS.map((format) => (
              <label key={format.value} className={"check"}>
                <input type={"checkbox"} name={"drqF"} value={format.value} defaultChecked={format.on} />
                <span>{format.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
          <Icon name={"file-check"} cls={"ic s"} />
          {"An upload is not accepted until someone at the firm reviews it."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={DOC_REQUEST_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-doc-request={"1"} data-org={data.organizationId} data-matter={data.matterId} {...(none ? { disabled: true } : {})}>
          {"Send request"}
        </button>
      </div>
    </dialog>
  );
}
