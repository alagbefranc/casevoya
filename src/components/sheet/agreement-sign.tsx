"use client";

/**
 * The consultation agreement signing page a booker opens from their private link
 * (/consultation/<booking ref>/agreement), as designed (#166, design/consultations-pr161): landing,
 * a six-digit code emailed to the attendee, review, a typed, drawn or uploaded signature, confirm,
 * done; or decline. End states: already signed, declined, withdrawn, and the link no longer
 * working (the consultation was cancelled or has ended). No login.
 *
 * Every form is a live form (data-live="1"). Errors sit inline next to the control (role=alert);
 * the receipt card, not a toast, says it is signed.
 */
import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "@/components/sheet/designer/frame";
import { firstName, shortFingerprint, type SigningView } from "@/modules/scheduling/agreement-sign-present";
import {
  declineBookingAgreement,
  noteSigningRequest,
  sendSigningCode,
  signBookingAgreement,
  verifySigningCode,
  type SigningRequest,
} from "@/modules/scheduling/agreement-sign";
import { longWhen } from "@/modules/scheduling/format";

type Shown = Exclude<SigningView, { state: "unavailable" }>;
type Open = Extract<SigningView, { state: "open" | "signed" | "closed" }>;
type Step = "landing" | "verify" | "review" | "sign" | "confirm" | "done";
type Mark = { kind: "typed" | "drawn" | "uploaded"; name: string; image: Blob | null; preview: string | null };
/** Screenshots and tests only: where the flow starts. */
type Seed = { message?: { tone: "bad" | "ok"; text: string }; code?: string; mode?: Mark["kind"]; declining?: boolean };

const MAX_IMAGE_BYTES = 1_572_864;

/** The design's signing page styles, on the app's tokens (Inter for text, Erode for headings and the typed mark). */
export const SIGN_PAGE_CSS = `
.es{background:var(--canvas);min-height:100vh;display:flex;flex-direction:column}
.es-top{display:flex;align-items:center;gap:14px;padding:14px clamp(16px,4vw,40px);background:#fff;border-bottom:1px solid var(--line)}
.es-top img{height:28px;width:auto}.es-top .firm{font-weight:500;font-size:16px}
.es-top .sec{margin-left:auto;display:inline-flex;gap:8px;align-items:center;font-size:13.5px;color:#063f6e;background:var(--tint);padding:6px 12px;border-radius:999px}
.es-main{flex:1;width:100%;max-width:760px;margin:0 auto;padding:clamp(20px,5vw,48px) clamp(16px,4vw,24px) 120px}
.es-main.wide{max-width:1180px}
.es-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:clamp(20px,4vw,32px)}
.es h1{font:300 clamp(30px,4.2vw,44px)/1.08 var(--font-erode),Georgia,serif;letter-spacing:-.015em;margin:0 0 10px;color:var(--ink)}
.es .lead{font-size:16px;color:var(--t2);max-width:58ch;margin:0 0 20px}
.es .eyebrow{margin:0 0 8px;font-size:14px;color:var(--t2)}
.es-doc{display:flex;gap:16px;align-items:center;padding:14px 16px;border-radius:14px;background:var(--canvas);margin:0 0 20px}
.es-doc .ic{width:28px;height:28px;color:var(--blue);flex:none}.es-doc b{font-weight:500;display:block}.es-doc small{color:var(--t2);font-size:13.5px}
.es-steps{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:10px;counter-reset:s}
.es-steps li{counter-increment:s;display:grid;grid-template-columns:28px 1fr;gap:12px;font-size:15px;align-items:start}
.es-steps li::before{content:counter(s);width:26px;height:26px;border-radius:50%;background:var(--tint);color:#075b9f;display:grid;place-items:center;font-size:13px}
.es-act{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.es-act .btn{height:46px;padding:0 20px;font-size:15.5px}
.es-link{background:none;border:0;padding:0;font:inherit;font-size:14px;color:var(--t2);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.es-link:disabled{cursor:default;text-decoration:none}
.es-foot{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:center;padding:18px;font-size:13px;color:var(--t2);border-top:1px solid var(--line);background:#fff}
.es-foot a{color:var(--t2)}.es-foot img{height:16px;width:auto;vertical-align:-3px}
.es-meta{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:14px;margin:0 0 20px}.es-meta dt{color:var(--t2)}.es-meta dd{margin:0;overflow-wrap:anywhere}
.es-rev{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}
.es-page{background:#fff;border:1px solid var(--line);border-radius:10px;padding:clamp(20px,5%,44px);display:grid;gap:16px}
.es-page .text{white-space:pre-wrap;font-size:15px;line-height:1.6;max-height:62vh;overflow:auto}
.es-field{display:flex;align-items:center;gap:8px;width:100%;min-height:58px;border-radius:8px;border:1.5px dashed var(--blue);background:#eef6fe;color:#075b9f;font:inherit;padding:0 .9em;cursor:pointer;transition:background 160ms ease-out}
.es-field:hover{background:#e1effd}
.es-mark{display:flex;align-items:center;min-height:84px;padding:12px 18px;border-radius:8px;border:1.5px solid var(--blue);background:#fff;color:#0a3d78}
.es-mark .typed{font:italic 300 34px var(--font-erode),Georgia,serif}.es-mark img{max-height:72px;max-width:100%}
.es-side{display:grid;gap:14px;position:sticky;top:20px}
.es-side .es-card{padding:18px}.es-side h2{font-size:16px;font-weight:500;margin:0 0 10px}
.es-fl{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:14px}.es-fl li{display:flex;gap:8px;align-items:center}.es-fl .ic{color:var(--blue)}
.es-bar{display:none}
.es-seg{display:inline-flex;gap:4px;padding:4px;border-radius:12px;background:var(--canvas);margin:0 0 14px}
.es-seg button{height:36px;padding:0 16px;border:0;border-radius:9px;background:none;font:inherit;font-size:14.5px;color:var(--t2);cursor:pointer}
.es-seg button[aria-selected="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(17,17,17,.08)}
.es-up{display:grid;place-items:center;gap:6px;height:150px;border:1.5px dashed #c9c5c0;border-radius:12px;background:#fff;color:var(--t2);font-size:14px;text-align:center;cursor:pointer}
.es-pad{position:relative;border:1px solid #d6d2cd;border-radius:12px;background:#fff;height:170px;touch-action:none}
.es-pad canvas{width:100%;height:100%;display:block;border-radius:12px;cursor:crosshair}
.es-pad .x{position:absolute;left:18px;bottom:38px;color:#c9c5c0;font-size:18px;pointer-events:none}
.es-pad::after{content:"";position:absolute;left:16px;right:16px;bottom:36px;border-bottom:1px solid #e6e3df;pointer-events:none}
.es-typed{font:italic 300 40px var(--font-erode),Georgia,serif;color:#0a3d78;padding:10px 4px;min-height:64px;overflow-wrap:anywhere}
.es-done{text-align:center;display:grid;justify-items:center;gap:6px}
.es-done>.ic{width:44px;height:44px;color:var(--blue)}.es-done .lead{margin:0 auto}
.es-done .es-act{justify-content:center;margin-top:12px}.es-done .es-meta{text-align:left;margin:14px auto 0}
.es-otp{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;max-width:360px;margin:6px 0 8px}
.es-otp input{height:58px;width:100%;text-align:center;font-size:24px;font-family:var(--font-ui);border-radius:10px;border:1px solid #d6d2cd;background:#fff;color:var(--ink)}
.es-otp input:focus{outline:0;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,117,222,.18)}
.es-otp.bad input{border-color:var(--bad);background:#fffaf9}
.es-msg{font-size:14px;min-height:20px;margin:0}.es-msg.bad{color:var(--bad)}.es-msg.ok{color:#1f7a45}
.es .fp-short{display:none}
.es-dlg[open]{border:0;border-radius:16px;padding:0;max-width:520px;width:calc(100% - 32px)}
@media (max-width:1000px){.es-rev{grid-template-columns:1fr}.es-side{position:static}}
@media (max-width:640px){.es-top{padding:12px 16px}.es-top img{height:22px}.es-top .sec span{display:none}.es-top .sec{padding:6px 9px}
 .es-act .btn{flex:1 1 100%}.es-meta{grid-template-columns:1fr;gap:2px}.es-meta dd{margin-bottom:8px}
 .es-bar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:20;gap:10px;align-items:center;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--line)}
 .es-bar .btn{flex:1;height:48px}.es-bar small{font-size:13px;color:var(--t2);flex:none}
 .es-side .es-act{display:none}.es-foot{padding-bottom:90px}
 .es .fp-full{display:none}.es .fp-short{display:inline}}
@media (prefers-reduced-motion:reduce){.es-field{transition:none}}
`;

/** "SHA-256 <full>" on wide screens, "SHA-256 9f3b…41aa" on a phone. */
function Fingerprint({ sha256 }: { sha256: string }) {
  return (
    <span className={"num"}>
      {"SHA-256 "}
      <span className={"fp-full"} style={{ wordBreak: "break-all" }}>
        {sha256}
      </span>
      <span className={"fp-short"}>{shortFingerprint(sha256)}</span>
    </span>
  );
}

function Shell({ firm, logo, sample, wide, children }: { firm: string; logo: string | null; sample: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={"es"}>
      <style dangerouslySetInnerHTML={{ __html: SIGN_PAGE_CSS }} />
      <a className={"sr"} href={"#main"}>
        {"Skip to content"}
      </a>
      <header className={"es-top"}>
        {logo ? <img src={logo} alt={firm} height={28} /> : <span className={"firm"}>{firm}</span>}
        <span className={"sec"}>
          <Icon name={"lock"} cls={"ic s"} />
          <span>{"Signing secured by Casevoya"}</span>
        </span>
      </header>
      <main className={wide ? "es-main wide" : "es-main"} id={"main"}>
        {sample ? (
          <div className={"es-card"} role={"note"} style={{ marginBottom: "16px", padding: "14px 18px" }}>
            <b style={{ fontWeight: 600, color: "#a15c00" }}>{"Sample mode · practice records are marked sample"}</b>
            <p className={"fp-note"} style={{ margin: "4px 0 0" }}>
              {"This is a practice consultation. Signing it records nothing for a real client."}
            </p>
          </div>
        ) : null}
        {children}
      </main>
      <footer className={"es-foot"}>
        <span>
          <img src={"/assets/brand/casevoya-wordmark.svg"} alt={"Casevoya"} width={100} height={16} /> {"Signing secured by Casevoya"}
        </span>
        <span>{"Every step is recorded with the time and the document’s fingerprint."}</span>
        <a href={"/privacy"}>{"Privacy"}</a>
        <a href={"/help"}>{"Help"}</a>
      </footer>
    </div>
  );
}

/** A request recorded for the firm, confirmed inline (never only a toast). */
function RequestButton({ reference, kind, label, done, primary }: { reference: string; kind: SigningRequest; label: string; done: string; primary?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function run() {
    if (state === "busy" || state === "done") return;
    setState("busy");
    const result = await noteSigningRequest(reference, kind);
    setState("error" in result ? "error" : "done");
  }
  return (
    <>
      <button className={primary ? "btn p" : "es-link"} type={"button"} onClick={run} aria-busy={state === "busy" ? "true" : undefined} disabled={state === "done"}>
        {label}
      </button>
      {state === "done" ? (
        <span className={"es-msg ok"} role={"status"} style={{ display: "block", marginTop: "8px" }}>
          {done}
        </span>
      ) : state === "error" ? (
        <span className={"es-msg bad"} role={"alert"} style={{ display: "block", marginTop: "8px" }}>
          {"That didn’t go through. Try again in a moment."}
        </span>
      ) : null}
    </>
  );
}

function MarkView({ mark }: { mark: { kind: Mark["kind"]; name: string; preview: string | null } }) {
  return (
    <div className={"es-mark"}>
      {mark.kind !== "typed" && mark.preview ? <img src={mark.preview} alt={"Your signature"} /> : <span className={"typed"}>{mark.name}</span>}
    </div>
  );
}

/** The end states that need no flow: declined, withdrawn, the link no longer working, already signed. */
function EndCard({ view, reference }: { view: Shown; reference: string }) {
  if (view.state === "withdrawn") {
    return (
      <div className={"es-card es-done"}>
        <Icon name={"file-check"} />
        <h1>{"This agreement was withdrawn."}</h1>
        <p className={"lead"}>{`${view.firm} withdrew this agreement. Nothing was signed.`}</p>
      </div>
    );
  }
  if (view.state === "declined") {
    return (
      <div className={"es-card es-done"}>
        <Icon name={"file-check"} />
        <h1>{"You declined to sign"}</h1>
        <p className={"lead"}>{`${view.firm} was told, with your reason: “${view.reason}”. Nothing was signed.`}</p>
        <p className={"fp-note"} style={{ margin: "6px auto 0" }}>
          {`Changed your mind? ${view.firm} can send you a corrected version.`}
        </p>
        <div className={"es-act"}>
          <RequestButton reference={reference} kind={"message"} label={`Message ${view.firm}`} done={`${view.firm} was told you’d like to talk. They’ll reply by email.`} primary />
        </div>
      </div>
    );
  }
  if (view.state === "closed") {
    return (
      <div className={"es-card es-done"}>
        <Icon name={"file-check"} />
        <h1>{"This signing link no longer works."}</h1>
        <p className={"lead"}>{`The consultation was cancelled or has ended, so there’s nothing to sign. Nothing was signed. Contact ${view.firm} if you need anything.`}</p>
        <div className={"es-act"}>
          <RequestButton reference={reference} kind={"link_requested"} label={"Ask for a new link"} done={`${view.firm} has been asked to send you a new link.`} primary />
        </div>
      </div>
    );
  }
  if (view.state === "signed") {
    return (
      <div className={"es-card es-done"}>
        <Icon name={"check-circle"} />
        <h1>{"You’ve already signed this"}</h1>
        <p className={"lead"}>
          {`You signed “${view.title}”${view.signedAt ? ` on ${longWhen(Date.parse(view.signedAt), view.timeZone)}` : ""}. There’s nothing more to do.`}
        </p>
        <div style={{ width: "min(420px,100%)", marginTop: "12px" }}>
          <MarkView mark={{ kind: view.signatureKind ?? "typed", name: view.signedName ?? "", preview: view.signatureImage }} />
        </div>
        <dl className={"es-meta"}>
          <dt>{"Fingerprint"}</dt>
          <dd>
            <Fingerprint sha256={view.sha256} />
          </dd>
        </dl>
      </div>
    );
  }
  return null;
}

/** The six code boxes: digits only, paste fills them, the first takes the one-time-code autofill. */
function CodeBoxes({ value, onChange, bad }: { value: string; onChange: (next: string) => void; bad: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  function put(i: number, raw: string) {
    const only = raw.replace(/\D/g, "");
    if (only.length > 1) {
      const next = (value.slice(0, i) + only).slice(0, 6);
      onChange(next);
      refs.current[Math.min(next.length, 5)]?.focus();
      return;
    }
    const next = (value.slice(0, i) + only + value.slice(i + 1)).slice(0, 6);
    onChange(next);
    if (only && i < 5) refs.current[i + 1]?.focus();
  }
  return (
    <div className={bad ? "es-otp bad" : "es-otp"}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`o${i}`}
          inputMode={"numeric"}
          maxLength={i === 0 ? 6 : 1}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of 6`}
          aria-invalid={bad ? "true" : undefined}
          value={digit}
          onChange={(event) => put(i, event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            put(0, event.clipboardData.getData("text"));
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digit && i > 0) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/** A drawing pad for a pointer, finger or stylus. */
function DrawPad({ onInk }: { onInk: (blob: Blob | null, preview: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const scale = window.devicePixelRatio || 1;
    el.width = el.clientWidth * scale;
    el.height = el.clientHeight * scale;
    const ctx = el.getContext("2d");
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0a3d78";
    }
  }, []);
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    const el = canvas.current;
    if (!el || !inked.current) return;
    const preview = el.toDataURL("image/png");
    el.toBlob((blob) => onInk(blob, preview), "image/png");
  }
  function clear() {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    inked.current = false;
    onInk(null, null);
  }
  return (
    <>
      <div className={"es-pad"}>
        <canvas
          ref={canvas}
          aria-label={"Draw your signature with a mouse, finger or stylus"}
          role={"img"}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const ctx = event.currentTarget.getContext("2d");
            const p = point(event);
            ctx?.beginPath();
            ctx?.moveTo(p.x, p.y);
            drawing.current = true;
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const ctx = event.currentTarget.getContext("2d");
            const p = point(event);
            ctx?.lineTo(p.x, p.y);
            ctx?.stroke();
            inked.current = true;
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        <span className={"x"} aria-hidden={"true"}>
          {"×"}
        </span>
      </div>
      <div className={"es-act"} style={{ marginTop: "8px" }}>
        <button className={"es-link"} type={"button"} onClick={clear}>
          {"Clear"}
        </button>
      </div>
    </>
  );
}

/** The decline dialog: a reason the firm sees, then the declined card. */
function DeclineDialog({ open, onClose, firm, reference, onDeclined }: { open: boolean; onClose: () => void; firm: string; reference: string; onDeclined: (reason: string) => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close();
  }, [open]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason) {
      setError(`Say why you’re declining. ${firm} sees this.`);
      return;
    }
    setBusy(true);
    const result = await declineBookingAgreement(reference, reason);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onDeclined(reason);
  }
  return (
    <dialog className={"dlg es-dlg"} ref={dialog} aria-labelledby={"dDeclH"} onClose={onClose}>
      <form data-live={"1"} onSubmit={submit} noValidate>
        <div className={"dh"}>
          <h2 id={"dDeclH"}>{"Decline to sign?"}</h2>
          <button className={"x"} type={"button"} aria-label={"Close"} onClick={onClose}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        <div className={"db"}>
          <p style={{ margin: "0 0 12px" }}>{`${firm} will be told you declined, with your reason. The agreement won’t be signed.`}</p>
          <div className={"fld"}>
            <label htmlFor={"dr"}>{`Reason (${firm} sees this)`}</label>
            <textarea className={"ta"} id={"dr"} name={"reason"} rows={3} maxLength={500} aria-invalid={error ? "true" : undefined}></textarea>
            {error ? (
              <p className={"es-msg bad"} role={"alert"}>
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className={"df"}>
          <button className={"btn"} type={"button"} onClick={onClose}>
            {"Keep reviewing"}
          </button>
          <button className={"btn p"} type={"submit"} aria-busy={busy ? "true" : undefined}>
            {"Decline"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** The open agreement's flow: landing, code, review, signature, confirm, done. */
function Flow({
  view,
  reference,
  initialStep = "landing",
  initialMark = null,
  seed = {},
  onDeclined,
}: {
  view: Open;
  reference: string;
  initialStep?: Step;
  initialMark?: Mark | null;
  seed?: Seed;
  onDeclined: (reason: string) => void;
}) {
  const first = firstName(view.attendee);
  const mask = view.emailMask ?? "your email";
  const when = view.startsAt ? longWhen(Date.parse(view.startsAt), view.timeZone) : null;
  const [step, setStep] = useState<Step>(initialStep);
  const [declining, setDeclining] = useState(seed.declining ?? false);
  const [code, setCode] = useState(seed.code ?? "");
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: string } | null>(seed.message ?? null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [mode, setMode] = useState<Mark["kind"]>(seed.mode ?? "typed");
  const [typed, setTyped] = useState(view.attendee ?? "");
  const [drawn, setDrawn] = useState<{ blob: Blob | null; preview: string | null }>({ blob: null, preview: null });
  const [upload, setUpload] = useState<{ blob: Blob | null; preview: string | null }>({ blob: null, preview: null });
  const [consent, setConsent] = useState(false);
  const [mark, setMark] = useState<Mark | null>(initialMark);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [confirmAt, setConfirmAt] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  function go(next: Step) {
    setMsg(null);
    setStep(next);
    window.scrollTo(0, 0);
    window.setTimeout(() => heading.current?.focus({ preventScroll: true }), 0);
  }

  async function askForCode(resend: boolean) {
    if (busy) return;
    setBusy(true);
    const result = await sendSigningCode(reference);
    setBusy(false);
    if ("error" in result) {
      setMsg({ tone: "bad", text: result.error });
      return;
    }
    if (result.state === "sent") {
      setWait(30);
      setCode("");
      if (resend) setMsg({ tone: "ok", text: "New code sent." });
      else go("verify");
      return;
    }
    if (result.state === "wait") {
      setWait(result.seconds);
      if (!resend) go("verify");
      return;
    }
    setMsg({
      tone: "bad",
      text:
        result.state === "notices_off"
          ? `${view.firm} has email notices turned off for you, so we can’t email a code. Contact ${view.firm} to sign.`
          : result.state === "limited"
            ? "Too many codes were sent in the last hour. Try again later."
            : "This agreement can’t be signed any more. Reload the page.",
    });
  }

  async function checkCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setMsg({ tone: "bad", text: "Enter all 6 digits." });
      return;
    }
    setBusy(true);
    const result = await verifySigningCode(reference, code);
    setBusy(false);
    if ("error" in result) return setMsg({ tone: "bad", text: result.error });
    if (result.state === "ok") return go("review");
    if (result.state === "wrong") return setMsg({ tone: "bad", text: `That code doesn’t match. Check the latest email; ${result.left} ${result.left === 1 ? "try" : "tries"} left.` });
    if (result.state === "locked") return setMsg({ tone: "bad", text: "That code can’t be used any more. Resend a new code." });
    if (result.state === "expired") return setMsg({ tone: "bad", text: "That code has expired. Resend a new code." });
    return setMsg({ tone: "bad", text: "Ask for a code first: use Resend." });
  }

  function adopt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = typed.trim();
    if (name.length < 2) return setMsg({ tone: "bad", text: "Type your full name to sign." });
    if (mode === "drawn" && !drawn.blob) return setMsg({ tone: "bad", text: "Draw your signature first." });
    if (mode === "uploaded" && !upload.blob) return setMsg({ tone: "bad", text: "Choose a PNG or JPEG of your signature." });
    if (!consent) return setMsg({ tone: "bad", text: "Tick the box to agree to sign electronically." });
    setMark({
      kind: mode,
      name,
      image: mode === "drawn" ? drawn.blob : mode === "uploaded" ? upload.blob : null,
      preview: mode === "drawn" ? drawn.preview : mode === "uploaded" ? upload.preview : null,
    });
    setConfirmAt(Date.now());
    go("confirm");
  }

  async function signNow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !mark) return;
    const form = new FormData();
    form.set("ref", reference);
    form.set("sha256", view.sha256);
    form.set("kind", mark.kind);
    form.set("name", mark.name);
    form.set("consent", consent ? "on" : "");
    if (mark.image) form.set("image", mark.image);
    setBusy(true);
    const result = await signBookingAgreement(form);
    setBusy(false);
    if ("error" in result) return setMsg({ tone: "bad", text: result.error });
    setSignedAt(result.signedAt ?? new Date().toISOString());
    go("done");
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setUpload({ blob: null, preview: null });
      return setMsg({ tone: "bad", text: "Choose a PNG or JPEG of your signature." });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUpload({ blob: null, preview: null });
      return setMsg({ tone: "bad", text: "That image is over 1.5 MB. Choose a smaller PNG or JPEG." });
    }
    setMsg(null);
    setUpload({ blob: file, preview: URL.createObjectURL(file) });
  }

  const message = msg ? (
    <p className={`es-msg ${msg.tone}`} role={msg.tone === "bad" ? "alert" : "status"}>
      {msg.text}
    </p>
  ) : null;
  const decline = (
    <button className={"es-link"} type={"button"} onClick={() => setDeclining(true)}>
      {"Decline to sign"}
    </button>
  );
  const dialog = (
    <DeclineDialog
      open={declining}
      onClose={() => setDeclining(false)}
      firm={view.firm}
      reference={reference}
      onDeclined={(reason) => {
        setDeclining(false);
        onDeclined(reason);
      }}
    />
  );

  if (step === "landing") {
    return (
      <div className={"es-card"}>
        <p className={"eyebrow"}>{`Hello ${first}`}</p>
        <h1 ref={heading} tabIndex={-1}>{`${view.firm} asked you to sign your consultation agreement`}</h1>
        <p className={"lead"}>{`${view.meeting} with ${view.firm}${when ? `, ${when}` : ""}. It takes about two minutes. You don’t need an account.`}</p>
        <div className={"es-doc"}>
          <Icon name={"file-check"} />
          <div>
            <b>{view.title}</b>
            <small>{`from ${view.firm}`}</small>
          </div>
        </div>
        <ol className={"es-steps"}>
          <li>{`Confirm it’s you with a code we email to ${mask}`}</li>
          <li>{"Read the agreement"}</li>
          <li>{"Sign by typing, drawing or uploading your signature"}</li>
        </ol>
        {message}
        <div className={"es-act"}>
          <button className={"btn p"} type={"button"} onClick={() => askForCode(false)} aria-busy={busy ? "true" : undefined}>
            {"Review and sign"}
          </button>
          {decline}
        </div>
        <p className={"fp-note"} style={{ marginTop: "18px" }}>
          {`This link is just for you and works until you sign or ${view.firm} withdraws it.${view.attendee ? ` Not ${view.attendee}? ` : " "}`}
          <RequestButton reference={reference} kind={"wrong_recipient"} label={`Tell ${view.firm}`} done={`${view.firm} has been told. Nothing was signed.`} />
        </p>
        {dialog}
      </div>
    );
  }

  if (step === "verify") {
    return (
      <form className={"es-card"} data-live={"1"} onSubmit={checkCode} noValidate>
        <h1 ref={heading} tabIndex={-1}>
          {"Check it’s you"}
        </h1>
        <p className={"lead"}>
          {"We emailed a 6-digit code to "}
          <b style={{ fontWeight: 500 }}>{mask}</b>
          {". It works for 10 minutes."}
        </p>
        <label className={"sr"} htmlFor={"o0"}>
          {"Six-digit code"}
        </label>
        <CodeBoxes
          value={code}
          onChange={(next) => {
            setCode(next);
            setMsg(null);
          }}
          bad={msg?.tone === "bad"}
        />
        {message ?? <p className={"es-msg"}></p>}
        <div className={"es-act"} style={{ marginTop: "8px" }}>
          <button className={"btn p"} type={"submit"} aria-busy={busy ? "true" : undefined}>
            {"Continue"}
          </button>
          <button className={"es-link"} type={"button"} disabled={wait > 0 || busy} onClick={() => askForCode(true)}>
            {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          </button>
        </div>
        <p className={"fp-note"} style={{ marginTop: "18px" }}>
          {"Can’t get the email? Check spam, or "}
          <RequestButton reference={reference} kind={"code_help"} label={`ask ${view.firm} to check your address`} done={`${view.firm} has been asked to check your email address.`} />
        </p>
      </form>
    );
  }

  if (step === "review") {
    return (
      <>
        <div className={"es-rev"}>
          <div style={{ display: "grid", gap: "14px" }}>
            <h1 ref={heading} tabIndex={-1} style={{ margin: 0 }}>
              {view.title}
            </h1>
            <p className={"lead"} style={{ margin: "-4px 0 4px" }}>
              {"Read the agreement, then add your signature."}
            </p>
            <section className={"es-page"} aria-label={"The agreement"}>
              <div className={"text"} tabIndex={0}>
                {view.body}
              </div>
              <small className={"fp-note"} style={{ margin: 0 }}>
                {`Version ${view.version} · `}
                <Fingerprint sha256={view.sha256} />
              </small>
              <div>
                <small style={{ color: "var(--t2)" }}>{"Your signature"}</small>
                {mark ? (
                  <MarkView mark={mark} />
                ) : (
                  <button type={"button"} className={"es-field"} onClick={() => go("sign")}>
                    <Icon name={"signature"} cls={"ic s"} />
                    {"Sign here · required"}
                  </button>
                )}
              </div>
            </section>
          </div>
          <aside className={"es-side"}>
            <div className={"es-card"}>
              <h2>{"To do"}</h2>
              <ul className={"es-fl"}>
                <li>
                  <Icon name={mark ? "check-circle" : "signature"} cls={"ic s"} />
                  {"Your signature"}
                </li>
                <li>
                  <Icon name={"check-circle"} cls={"ic s"} />
                  {"Date · filled in for you"}
                </li>
              </ul>
            </div>
            <div className={"es-card"}>
              <h2>{"About this agreement"}</h2>
              <dl className={"es-meta"} style={{ margin: 0 }}>
                <dt>{"From"}</dt>
                <dd>{view.firm}</dd>
                <dt>{"For"}</dt>
                <dd>{view.meeting}</dd>
                <dt>{"Fingerprint"}</dt>
                <dd>
                  <Fingerprint sha256={view.sha256} />
                </dd>
              </dl>
            </div>
            <div className={"es-act"}>
              <button className={"btn p"} type={"button"} style={{ width: "100%" }} onClick={() => go(mark ? "confirm" : "sign")}>
                {mark ? "Continue" : "Sign"}
              </button>
              {decline}
            </div>
          </aside>
        </div>
        <div className={"es-bar"}>
          <small>{mark ? "Ready" : "1 field left"}</small>
          <button className={"btn p"} type={"button"} onClick={() => go(mark ? "confirm" : "sign")}>
            {mark ? "Continue" : "Sign"}
          </button>
        </div>
        {dialog}
      </>
    );
  }

  if (step === "sign") {
    const tabs: [Mark["kind"], string][] = [
      ["typed", "Type"],
      ["drawn", "Draw"],
      ["uploaded", "Upload"],
    ];
    return (
      <form className={"es-card"} data-live={"1"} onSubmit={adopt} noValidate>
        <h1 ref={heading} tabIndex={-1}>
          {"Add your signature"}
        </h1>
        <p className={"lead"}>{`Choose how you’d like to sign “${view.title}”.`}</p>
        <div className={"es-seg"} role={"tablist"} aria-label={"How to sign"}>
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type={"button"}
              role={"tab"}
              aria-selected={mode === key}
              onClick={() => {
                setMode(key);
                setMsg(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={"fld"}>
          <label htmlFor={"tn"}>{"Your full name"}</label>
          <input className={"inp"} id={"tn"} value={typed} autoComplete={"name"} maxLength={200} onChange={(event) => setTyped(event.target.value)} />
        </div>
        {mode === "typed" ? (
          <div className={"es-typed"} aria-live={"polite"}>
            {typed || " "}
          </div>
        ) : mode === "drawn" ? (
          <DrawPad
            onInk={(blob, preview) => {
              setDrawn({ blob, preview });
              setMsg(null);
            }}
          />
        ) : (
          <>
            <label className={"es-up"} htmlFor={"upf"}>
              {upload.preview ? (
                <img src={upload.preview} alt={"Your signature"} style={{ maxHeight: "110px", maxWidth: "90%" }} />
              ) : (
                <>
                  <Icon name={"upload"} />
                  <span>
                    <b style={{ fontWeight: 500, color: "var(--ink)" }}>{"Upload a picture of your signature"}</b>
                    <br />
                    {"PNG or JPEG, up to 1.5 MB, on a plain background"}
                  </span>
                </>
              )}
            </label>
            <input type={"file"} id={"upf"} accept={"image/png,image/jpeg"} className={"sr"} onChange={(event) => chooseFile(event.target.files?.[0])} />
          </>
        )}
        <label className={"check"} style={{ margin: "16px 0" }}>
          <input
            type={"checkbox"}
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              setMsg(null);
            }}
          />
          <span>{view.consentText}</span>
        </label>
        {message}
        <div className={"es-act"}>
          <button className={"btn p"} type={"submit"}>
            {"Use this signature"}
          </button>
          <button className={"btn"} type={"button"} onClick={() => go("review")}>
            {"Back to the document"}
          </button>
        </div>
      </form>
    );
  }

  if (step === "confirm" && mark) {
    return (
      <form className={"es-card"} data-live={"1"} onSubmit={signNow} noValidate>
        <h1 ref={heading} tabIndex={-1}>
          {"Sign the document?"}
        </h1>
        <p className={"lead"}>{`You’re signing “${view.title}” as ${mark.name}. After this you can’t change it; ${view.firm} would need to send a new agreement.`}</p>
        <div style={{ margin: "0 0 18px" }}>
          <MarkView mark={mark} />
        </div>
        <dl className={"es-meta"}>
          <dt>{"Date"}</dt>
          <dd>{confirmAt ? longWhen(confirmAt, view.timeZone) : "When you sign"}</dd>
          <dt>{"Recorded"}</dt>
          <dd>{"The time, your email, the code check and the document’s fingerprint"}</dd>
        </dl>
        {message}
        <div className={"es-act"}>
          <button className={"btn p"} type={"submit"} aria-busy={busy ? "true" : undefined}>
            <Icon name={"signature"} cls={"ic s"} />
            {busy ? "Signing…" : "Sign now"}
          </button>
          <button className={"btn"} type={"button"} onClick={() => go("sign")}>
            {"Change signature"}
          </button>
        </div>
      </form>
    );
  }

  // Done: the receipt.
  return (
    <div className={"es-card es-done"} role={"status"}>
      <Icon name={"check-circle"} />
      <h1 ref={heading} tabIndex={-1}>{`Signed. Thank you, ${first}.`}</h1>
      <p className={"lead"}>{`${view.firm} has the signed agreement. You can close this page.`}</p>
      <dl className={"es-meta"}>
        <dt>{"Signed by"}</dt>
        <dd>{mark?.name ?? view.attendee}</dd>
        <dt>{"When"}</dt>
        <dd>{signedAt ? longWhen(Date.parse(signedAt), view.timeZone) : "Just now"}</dd>
        <dt>{"Firm"}</dt>
        <dd>{view.firm}</dd>
        <dt>{"Fingerprint"}</dt>
        <dd>
          <Fingerprint sha256={view.sha256} />
        </dd>
      </dl>
    </div>
  );
}

/** The signing page for one private link. `step` and `mark` only seed the flow (screenshots, tests). */
export function AgreementSign({
  view,
  reference,
  logo = null,
  step,
  mark,
  seed,
}: {
  view: Shown;
  reference: string;
  logo?: string | null;
  step?: Step;
  mark?: Mark | null;
  seed?: Seed;
}) {
  const [shown, setShown] = useState<Shown>(view);
  return (
    <Shell firm={shown.firm} logo={logo} sample={"sample" in shown ? shown.sample : false} wide={shown.state === "open" && step === "review"}>
      {shown.state === "open" ? (
        <Flow
          view={shown}
          reference={reference}
          initialStep={step}
          initialMark={mark ?? null}
          seed={seed}
          onDeclined={(reason) =>
            setShown({
              state: "declined",
              firm: shown.firm,
              firmSlug: shown.firmSlug,
              attendee: shown.attendee,
              reason,
              declinedAt: new Date().toISOString(),
              timeZone: shown.timeZone,
              sample: shown.sample,
            })
          }
        />
      ) : (
        <EndCard view={shown} reference={reference} />
      )}
    </Shell>
  );
}

/** The page's error card: nothing was signed and the link still works. */
export function AgreementSignError({ firm }: { firm: string | null }) {
  return (
    <Shell firm={firm ?? "Casevoya"} logo={null} sample={false}>
      <div className={"es-card"}>
        <div className={"alert bad"} role={"alert"} style={{ margin: "0 0 16px" }}>
          <Icon name={"alert"} />
          <div>
            <b>{"We couldn’t open this document"}</b>
            {" Nothing was signed and your link still works."}
          </div>
        </div>
        <div className={"es-act"}>
          <button className={"btn p"} type={"button"} onClick={() => window.location.reload()}>
            <Icon name={"refresh"} cls={"ic s"} />
            {"Try again"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

/** The page's loading state: a skeleton the screen reader announces. */
export function AgreementSignLoading() {
  return (
    <Shell firm={""} logo={null} sample={false}>
      <div className={"es-card"} role={"status"} aria-live={"polite"} aria-busy={"true"}>
        <span className={"sr"}>{"Opening the document…"}</span>
        <div className={"sk"} style={{ height: "34px", width: "70%", margin: "0 0 14px" }}></div>
        <div className={"sk"} style={{ width: "90%" }}></div>
        <div className={"sk"} style={{ width: "60%", margin: "10px 0 22px" }}></div>
        <div className={"sk"} style={{ height: "96px", borderRadius: "14px" }}></div>
      </div>
    </Shell>
  );
}
