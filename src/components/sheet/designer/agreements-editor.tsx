/**
 * The Designer's Agreement editor tab (`markup/agreements.tsx`, variant tab-editor), live: one
 * agreement's clauses (public.agreement_clauses) with the mandatory ones locked to the
 * professional reviewer, and its Signing panel (version, hash, signers, consent, sent, expires)
 * from the envelope. Same DOM, classes and order as the capture. Live-only, stripped in the
 * fidelity test: `data-dlg` on each Edit button (the clause's own dialog) in place of the
 * Designer's toast, `disabled` and `title` on Send a reminder (no approved reminder email design
 * yet), and the Void envelope button only while an envelope is out.
 *
 * An executed agreement is read-only: every clause shows a lock tag and the intro says why.
 */
import type { ReactNode } from "react";
import { Icon, Pair, Sep } from "./frame";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** One part of a `.fp-dl` value: text, optionally followed by a `.num` span ("hash " + a41e…9c02). */
export type DdPart = { text: string; num?: string };

export function Dd({ parts }: { parts: readonly DdPart[] }) {
  const last = parts.length - 1;
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    const lead = index === 0 ? "" : " ";
    const tail = index === last ? "" : " ";
    if (part.num !== undefined) {
      if (part.text || lead) out.push(`${lead}${part.text}`);
      out.push(
        <span key={`n${index}`} className={"num"}>
          {part.num}
        </span>,
      );
      if (tail) out.push(tail);
    } else {
      out.push(`${lead}${part.text}${tail}`);
    }
  });
  return <>{out}</>;
}

export type EditorClause = {
  key?: string;
  num: string;
  title: string;
  summary: string[];
  /** Mandatory: the reviewer-owned tag. Else an Edit button (live: opens `dialog`), or a lock tag with `locked` words. */
  mandatory: boolean;
  dialog?: string;
  locked?: string[] | null;
};

export type EditorViewData = {
  /** "Service agreement" and the client's name. */
  title: string;
  client: string;
  intro: string;
  clauses: EditorClause[];
  signing: {
    facts: { term: string; parts: DdPart[] }[];
    /** Send a reminder: live, disabled with the reason. The Designer's toast attributes are the default. */
    reminder: { attrs: Record<string, string>; disabled?: string | null };
    /** Void envelope: shown while an envelope is out for signature. */
    void: boolean;
  };
};

const MANDATORY = ["Mandatory", "reviewer owns"] as const;

function Tag({ parts }: { parts: readonly string[] }) {
  return (
    <span className={"fp-tag"}>
      <Icon name={"lock"} cls={"ic s"} />
      <span>
        <Pair left={parts[0]} right={parts[1]} />
      </span>
    </span>
  );
}

export function SheetAgreementEditor({ data }: { data: EditorViewData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>
            <Pair left={data.title} right={data.client} />
          </h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"fp-g2 rv"} style={i(1)}>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"file-doc"} />
              {"Clauses"}
            </h2>
            <div className={"fp-pad"}>
              {data.clauses.map((clause) => (
                <div key={clause.key ?? clause.num} className={"li"}>
                  <span className={"num"} style={{ width: "22px", color: "var(--t2)" }}>
                    {clause.num}
                  </span>
                  <div>
                    <b>{clause.title}</b>
                    <small>
                      <Summary parts={clause.summary} />
                    </small>
                  </div>
                  <span className={"r"}>
                    {clause.mandatory ? (
                      <Tag parts={MANDATORY} />
                    ) : clause.locked ? (
                      <Tag parts={clause.locked} />
                    ) : (
                      <button className={"btn sm"} data-dlg={clause.dialog} data-fpb={"1"}>
                        {"Edit"}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"signature"} />
              {"Signing"}
            </h2>
            <div className={"fp-pad"}>
              <dl className={"fp-dl"}>
                {data.signing.facts.map((fact) => (
                  <div key={fact.term}>
                    <dt>{fact.term}</dt>
                    <dd>
                      <Dd parts={fact.parts} />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className={"fp-row"} style={{ marginTop: "12px" }}>
                <button className={"btn sm"} {...data.signing.reminder.attrs} disabled={data.signing.reminder.disabled ? true : undefined} title={data.signing.reminder.disabled ?? undefined}>
                  <span className={"lab"}>
                    <Icon name={"bell"} cls={"ic s"} />
                    {" Send a reminder"}
                  </span>
                  <span className={"spin"} aria-hidden={"true"}></span>
                </button>
                {data.signing.void ? (
                  <button className={"btn sm"} data-dlg={"dlgVoid"} data-fpd={"1"}>
                    <Icon name={"x-circle"} cls={"ic s"} />
                    {"Void envelope"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>
          <div className={"alert warn"}>
            <Icon name={"info"} />
            <div>
              <b>{"Government forms sign separately"}</b>
              {"This envelope is for the service agreement only. IRCC forms have their own signature rules."}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Summary({ parts }: { parts: readonly string[] }) {
  if (parts.length <= 1) return <>{parts[0] ?? ""}</>;
  return <Pair left={parts[0]} right={parts.slice(1).join(" · ")} />;
}

export type ClauseDialogData = {
  organizationId: string;
  agreementId: string;
  clauseId: string;
  dialogId: string;
  num: string;
  title: string;
  body: string;
  /** The version is locked or an envelope is out: saving makes a new version (and supersedes the envelope). */
  revises: boolean;
  signedCount: number;
};

/** Edit one clause (`#dlgClause-<n>`): a `.ta` with the wording; Save carries `data-agreement-act="clause-save"`. */
export function ClauseDialog({ data }: { data: ClauseDialogData }) {
  const id = data.dialogId;
  return (
    <dialog className={"dlg wide"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{`Clause ${data.num}: ${data.title}`}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>
          {data.revises
            ? data.signedCount > 0
              ? "This version is out for signature and someone has signed it. Saving voids that envelope, makes a new draft version and needs fresh signatures from everyone."
              : "This version was sent. Saving makes a new draft version (the open envelope is superseded) that you send again."
            : "This draft hasn’t been sent, so the wording changes in place. The title and the mandatory clauses stay as the reviewer approved them."}
        </p>
        <div className={"fld"}>
          <label htmlFor={`${id}B`}>{"Wording"}</label>
          <textarea className={"ta"} id={`${id}B`} rows={10} maxLength={20000} defaultValue={data.body}></textarea>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-agreement-act={"clause-save"} data-agreement={data.agreementId} data-clause={data.clauseId} data-org={data.organizationId}>
          {data.revises ? "Save as a new version" : "Save"}
        </button>
      </div>
    </dialog>
  );
}
