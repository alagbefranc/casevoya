/**
 * Live only (SRC-01, SRC-02, SRC-03): the Source review workbench parts the Designer has no capture
 * for, built from its own pieces. Add claim (a dialog with the Designer's `.dlg`, `.fld`, `.inp`,
 * `.sel`, `.ta` fields), each claim's evidence as the Designer's `details.src` source block with
 * every date on its own line (Unknown when the page doesn't state it), and the review panel in the
 * shape of the Designer's "Actions for your role" panel, wired to real actions. Buttons carry
 * `data-claim-act` (source-claim-acts.ts); the database decides who may do what.
 */
import { Fragment } from "react";
import { Icon } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import { PageAttestFields } from "./page-attestation";

export type AddClaimData = {
  organizationId: string;
  /** Firm owner, licensed consultant or case manager. */
  canAdd: boolean;
  today: string;
};

export type ClaimEvidenceItem = {
  publisher: string;
  url: string;
  section: string;
  excerpt: string | null;
  form: string | null;
  capture: string;
  captured: boolean;
  dates: { label: string; value: string }[];
};

export type ClaimReviewData = {
  organizationId: string;
  id: string;
  version: number;
  status: MatterBadge;
  reason: string | null;
  value: string | null;
  applicability: string;
  /** Firm owner or licensed consultant. */
  licensed: boolean;
  canResolve: boolean;
  canApprove: boolean;
  canReject: boolean;
  canSuspend: boolean;
  /** A suspended version: a licensed member unsuspends it with a fresh step-up (live only). */
  canUnsuspend?: boolean;
  /** Some evidence has no capture: approving needs the reviewer's attestation. */
  needsAttestation: boolean;
  today: string;
  nextReviewDefault: string;
};

export function AddClaimButton({ data }: { data: AddClaimData }) {
  return (
    <div className={"fp-row rv"} style={{ "--i": "1", marginBottom: "16px" } as React.CSSProperties}>
      <button className={"btn sm"} data-dlg={"dlgClaim"} disabled={data.canAdd ? undefined : true}>
        <Icon name={"plus"} cls={"ic s"} />
        {" Add claim"}
      </button>
      <span className={"mu"} style={{ fontSize: "13px" }}>
        {"A claim your firm adds (a processing time, for example) keeps its exact official page and section, Casevoya’s capture of the page and the dates it states. A licensed reviewer approves it before it is live."}
      </span>
    </div>
  );
}

export function ClaimEvidenceList({ items }: { items: ClaimEvidenceItem[] }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={"link"} />
        {`Evidence (${items.length})`}
      </h2>
      <div className={"fp-pad"}>
        {items.length === 0 ? <p className={"mu"}>{"No evidence recorded. This claim can’t be approved."}</p> : null}
        {items.map((item, index) => (
          <details key={index} className={"src"} open={index === 0 ? true : undefined} style={index > 0 ? { marginTop: "10px" } : undefined}>
            <summary>
              <Icon name={"link"} cls={"ic s"} />
              <span>
                <b style={{ fontWeight: "500" }}>{"Source"}</b> <span className={"sep"} aria-hidden={"true"}></span>
                {` ${item.publisher}`}
              </span>
              <Badge badge={item.captured ? { tone: "ok", label: "Captured" } : { tone: "unv", label: "Not captured" }} />
              <Icon name={"chevron-down"} cls={"ic s ch"} />
            </summary>
            <dl>
              <dt>{"Link"}</dt>
              <dd>
                <a href={item.url} rel={"noopener"} target={"_blank"}>
                  {`${item.url} `}
                  <Icon name={"external-link"} cls={"ic s"} />
                  <span className={"sr"}>{"(opens in a new tab)"}</span>
                </a>
              </dd>
              <dt>{"Section"}</dt>
              <dd>{item.section}</dd>
              {item.excerpt ? (
                <>
                  <dt>{"The page says"}</dt>
                  <dd>{`“${item.excerpt}”`}</dd>
                </>
              ) : null}
              {item.form ? (
                <>
                  <dt>{"Form"}</dt>
                  <dd>{item.form}</dd>
                </>
              ) : null}
              {item.dates.map((line) => (
                <Fragment key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>
                    <time className={"num"}>{line.value}</time>
                  </dd>
                </Fragment>
              ))}
              <dt>{"Capture"}</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{item.capture}</dd>
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}

export function ClaimReviewPanel({ review }: { review: ClaimReviewData }) {
  const any = review.canResolve || review.canApprove || review.canReject || review.canSuspend || review.canUnsuspend;
  return (
    <div className={"panel"} style={{ marginTop: "16px" }}>
      <div className={"fp-pad"}>
        <h3 style={{ fontSize: "15px", fontWeight: "500", marginBottom: "10px" }}>{"Review"}</h3>
        <p style={{ marginBottom: "8px" }}>
          <Badge badge={review.status} />
        </p>
        {review.value ? <p style={{ marginBottom: "6px" }}>{`Value: ${review.value}`}</p> : null}
        <p className={"fp-note"}>{`Applicability: ${review.applicability}`}</p>
        {review.reason ? <p className={"fp-note"}>{`Reason: ${review.reason}`}</p> : null}
        {any ? (
          <div className={"fp-row"} style={{ marginTop: "10px" }}>
            {review.canResolve ? (
              <button className={"btn sm"} data-dlg={"dlgClaimResolve"}>
                {"Resolve applicability"}
              </button>
            ) : null}
            {review.canApprove ? (
              <button className={"btn p sm"} data-dlg={"dlgClaimApprove"}>
                {"Approve and publish"}
              </button>
            ) : null}
            {review.canReject ? (
              <button className={"btn sm"} data-dlg={"dlgClaimReject"}>
                {"Reject"}
              </button>
            ) : null}
            {review.canSuspend ? (
              <button className={"btn sm"} data-dlg={"dlgClaimSuspend"}>
                {"Suspend"}
              </button>
            ) : null}
            {review.canUnsuspend ? (
              <button className={"btn sm"} data-dlg={"dlgClaimUnsuspend"}>
                {"Unsuspend"}
              </button>
            ) : null}
          </div>
        ) : null}
        <p className={"fp-note"}>
          {review.licensed
            ? "Approving needs a step-up. It locks this version and makes it live for its program; a version you entered yourself is approved by another licensed member when the firm has one."
            : "A firm owner or licensed consultant resolves applicability and approves claims. Each step is logged with who did it."}
        </p>
      </div>
    </div>
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

export function AddClaimDialog({ data }: { data: AddClaimData }) {
  const ids = { "data-org": data.organizationId };
  return (
    <dialog className={"dlg"} id={"dlgClaim"} aria-labelledby={"dlgClaimH"}>
      <DialogHead id={"dlgClaim"} title={"Add claim"} />
      <div className={"db"}>
        <p className={"fp-note"} style={{ marginTop: 0 }}>
          {"For a claim Casevoya hasn’t captured, a processing time for example. Captured official claims are already live in Source review; edit your firm’s wording there."}
        </p>
        <Field id={"clC"} label={"Claim"} help={"In the page’s words: what it says and who it applies to."}>
          <textarea className={"ta"} id={"clC"} maxLength={2000}></textarea>
        </Field>
        <Field id={"clV"} label={"Value (optional)"} help={"An amount or period exactly as the page prints it."}>
          <input className={"inp"} id={"clV"} maxLength={200} />
        </Field>
        <Field id={"clP"} label={"Program key (optional)"} help={"For example study_permit. Leave empty when the claim isn’t tied to one program."}>
          <input className={"inp"} id={"clP"} maxLength={80} />
        </Field>
        <Field id={"clU"} label={"Exact official page, with the section anchor"} help={"canada.ca or a gc.ca site, never a homepage. For example …/fees.asp#temporary."}>
          <input className={"inp"} id={"clU"} type={"url"} maxLength={2000} />
        </Field>
        <Field id={"clS"} label={"Section"}>
          <input className={"inp"} id={"clS"} maxLength={300} />
        </Field>
        <Field id={"clX"} label={"What the page says (excerpt, optional)"}>
          <textarea className={"ta"} id={"clX"} maxLength={600}></textarea>
        </Field>
        <Field id={"clA"} label={"Applicability note (optional)"} help={"Who and what it applies to. A licensed reviewer resolves applicability before approval."}>
          <textarea className={"ta"} id={"clA"} maxLength={2000}></textarea>
        </Field>
        <Field id={"clF"} label={"Form number and its date modified (only for a form)"}>
          <span className={"fp-row"}>
            <input className={"inp"} id={"clF"} maxLength={40} placeholder={"Form number"} />
            <input className={"inp"} id={"clFm"} type={"date"} max={data.today} aria-label={"Form date modified"} />
          </span>
        </Field>
        <p className={"fp-note"}>{"Dates only as the page states them. Leave a date empty when the page doesn’t give it: it shows as Unknown. When Casevoya captures the page, the dates it prints are used."}</p>
        <Field id={"clDp"} label={"Published"}>
          <input className={"inp"} id={"clDp"} type={"date"} max={data.today} />
        </Field>
        <Field id={"clDm"} label={"Date modified"}>
          <input className={"inp"} id={"clDm"} type={"date"} max={data.today} />
        </Field>
        <Field id={"clDa"} label={"Last amended (Justice Laws)"}>
          <input className={"inp"} id={"clDa"} type={"date"} max={data.today} />
        </Field>
        <Field id={"clDc"} label={"Current to (Justice Laws)"}>
          <input className={"inp"} id={"clDc"} type={"date"} max={data.today} />
        </Field>
        <Field id={"clDe"} label={"Effective from, and until (only when stated)"}>
          <span className={"fp-row"}>
            <input className={"inp"} id={"clDe"} type={"date"} aria-label={"Effective from"} />
            <input className={"inp"} id={"clDt"} type={"date"} aria-label={"Effective until"} />
          </span>
        </Field>
        <Field id={"clD"} label={"Date you checked the page"}>
          <input className={"inp"} id={"clD"} type={"date"} max={data.today} defaultValue={data.today} />
        </Field>
        {data.canAdd ? null : (
          <p className={"fp-note"} role={"note"}>
            {"Only a firm owner, licensed consultant or case manager can add claims."}
          </p>
        )}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgClaim"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-claim-act={"add"} {...ids} disabled={data.canAdd ? undefined : true}>
          {"Save as draft"}
        </button>
      </div>
    </dialog>
  );
}

export function ClaimReviewDialogs({ review }: { review: ClaimReviewData }) {
  const ids = { "data-org": review.organizationId, "data-id": review.id, "data-v": String(review.version) };
  return (
    <>
      {review.canResolve ? (
        <dialog className={"dlg"} id={"dlgClaimResolve"} aria-labelledby={"dlgClaimResolveH"}>
          <DialogHead id={"dlgClaimResolve"} title={"Resolve applicability"} />
          <div className={"db"}>
            <Field id={"crR"} label={"Does this claim apply to the program it is for?"}>
              <select className={"sel"} id={"crR"} defaultValue={"applies"}>
                <option value={"applies"}>{"Applies"}</option>
                <option value={"partly"}>{"Applies in part"}</option>
                <option value={"does_not_apply"}>{"Doesn’t apply"}</option>
              </select>
            </Field>
            <Field id={"crN"} label={"Note"} help={"Who and what it applies to, and any limits. Required."}>
              <textarea className={"ta"} id={"crN"} maxLength={2000}></textarea>
            </Field>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimResolve"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"resolve"} {...ids}>
              {"Save"}
            </button>
          </div>
        </dialog>
      ) : null}
      {review.canApprove ? (
        <dialog className={"dlg"} id={"dlgClaimApprove"} aria-labelledby={"dlgClaimApproveH"}>
          <DialogHead id={"dlgClaimApprove"} title={"Approve and publish"} />
          <div className={"db"}>
            <p className={"fp-note"}>{"Approving locks this version and makes it live for its program. Earlier live versions of this claim are superseded. It needs a step-up."}</p>
            <Field id={"caD"} label={"Next review"}>
              <input className={"inp"} id={"caD"} type={"date"} min={review.today} defaultValue={review.nextReviewDefault} />
            </Field>
            <Field id={"caN"} label={"Review note (optional)"}>
              <textarea className={"ta"} id={"caN"} maxLength={2000}></textarea>
            </Field>
            {review.needsAttestation ? <PageAttestFields today={review.today} /> : null}
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimApprove"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"approve"} {...ids}>
              {"Approve and publish"}
            </button>
          </div>
        </dialog>
      ) : null}
      {review.canReject ? (
        <dialog className={"dlg"} id={"dlgClaimReject"} aria-labelledby={"dlgClaimRejectH"}>
          <DialogHead id={"dlgClaimReject"} title={"Reject this version"} />
          <div className={"db"}>
            <Field id={"cjN"} label={"Why"} help={"Kept with the version and shown in the workbench."}>
              <textarea className={"ta"} id={"cjN"} maxLength={500}></textarea>
            </Field>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimReject"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"reject"} {...ids}>
              {"Reject"}
            </button>
          </div>
        </dialog>
      ) : null}
      {review.canSuspend ? (
        <dialog className={"dlg"} id={"dlgClaimSuspend"} aria-labelledby={"dlgClaimSuspendH"}>
          <DialogHead id={"dlgClaimSuspend"} title={"Suspend this version"} />
          <div className={"db"}>
            <p className={"fp-note"}>{"It stops being live straight away. A licensed member can unsuspend it later with a step-up, or add and approve a new version."}</p>
            <Field id={"csN"} label={"Why"}>
              <textarea className={"ta"} id={"csN"} maxLength={500}></textarea>
            </Field>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimSuspend"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"suspend"} {...ids}>
              {"Suspend"}
            </button>
          </div>
        </dialog>
      ) : null}
      {review.canUnsuspend ? (
        <dialog className={"dlg"} id={"dlgClaimUnsuspend"} aria-labelledby={"dlgClaimUnsuspendH"}>
          <DialogHead id={"dlgClaimUnsuspend"} title={"Unsuspend this version"} />
          <div className={"db"}>
            <p className={"fp-note"}>{"It is live again for its program. It needs a fresh step-up; who did it and why are kept with the version."}</p>
            <Field id={"cuN"} label={"Why"}>
              <textarea className={"ta"} id={"cuN"} name={"cuN"} maxLength={500}></textarea>
            </Field>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-close={"dlgClaimUnsuspend"}>
              {"Cancel"}
            </button>
            <button className={"btn p"} data-claim-act={"unsuspend"} {...ids}>
              {"Unsuspend"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
