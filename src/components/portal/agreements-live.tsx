"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { acceptQuote, declineAgreement, signAgreement } from "@/modules/agreements/actions";
import type { PortalAgreement, PortalAgreements } from "@/modules/agreements/load";
import type { PortalViewer } from "@/modules/portal/load";

export function AgreementsLive({ viewer, agreements }: { viewer: PortalViewer; agreements: PortalAgreements }) {
  const cards = [...agreements.open, ...agreements.done];
  const firstSign = agreements.open.find((card) => card.canSign)?.id ?? null;
  return (
    <div id="pc">
      <div className="ph">
        <h1 className="display">Agreements</h1>
        <p>What you’ve agreed with {viewer.organizationName}, in writing. Signing happens in Casevoya. Your sealed copy stays here.</p>
      </div>
      {cards.length === 0 ? (
        <div className="panel">
          <div className="emp">
            <b>No agreements yet</b>
            <small>When your firm sends an agreement, it appears here.</small>
          </div>
        </div>
      ) : (
        cards.map((card) => (
          <AgreementCard
            key={card.id}
            card={card}
            organizationId={viewer.organizationId}
            consentText={agreements.consentText}
            signButtonId={card.id === firstSign ? "sg" : undefined}
          />
        ))
      )}
      <div className="alert info">
        <svg className="ic" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-info" /></svg>
        <div>
          <b>Signing stays in Casevoya</b>
          Nothing is marked signed until you confirm. The sealed PDF and its SHA-256 hash do not change afterwards.
        </div>
      </div>
    </div>
  );
}

function AgreementCard({
  card,
  organizationId,
  consentText,
  signButtonId,
}: {
  card: PortalAgreement;
  organizationId: string;
  consentText: string;
  signButtonId?: string;
}) {
  const done = ["completed", "accepted", "declined", "voided", "expired", "superseded"].includes(card.status);
  return (
    <div className="panel">
      <h2>
        <svg className="ic s" aria-hidden="true">
          <use href={`/assets/icons-coreui/sprite.svg#i-${done ? "file-check" : "signature"}`} />
        </svg>
        {card.title}
        <span className="r"><Status status={card.status} canSign={card.canSign} /></span>
      </h2>
      {done ? (
        <Done card={card} organizationId={organizationId} />
      ) : (
        <Open card={card} organizationId={organizationId} consentText={consentText} signButtonId={signButtonId} />
      )}
    </div>
  );
}

function Status({ status, canSign }: { status: string; canSign: boolean }) {
  if (canSign) return <span className="bd blue"><i />Your signature needed</span>;
  if (status === "completed") return <span className="bd ok"><i />Signed by everyone</span>;
  if (status === "accepted") return <span className="bd ok"><i />Quote accepted</span>;
  if (status === "partially_signed") return <span className="bd blue"><i />Waiting on the next signature</span>;
  if (status === "sent") return <span className="bd blue"><i />Sent</span>;
  const label: Record<string, string> = {
    declined: "Declined",
    expired: "Expired",
    voided: "Voided",
    superseded: "Replaced",
    draft: "Draft",
  };
  return <span className="bd"><i />{label[status] ?? status}</span>;
}

function Open({
  card,
  organizationId,
  consentText,
  signButtonId,
}: {
  card: PortalAgreement;
  organizationId: string;
  consentText: string;
  signButtonId?: string;
}) {
  return (
    <div className="split" style={{ "--n": "2" } as CSSProperties}>
      <div>
        <span className="lbl">{card.kind === "quote" ? "Quote" : "What this covers"}</span>
        <p style={{ marginTop: 6 }}>{card.scope}</p>
        <Terms card={card} />
        {card.canSign && card.envelopeId ? (
          <Sign organizationId={organizationId} envelopeId={card.envelopeId} consentText={consentText} needsStepUp={card.needsStepUp} buttonId={signButtonId} />
        ) : null}
        {card.canAccept ? <Accept organizationId={organizationId} agreementId={card.id} /> : null}
      </div>
      <div>
        <span className="lbl">Who signs, in order</span>
        {card.signers.length === 0 ? (
          <p className="lbl" style={{ marginTop: 6 }}>{card.kind === "quote" ? "A quote is accepted. It is not an executed agreement." : "Not sent for signature yet."}</p>
        ) : (
          <div className="job" style={{ marginTop: 6 }}>
            {card.signers.map((signer) => (
              <div key={signer.id} className={signer.status === "signed" ? "done" : signer.status === "current" ? "now" : undefined}>
                <span className="st">
                  {signer.status === "signed" ? (
                    <svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>
                  ) : null}
                </span>
                <span>
                  {signer.name}
                  <small style={{ display: "block" }}>{signerLine(signer.status, signer.signedAt, card.canSign && signer.status === "current")}</small>
                </span>
                <small />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Done({ card, organizationId }: { card: PortalAgreement; organizationId: string }) {
  const download = card.envelopeId && card.status === "completed"
    ? `/api/agreements/${card.envelopeId}/pdf?organizationId=${organizationId}`
    : null;
  return (
    <div className="pad">
      <div className="li">
        <div>
          <b>{card.status === "completed" ? "Executed copy" : card.title}</b>
          <small className="num">
            {card.contentSha ? `SHA-256 ${card.contentSha.slice(0, 16)}` : card.status.replaceAll("_", " ")}
            {card.status === "completed" ? " · Completion certificate included" : ""}
          </small>
        </div>
        {download ? (
          <span className="r">
            <a className="btn sm" href={download}>
              <svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-download" /></svg>
              Download
            </a>
            <a className="btn sm" href={`${download}&which=certificate`}>Certificate</a>
          </span>
        ) : null}
      </div>
      <Terms card={card} />
    </div>
  );
}

function Terms({ card }: { card: PortalAgreement }) {
  const fee = card.feeCents == null
    ? null
    : new Intl.NumberFormat("en-CA", { style: "currency", currency: card.currency }).format(card.feeCents / 100);
  return (
    <details className="src" style={{ marginTop: 6 }}>
      <summary>
        <svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-info" /></svg>
        What you agreed to, in short
        <svg className="ic s ch" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-down" /></svg>
      </summary>
      <dl>
        <dt>Services</dt><dd>{card.scope}</dd>
        {card.exclusions ? <><dt>Not included</dt><dd>{card.exclusions}</dd></> : null}
        {fee ? <><dt>Professional fee</dt><dd className="num">{fee}</dd></> : null}
        {card.governmentFeeNote ? <><dt>Government fees</dt><dd>{card.governmentFeeNote}</dd></> : null}
        {card.refundPolicy ? <><dt>Refunds</dt><dd>{card.refundPolicy}</dd></> : null}
        {card.comparison ? <><dt>What changed</dt><dd>{card.comparison}</dd></> : null}
        {card.contentSha ? <><dt>Locked hash</dt><dd className="num">{card.contentSha}</dd></> : null}
      </dl>
    </details>
  );
}

function Sign({
  organizationId,
  envelopeId,
  consentText,
  needsStepUp,
  buttonId,
}: {
  organizationId: string;
  envelopeId: string;
  consentText: string;
  needsStepUp: boolean;
  buttonId?: string;
}) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="kd-row"
      style={{ marginTop: 14, alignItems: "flex-start" }}
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await signAgreement({ organizationId, envelopeId, consent, code: code || null });
          if ("error" in result) {
            setMessage(result.error ?? "That agreement could not be signed.");
            return;
          }
          setMessage(result.status === "completed" ? "Signed. The sealed copy is stored." : "Signed. The next person can sign.");
          router.refresh();
        });
      }}
    >
      <label className="lbl" style={{ display: "block", maxWidth: "62ch" }}>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {consentText}
      </label>
      {needsStepUp ? (
        <input
          className="inp"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Authenticator code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Authenticator code"
        />
      ) : null}
      <button className="btn p" id={buttonId} type="submit" disabled={pending || !consent}>Review and sign</button>
      <button
        className="btn"
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const result = await declineAgreement({ organizationId, envelopeId, code: code || null });
            if ("error" in result) setMessage(result.error ?? "That agreement could not be declined.");
            else router.refresh();
          });
        }}
      >
        Decline
      </button>
      {message ? <p className="lbl" role="status">{message}</p> : null}
    </form>
  );
}

function Accept({ organizationId, agreementId }: { organizationId: string; agreementId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="kd-row" style={{ marginTop: 14 }}>
      <button
        className="btn p"
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const result = await acceptQuote({ organizationId, agreementId });
            if ("error" in result) setMessage(result.error ?? "That quote could not be accepted.");
            else router.refresh();
          });
        }}
      >
        Accept quote
      </button>
      {message ? <p className="lbl" role="status">{message}</p> : null}
    </div>
  );
}

function signerLine(status: string, signedAt: string | null, yours: boolean): string {
  if (status === "signed" && signedAt) {
    return `Signed ${new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short" }).format(new Date(signedAt))}`;
  }
  if (status === "declined") return "Declined";
  if (yours) return "Waiting for you";
  if (status === "current") return "Waiting";
  return "After the current signer";
}
