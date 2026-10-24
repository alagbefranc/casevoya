/**
 * GOV-05 dialogs on the Government status page: Share with client (a preview of exactly what the
 * client's portal Home will show), Add IRCC estimate, and Review estimate. The Designer has no
 * capture for them, so each is built from the design system's dialog parts, as the matter page's
 * handoff dialogs are (`.dlg wide`, `.dh` with the close button, `.db` with `.fl` fields and an
 * `.alert` note, `.df` with Cancel and a primary button). Controls carry `data-govs` for
 * src/components/sheet/gov-status-acts.ts.
 */
import type { ClientRecordView } from "@/modules/government/status-provenance";
import { Icon } from "./frame";
import { PageAttestFields } from "./page-attestation";

export type GovStatusWire = Record<`data-${string}`, string>;

export type GovShareDialog = { id: string; view: ClientRecordView; wire: GovStatusWire };

export type GovEstimateEntry = { wire: GovStatusWire; url: string; today: string };

export type GovEstimateReview = {
  approve: GovStatusWire;
  reject: GovStatusWire;
  facts: [string, string][];
  href: string;
  /** No page capture: the reviewer's attestation (decided 2026-10-24). */
  attest?: { today: string } | null;
};

export type GovStatusDialogsData = {
  shares: GovShareDialog[];
  estimate: GovEstimateEntry | null;
  review: GovEstimateReview | null;
};

const muted = { color: "var(--t2)", fontSize: "13.5px" } as const;

function Head({ id, title }: { id: string; title: string }) {
  return (
    <div className={"dh"}>
      <h2 id={`${id}T`}>{title}</h2>
      <button className={"x"} aria-label={"Close"} data-x={""}>
        <Icon name={"close"} />
      </button>
    </div>
  );
}

/** The client's card, as /portal shows it (src/components/portal/live.tsx renders the same three parts). */
export function SharedRecordPreview({ view }: { view: ClientRecordView }) {
  return (
    <div className={"panel"} style={{ margin: "0" }}>
      <div className={"pad"}>
        <b style={{ fontWeight: 500, display: "block" }}>{view.title}</b>
        {view.lines.map((line, index) => (
          <span key={index} style={{ display: "block", fontSize: "14px" }}>
            {line}
          </span>
        ))}
        <small style={{ ...muted, display: "block", marginTop: "6px" }}>{view.recorded}</small>
      </div>
    </div>
  );
}

export function GovStatusDialogs({ data }: { data: GovStatusDialogsData }) {
  return (
    <>
      {data.shares.map((share) => (
        <dialog key={share.id} className={"dlg wide"} id={share.id} aria-labelledby={`${share.id}T`}>
          <Head id={share.id} title={"Share with the client"} />
          <div className={"db"}>
            <p style={{ ...muted, marginBottom: "10px" }}>{"The client sees exactly this on their portal Home:"}</p>
            <SharedRecordPreview view={share.view} />
            <div className={"alert info"} style={{ marginTop: "12px" }}>
              <Icon name={"lock"} />
              <div>{"Only this is shown. The evidence file, notes and government references stay with the firm. Sharing can’t be undone."}</div>
            </div>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-x={""}>
              {"Cancel"}
            </button>
            <button className={"btn p"} {...share.wire}>
              {"Share with client"}
            </button>
          </div>
        </dialog>
      ))}
      {data.estimate ? (
        <dialog className={"dlg wide"} id={"dGovEst"} aria-labelledby={"dGovEstT"}>
          <Head id={"dGovEst"} title={"Add IRCC’s processing-time estimate"} />
          <div className={"db"}>
            <label className={"fl"}>
              {"IRCC’s processing-times page"}
              <input id={"geU"} type={"url"} defaultValue={data.estimate.url} autoComplete={"off"} />
            </label>
            <label className={"fl"}>
              {"Application type, as IRCC’s page names it"}
              <input id={"geT"} autoComplete={"off"} />
            </label>
            <label className={"fl"}>
              {"IRCC’s estimate, exactly as shown"}
              <input id={"geV"} autoComplete={"off"} />
            </label>
            <label className={"fl"}>
              {"Date you checked the page"}
              <input id={"geD"} type={"date"} defaultValue={data.estimate.today} max={data.estimate.today} />
            </label>
            <div className={"alert info"} style={{ marginTop: "4px" }}>
              <Icon name={"info"} />
              <div>
                {"Copy it from IRCC’s page; don’t estimate it yourself. A licensed member reviews it before it shows next to the status, labelled as IRCC’s estimate, not a maximum or a guarantee. When Casevoya can reach the page, it records the page’s SHA-256 fingerprint and when it read it."}
              </div>
            </div>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-x={""}>
              {"Cancel"}
            </button>
            <button className={"btn p"} {...data.estimate.wire}>
              {"Send for review"}
            </button>
          </div>
        </dialog>
      ) : null}
      {data.review ? (
        <dialog className={"dlg wide"} id={"dGovEstRev"} aria-labelledby={"dGovEstRevT"}>
          <Head id={"dGovEstRev"} title={"Review IRCC’s processing-time estimate"} />
          <div className={"db"}>
            {data.review.facts.map(([term, value]) => (
              <p key={term} style={{ fontSize: "14px", margin: "0 0 4px" }}>
                <span style={{ color: "var(--t2)" }}>{`${term}: `}</span>
                {value}
              </p>
            ))}
            <p style={{ fontSize: "14px", margin: "8px 0 0" }}>
              <a href={data.review.href} target={"_blank"} rel={"noopener noreferrer"} style={{ textDecoration: "underline" }}>
                {"Open IRCC’s page to compare"}
              </a>
            </p>
            <label className={"fl"} style={{ marginTop: "12px" }}>
              {"Note (required to reject)"}
              <input id={"gerN"} autoComplete={"off"} />
            </label>
            {data.review.attest ? <PageAttestFields today={data.review.attest.today} /> : null}
          </div>
          <div className={"df"}>
            <button className={"btn"} {...data.review.reject}>
              {"Reject"}
            </button>
            <button className={"btn p"} {...data.review.approve}>
              {"Approve"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
