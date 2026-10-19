/**
 * The Designer's public booking page (`components/sheet/markup/book.tsx`), rendered from data.
 * Same DOM, classes and order: firm header, heading and lead, the fee card, the form (time slots,
 * name, email, how to meet, note, submit) and the footer. Given the Designer's own sample values it
 * renders the captured HTML exactly (tests/designer-fidelity.test.tsx).
 *
 * Live pages add, inside the same form: `data-live="1"` (the Sheet's form guard), a "Later times"
 * button under the slots, the booker's time-zone picker (PRD: confirm timezone), a phone field
 * for phone consultations, a hidden honeypot field and an error line. A free consultation has no
 * fee card. After booking, the form is replaced by the confirmation card. A sample-mode firm's
 * practice page (open only to the firm's staff) adds a notice card under the header: the Sheet's
 * sample-mode line ("Sample mode · practice records are marked sample") and who can open it.
 */
import type { FormEvent, ReactNode } from "react";

export const BOOK_PAGE_CSS = "body{background:#F6F5F4}.pb{max-width:1080px;margin:0 auto;padding:28px 24px 64px}.pb header{display:flex;gap:12px;align-items:center;font-weight:500;font-size:16px;margin-bottom:28px}\n.pb main{display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:start}.pb h1{font-weight:300;font-size:44px;letter-spacing:-.02em;line-height:1.08;margin:0 0 12px}.pb .lead{color:#615d59;font-size:17px;max-width:46ch}\n.pb form,.pb .card{background:#fff;border:1px solid rgba(17,17,17,.08);border-radius:16px;padding:24px;display:grid;gap:14px}.pb footer{margin-top:40px;font-size:13px;color:#615d59;display:flex;gap:16px;flex-wrap:wrap}\n.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.slots button{height:44px;border-radius:10px;border:1px solid #c9c5c0;background:#fff;font:inherit}.slots button[aria-pressed=true]{border-color:#0075DE;background:#e6f3fe;color:#075b9f}\n@media (max-width:820px){.pb main{grid-template-columns:1fr}.pb h1{font-size:34px}}";
const WAVE =
  ".m-wave{transform-origin:80px 60px;animation:vwave 300ms var(--ease,ease) infinite}@keyframes vwave{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(14deg)}80%{transform:rotate(-6deg)}90%{transform:rotate(10deg)}}@media (prefers-reduced-motion:reduce){.m-wave{animation:none}}";

export type BookSlot = { label: string; value: string; pressed: boolean };

export type BookPageData = {
  /** The firm's lockup image, or its name as text when no public logo exists. */
  header: { logo: { src: string; alt: string } } | { name: string };
  title: string;
  lead: string;
  description?: string | null;
  fee: { title: string; copy: string } | null;
  slots: BookSlot[];
  meet: string[];
  note: string;
  submit: { label: string; busy?: boolean };
  footer: { firm: string; privacyHref?: string | null };
  /** Live only: a practice page in sample mode. Absent on the Designer render and on real pages. */
  practice?: { label: string; detail: string; note: string } | null;
  /** Live wiring; absent on the Designer render. */
  live?: {
    zone: { value: string; options: string[] };
    phone: boolean;
    more: boolean;
    /** Earlier times: back from "Later times". */
    earlier?: boolean;
    onEarlier?: () => void;
    /** Shown in place of the slot grid when there is nothing to choose. */
    empty?: string | null;
    error?: string | null;
    done?: ReactNode;
    onSlot?: (value: string) => void;
    onMore?: () => void;
    onZone?: (zone: string) => void;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  };
};

export function BookPage({ data }: { data: BookPageData }) {
  const live = data.live;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: WAVE }} />
      <a className={"sr"} href={"#m"}>
        {"Skip to content"}
      </a>
      <div className={"pb"}>
        <header>
          {"logo" in data.header ? (
            <img src={data.header.logo.src} alt={data.header.logo.alt} height={32} style={{ height: "32px", width: "auto" }} />
          ) : (
            <span>{data.header.name}</span>
          )}
        </header>
        {data.practice ? (
          <div className={"card"} role={"note"} style={{ marginBottom: "24px", maxWidth: "640px" }}>
            <b className={"demo"} style={{ fontWeight: "600", color: "#a15c00" }}>
              {`${data.practice.label} · ${data.practice.detail}`}
            </b>
            <small style={{ color: "#615d59" }}>{data.practice.note}</small>
          </div>
        ) : null}
        <main id={"m"}>
          <div>
            <h1>{data.title}</h1>
            <p className={"lead"}>{data.lead}</p>
            {data.description ? <p className={"lead"} style={{ marginTop: "12px", fontSize: "15px" }}>{data.description}</p> : null}
            {data.fee ? (
              <div className={"card"} style={{ marginTop: "24px" }}>
                <b style={{ fontWeight: "500" }}>{data.fee.title}</b>
                <small style={{ color: "#615d59" }}>{data.fee.copy}</small>
              </div>
            ) : null}
          </div>
          {live?.done ? (
            live.done
          ) : (
            <form id={"f"} data-live={live ? "1" : undefined} onSubmit={live?.onSubmit} noValidate={live ? true : undefined}>
              <fieldset style={{ border: "0", padding: "0", margin: "0" }}>
                <legend style={{ fontWeight: "500", marginBottom: "8px" }}>{"Choose a time"}</legend>
                {live?.empty ? (
                  <p className={"fp-note"} style={{ margin: "0" }}>
                    {live.empty}
                  </p>
                ) : (
                  <div className={"slots"} id={"sl"}>
                    {data.slots.map((slot) => (
                      <button
                        key={slot.value}
                        type={"button"}
                        aria-pressed={slot.pressed ? "true" : "false"}
                        data-start={live ? slot.value : undefined}
                        onClick={live?.onSlot ? () => live.onSlot?.(slot.value) : undefined}
                      >
                        {slot.label}
                      </button>
                    ))}
                  </div>
                )}
                {live?.earlier || live?.more ? (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                    {live.earlier ? (
                      <button className={"btn s sm"} type={"button"} onClick={live.onEarlier}>
                        {"Earlier times"}
                      </button>
                    ) : null}
                    {live.more ? (
                      <button className={"btn s sm"} type={"button"} onClick={live.onMore}>
                        {"Later times"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
              {live ? (
                <div className={"fld"}>
                  <label htmlFor={"bz"}>{"Your time zone"}</label>
                  <select className={"sel"} id={"bz"} name={"tz"} value={live.zone.value} onChange={(event) => live.onZone?.(event.target.value)}>
                    {live.zone.options.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className={"fld"}>
                <label htmlFor={"bn"}>{"Your name"}</label>
                <input className={"inp"} id={"bn"} name={live ? "name" : undefined} autoComplete={"name"} required={live ? true : undefined} maxLength={live ? 200 : undefined} />
              </div>
              <div className={"fld"}>
                <label htmlFor={"be"}>{"Email"}</label>
                <input className={"inp"} id={"be"} name={live ? "email" : undefined} type={"email"} autoComplete={"email"} required={live ? true : undefined} maxLength={live ? 320 : undefined} />
              </div>
              {live?.phone ? (
                <div className={"fld"}>
                  <label htmlFor={"bp"}>{"Phone"}</label>
                  <input className={"inp"} id={"bp"} name={"phone"} type={"tel"} autoComplete={"tel"} maxLength={40} />
                </div>
              ) : null}
              <div className={"fld"}>
                <label htmlFor={"bm"}>{"How would you like to meet?"}</label>
                <select className={"sel"} id={"bm"}>
                  {data.meet.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </div>
              {live ? (
                <div aria-hidden={"true"} style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" }}>
                  <label htmlFor={"bw"}>{"Leave this empty"}</label>
                  <input id={"bw"} name={"website"} tabIndex={-1} autoComplete={"off"} />
                </div>
              ) : null}
              <p className={"fp-note"} style={{ margin: "0" }}>
                {data.note}
              </p>
              {live?.error ? (
                <p className={"fp-note"} role={"alert"} style={{ margin: "0", color: "#a12c20" }}>
                  {live.error}
                </p>
              ) : null}
              <button className={"btn p"} type={"submit"} aria-busy={data.submit.busy ? "true" : undefined}>
                {data.submit.label}
              </button>
            </form>
          )}
        </main>
        <footer>
          <span>{data.footer.firm}</span>
          <span>{"Powered by Casevoya"}</span>
          {data.footer.privacyHref ? <a href={data.footer.privacyHref}>{"Privacy notice"}</a> : null}
        </footer>
      </div>
      <div id={"k2wt"} className={"k2-wt"} role={"tooltip"} aria-hidden={"true"}></div>
    </>
  );
}
