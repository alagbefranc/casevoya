/**
 * The Designer's document review panel on a matter's Documents tab (`#ocr` in `markup/matter.tsx`,
 * "Review · Marriage certificate" with "Extracted fields · confirm before they become facts").
 * Same DOM, classes and order as the capture; live, it shows Vo's reading of one document version:
 * each proposal (suggested purpose, values read from the page, things to check, proposed deadlines)
 * is a `.fieldr` row a person ticks (`.ck`, the Designer's own toggle) and may edit before
 * accepting. The primary button accepts the ticked rows, the secondary rejects the rest. Nothing
 * changes until a person accepts (PRD AI-03).
 *
 * Live-only additions (stripped in the fidelity test): `data-*` attributes on rows and buttons, and
 * `contentEditable` on a row's value so it can be corrected before it is accepted.
 */
import type { ReactNode } from "react";
import { Icon, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type VoDocAttrs = Record<string, string>;

export type VoDocReviewRow = {
  /** The Designer's `data-f`, linking a row to its highlight on the paper. */
  f: string;
  label: string;
  value: string;
  badge: MatterBadge;
  /** "Confirm Spouse name". */
  check: string;
  attrs?: VoDocAttrs;
  /** Live: the value can be edited before it is accepted. */
  editable?: boolean;
};

export type VoDocPaperPart = string | { hl: string; f: string };

export type MatterDocumentReviewData = {
  title: string;
  badge: MatterBadge;
  pill: string[];
  paper: { title: string[]; text: VoDocPaperPart[]; note: string[] };
  heading: string[];
  rows: VoDocReviewRow[];
  note: string;
  accept: { label: string; attrs?: VoDocAttrs };
  reject: { label: string; attrs?: VoDocAttrs };
};

/** "a · b · c" as the capture writes it. */
function joined(parts: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(index === 0 ? (parts.length === 1 ? part : `${part} `) : index === parts.length - 1 ? ` ${part}` : ` ${part} `);
  });
  return out;
}

export function MatterDocumentReview({ data }: { data: MatterDocumentReviewData }) {
  return (
    <div className={"panel rv"} id={"ocr"} style={{ "--i": "2" } as React.CSSProperties}>
      <h2>
        <Icon name={"document-scan"} />
        <span>{joined(["Review", data.title])}</span>
        <span className={"r"} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <Badge badge={data.badge} />
          <span className={"pill"}>
            <span>{joined(data.pill)}</span>
          </span>
        </span>
      </h2>
      <div className={"split"} style={{ "--n": "2" } as React.CSSProperties}>
        <div>
          <div className={"paper"}>
            <b>{joined(data.paper.title)}</b>
            <p>
              {data.paper.text.map((part, index) =>
                typeof part === "string" ? (
                  part
                ) : (
                  <span key={index} className={"hl"} data-f={part.f}>
                    {part.hl}
                  </span>
                ),
              )}
            </p>
            <small>{joined(data.paper.note)}</small>
          </div>
        </div>
        <div>
          <h3>
            <Icon name={"sparkles"} cls={"ic s"} />
            <span>{joined(data.heading)}</span>
          </h3>
          {data.rows.map((row) => (
            <div key={row.f} className={"fieldr"} data-f={row.f} {...(row.attrs ?? {})}>
              <div>
                <small>{row.label}</small>
                {row.editable ? (
                  <b contentEditable={"plaintext-only"} suppressContentEditableWarning data-vo-value={"1"}>
                    {row.value}
                  </b>
                ) : (
                  <b>{row.value}</b>
                )}
              </div>
              <Badge badge={row.badge} />
              <span className={"ck"} role={"checkbox"} aria-label={row.check}></span>
            </div>
          ))}
          <p style={{ fontSize: "13px", color: "var(--t2)", margin: "12px 0" }}>{data.note}</p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className={"btn p"} id={"acc"} {...(data.accept.attrs ?? {})}>
              {data.accept.label}
            </button>
            <button className={"btn s"} {...(data.reject.attrs ?? {})}>
              {data.reject.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
