/**
 * Share the enquiry form (CRM-01): a live addition (the Designer has no share dialog), built only
 * from the Designer's own parts: the `.dlg` dialog anatomy (`.dh`, `.db`, `.df`, the close `x`),
 * `.alert` notices, `.fp-note` labels, `.fp-row` code-and-button rows and `.btn s sm` buttons
 * with the Sheet's copy toast (`data-copy` + `data-toast`, as Consultations' Copy link). It
 * holds every public link the firm has in one place: the enquiry page (Copy, QR code, Preview),
 * the two website snippets (script and iframe) and each published booking page.
 *
 * Opened from Leads › Pipeline and Practice › Intake forms by `ShareEnquiryButton`
 * (`data-open="dlgShare"`, the Sheet's dialog opener).
 */
import { Icon } from "@/components/sheet/designer/frame";
import type { EnquiryShareData } from "@/modules/leads/share";
import { POLICY_PAGE } from "@/modules/portal-policies/defaults";

export const SHARE_DIALOG = "dlgShare";

export function ShareEnquiryButton() {
  return (
    <button className={"btn s sm"} type={"button"} data-open={SHARE_DIALOG}>
      <Icon name={"share"} cls={"ic s"} />
      {"Share enquiry form"}
    </button>
  );
}

function CopyRow({ text, label, toast }: { text: string; label: string; toast: string }) {
  return (
    <div className={"fp-row"} style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
      <code style={{ fontSize: "13px", wordBreak: "break-all", whiteSpace: "pre-wrap", flex: "1" }}>{text}</code>
      <button className={"btn s sm"} type={"button"} data-toast={toast} data-copy={text}>
        <Icon name={"copy"} cls={"ic s"} />
        {label}
      </button>
    </div>
  );
}

export function EnquiryShareDialog({ data }: { data: EnquiryShareData }) {
  return (
    <dialog className={"dlg wide"} id={SHARE_DIALOG} aria-labelledby={`${SHARE_DIALOG}H`}>
      <div className={"dh"}>
        <h2 id={`${SHARE_DIALOG}H`}>{"Share your enquiry form"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={SHARE_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"} style={{ display: "grid", gap: "8px" }}>
        {data.privacyMissing ? (
          <div className={"alert warn"}>
            <Icon name={"alert"} />
            <div>
              <b>{"The form is off until you publish a privacy notice"}</b>
              {"Visitors see “This form isn’t available” until your firm publishes its privacy notice. "}
              <a className={"tl"} href={POLICY_PAGE}>
                {"Review and publish"}
              </a>
            </div>
          </div>
        ) : null}
        {data.practice ? (
          <div className={"alert info"}>
            <Icon name={"info"} />
            <div>
              <b>{"Sample mode · practice records are marked sample"}</b>
              {"Practice pages: only your team can open these links until your firm is verified. Enquiries and bookings made on them are sample records."}
            </div>
          </div>
        ) : null}
        <p className={"fp-note"} style={{ margin: "0" }}>
          {"Enquiry form link"}
        </p>
        <CopyRow text={data.links.page} label={"Copy link"} toast={"Link copied"} />
        <div className={"fp-row"} style={{ alignItems: "center", gap: "16px", marginTop: "4px" }}>
          {data.qr ? <img src={data.qr} alt={`QR code for ${data.links.page}`} width={132} height={132} style={{ border: "1px solid var(--line)", borderRadius: "10px", background: "#fff" }} /> : null}
          <div style={{ display: "grid", gap: "8px", justifyItems: "start" }}>
            <small style={{ color: "var(--t2)" }}>{"Print the QR code on a flyer or a business card. It opens the same link."}</small>
            <div className={"fp-row"}>
              {data.qr ? (
                <a className={"btn s sm"} href={data.qr} download={"enquiry-form-qr.svg"}>
                  <Icon name={"download"} cls={"ic s"} />
                  {"Download QR code"}
                </a>
              ) : null}
              <a className={"btn s sm"} href={data.links.page} target={"_blank"} rel={"noopener noreferrer"}>
                <Icon name={"external-link"} cls={"ic s"} />
                {"Preview"}
              </a>
            </div>
          </div>
        </div>
        <p className={"fp-note"} style={{ margin: "12px 0 0" }}>
          {"On your website: paste this where the form should appear. It sizes itself to the form."}
        </p>
        <CopyRow text={data.links.scriptSnippet} label={"Copy code"} toast={"Code copied"} />
        <p className={"fp-note"} style={{ margin: "12px 0 0" }}>
          {"Or, if your website builder only takes an iframe:"}
        </p>
        <CopyRow text={data.links.iframeSnippet} label={"Copy code"} toast={"Code copied"} />
        <p className={"fp-note"} style={{ margin: "0" }}>
          {"Enquiries from your website are recorded with the source “Website form”, from the link as “Hosted page”. Both arrive in New on your pipeline."}
        </p>
        <p className={"fp-note"} style={{ margin: "12px 0 0" }}>
          {"Book a consultation"}
        </p>
        {data.bookings.length ? (
          data.bookings.map((booking) => (
            <div key={booking.url} style={{ display: "grid", gap: "4px" }}>
              <small>{booking.practice ? `${booking.title} · Practice page` : booking.title}</small>
              <CopyRow text={booking.url} label={"Copy link"} toast={"Link copied"} />
            </div>
          ))
        ) : (
          <p className={"fp-note"} style={{ margin: "0" }}>
            {"No booking page is published yet. "}
            <a href={"/sheet/consultations?tab=booking"} style={{ color: "var(--blue)" }}>
              {"Set one up in Consultations"}
            </a>
            {"."}
          </p>
        )}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={SHARE_DIALOG}>
          {"Close"}
        </button>
      </div>
    </dialog>
  );
}
