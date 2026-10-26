"use client";

import { useState, useTransition, type CSSProperties } from "react";
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
import { draftInFrench } from "@/modules/i18n/actions";
import type { PortalViewer } from "@/modules/portal/load";
import { createClient } from "@/lib/supabase/client";
import { checkUploadFile, formatList, uploadFailure, type UploadFailure } from "@/modules/portal/upload-failure";
import { Seg } from "./seg";
import { UploadFailed } from "./upload-failed";

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

type Show = "all" | "needs" | "accepted";

const SPRITE = "/assets/icons-coreui/sprite.svg";

function Glyph({ name, size = "s" }: { name: string; size?: "s" | "l" | "" }) {
  return (
    <svg className={size ? `ic ${size}` : "ic"} aria-hidden="true">
      <use href={`${SPRITE}#i-${name}`}></use>
    </svg>
  );
}

/**
 * The Documents page, laid out as design/portal/pages/portal-documents.html: the All / Needs you /
 * Accepted switch, the client's requested documents, then documents others on the file shared.
 * Staff previewing it keep the review tools and the request form under the cards.
 */
function List({ viewer, documents }: { viewer: PortalViewer; documents: PortalDocuments }) {
  const [show, setShow] = useState<Show>("all");
  const firm = viewer.organizationName;
  const self = viewer.person?.id ?? null;
  const needs = documents.cards.filter((card) => card.needsYou);
  const accepted = documents.cards.filter((card) => card.countsAsAccepted);
  const shown = show === "needs" ? needs : show === "accepted" ? accepted : documents.cards;
  const mine = documents.canReview || !self ? shown : shown.filter((card) => card.personId === self || card.requestId);
  const shared = documents.canReview || !self ? [] : shown.filter((card) => card.personId !== self && !card.requestId);
  const filters: [Show, string, number][] = [
    ["all", "All", documents.cards.length],
    ["needs", "Needs you", needs.length],
    ["accepted", "Accepted", accepted.length],
  ];
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        <div>
          <h1 className="display">Documents</h1>
          <p>Everything you’ve sent, and what {firm} thinks of it. Uploaded is not the same as accepted.</p>
        </div>
      </div>
      <div className="kd-row rv" style={{ "--i": "1", marginBottom: 18, justifyContent: "space-between" } as CSSProperties}>
        <Seg label="Show" options={filters.map(([key, label, count]) => ({ key, label, count }))} value={show} onChange={setShow} />
        <a className="btn p" href="/portal/upload"><Glyph name="upload" />Upload a document</a>
      </div>
      {documents.cards.length === 0 ? (
        <div className="panel"><div className="emp"><b>No documents requested yet</b><small>When {firm} asks for a document, it appears here.</small></div></div>
      ) : shown.length === 0 ? (
        <div className="panel"><div className="emp"><b>{show === "needs" ? "Nothing needs you" : "Nothing accepted yet"}</b><small>{show === "needs" ? "Every document you were asked for is in." : `Accepted documents appear here once ${firm} checks them.`}</small></div></div>
      ) : null}
      {mine.length ? (
        <>
          <h2 className="sub">{documents.canReview ? "Documents" : `Requested by ${firm}`}</h2>
          <div style={{ display: "grid", gap: 10 }} className="rv">
            {mine.map((card) => (
              <Card key={card.key} card={card} self={self} organizationId={viewer.organizationId} canReview={documents.canReview} />
            ))}
          </div>
        </>
      ) : null}
      {shared.length ? (
        <>
          <h2 className="sub">Shared with you by others</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {shared.map((card) => (
              <Card key={card.key} card={card} self={self} organizationId={viewer.organizationId} canReview={false} />
            ))}
          </div>
        </>
      ) : null}
      <p className="lbl" style={{ marginTop: 18 }}>
        Each file’s type and size are checked against the file itself before anyone opens it. Your originals are kept as you sent them.
      </p>
      {documents.canReview && viewer.matters[0] ? (
        <RequestForm organizationId={viewer.organizationId} matterId={viewer.matters[0].id} people={documents.people} />
      ) : null}
    </div>
  );
}

function Card({
  card,
  self,
  organizationId,
  canReview,
}: {
  card: PortalDocumentCard;
  self: string | null;
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
  const whose = card.personId === self ? "You" : card.personName;
  const checking = card.labels.includes("Checking file");

  return (
    <>
      <article className="fcard k2-spot" data-spot="1">
        <div className="th"><Glyph name="file" size="l" /></div>
        <div>
          <h4>{card.title}</h4>
          <div className="meta">
            {card.meta && card.meta !== card.title ? <><span>{card.meta}</span><span className="sep" /></> : null}
            <span>{whose}</span>
            {card.versionLabel && card.versionLabel !== "Requested" ? <><span className="sep" /><span className="num">{card.versionLabel}</span></> : null}
            {card.when ? <><span className="sep" /><time className="num">{card.when}</time></> : null}
            {!canReview && card.canDownload && card.versionId ? (
              <>
                <span className="sep" />
                <button type="button" disabled={pending} onClick={() => download("")} style={{ color: "var(--blue)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                  Download
                </button>
              </>
            ) : null}
          </div>
          {card.canReview && card.versionId && card.expectedVersion != null ? (
            <Review organizationId={organizationId} versionId={card.versionId} expectedVersion={card.expectedVersion} />
          ) : null}
          {canReview && card.versionId && card.expectedVersion != null ? (
            <StaffTools card={card} organizationId={organizationId} />
          ) : null}
          {message ? <p className="lbl" role="status">{message}</p> : null}
        </div>
        <div className="states">
          {card.labels.map((label) => (
            <span key={label} className={badgeClass(label)}><i />{label}</span>
          ))}
          {card.needsYou && !card.alert && card.personId === self ? <a className="btn sm p" href="/portal/upload">Upload</a> : null}
          {canReview && card.canDownload && card.versionId ? (
            <Download organizationId={organizationId} versionId={card.versionId} staff={canReview} pending={pending} onDownload={download} />
          ) : null}
        </div>
        {checking ? <div className="prog"><i style={{ "--v": "100%" } as CSSProperties}></i></div> : null}
      </article>
      {card.alert ? (
        <div className="alert warn" style={{ margin: "-4px 0 6px" }}>
          <Glyph name="alert" size="" />
          <div><b>Why changes are needed</b>“{card.alertLang === "fr" ? <span lang="fr">{card.alert}</span> : card.alert}”</div>
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
    <div className="kd-row" style={{ justifyContent: "flex-end" }}>
      {staff ? (
        <input className="inp" inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Authenticator code" />
      ) : null}
      <button type="button" className="btn s sm" disabled={pending} onClick={() => onDownload(code)}><Glyph name="download" />Download</button>
    </div>
  );
}

/**
 * The firm's review form. Live-only portal control (not Designer markup). The French reason is a
 * documented live-only addition (tests/designer-fidelity.test.tsx): a "Draft in French" button, a
 * French reason field, and for a machine draft the "Machine draft: check before sending" note
 * and a required check box. Existing classes only (inp, btn sm, lbl, kd-row); no new styles.
 */
export function Review({
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
  const [reason, setReason] = useState("");
  const [french, setFrench] = useState("");
  // True while the French field holds (an edit of) a machine draft; cleared when it is emptied.
  const [machine, setMachine] = useState(false);
  const [drafting, startDraft] = useTransition();
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
            reasonFr: french.trim() || null,
            reasonFrMachine: machine && Boolean(french.trim()),
            reasonFrReviewed: form.get("fr_checked") === "on",
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
      <input className="inp" name="reason" required minLength={3} maxLength={2000} aria-label="Review reason" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      <div className="kd-row">
        <button
          type="button"
          className="btn sm"
          disabled={drafting || pending || reason.trim().length < 3}
          onClick={() => {
            startDraft(async () => {
              const result = await draftInFrench({ organizationId, text: reason });
              if ("error" in result) {
                setMessage(result.error ?? "The French draft could not be made.");
                return;
              }
              setFrench(result.text);
              setMachine(true);
              setMessage("");
            });
          }}
        >
          {drafting ? "Drafting" : "Draft in French"}
        </button>
      </div>
      <textarea
        className="inp"
        name="reason_fr"
        lang="fr"
        maxLength={2000}
        aria-label="Reason in French, for a client who prefers French"
        aria-describedby={machine && french ? `fr-note-${versionId}` : undefined}
        placeholder="Reason in French, optional"
        value={french}
        onChange={(event) => {
          setFrench(event.target.value);
          if (!event.target.value.trim()) setMachine(false);
        }}
      />
      {machine && french ? (
        <>
          <p className="lbl" role="note" id={`fr-note-${versionId}`}>Machine draft: check before sending. Edit it until it says what you mean; the client sees it if they chose French.</p>
          <label className="lbl"><input type="checkbox" name="fr_checked" required /> I checked this French</label>
        </>
      ) : null}
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

const UPLOAD_STEPS = ["Request", "Whose", "Add pages", "Check", "Send"] as const;
/** The 25 MB product default, when the firm's own limit wasn't read. */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** "25 MB", "30 MB", "2.5 MB". */
export function limitText(bytes: number): string {
  const mb = Math.round((bytes / 1024 / 1024) * 10) / 10;
  return `${mb} MB`;
}

function bytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** "PDF, JPG, PNG, HEIC or DOCX", or only the formats the chosen request accepts (DOC-01; main's formatList). */
export function formatsText(formats: readonly string[] | undefined): string {
  return formatList(formats ?? []);
}

function audienceLine(audience: string, person: string, self: boolean, firm: string): string {
  if (audience === "matter") return "Shared on the matter. People on it can see it.";
  if (audience === "staff") return `Only ${firm} can see it.`;
  return self ? "Only you and your firm can see it." : `Only ${person} and your firm can see it.`;
}

/**
 * Upload a document, laid out as design/portal/pages/portal-upload.html: five steps (which
 * request, whose it is, the file, a readability check, then sending). One file per upload; the
 * same upload calls as before (intent, signed upload, completion check).
 */
function Upload({ viewer, documents }: { viewer: PortalViewer; documents: PortalDocuments }) {
  const router = useRouter();
  const firm = viewer.organizationName;
  const self = viewer.person?.id ?? null;
  const staff = documents.canReview;
  const [at, setAt] = useState(0);
  const [requestId, setRequestId] = useState<string>(documents.requests[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [readable, setReadable] = useState(false);
  const [over, setOver] = useState(false);
  const [person, setPerson] = useState(documents.people[0]?.id ?? "");
  const [purpose, setPurpose] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "checking" | "failed">("idle");
  // DES-04: why the file wasn't taken (wrong type, too large, the check, an expired link, the
  // connection), with its retry. Set before sending (the file check) or after (the upload calls).
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [pending, start] = useTransition();
  const request = documents.requests.find((item) => item.id === requestId) ?? null;
  const cardFor = (id: string) => documents.cards.find((card) => card.requestId === id) ?? null;
  const maxBytes = documents.maxBytes ?? DEFAULT_MAX_BYTES;

  if (documents.requests.length === 0 && !staff) {
    return (
      <div id="pc">
        <div className="flow">
          <a className="lbl" href="/portal/documents" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 12 }}><Glyph name="chevron-left" />Documents</a>
          <div className="ph pp-h"><div><h1 className="display">Upload a document</h1></div></div>
          <div className="panel"><div className="emp"><b>Nothing to upload</b><small>{firm} hasn’t asked for a document. When they do, it appears here.</small></div></div>
        </div>
      </div>
    );
  }

  const choose = (picked: File | null | undefined) => {
    if (!picked) return;
    // The type the request accepts and the firm's size limit, before anything is sent.
    const refused = checkUploadFile(picked, { maxBytes, formats: request?.formats ?? null });
    if (refused) {
      setFailure(refused);
      setMessage("");
      return;
    }
    setFailure(null);
    setMessage("");
    setFile(picked);
    setReadable(false);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return picked.type.startsWith("image/") && picked.type !== "image/heic" ? URL.createObjectURL(picked) : null;
    });
  };

  const send = () => {
    if (!file) return;
    setStatus("sending");
    setMessage("");
    setFailure(null);
    const fail = (reason: UploadFailure) => {
      setStatus("failed");
      setFailure(reason);
    };
    start(async () => {
      // No answer at all (offline, a dropped connection) is a failure with a retry, not a stuck page.
      try {
        await sendFile(file, fail);
      } catch {
        fail(uploadFailure({ stage: "transfer", thrown: true }));
      }
    });
  };

  // The same upload calls as before (intent, signed upload, the server's file check); each failure
  // is named by uploadFailure so the person sees what happened and what to do next.
  const sendFile = async (picked: File, fail: (reason: UploadFailure) => void) => {
    const file = picked;
    {
      const intent = await createUploadIntent({
        organizationId: viewer.organizationId,
        matterId: request?.matterId ?? viewer.matters[0]?.id ?? "",
        personId: request?.personId ?? person,
        filename: file.name,
        byteSize: file.size,
        purpose: request?.purpose ?? purpose,
        sensitivity: request?.sensitivity ?? "ordinary",
        audience: request?.audience ?? "subject",
        documentId: request?.documentId ?? null,
        requestId: request?.id ?? null,
        code: code || null,
      });
      if ("error" in intent) {
        fail(uploadFailure({ stage: "intent", message: intent.error ?? null }));
        return;
      }
      const supabase = createClient();
      const uploaded = await supabase.storage.from("documents").uploadToSignedUrl(intent.path, intent.token, file);
      if (uploaded.error) {
        fail(uploadFailure({ stage: "transfer", message: uploaded.error.message }));
        return;
      }
      const done = await completeDocumentUpload({ organizationId: viewer.organizationId, versionId: intent.versionId });
      if ("error" in done) {
        fail(uploadFailure({ stage: "check", message: done.error ?? null }));
        return;
      }
      if (done.uploadState === "quarantined" || done.uploadState === "failed") {
        fail(uploadFailure({ stage: "check", state: done.uploadState }));
        return;
      }
      setStatus(done.uploadState === "scanning" ? "checking" : "sent");
      router.refresh();
    }
  };

  // The retry: another file goes back to "Add the file"; the same file is sent again with a new
  // upload authorisation (an expired one is never reused).
  const retry = () => {
    if (!failure || failure.retry === "choose") {
      setFailure(null);
      setStatus("idle");
      setFile(null);
      setReadable(false);
      setAt(2);
      return;
    }
    send();
  };

  const canContinue =
    at === 0 ? Boolean(request) || (staff && purpose.trim().length > 1 && Boolean(person)) :
    at === 1 ? true :
    at === 2 ? Boolean(file) :
    at === 3 ? readable && (!staff || code.trim().length > 0) :
    false;
  const goNext = () => {
    if (!canContinue) {
      setMessage(at === 2 ? "Add a file first." : at === 3 ? "Tick the box once every page is readable." : "Pick the request this is for.");
      return;
    }
    setMessage("");
    if (at === 3) {
      setAt(4);
      send();
      return;
    }
    setAt(at + 1);
  };
  const ownerName = request ? (request.personId === self ? "You" : request.personName) : documents.people.find((item) => item.id === person)?.displayName ?? "";
  const step = (index: number) => (index < at ? "d" : index === at ? "c" : "");

  return (
    <div id="pc">
      <div className="flow">
        <a className="lbl" href="/portal/documents" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 12 }}><Glyph name="chevron-left" />Documents</a>
        <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}><div><h1 className="display">Upload a document</h1></div></div>
        <ol className="stepper">
          {UPLOAD_STEPS.map((label, index) => (
            <li key={label} className={step(index)} aria-current={index === at ? "step" : undefined}><span>{index + 1}. {label}</span></li>
          ))}
        </ol>

        <section className={at === 0 ? "fstep on" : "fstep"} aria-labelledby="up-s0">
          <h2 id="up-s0" style={{ fontSize: 22, fontWeight: 400, marginBottom: 6 }}>Which request is this for?</h2>
          <p className="lbl" style={{ marginBottom: 14 }}>Picking the request tells {firm} exactly what you’re answering.</p>
          <div className="pick">
            {documents.requests.map((item) => {
              const card = cardFor(item.id);
              const label = card?.labels.includes("Changes needed") ? "Changes needed" : card?.labels.some((item) => item === "Uploaded" || item === "Checking file") ? "Uploaded" : "Requested";
              return (
                <label key={item.id}>
                  <input type="radio" name="up-request" checked={requestId === item.id} onChange={() => setRequestId(item.id)} />
                  <span>
                    <b style={{ fontWeight: 500 }}>{item.purpose}</b>
                    <small>{item.explanation || `For ${item.personId === self ? "you" : item.personName}`}</small>
                  </span>
                  <span className={badgeClass(label)}><i />{label}</span>
                </label>
              );
            })}
            {staff ? (
              <label>
                <input type="radio" name="up-request" checked={requestId === ""} onChange={() => setRequestId("")} />
                <span><b style={{ fontWeight: 500 }}>Something else</b><small>Not on a request. Name it below.</small></span>
              </label>
            ) : null}
          </div>
          {staff && requestId === "" ? (
            <div className="kd-row" style={{ marginTop: 12 }}>
              <select className="inp" aria-label="Person" value={person} onChange={(event) => setPerson(event.target.value)}>
                {documents.people.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
              <input className="inp" aria-label="Purpose" placeholder="What it is" value={purpose} onChange={(event) => setPurpose(event.target.value)} />
            </div>
          ) : null}
        </section>

        <section className={at === 1 ? "fstep on" : "fstep"} aria-labelledby="up-s1">
          <h2 id="up-s1" style={{ fontSize: 22, fontWeight: 400, marginBottom: 6 }}>Whose document is it?</h2>
          <p className="lbl" style={{ marginBottom: 14 }}>This decides who can see it. Private documents stay private, even inside your family.</p>
          <div className="pick">
            <label>
              <input type="radio" name="up-whose" checked readOnly />
              <span className="av" aria-hidden="true">{ownerName ? ownerName.split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase() : "·"}</span>
              <span>
                <b style={{ fontWeight: 500 }}>{ownerName === "You" ? "Me" : ownerName}</b>
                <small>{audienceLine(request?.audience ?? "subject", ownerName, ownerName === "You", firm)}</small>
              </span>
            </label>
          </div>
          <p className="lbl" style={{ marginTop: 12 }}>{firm} set this when they asked for the document. To change it, write to them in Messages.</p>
        </section>

        <section className={at === 2 ? "fstep on" : "fstep"} aria-labelledby="up-s2">
          <h2 id="up-s2" style={{ fontSize: 22, fontWeight: 400, marginBottom: 6 }}>Add the file</h2>
          <p className="lbl" style={{ marginBottom: 14 }}>Take a photo with your phone or choose a file. A scan or PDF with every page works best.</p>
          <div
            className={over ? "drop over" : "drop"}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              choose(event.dataTransfer.files?.[0]);
            }}
          >
            <span className="art bare" style={{ "--a": "64px" } as CSSProperties} aria-hidden="true">
              <img src="/assets/generated/b2/camera-capture-160@1x.webp" srcSet="/assets/generated/b2/camera-capture-160@2x.webp 2x" width={64} height={64} alt="" loading="lazy" decoding="async" />
            </span>
            <b style={{ fontWeight: 500, fontSize: 16 }}>{file ? file.name : "Drop a file here, or"}</b>
            <div className="kd-row" style={{ justifyContent: "center" }}>
              <label className="btn p"><Glyph name="camera" />Use camera<input type="file" className="sr" accept="image/*" capture="environment" onChange={(event) => choose(event.target.files?.[0])} /></label>
              <label className="btn"><Glyph name="paperclip" />{file ? "Choose another" : "Choose a file"}<input type="file" className="sr" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic" onChange={(event) => choose(event.target.files?.[0])} /></label>
            </div>
            <small className="lbl">{file ? bytes(file.size) : <>{request?.formats?.length ? formatList(request.formats) : "PDF, JPG, PNG, HEIC or DOCX"} <span className="sep" aria-hidden="true" /> {`up to ${limitText(maxBytes)}`}</>}</small>
          </div>
          {failure && at === 2 ? (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="pad"><UploadFailed failure={failure} onRetry={retry} /></div>
            </div>
          ) : null}
        </section>

        <section className={at === 3 ? "fstep on" : "fstep"} aria-labelledby="up-s3">
          <h2 id="up-s3" style={{ fontSize: 22, fontWeight: 400, marginBottom: 6 }}>Check it’s readable</h2>
          <p className="lbl" style={{ marginBottom: 14 }}>Zoom in. If you can read every word, {firm} can too.</p>
          <div className="grid2">
            <div className="pg" style={{ width: "100%" }}>
              <div className="im" style={{ height: 340, padding: 0, overflow: "hidden", display: "grid", placeItems: "center" }}>
                {preview ? <img src={preview} alt={`Preview of ${file?.name ?? "your file"}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <Glyph name="file" size="l" />}
              </div>
              <div className="ctl"><span>{file?.name ?? ""}</span><span className="num">{file ? bytes(file.size) : ""}</span></div>
            </div>
            <div>
              <label className="check">
                <input type="checkbox" checked={readable} onChange={(event) => setReadable(event.target.checked)} />
                <span>Every page is readable<small>Nothing cut off, no glare over text.</small></span>
              </label>
              {staff ? (
                <input className="inp" style={{ marginTop: 12 }} inputMode="numeric" autoComplete="one-time-code" aria-label="Authenticator code" placeholder="Authenticator code" value={code} onChange={(event) => setCode(event.target.value)} />
              ) : null}
              <p className="lbl" style={{ margin: "16px 0 0" }}>Your original file is kept exactly as you sent it. Uploaded isn’t accepted until {firm} checks it.</p>
            </div>
          </div>
        </section>

        <section className={at === 4 ? "fstep on" : "fstep"} aria-labelledby="up-s4">
          <h2 id="up-s4" style={{ fontSize: 22, fontWeight: 400, marginBottom: 6 }}>Sending</h2>
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="pad" role="status">
              {status === "sending" || pending ? <p>Sending {file?.name}…</p> : null}
              {status === "sent" ? <p><b>Sent.</b> {firm} will check it. It shows as Being reviewed in Documents until they do.</p> : null}
              {status === "checking" ? <p><b>Sent.</b> The file is stored and still being checked. It isn’t accepted yet.</p> : null}
              {status === "failed" && failure && !pending ? <UploadFailed failure={failure} onRetry={retry} busy={pending} /> : null}
              {status === "sent" || status === "checking" ? <a className="btn p sm" href="/portal/documents" style={{ marginTop: 10 }}>Back to Documents</a> : null}
            </div>
          </div>
        </section>

        {message && status !== "failed" ? <p className="lbl" role="alert" style={{ color: "var(--red, #b42318)", marginTop: 12 }}>{message}</p> : null}
        <div className="fnav">
          <button className="btn" type="button" style={{ visibility: at === 0 || status === "sent" || status === "checking" || pending ? "hidden" : "visible" }} onClick={() => { setMessage(""); setFailure(null); setStatus("idle"); setAt(Math.max(0, at - 1)); }}>Back</button>
          {at < 4 ? (
            <button className="btn p" type="button" onClick={goNext}>{at === 3 ? "Send" : "Continue"}</button>
          ) : <span />}
        </div>
      </div>
    </div>
  );
}
