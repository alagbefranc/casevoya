/**
 * The Designer's public enquiry page (`components/sheet/markup/enquiry.tsx`), rendered from data
 * (CRM-01). Same DOM, classes and order: firm header, heading and lead, the welcome art, the
 * "Put this form on your own website" card, the form (error summary, name, email or phone,
 * preferred contact, service, country, language, the reply and marketing boxes, Send enquiry) and
 * the footer. Given the Designer's own sample values it renders the captured HTML exactly
 * (tests/designer-fidelity.test.tsx).
 *
 * Live additions, documented and stripped in the fidelity test:
 *   - inside the form: `data-live="1"` (the Sheet's form guard), field names, a hidden honeypot
 *     field (#ew) and `aria-invalid` on a field the error summary names; the summary (#es) is the
 *     Designer's own, shown with the real problems;
 *   - after sending, the form is replaced by a confirmation card (role="status");
 *   - the website card is shown only to the firm's own staff (with the real snippet); visitors
 *     never see it;
 *   - a sample-mode firm's practice page (open only to its staff) has the Sheet's sample-mode
 *     notice card under the header, as on practice booking pages;
 *   - no privacy link until the firm has a public privacy notice.
 * The embedded form (`embed`) is the same form inside `.pb.pb-e` without the header, the left
 * column and the art: a transparent page sized to the form, for an iframe on the firm's site.
 */
import type { FormEvent, ReactNode } from "react";

export const ENQUIRY_PAGE_CSS =
  "body{background:#F6F5F4}.pb{max-width:1080px;margin:0 auto;padding:28px 24px 64px}.pb header{display:flex;gap:12px;align-items:center;font-weight:500;font-size:16px;margin-bottom:28px}\n.pb main{display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:start}.pb h1{font-weight:300;font-size:44px;letter-spacing:-.02em;line-height:1.08;margin:0 0 12px}.pb .lead{color:#615d59;font-size:17px;max-width:46ch}\n.pb form,.pb .card{background:#fff;border:1px solid rgba(17,17,17,.08);border-radius:16px;padding:24px;display:grid;gap:14px}.pb footer{margin-top:40px;font-size:13px;color:#615d59;display:flex;gap:16px;flex-wrap:wrap}\n.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.slots button{height:44px;border-radius:10px;border:1px solid #c9c5c0;background:#fff;font:inherit}.slots button[aria-pressed=true]{border-color:#0075DE;background:#e6f3fe;color:#075b9f}\n@media (max-width:820px){.pb main{grid-template-columns:1fr}.pb h1{font-size:34px}}";
const WAVE =
  ".m-wave{transform-origin:80px 60px;animation:vwave 300ms var(--ease,ease) infinite}@keyframes vwave{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(14deg)}80%{transform:rotate(-6deg)}90%{transform:rotate(10deg)}}@media (prefers-reduced-motion:reduce){.m-wave{animation:none}}";
/** The embedded form: the page's own rules, then a transparent page with only the form on it. */
export const ENQUIRY_EMBED_CSS = `${ENQUIRY_PAGE_CSS}\nhtml,body{background:transparent!important;min-height:0!important}.pb.pb-e{max-width:none;padding:2px}.pb.pb-e main{display:block}.pb.pb-e footer{margin-top:12px}`;

export type EnquiryField = "n" | "c" | "ok";

export type EnquiryPageData = {
  /** The firm's lockup image, or its name as text when it has no logo. */
  header: { logo: { src: string; alt: string } } | { name: string };
  title: string;
  lead: string;
  /** The Designer's welcome illustration. */
  art: string;
  /** "Put this form on your own website": the firm's staff only on live pages. */
  embed: { code: string; note: string } | null;
  /** The error summary (#es). Hidden unless `shown`. */
  errors: { title: string; items: { field: EnquiryField; label: string }[]; shown: boolean };
  preferred: string[];
  services: string[];
  consent: { reply: string; replyNote: string; marketing: string; marketingNote: string };
  submit: { label: string; busy?: boolean };
  footer: { firm: string; privacyHref?: string | null };
  /** Live only: a practice page in sample mode. */
  practice?: { label: string; detail: string; note: string } | null;
  /** Live only: the embedded form (no header, left column or art). */
  embedded?: boolean;
  /** Live wiring; absent on the Designer render. */
  live?: {
    done?: ReactNode;
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  };
};

function EnquiryForm({ data }: { data: EnquiryPageData }) {
  const live = data.live;
  const invalid = new Set(data.errors.shown ? data.errors.items.map((item) => item.field) : []);
  const bad = (field: EnquiryField) => (live && invalid.has(field) ? "true" : undefined);
  return (
    <form id={"f"} data-live={live ? "1" : undefined} onSubmit={live?.onSubmit} noValidate>
      <div className={"errsum"} id={"es"} hidden={!data.errors.shown} tabIndex={-1} role={"alert"}>
        <b>{data.errors.title}</b>
        {data.errors.items.length ? (
          <ul>
            {data.errors.items.map((item) => (
              <li key={item.field}>
                <a href={`#${item.field}`}>{item.label}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className={"fld"}>
        <label htmlFor={"n"}>{"Your name"}</label>
        <input className={"inp"} id={"n"} name={live ? "name" : undefined} autoComplete={"name"} maxLength={live ? 200 : undefined} aria-invalid={bad("n")} />
      </div>
      <div className={"fld"}>
        <label htmlFor={"c"}>{"Email or phone"}</label>
        <small className={"hint"}>{"How we’ll reply"}</small>
        <input className={"inp"} id={"c"} name={live ? "contact" : undefined} autoComplete={"email"} maxLength={live ? 320 : undefined} aria-invalid={bad("c")} />
      </div>
      <div className={"fld"}>
        <label htmlFor={"p"}>{"Preferred contact"}</label>
        <select className={"sel"} id={"p"} name={live ? "preferred" : undefined}>
          {data.preferred.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className={"fld"}>
        <label htmlFor={"s"}>{"What can we help with?"}</label>
        <select className={"sel"} id={"s"} name={live ? "service" : undefined}>
          {data.services.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className={"fld"}>
        <label htmlFor={"k"}>{"Country you live in now"}</label>
        <input className={"inp"} id={"k"} name={live ? "country" : undefined} autoComplete={"country-name"} maxLength={live ? 100 : undefined} />
      </div>
      <div className={"fld"}>
        <label htmlFor={"l"}>
          {"Language you’d like us to use "}
          <span className={"opt k2-spot"} data-spot={"1"}>
            {"(optional)"}
          </span>
        </label>
        <input className={"inp"} id={"l"} name={live ? "language" : undefined} maxLength={live ? 100 : undefined} />
      </div>
      <label className={"check"}>
        <input type={"checkbox"} id={"ok"} name={live ? "reply" : undefined} aria-invalid={bad("ok")} />
        <span>
          {data.consent.reply}
          <small>{data.consent.replyNote}</small>
        </span>
      </label>
      <label className={"check"}>
        <input type={"checkbox"} name={live ? "marketing" : undefined} />
        <span>
          {data.consent.marketing}
          <span className={"opt k2-spot"} data-spot={"1"}>
            {"(optional)"}
          </span>
          <small>{data.consent.marketingNote}</small>
        </span>
      </label>
      {live ? (
        <div aria-hidden={"true"} style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" }}>
          <label htmlFor={"ew"}>{"Leave this empty"}</label>
          <input id={"ew"} name={"website"} tabIndex={-1} autoComplete={"off"} />
        </div>
      ) : null}
      <button className={"btn p"} type={"submit"} aria-busy={data.submit.busy ? "true" : undefined}>
        {data.submit.label}
      </button>
    </form>
  );
}

function Practice({ data }: { data: EnquiryPageData }) {
  return data.practice ? (
    <div className={"card"} role={"note"} style={{ marginBottom: "24px", maxWidth: "640px" }}>
      <b className={"demo"} style={{ fontWeight: "600", color: "#a15c00" }}>
        {`${data.practice.label} · ${data.practice.detail}`}
      </b>
      <small style={{ color: "#615d59" }}>{data.practice.note}</small>
    </div>
  ) : null;
}

export function EnquiryPage({ data }: { data: EnquiryPageData }) {
  const done = data.live?.done;
  if (data.embedded) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: ENQUIRY_EMBED_CSS }} />
        <div className={"pb pb-e"}>
          <Practice data={data} />
          <main id={"m"}>{done ? done : <EnquiryForm data={data} />}</main>
          <footer>
            <span>{data.footer.firm}</span>
            <span>{"Powered by Casevoya"}</span>
            {data.footer.privacyHref ? <a href={data.footer.privacyHref}>{"Privacy notice"}</a> : null}
          </footer>
        </div>
      </>
    );
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ENQUIRY_PAGE_CSS }} />
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
        <Practice data={data} />
        <main id={"m"}>
          <div>
            <h1>{data.title}</h1>
            <p className={"lead"}>{data.lead}</p>
            <img src={data.art} alt={""} width={140} height={140} style={{ marginTop: "24px" }} />
            {data.embed ? (
              <div className={"card"} style={{ marginTop: "24px" }}>
                <b style={{ fontWeight: "500" }}>{"Put this form on your own website"}</b>
                <code style={{ fontSize: "13px", wordBreak: "break-all" }}>{data.embed.code}</code>
                <small style={{ color: "#615d59" }}>{data.embed.note}</small>
              </div>
            ) : null}
          </div>
          {done ? done : <EnquiryForm data={data} />}
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
