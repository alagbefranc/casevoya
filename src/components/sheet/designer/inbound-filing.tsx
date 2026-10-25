/**
 * Inbound email capture (OPS-06): live additions the Designer has no screen for, built only from
 * the Designer's own parts.
 *
 * - `InboundAddress`: a matter's or the firm's inbound address with a Copy button: the `.fp-row`
 *   code-and-button row and `.btn s sm` with the Sheet's copy toast (`data-copy` + `data-toast`),
 *   as the Share enquiry form dialog.
 * - `FileToMatterDialog`: Email to triage › File to matter, the `.dlg` anatomy (`.dh`, `.db`,
 *   `.df`, the close `x`), `.fld` / `.inp` / `.sel` fields, `.check` rows and an `.alert info`.
 *   use-sheet fills it per email (`data-inbox-pick`), searches matters on the server
 *   (`data-inbox-search`) and files (`data-inbox-file-go`); the database decides every step.
 */
import { Icon } from "./frame";

export const FILE_TO_MATTER_DIALOG = "dlgFileTo";

export type InboundAddressData = {
  address: string;
  /** One plain line under the address: what mail sent there does. */
  note: string;
};

export function InboundAddress({ data }: { data: InboundAddressData }) {
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      <div className={"fp-row"} style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <code style={{ fontSize: "13px", wordBreak: "break-all", whiteSpace: "pre-wrap", flex: "1" }}>{data.address}</code>
        <button className={"btn s sm"} type={"button"} data-toast={"Address copied"} data-copy={data.address}>
          <Icon name={"copy"} cls={"ic s"} />
          {"Copy"}
        </button>
      </div>
      <small style={{ color: "var(--t2)" }}>{data.note}</small>
    </div>
  );
}

export function FileToMatterDialog({ organizationId }: { organizationId: string }) {
  const id = FILE_TO_MATTER_DIALOG;
  return (
    <dialog className={"dlg"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{"File to matter"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p className={"fp-note"} id={"ftE"} style={{ margin: "0 0 8px" }}></p>
        <div className={"fld"}>
          <label htmlFor={"ftQ"}>{"Find a matter"}</label>
          <div className={"fp-row"} style={{ flexWrap: "nowrap" }}>
            <input className={"inp"} id={"ftQ"} type={"search"} maxLength={80} autoComplete={"off"} placeholder={"Reference or title"} style={{ flex: "1" }} />
            <button className={"btn s sm"} type={"button"} data-inbox-search={"1"} data-org={organizationId}>
              <Icon name={"search"} cls={"ic s"} />
              {"Search"}
            </button>
          </div>
          <span className={"hint"}>{"Only matters you can open are shown."}</span>
        </div>
        <div className={"fld"}>
          <label htmlFor={"ftM"}>{"Matter"}</label>
          <select className={"sel"} id={"ftM"} disabled>
            <option value={""}>{"Search for a matter first"}</option>
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"ftP"}>{"Who it’s from or about"}</label>
          <select className={"sel"} id={"ftP"} disabled>
            <option value={""}>{"Choose a matter first"}</option>
          </select>
        </div>
        <fieldset className={"fld"} style={{ border: "0", padding: "0", margin: "0" }}>
          <legend>{"Attachments"}</legend>
          <div id={"ftF"} style={{ display: "grid", gap: "8px" }}></div>
          <span className={"hint"}>{"Saved files go through the same file check as any upload and wait for review in Documents."}</span>
        </fieldset>
        <div className={"alert info"}>
          <Icon name={"users"} />
          <div>
            <b>{"Filing doesn’t give the sender access"}</b>
            {"Forwarded or copied email never adds its sender to the matter or the portal."}
          </div>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-inbox-file-go={"1"} data-org={organizationId}>
          {"File to matter"}
        </button>
      </div>
    </dialog>
  );
}
