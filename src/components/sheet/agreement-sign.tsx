"use client";

/**
 * The consultation agreement page a booker opens from their private link
 * (/consultation/<booking ref>/agreement), in the public booking page's look: the firm's name, the
 * meeting, the locked text with its SHA-256, then typed name, the e-sign consent and Sign. No
 * login. Signed (or cancelled) shows the record instead of the form.
 */
import { useState, type FormEvent } from "react";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import type { SigningView } from "@/modules/scheduling/agreement-sign-present";
import { signBookingAgreement } from "@/modules/scheduling/agreement-sign";
import { longWhen } from "@/modules/scheduling/format";

type Open = Exclude<SigningView, { state: "unavailable" } | { state: "withdrawn" }>;

const PAGE_CSS = ".pb .doc{white-space:pre-wrap;font-size:15px;line-height:1.6;max-height:60vh;overflow:auto}.pb .hash{font-family:ui-monospace,monospace;font-size:12px;color:#615d59;word-break:break-all}";

export function AgreementSign({ view, reference }: { view: Open; reference: string }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null; signed: { name: string; at: string } | null }>({
    busy: false,
    error: null,
    signed: view.state === "signed" && view.signedName ? { name: view.signedName, at: view.signedAt ?? "" } : null,
  });
  const when = view.startsAt ? longWhen(Date.parse(view.startsAt), view.timeZone) : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    setState((s) => ({ ...s, busy: true, error: null }));
    const result = await signBookingAgreement({ ref: reference, name, consent: form.get("consent") === "on", sha256: view.sha256 });
    if ("error" in result) {
      setState((s) => ({ ...s, busy: false, error: result.error }));
      return;
    }
    setState({ busy: false, error: null, signed: { name: name.trim(), at: new Date().toISOString() } });
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS + PAGE_CSS }} />
      <a className={"sr"} href={"#m"}>
        {"Skip to content"}
      </a>
      <div className={"pb"}>
        <header>
          <span>{view.firm}</span>
        </header>
        {view.sample ? (
          <div className={"card"} role={"note"} style={{ marginBottom: "24px", maxWidth: "640px" }}>
            <b style={{ fontWeight: "600", color: "#a15c00" }}>{"Sample mode · practice records are marked sample"}</b>
            <small style={{ color: "#615d59" }}>{"This is a practice consultation. Signing it records nothing for a real client."}</small>
          </div>
        ) : null}
        <main id={"m"}>
          <div>
            <h1>{view.title}</h1>
            <p className={"lead"}>
              {`${view.meeting} with ${view.firm}${when ? `, ${when}` : ""}. Read the agreement below, then sign it before the meeting.`}
            </p>
            <div className={"card"} style={{ marginTop: "24px" }}>
              <div className={"doc"} tabIndex={0} aria-label={"Agreement text"}>
                {view.body}
              </div>
              <small className={"hash"}>{`Version ${view.version} · SHA-256 ${view.sha256}`}</small>
            </div>
          </div>
          {state.signed ? (
            <div className={"card"} role={"status"}>
              <b style={{ fontWeight: "500" }}>{"Signed"}</b>
              <small style={{ color: "#615d59" }}>
                {`Signed by ${state.signed.name}${state.signed.at ? ` on ${longWhen(Date.parse(state.signed.at), view.timeZone)}` : ""}. ${view.firm} has the signed agreement. You can close this page.`}
              </small>
            </div>
          ) : view.state === "closed" ? (
            <div className={"card"} role={"status"}>
              <b style={{ fontWeight: "500" }}>{"Nothing to sign"}</b>
              <small style={{ color: "#615d59" }}>{"This consultation was cancelled, so the agreement no longer needs signing."}</small>
            </div>
          ) : (
            <form id={"f"} data-live={"1"} onSubmit={onSubmit} noValidate>
              <div className={"fld"}>
                <label htmlFor={"sn"}>{"Your full name"}</label>
                <input className={"inp"} id={"sn"} name={"name"} autoComplete={"name"} required maxLength={200} defaultValue={view.attendee ?? ""} />
              </div>
              <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "14px" }}>
                <input type={"checkbox"} name={"consent"} required style={{ marginTop: "3px" }} />
                <span>{view.consentText}</span>
              </label>
              {state.error ? (
                <p className={"fp-note"} role={"alert"} style={{ margin: "0", color: "#a12c20" }}>
                  {state.error}
                </p>
              ) : null}
              <button className={"btn p"} type={"submit"} aria-busy={state.busy ? "true" : undefined} disabled={state.busy}>
                {state.busy ? "Signing…" : "Sign the agreement"}
              </button>
              <p className={"fp-note"} style={{ margin: "0" }}>
                {"Your name, the time, this device’s address and browser, and the text’s SHA-256 are recorded with your signature."}
              </p>
            </form>
          )}
        </main>
        <footer>
          <span>{view.firm}</span>
          <span>{"Powered by Casevoya"}</span>
        </footer>
      </div>
    </>
  );
}
