/**
 * Parts shared by the Designer's two Compliance pages (Privacy requests and Complaints): the
 * Compliance top bar, the page heading, the `ol.fp-steps` progress list, `dl.fp-dl` rows, the
 * `.fp-row` buttons, and the `.dlg` dialog shell. Same DOM and classes as the captured markup
 * (`markup/privacy.tsx`, `markup/complaints.tsx`); only the values come from props.
 */
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import { Empty, Icon, Pair, Sep } from "./frame";

/** Plain text, or the Designer's line of parts ("Correction · address", "Quote · 2 emails · call note"). */
export type Line = string | readonly string[];

/** A state badge (`.bd`), optionally with the Designer's two-part label. */
export type StateBadge = { tone: string; label: string; detail?: string };

/** Data attributes for a live control (data-dlg, data-privacy-step…) or the Designer's own (data-toast…). */
export type Attrs = Record<string, string>;

export type Step = { state: "done" | "now" | ""; title: string; small?: Line };
export type DlRow = { term: string; value: Line };
export type Action = { label: string; primary?: boolean; attrs: Attrs };

export function i(n: number): CSSProperties {
  return { "--i": String(n) } as CSSProperties;
}

export function LineText({ line }: { line: Line }) {
  if (typeof line === "string") return <>{line}</>;
  if (line.length === 1) return <>{line[0]}</>;
  const last = line.length - 1;
  return (
    <>
      {line.map((part, at) => (
        <Fragment key={at}>
          {at === 0 ? `${part} ` : at === last ? ` ${part}` : ` ${part} `}
          {at < last ? <Sep /> : null}
        </Fragment>
      ))}
    </>
  );
}

/** Text that is a line of parts sits in a `<span>`, as the capture has it. */
export function SpanLine({ line }: { line: Line }) {
  return typeof line === "string" ? <>{line}</> : (
    <span>
      <LineText line={line} />
    </span>
  );
}

export function StateBadgeView({ badge }: { badge: StateBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.detail ? (
        <span>
          <Pair left={badge.label} right={badge.detail} />
        </span>
      ) : (
        badge.label
      )}
    </span>
  );
}

/** The Compliance crumb, this page's crumb, its pills and its buttons (the first one primary). */
export function ComplianceHeader({ icon, title, pills, actions }: { icon: string; title: string; pills: string[]; actions: Action[] }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"privacy"} cls={"ic s"} />
        {"Compliance"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"cs"} aria-hidden={"true"}>
        {"/"}
      </span>
      <button className={"crumb"}>
        <Icon name={icon} cls={"ic s"} />
        {title}
      </button>
      {pills.map((pill) => (
        <span key={pill} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}>
        {actions.map((action) => (
          <button key={action.label} className={action.primary ? "btn p sm" : "btn sm"} {...action.attrs}>
            <Icon name={action.primary ? "plus" : "settings"} cls={"ic s"} />
            {action.label}
          </button>
        ))}
      </span>
    </header>
  );
}

export function Heading({ art, title, copy }: { art: string; title: string; copy: string }) {
  return (
    <div className={"ph v rv"} style={i(0)}>
      <span className={"art"} style={{ "--a": "64px" } as CSSProperties} aria-hidden={"true"}>
        <img
          src={`/assets/generated/b2/${art}-160@1x.webp`}
          srcSet={`/assets/generated/b2/${art}-160@2x.webp 2x`}
          width={64}
          height={64}
          alt={""}
          loading={"lazy"}
          decoding={"async"}
        />
      </span>
      <div>
        <h1 className={"display"}>{title}</h1>
        <p>{copy}</p>
      </div>
    </div>
  );
}

export function EmptyPanel({ n, art, title, copy, children }: { n: number; art: string; title: string; copy: string; children?: ReactNode }) {
  return (
    <div className={"panel rv"} style={i(n)}>
      <Empty art={art} title={title} copy={copy}>
        {children}
      </Empty>
    </div>
  );
}

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className={"fp-steps"}>
      {steps.map((step) => (
        <li key={step.title} className={step.state}>
          <span className={"d"} aria-hidden={"true"}>
            {step.state === "done" ? <Icon name={"check-circle"} cls={"ic s"} /> : null}
          </span>
          <div>
            <b>{step.title}</b>
            {step.small !== undefined ? (
              <small>
                <LineText line={step.small} />
              </small>
            ) : null}
          </div>
          {step.state === "now" ? <span className={"sr"}>{"current step"}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function DlRows({ rows }: { rows: DlRow[] }) {
  return (
    <dl className={"fp-dl"}>
      {rows.map((row) => (
        <div key={row.term}>
          <dt>{row.term}</dt>
          <dd>
            <LineText line={row.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Actions({ actions }: { actions: Action[] }) {
  if (actions.length === 0) return null;
  return (
    <div className={"fp-row"} style={{ marginTop: "12px" }}>
      {actions.map((action) => (
        <button key={action.label} className={action.primary ? "btn p sm" : "btn sm"} {...action.attrs}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

/** A panel heading: an icon, then plain text or the Designer's `<span>` two-part title. */
export function PanelTitle({ icon, title }: { icon: string; title: Line }) {
  return (
    <h2>
      <Icon name={icon} />
      <SpanLine line={title} />
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export type Field =
  | { kind: "text"; id: string; label: string; value?: string; placeholder?: string; max?: number }
  | { kind: "area"; id: string; label: string; value?: string; max?: number }
  | { kind: "select"; id: string; label: string; options: readonly (readonly [string, string])[]; value?: string; multiple?: boolean; values?: string[] };

/** The Designer's `.dlg` shell (`.dh` title and close, `.db` fields, `.df` Cancel and Save). */
export function Dialog({
  id,
  title,
  fields,
  save,
  note,
}: {
  id: string;
  title: string;
  fields: Field[];
  save: { label: string; attrs: Attrs };
  /** A plain-language line above the buttons (`p.why`). */
  note?: string;
}) {
  return (
    <dialog className={"dlg"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        {fields.map((field) => (
          <FieldView key={field.id} field={field} />
        ))}
        {note ? (
          <p className={"why"}>
            <Icon name={"shield"} cls={"ic s"} />
            {note}
          </p>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...save.attrs}>
          {save.label}
        </button>
      </div>
    </dialog>
  );
}

export function FieldView({ field }: { field: Field }) {
  return (
    <div className={"fld"}>
      <label htmlFor={field.id}>{field.label}</label>
      {field.kind === "text" ? (
        <input className={"inp"} id={field.id} type={"text"} defaultValue={field.value ?? ""} placeholder={field.placeholder ?? ""} maxLength={field.max} />
      ) : field.kind === "area" ? (
        <textarea className={"ta"} id={field.id} defaultValue={field.value} maxLength={field.max}></textarea>
      ) : field.multiple ? (
        <select className={"sel"} id={field.id} multiple defaultValue={field.values ?? []}>
          {field.options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <select className={"sel"} id={field.id} defaultValue={field.value}>
          {field.options.map(([value, label]) => (
            // An empty value is the Designer's plain `<option>` (its value is its text).
            <option key={value || label} value={value || undefined}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
