/**
 * Live addition (SRC-12): Practice > Templates > "What Casevoya supports". The Designer has no such
 * screen, so it is built only from its existing pieces, with no new classes and no animation: the
 * page heading (`.ph`), tables (`.tw` / `.t`), state badges (`.bd`), `.sep` separators and notes
 * (`.fp-note`), under the Designer's Templates tab strip with Program templates selected. The same
 * data feeds the public page (`/supported`).
 */
import type { ReactNode } from "react";
import type { CatalogueRow, SupportCatalogueData } from "@/modules/sheet/support-catalogue-present";
import { Icon, Sep } from "./frame";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Facts({ facts }: { facts: string[] }) {
  const out: ReactNode[] = [];
  facts.forEach((fact, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(<span key={`f${index}`}>{index > 0 ? ` ${fact}` : fact}</span>);
  });
  return <>{out}</>;
}

export function CatalogueName({ row }: { row: CatalogueRow }) {
  return row.href ? (
    <a href={row.href} target={"_blank"} rel={"noopener noreferrer"}>
      {row.name}
    </a>
  ) : (
    <>{row.name}</>
  );
}

function Table({ title, rows, empty, index }: { title: string; rows: CatalogueRow[]; empty: string; index: number }) {
  return (
    <div className={"tw rv"} role={"region"} aria-label={title} tabIndex={0} style={{ ...i(index), marginTop: "16px" }}>
      <table className={"t"}>
        <caption className={"sr"}>{title}</caption>
        <thead>
          <tr>
            <th scope={"col"}>{title}</th>
            <th scope={"col"}>{"What it means"}</th>
            <th scope={"col"}>{"Status"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} data-scope={row.key}>
                <td>
                  <b>
                    <CatalogueName row={row} />
                  </b>
                  {row.facts.length ? (
                    <>
                      <br />
                      <small>
                        <Facts facts={row.facts} />
                      </small>
                    </>
                  ) : null}
                </td>
                <td>{row.detail}</td>
                <td>
                  <span className={`bd ${row.badge.tone}`}>
                    <i></i>
                    {row.badge.label}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SheetSupportCatalogue({ data }: { data: SupportCatalogueData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"What Casevoya supports"}</h1>
          <p>{data.unavailable ? "The catalogue couldn’t be read just now. Reload the page to try again." : data.intro}</p>
        </div>
      </div>
      {data.firm ? (
        <p className={"fp-note rv"} style={i(1)}>
          <Icon name={"info"} cls={"ic s"} />
          {` Your firm’s jurisdictions: ${data.firm}.`}
        </p>
      ) : null}
      <Table title={"Programs"} rows={data.programs} empty={"No programs are catalogued yet. A program appears once its official page is captured or an approved rule pack exists for it."} index={2} />
      <Table title={"Jurisdictions"} rows={data.jurisdictions} empty={"No jurisdictions are listed."} index={3} />
      <Table title={"Case types"} rows={data.caseTypes} empty={"No case types are listed."} index={4} />
      {data.notes.map((note, n) => (
        <p key={n} className={"fp-note rv"} style={{ marginTop: n === 0 ? "16px" : "6px", ...i(5 + n) }}>
          <Icon name={"info"} cls={"ic s"} />
          {` ${note}`}
        </p>
      ))}
      <p className={"fp-note rv"} style={{ marginTop: "6px", ...i(9) }}>
        <Icon name={"globe"} cls={"ic s"} />{" "}
        <a href={data.publicHref} target={"_blank"} rel={"noopener noreferrer"}>
          {"Public version of this page"}
        </a>
      </p>
    </>
  );
}
