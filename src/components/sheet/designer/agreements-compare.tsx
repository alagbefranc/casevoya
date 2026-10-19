/**
 * The Designer's Compare versions tab (`markup/agreements.tsx`, variant tab-compare), live: the
 * two latest versions of one agreement diffed word by word (src/modules/agreements/diff.ts) per
 * clause that changed, rendered as the Designer's `<del>`/`<ins>` in `.fp-diff` with its legend,
 * and the version history (state, who signed, events) from agreement_versions,
 * signature_envelopes, envelope_signers and signature_events. Same DOM, classes and order as
 * the capture; nothing live-only.
 */
import { Fragment, type ReactNode } from "react";
import type { DiffToken } from "@/modules/agreements/diff";
import { Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import { Parts } from "./agreements-quote";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

export type CompareSection = {
  key?: string;
  /** "Section 5" and "Fees". */
  label: string;
  name: string;
  badges: MatterBadge[];
  /** Each paragraph is a token list; an empty list of paragraphs shows `unchanged`. */
  paragraphs: DiffToken[][];
  unchanged?: string | null;
};

export type CompareViewData = {
  client: string;
  intro: string;
  sections: CompareSection[];
  history: { key?: string; version: string; state: MatterBadge; signed: string; event: string[] }[];
};

/** A paragraph of diff tokens; two change tokens in a row are separated by one space (the Designer's `<del>…</del> <ins>…</ins>`). */
export function DiffParagraph({ tokens }: { tokens: readonly DiffToken[] }) {
  const out: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    if (previous && previous.kind !== "same" && token.kind !== "same") out.push(" ");
    if (token.kind === "same") out.push(token.text);
    else if (token.kind === "del") out.push(<del key={index}>{token.text}</del>);
    else out.push(<ins key={index}>{token.text}</ins>);
  });
  return <>{out}</>;
}

export function SheetAgreementCompare({ data }: { data: CompareViewData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>
            <Pair left={"Compare versions"} right={data.client} />
          </h1>
          <p>{data.intro}</p>
        </div>
      </div>
      {data.sections.map((section, index) => (
        <section key={section.key ?? index} className={"panel rv"} style={i(1 + index)}>
          <h2>
            <Icon name={"repeat"} />
            <span>
              <Pair left={section.label} right={section.name} />
            </span>
            <span className={"r"}>
              {section.badges.map((badge, badgeIndex) => (
                <Fragment key={badgeIndex}>
                  {badgeIndex > 0 ? " " : null}
                  <Badge badge={badge} />
                </Fragment>
              ))}
            </span>
          </h2>
          <div className={"fp-pad fp-diff"}>
            {section.paragraphs.length ? (
              section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} style={paragraphIndex > 0 ? { marginTop: "8px" } : undefined}>
                  <DiffParagraph tokens={paragraph} />
                </p>
              ))
            ) : (
              <p>{section.unchanged}</p>
            )}
            <div className={"fp-legend"}>
              <span>
                <del>{"removed"}</del>
              </span>
              <span>
                <ins>{"added"}</ins>
              </span>
            </div>
          </div>
        </section>
      ))}
      <div className={"tw rv"} role={"region"} aria-label={"Version history"} tabIndex={0} style={i(1 + data.sections.length)}>
        <table className={"t"}>
          <caption className={"sr"}>{"Version history"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Version"}</th>
              <th scope={"col"}>{"State"}</th>
              <th scope={"col"}>{"Signed"}</th>
              <th scope={"col"}>{"Event"}</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((row, index) => (
              <tr key={row.key ?? index}>
                <td>{row.version}</td>
                <td>
                  <Badge badge={row.state} />
                </td>
                <td>{row.signed}</td>
                <td>
                  <Parts parts={row.event} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
