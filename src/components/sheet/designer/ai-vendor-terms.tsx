/**
 * Settings > Vo: the AI vendor terms panel and its acknowledgement dialog (PRD AI-06). Live only:
 * the Designer has no screen for them, so they are built from the Designer's own parts: the
 * `.panel` of the Vo and AI settings, the Citations library's `details.src` source block (summary,
 * `dl`, external link) and the disclosure dialog's `.dlg` parts (`.dh`, `.db`, `ol.ofl`, `.df`).
 */
import { Fragment } from "react";
import type { AiVendorTermsData, CommitmentsData, VendorQuote, VendorTermsDialogData, VendorTermsVendor } from "@/modules/sheet/vo-vendor-terms-present";
import { Icon, Sep } from "./frame";
import { Badge } from "./matters";

function External({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} rel={"noopener noreferrer"} target={"_blank"}>
      {`${label} `}
      <Icon name={"external-link"} cls={"ic s"} />
      <span className={"sr"}>{"(opens in a new tab)"}</span>
    </a>
  );
}

function Quote({ quote }: { quote: VendorQuote }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <blockquote style={{ margin: 0 }}>
        {quote.text.map((line, index) => (
          <span key={index}>
            {index === 0 ? `“${line}` : line}
            {index === quote.text.length - 1 ? "”" : null}
            {index < quote.text.length - 1 ? <br /> : null}
          </span>
        ))}
      </blockquote>
      <small className={"mu"}>
        <External label={quote.cite.label} href={quote.cite.href} />
        {` · ${quote.cite.detail} · `}
        <span title={`SHA-256 of the page as retrieved: ${quote.cite.hash}`}>{`page hash ${quote.cite.hash.slice(0, 12)}`}</span>
      </small>
    </div>
  );
}

function Vendor({ vendor }: { vendor: VendorTermsVendor }) {
  return (
    <details className={"src"} open>
      <summary>
        <Icon name={"link"} cls={"ic s"} />
        <span>
          <b style={{ fontWeight: "500" }}>{vendor.vendor}</b> <Sep />
          {` ${vendor.service}`}
        </span>
        <Icon name={"chevron-down"} cls={"ic s ch"} />
      </summary>
      <dl>
        <dt>{"Used for"}</dt>
        <dd>{vendor.usedFor}</dd>
        <dt>{"How Casevoya calls it"}</dt>
        <dd>
          {vendor.setup.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </dd>
        {vendor.agreement ? (
          <>
            <dt>{vendor.agreement.title}</dt>
            <dd>
              <b style={{ fontWeight: "500" }}>{vendor.agreement.text}</b>
              <div>{vendor.agreement.precedence}</div>
            </dd>
          </>
        ) : null}
        <dt>{vendor.published.term}</dt>
        <dd>{vendor.published.text}</dd>
        {vendor.rows.map((row) => (
          <Fragment key={row.term}>
            <dt>{row.term}</dt>
            <dd>{row.unstated ?? row.quotes.map((quote, index) => <Quote key={index} quote={quote} />)}</dd>
          </Fragment>
        ))}
        <dt>{"Last reviewed"}</dt>
        <dd>
          <time className={"num"}>{vendor.reviewed}</time>
        </dd>
        <dt>{"Full terms"}</dt>
        <dd>
          {vendor.terms.map((link) => (
            <div key={link.href}>
              <External label={link.label} href={link.href} />
            </div>
          ))}
        </dd>
      </dl>
    </details>
  );
}

function Commitments({ data }: { data: CommitmentsData }) {
  return (
    <section className={"panel"} id={"voCommitments"}>
      <h2>
        <Icon name={"check-circle"} />
        {"Casevoya’s commitments"}
      </h2>
      <div className={"fp-pad"}>
        <div className={"fp-row"} style={{ marginBottom: "10px" }}>
          <Badge badge={{ tone: "rev", label: data.status }} />
        </div>
        <p style={{ margin: "0 0 10px" }}>{data.intro}</p>
        {data.items.map((item) => (
          <details className={"src"} open key={item.key}>
            <summary>
              <Icon name={"link"} cls={"ic s"} />
              <span>
                <b style={{ fontWeight: "500" }}>{item.title}</b>
              </span>
              <Icon name={"chevron-down"} cls={"ic s ch"} />
            </summary>
            <dl>
              <dt>{"The Code says"}</dt>
              <dd>
                <Quote quote={{ text: [item.quote], cite: item.cite }} />
              </dd>
              <dt>{"Casevoya’s commitment"}</dt>
              <dd>
                {item.commitment.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </dd>
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}

export function AiVendorTermsDialog({ data }: { data: VendorTermsDialogData }) {
  return (
    <dialog className={"dlg wide"} id={data.id} aria-labelledby={`${data.id}H`}>
      <div className={"dh"}>
        <h2 id={`${data.id}H`}>{data.title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={data.id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ margin: "0 0 14px", color: "var(--t2)" }}>{data.lead}</p>
        <ol className={"ofl"}>
          {data.points.map((point) => (
            <li key={point.title}>
              <span className={"ck on"} role={"img"} aria-label={"Part of what you acknowledge"}></span>
              <div>
                <b>{point.title}</b>
                <small>{point.detail}</small>
              </div>
            </li>
          ))}
        </ol>
        <p className={"fp-note"}>
          <Icon name={"info"} cls={"ic s"} />
          {" The full terms: "}
          {data.links.map((link, index) => (
            <span key={link.href}>
              {index ? ", " : null}
              <a href={link.href} target={"_blank"} rel={"noreferrer"}>
                {link.label}
              </a>
            </span>
          ))}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={data.id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...data.accept.attrs}>
          {data.accept.label}
        </button>
      </div>
    </dialog>
  );
}

export function AiVendorTerms({ data }: { data: AiVendorTermsData }) {
  return (
    <div className={"rv"} style={{ "--i": "2", marginTop: "6px" } as React.CSSProperties}>
      <section className={"panel"} id={"voTerms"}>
        <h2>
          <Icon name={"shield"} />
          {"AI vendor terms"}
        </h2>
        <div className={"fp-pad"}>
          <p style={{ margin: "0 0 10px" }}>{data.intro}</p>
          <div className={"fp-row"} style={{ marginBottom: "10px" }}>
            <Badge badge={data.status.badge} />
            <span>{data.status.text}</span>
            {data.action ? (
              <button className={"btn sm"} {...data.action.attrs}>
                {data.action.label}
              </button>
            ) : null}
          </div>
          {data.vendors.map((vendor) => (
            <Vendor key={vendor.key} vendor={vendor} />
          ))}
          <p className={"fp-note"}>{data.note}</p>
        </div>
      </section>
      <Commitments data={data.commitments} />
      {data.dialog ? <AiVendorTermsDialog data={data.dialog} /> : null}
    </div>
  );
}
