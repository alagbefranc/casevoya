"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { badgeClass } from "@/modules/documents/present";
import {
  authorizeDocumentDownload,
  completeDocumentUpload,
  createDocumentRequest,
  createUploadIntent,
  recordDocumentCustody,
  reviewDocumentVersion,
  setDocumentExpiry,
  unlinkDocumentMatter,
  waiveDocumentRequest,
} from "@/modules/documents/actions";
import type { PortalDocumentCard, PortalDocuments } from "@/modules/documents/load";
import type { PortalViewer } from "@/modules/portal/load";
import { createClient } from "@/lib/supabase/client";

const FORMATS = ["pdf", "jpeg", "png", "heic", "docx"] as const;

export function DocumentsLive({
  page,
  viewer,
  documents,
}: {
  page: string;
  viewer: PortalViewer;
  documents: PortalDocuments;
}) {
  if (page === "upload") return <Upload viewer={viewer} documents={documents} />;
  return <List viewer={viewer} documents={documents} />;
}

function List({ viewer, documents }: { viewer: PortalViewer; documents: PortalDocuments }) {
  const needs = documents.cards.filter((card) => card.needsYou).length;
  const accepted = documents.cards.filter((card) => card.countsAsAccepted).length;
  return (
    <div id="pc">
      <div className="ph">
        <h1 className="display">Documents</h1>
        <p>{documents.progressLine} Accepted means your firm accepted the file for the stated purpose.</p>
      </div>
      <div className="kd-row" style={{ marginBottom: 18, justifyContent: "space-between" }}>
        <div className="seg" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" aria-checked="true" tabIndex={0}>All <span className="sep" aria-hidden="true" /> {documents.cards.length}</button>
          <button type="button" role="radio" aria-checked="false" tabIndex={-1}>Needs you <span className="sep" aria-hidden="true" /> {needs}</button>
          <button type="button" role="radio" aria-checked="false" tabIndex={-1}>Accepted <span className="sep" aria-hidden="true" /> {accepted}</button>
        </div>
        <a className="btn p" href="/portal/upload">Upload a document</a>
      </div>
      <p className="lbl" style={{ margin: "0 0 14px" }}>
        The file type and size are checked against the file itself. A virus scanner is not connected. Uploaded is not the same as accepted. The original file is kept. A preview is not generated.
      </p>
      {documents.cards.length === 0 ? (
        <div className="panel"><div className="emp"><b>No documents requested yet</b><small>When your firm asks for a document, it appears here.</small></div></div>
      ) : documents.cards.map((card) => (
        <Card key={card.key} card={card} organizationId={viewer.organizationId} canReview={documents.canReview} />
      ))}
      {documents.canReview && viewer.matters[0] ? (
        <RequestForm organizationId={viewer.organizationId} matterId={viewer.matters[0].id} people={documents.people} />
      ) : null}
    </div>
  );
}

function Card({
  card,
  organizationId,
  canReview,
}: {
  card: PortalDocumentCard;
  organizationId: string;
  canReview: boolean;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const download = (code: string) => {
    start(async () => {
      const result = await authorizeDocumentDownload({ organizationId, versionId: card.versionId ?? "", code: code || null });
      if ("error" in result) {
        setMessage(result.error ?? "That file cannot be downloaded.");
        return;
      }
      window.location.assign(result.url);
    });
  };

  return (
    <>
      <article className="fcard">
        <div className="th doc" aria-hidden="true" />
        <div>
          <h4>{card.title} <span className="sep" aria-hidden="true" /> {card.personName}</h4>
          <div className="meta">
            <span>{card.meta}</span>
            <span className="sep" />
            <span>{card.personName}</span>
            <span className="sep" />
            <span className="num">{card.versionLabel}</span>
            {card.when ? <><span className="sep" /><time className="num">{card.when}</time></> : null}
          </div>
          <div className="states">
            {card.labels.map((label) => (
              <span key={label} className={badgeClass(label)}><i />{label}</span>
            ))}
          </div>
          {card.canDownload && card.versionId ? (
            <Download organizationId={organizationId} versionId={card.versionId} staff={canReview} pending={pending} onDownload={download} />
          ) : null}
          {card.canReview && card.versionId && card.expectedVersion != null ? (
            <Review organizationId={organizationId} versionId={card.versionId} expectedVersion={card.expectedVersion} />
          ) : null}
          {canReview && card.versionId && card.expectedVersion != null ? (
            <StaffTools card={card} organizationId={organizationId} />
          ) : null}
          {message ? <p className="lbl" role="status">{message}</p> : null}
        </div>
      </article>
      {card.alert ? (
        <div className="alert warn">
          <div><b>Why changes are needed</b> {card.alert}</div>
          <div className="acts"><a className="btn sm" href="/portal/upload">Fix now</a></div>
        </div>
      ) : null}
    </>
  );
}

function Download({
  staff,
  pending,
  onDownload,
}: {
  organizationId: string;
  versionId: string;
  staff: boolean;
  pending: boolean;
  onDownload: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  return (
    <div className="kd-row" style={{ marginTop: 10 }}>
      {staff ? (
        <input className="inp" inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Authenticator code" />
      ) : null}
      <button type="button" className="btn sm" disabled={pending} onClick={() => onDownload(code)}>Download</button>
    </div>
  );
}

function Review({
  organizationId,
  versionId,
  expectedVersion,
}: {
  organizationId: string;
  versionId: string;
  expectedVersion: number;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      style={{ marginTop: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const result = await reviewDocumentVersion({
            organizationId,
            versionId,
            expectedVersion,
            decision: String(form.get("decision") ?? ""),
            reason: String(form.get("reason") ?? ""),
            code: String(form.get("code") ?? ""),
          });
          if ("error" in result) setMessage(result.error ?? "The review was not saved.");
          else router.refresh();
        });
      }}
    >
      <label className="lbl">Firm review
        <select className="inp" name="decision" defaultValue="accepted">
          <option value="accepted">Accept for this purpose</option>
          <option value="changes_requested">Changes needed</option>
        </select>
      </label>
      <input className="inp" name="reason" required minLength={3} maxLength={2000} aria-label="Review reason" placeholder="Reason" />
      <input className="inp" name="code" inputMode="numeric" autoComplete="one-time-code" required aria-label="Authenticator code" placeholder="Authenticator code" />
      <button className="btn sm p" type="submit" disabled={pending}>Save review</button>
      {message ? <p className="lbl" role="status">{message}</p> : null}
    </form>
  );
}

function StaffTools({ card, organizationId }: { card: PortalDocumentCard; organizationId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  if (!card.versionId || card.expectedVersion == null) return null;
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="lbl">Custody, expiry, and matter link</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const kind = String(form.get("kind"));
          start(async () => {
            const code = String(form.get("code") ?? "");
            const result = kind === "expiry"
              ? await setDocumentExpiry({
                organizationId,
                versionId: card.versionId ?? "",
                expectedVersion: card.expectedVersion ?? 0,
                expiresOn: String(form.get("expires") || "") || null,
                code,
              })
              : kind === "unlink" && card.refId
                ? await unlinkDocumentMatter({ organizationId, refId: card.refId, reason: String(form.get("reason") ?? ""), code })
                : kind === "waive" && card.requestId && card.requestVersion != null
                  ? await waiveDocumentRequest({
                    organizationId,
                    requestId: card.requestId,
                    expectedVersion: card.requestVersion,
                    reason: String(form.get("reason") ?? ""),
                    code,
                  })
                  : await recordDocumentCustody({
                    organizationId,
                    versionId: card.versionId ?? "",
                    receivedOn: String(form.get("received") || "") || null,
                    location: String(form.get("location") || "") || null,
                    purpose: String(form.get("purpose") ?? ""),
                    recipient: String(form.get("recipient") || "") || null,
                    returnOn: String(form.get("return") || "") || null,
                    acknowledged: form.get("ack") === "on",
                    code,
                  });
            if ("error" in result) setMessage(result.error ?? "That was not saved.");
            else router.refresh();
          });
        }}
      >
        <input type="hidden" name="kind" value="custody" />
        <input className="inp" name="purpose" aria-label="Custody purpose" placeholder="Why the original moved" />
        <input className="inp" name="location" aria-label="Location" placeholder="Where it is" />
        <input className="inp" name="recipient" aria-label="Recipient" placeholder="Who has it" />
        <input className="inp" type="date" name="received" aria-label="Received on" />
        <input className="inp" type="date" name="return" aria-label="Return on" />
        <input className="inp" type="date" name="expires" aria-label="Expires on" />
        <input className="inp" name="reason" aria-label="Reason" placeholder="Reason, if you waive or unlink" />
        <label className="lbl"><input type="checkbox" name="ack" /> Acknowledgement recorded</label>
        <input className="inp" name="code" inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" placeholder="Authenticator code" />
        <div className="kd-row">
          <button className="btn sm" type="submit" disabled={pending} onClick={(event) => setKind(event.currentTarget.form, "custody")}>Record custody</button>
          <button className="btn sm" type="submit" disabled={pending} onClick={(event) => setKind(event.currentTarget.form, "expiry")}>Set expiry</button>
          {card.requestId ? <button className="btn sm" type="submit" disabled={pending} onClick={(event) => setKind(event.currentTarget.form, "waive")}>Waive request</button> : null}
          {card.refId ? <button className="btn sm" type="submit" disabled={pending} onClick={(event) => setKind(event.currentTarget.form, "unlink")}>Remove matter link</button> : null}
        </div>
        <p className="lbl">Removing a link keeps the file. A waiver is not an acceptance.</p>
        {message ? <p className="lbl" role="status">{message}</p> : null}
      </form>
    </details>
  );
}

function setKind(form: HTMLFormElement | null, kind: string) {
  const field = form?.querySelector<HTMLInputElement>('input[name="kind"]');
  if (field) field.value = kind;
}

function RequestForm({
  organizationId,
  matterId,
  people,
}: {
  organizationId: string;
  matterId: string;
  people: { id: string; displayName: string }[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="panel"
      style={{ marginTop: 18 }}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const formats = FORMATS.filter((format) => form.get(`fmt-${format}`) === "on");
        start(async () => {
          const result = await createDocumentRequest({
            organizationId,
            matterId,
            personId: String(form.get("person") ?? ""),
            purpose: String(form.get("purpose") ?? ""),
            explanation: String(form.get("explanation") ?? ""),
            acceptableFormats: formats,
            audience: String(form.get("audience") ?? "subject"),
            sensitivity: String(form.get("sensitivity") ?? "ordinary"),
            ruleVersionId: String(form.get("rule") || "") || null,
            ruleItemKey: String(form.get("item") || "") || null,
            code: String(form.get("code") ?? ""),
          });
          if ("error" in result) setMessage(result.error ?? "The request was not created.");
          else router.refresh();
        });
      }}
    >
      <h2>Request a document</h2>
      <div className="pad">
        <p className="lbl">This does not invent a checklist. Name the document yourself, or attach a published rule version and item key.</p>
        <select className="inp" name="person" required aria-label="Person">
          {people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
        </select>
        <input className="inp" name="purpose" required maxLength={200} aria-label="Purpose" placeholder="Purpose" />
        <textarea className="inp" name="explanation" required minLength={3} maxLength={2000} aria-label="What the file should show" placeholder="What the file should show" />
        <div className="lbl">Accepted formats {FORMATS.map((format) => (
          <label key={format}><input type="checkbox" name={`fmt-${format}`} defaultChecked /> {format}</label>
        ))}</div>
        <select className="inp" name="audience" aria-label="Who can see it" defaultValue="subject">
          <option value="subject">The person</option>
          <option value="matter">People on the matter</option>
          <option value="staff">Staff only</option>
        </select>
        <select className="inp" name="sensitivity" aria-label="Sensitivity" defaultValue="ordinary">
          <option value="ordinary">Ordinary</option>
          <option value="narrative">Narrative</option>
          <option value="medical">Medical</option>
          <option value="criminal">Criminal</option>
        </select>
        <input className="inp" name="rule" aria-label="Published rule version" placeholder="Published rule version, optional" />
        <input className="inp" name="item" aria-label="Rule item key" placeholder="Rule item key, optional" />
        <input className="inp" name="code" required inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" placeholder="Authenticator code" />
        <button className="btn p" type="submit" disabled={pending}>Request document</button>
        {message ? <p className="lbl" role="status">{message}</p> : null}
      </div>
    </form>
  );
}

function Upload({ viewer, documents }: { viewer: PortalViewer; documents: PortalDocuments }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const matterId = viewer.matters[0]?.id ?? "";
  return (
    <div id="pc">
      <div className="ph">
        <h1 className="display">Upload a document</h1>
        <p>Uploaded means the firm has the file. It is not accepted until a reviewer says so.</p>
      </div>
      <p className="lbl">PDF, JPEG, PNG, HEIC, or DOCX. Up to 25 MB unless the firm has a lower limit. A virus scanner is not connected.</p>
      {documents.requests.length === 0 && !documents.canReview ? (
        <div className="panel"><div className="emp"><b>Nothing to upload</b><small>Your firm has not requested a document.</small></div></div>
      ) : (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const file = data.get("file");
            if (!(file instanceof File) || file.size < 1) {
              setMessage("Choose a file.");
              return;
            }
            const request = documents.requests.find((item) => item.id === String(data.get("request") ?? ""));
            const personId = request?.personId ?? String(data.get("person") ?? "");
            const purpose = request?.purpose ?? String(data.get("purpose") ?? "");
            start(async () => {
              const intent = await createUploadIntent({
                organizationId: viewer.organizationId,
                matterId: request?.matterId ?? matterId,
                personId,
                filename: file.name,
                byteSize: file.size,
                purpose,
                sensitivity: request?.sensitivity ?? String(data.get("sensitivity") ?? "ordinary"),
                audience: request?.audience ?? String(data.get("audience") ?? "subject"),
                documentId: request?.documentId ?? null,
                requestId: request?.id ?? null,
                code: String(data.get("code") ?? "") || null,
              });
              if ("error" in intent) {
                setMessage(intent.error ?? "The upload could not start.");
                return;
              }
              const supabase = createClient();
              const uploaded = await supabase.storage.from("documents").uploadToSignedUrl(intent.path, intent.token, file);
              if (uploaded.error) {
                setMessage("The file did not finish uploading. Try again.");
                return;
              }
              const done = await completeDocumentUpload({ organizationId: viewer.organizationId, versionId: intent.versionId });
              if ("error" in done) {
                setMessage(done.error ?? "The file could not be checked.");
                return;
              }
              if (done.uploadState === "quarantined") {
                setMessage("The file contents do not match the file name. It was quarantined and is not accepted.");
                return;
              }
              if (done.uploadState === "failed") {
                setMessage("The file could not be checked. It is not accepted.");
                return;
              }
              if (done.uploadState === "scanning") {
                setMessage("The file is stored and still being checked. It is not accepted yet.");
                router.push("/portal/documents");
                return;
              }
              router.push("/portal/documents");
            });
          }}
        >
          <div className="pad">
            {documents.requests.length > 0 ? (
              <label className="lbl">Request
                <select className="inp" name="request" aria-label="Request" defaultValue={documents.requests[0]?.id}>
                  {documents.canReview ? <option value="">No request</option> : null}
                  {documents.requests.map((request) => (
                    <option key={request.id} value={request.id}>{request.purpose} · {request.personName}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {documents.canReview ? (
              <>
                <select className="inp" name="person" aria-label="Person">
                  {documents.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
                </select>
                <input className="inp" name="purpose" aria-label="Purpose" placeholder="Purpose, if this is not a request" />
                <input className="inp" name="code" inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" placeholder="Authenticator code" />
              </>
            ) : null}
            <div className="drop">
              <b style={{ fontWeight: 500 }}>Choose a file</b>
              <label className="btn">Choose a file<input className="sr" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic" /></label>
              <small className="lbl">PDF, JPEG, PNG, HEIC, or DOCX <span className="sep" aria-hidden="true" /> up to 25 MB</small>
            </div>
            <button className="btn p" type="submit" disabled={pending}>{pending ? "Uploading" : "Send to your firm"}</button>
            {message ? <p className="lbl" role="status">{message}</p> : null}
          </div>
        </form>
      )}
    </div>
  );
}
