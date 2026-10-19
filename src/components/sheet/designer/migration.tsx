/**
 * The Designer's Migration import page (`markup/migration.tsx`): Map columns, Preview, Row errors
 * and Sign off, rendered from a firm's import batch (T044, PRD §25). Same DOM, classes and order as
 * the capture.
 *
 * Live-only additions (absent when the Designer's own values are given): an empty state with
 * "Choose a CSV file" when no import is open; a `.sel` field picker in each Casevoya field cell, the
 * Designer's `.fld` date-order and default-consultant fields, and a Value mapping table on Map
 * columns; Discard beside Continue; a Possible matches table with Same person / Different people
 * on Preview; an `alert ok` when no row has a problem; on Sign off, rows-checked and checksum lines,
 * the result after import, Roll back with the reasons it can't run, and the firm's earlier imports.
 * Buttons carry `data-mig-act` (use-sheet runs them against /api/migration).
 */
import type { CSSProperties } from "react";
import { Empty, Icon, Sep } from "./frame";

export type MigrationTab = "map" | "preview" | "errors" | "signoff";
export type Attrs = Record<string, string>;
export type Pair2 = [string, string];
export type MigrationBadge = { tone: string; label: string; detail?: string };
export type SelectData = { attrs: Attrs; value: string; options: [string, string][] };

export type MigrationHeaderData = { tab: MigrationTab; pill: Pair2 | null };

export type MapRow = {
  column: string;
  sample: string;
  /** "Person · legal name", or null for "—". */
  field: Pair2 | null;
  check: string | MigrationBadge;
  /** Live: the field picker. */
  select?: SelectData;
};

export type ValueRow = { column: string; value: string; rows: string; select: SelectData };

export type MapData = {
  rows: MapRow[];
  /** Designer: a link to Preview. Live: the button that saves the mapping and runs the dry run. */
  next: { href: string } | { attrs: Attrs };
  settings?: { dateOrder: SelectData; consultant: SelectData } | null;
  values?: ValueRow[];
  discard?: Attrs | null;
};

export type PreviewRow = { row: string; person: string; birth: string; matter: string; result: MigrationBadge };
export type MatchRow = { row: string; person: string; existing: string; same: string; decided: string | null; actions: { label: string; attrs: Attrs; primary?: boolean }[] };
export type ErrorRow = { row: string; column: string; problem: string; fix: string };
export type SummaryRow = { term: string; value: string | Pair2 };
export type HistoryRow = { key: string; file: string; when: string; rows: string; state: MigrationBadge; href: string };

export type SignoffData = {
  summary: SummaryRow[];
  /** Designer: the data-run button. Live: Sign off and import, or nothing once imported. */
  action: { label: string; attrs: Attrs } | null;
  rollback?: { attrs: Attrs | null; reasons: string[] } | null;
  history?: HistoryRow[];
};

export type MigrationData = {
  tab: MigrationTab;
  /** Live: no import open, so Map columns shows the upload empty state. */
  upload?: { attrs: Attrs } | null;
  /** Live: why there's nothing to show on this tab. */
  empty?: { title: string; copy: string } | null;
  map?: MapData | null;
  preview?: { rows: PreviewRow[]; matches?: MatchRow[] } | null;
  errors?: { title: string; copy: string; ok?: boolean; rows: ErrorRow[] } | null;
  signoff?: SignoffData | null;
};

const UNDERLINE: Record<MigrationTab, CSSProperties> = {
  map: { left: "0px", width: "94px" },
  preview: { left: "120px", width: "62px" },
  errors: { left: "208px", width: "79px" },
  signoff: { left: "313px", width: "61px" },
};

const TABS: [MigrationTab, string][] = [
  ["map", "1. Map columns"],
  ["preview", "2. Preview"],
  ["errors", "3. Row errors"],
  ["signoff", "4. Sign off"],
];

const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;

function Pair({ value }: { value: Pair2 }) {
  return (
    <>
      {`${value[0]} `}
      <Sep />
      {` ${value[1]}`}
    </>
  );
}

function Badge({ badge }: { badge: MigrationBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.detail ? (
        <span>
          <Pair value={[badge.label, badge.detail]} />
        </span>
      ) : (
        badge.label
      )}
    </span>
  );
}

function Select({ data, id }: { data: SelectData; id?: string }) {
  return (
    <select className={"sel"} id={id} defaultValue={data.value} {...data.attrs}>
      {data.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function MigrationHeader({ data }: { data: MigrationHeaderData }) {
  return (
    <>
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
          <Icon name={"import"} cls={"ic s"} />
          {"Migration import"}
        </button>
        {data.pill ? (
          <span className={"pill"}>
            <span>
              <Pair value={data.pill} />
            </span>
          </span>
        ) : null}
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === data.tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[data.tab]}></i>
      </div>
    </>
  );
}

function Head({ title, copy, art }: { title: string; copy: string; art?: boolean }) {
  return (
    <div className={art ? "ph v rv" : "ph rv"} style={i(0)}>
      {art ? (
        <span className={"art"} style={{ "--a": "64px" } as CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/migration-box-320@1x.webp"}
            srcSet={"/assets/generated/b2/migration-box-320@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
      ) : null}
      <div>
        <h1 className={"display"}>{title}</h1>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function EmptyPanel({ n, title, copy, children }: { n: number; title: string; copy: string; children?: React.ReactNode }) {
  return (
    <div className={"panel rv"} style={i(n)}>
      <Empty art={"migration-box"} title={title} copy={copy}>
        {children}
      </Empty>
    </div>
  );
}

function MapTab({ data }: { data: MigrationData }) {
  const map = data.map;
  return (
    <>
      <Head
        art
        title={"Migration import"}
        copy={"Bring clients and matters from a spreadsheet or another system. Nothing goes live until someone signs off."}
      />
      {data.upload ? (
        <EmptyPanel
          n={1}
          title={"No import in progress"}
          copy={"Choose a CSV file of clients and matters, up to 5 MB and 5,000 rows. Nothing goes live until you sign off."}
        >
          <button className={"btn p sm"} {...data.upload.attrs}>
            {"Choose a CSV file"}
          </button>
          <input type={"file"} accept={".csv,text/csv"} hidden data-mig-file={"1"} />
        </EmptyPanel>
      ) : null}
      {!data.upload && data.empty ? <EmptyPanel n={1} title={data.empty.title} copy={data.empty.copy} /> : null}
      {map ? (
        <>
          <div className={"tw rv"} role={"region"} aria-label={"Column mapping"} tabIndex={0} style={i(1)}>
            <table className={"t"}>
              <caption className={"sr"}>{"Column mapping"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Your column"}</th>
                  <th scope={"col"}>{"Sample"}</th>
                  <th scope={"col"}>{"Casevoya field"}</th>
                  <th scope={"col"}>{"Check"}</th>
                </tr>
              </thead>
              <tbody>
                {map.rows.map((row, index) => (
                  <tr key={`${index}-${row.column}`}>
                    <td>{row.column}</td>
                    <td>{row.sample}</td>
                    <td>{row.select ? <Select data={row.select} /> : row.field ? <Pair value={row.field} /> : "—"}</td>
                    <td>{typeof row.check === "string" ? row.check : <Badge badge={row.check} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {map.settings ? (
            <section className={"panel rv"} style={{ marginTop: "12px", ...i(2) }}>
              <div className={"fp-pad"}>
                <div className={"fld"}>
                  <label htmlFor={"migD"}>{"Dates in your file"}</label>
                  <Select data={map.settings.dateOrder} id={"migD"} />
                </div>
                <div className={"fld"}>
                  <label htmlFor={"migC"}>{"Responsible consultant when a row names none"}</label>
                  <Select data={map.settings.consultant} id={"migC"} />
                </div>
              </div>
            </section>
          ) : null}
          {map.values?.length ? (
            <div className={"tw rv"} role={"region"} aria-label={"Value mapping"} tabIndex={0} style={{ marginTop: "12px", ...i(2) }}>
              <table className={"t"}>
                <caption className={"sr"}>{"Value mapping"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Your column"}</th>
                    <th scope={"col"}>{"Your value"}</th>
                    <th scope={"col"}>{"Rows"}</th>
                    <th scope={"col"}>{"Casevoya value"}</th>
                  </tr>
                </thead>
                <tbody>
                  {map.values.map((row, index) => (
                    <tr key={`${index}-${row.column}-${row.value}`}>
                      <td>{row.column}</td>
                      <td>{row.value}</td>
                      <td>{row.rows}</td>
                      <td>
                        <Select data={row.select} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className={"fp-row rv"} style={{ marginTop: "12px", "--i": "2" } as CSSProperties}>
            {"href" in map.next ? (
              <a className={"btn p sm"} href={map.next.href}>
                {"Continue to preview"}
              </a>
            ) : (
              <button className={"btn p sm"} {...map.next.attrs}>
                {"Continue to preview"}
              </button>
            )}
            {map.discard ? (
              <button className={"btn sm"} {...map.discard}>
                {"Discard this import"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}

function PreviewTab({ data }: { data: MigrationData }) {
  const preview = data.preview;
  return (
    <>
      <Head title={"Preview"} copy={"What the first rows will look like after import."} />
      {preview ? (
        <>
          <div className={"tw rv"} role={"region"} aria-label={"Import preview"} tabIndex={0} style={i(1)}>
            <table className={"t"}>
              <caption className={"sr"}>{"Import preview"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Row"}</th>
                  <th scope={"col"}>{"Person"}</th>
                  <th scope={"col"}>{"Date of birth"}</th>
                  <th scope={"col"}>{"Matter"}</th>
                  <th scope={"col"}>{"Result"}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.person}</td>
                    <td>{row.birth}</td>
                    <td>{row.matter}</td>
                    <td>
                      <Badge badge={row.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.matches?.length ? (
            <div className={"tw rv"} role={"region"} aria-label={"Possible matches"} tabIndex={0} style={{ marginTop: "12px", ...i(2) }}>
              <table className={"t"}>
                <caption className={"sr"}>{"Possible matches"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Row"}</th>
                    <th scope={"col"}>{"Person"}</th>
                    <th scope={"col"}>{"Possible match"}</th>
                    <th scope={"col"}>{"Same"}</th>
                    <th scope={"col"}>{"Decision"}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.matches.map((match) => (
                    <tr key={match.row}>
                      <td>{match.row}</td>
                      <td>{match.person}</td>
                      <td>{match.existing}</td>
                      <td>{match.same}</td>
                      <td>
                        {match.decided ? `${match.decided} ` : null}
                        {match.actions.map((action) => (
                          <button key={action.label} className={action.primary ? "btn p sm" : "btn sm"} {...action.attrs}>
                            {action.label}
                          </button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : data.empty ? (
        <EmptyPanel n={1} title={data.empty.title} copy={data.empty.copy} />
      ) : null}
    </>
  );
}

function ErrorsTab({ data }: { data: MigrationData }) {
  const errors = data.errors;
  return (
    <>
      <Head title={"Row errors"} copy={"Rows with problems aren’t imported. Fix them in your file and upload it again, or map their values on Map columns."} />
      {errors ? (
        <>
          <div className={errors.ok ? "alert ok rv" : "alert bad rv"} style={i(1)}>
            <Icon name={errors.ok ? "check-circle" : "alert"} />
            <div>
              <b>{errors.title}</b>
              {errors.copy}
            </div>
          </div>
          {errors.rows.length ? (
            <div className={"tw rv"} role={"region"} aria-label={"Row errors"} tabIndex={0} style={i(2)}>
              <table className={"t"}>
                <caption className={"sr"}>{"Row errors"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Row"}</th>
                    <th scope={"col"}>{"Column"}</th>
                    <th scope={"col"}>{"Problem"}</th>
                    <th scope={"col"}>{"Fix"}</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.rows.map((row, index) => (
                    <tr key={`${row.row}-${index}`}>
                      <td>{row.row}</td>
                      <td>{row.column}</td>
                      <td>{row.problem}</td>
                      <td>{row.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : data.empty ? (
        <EmptyPanel n={1} title={data.empty.title} copy={data.empty.copy} />
      ) : null}
    </>
  );
}

function SignoffTab({ data }: { data: MigrationData }) {
  const signoff = data.signoff;
  return (
    <>
      <Head title={"Sign off"} copy={"A named person checks the counts and confirms before anything goes live."} />
      {signoff ? (
        <>
          <section className={"panel rv"} style={i(1)}>
            <h2>
              <Icon name={"signature"} />
              {"Import summary"}
            </h2>
            <div className={"fp-pad"}>
              <dl className={"fp-dl"}>
                {signoff.summary.map((row) => (
                  <div key={row.term}>
                    <dt>{row.term}</dt>
                    <dd>{typeof row.value === "string" ? row.value : <Pair value={row.value} />}</dd>
                  </div>
                ))}
              </dl>
              {signoff.action || signoff.rollback?.attrs ? (
                <div className={"fp-row"} style={{ marginTop: "12px" }}>
                  {signoff.action ? (
                    <button className={"btn p sm"} {...signoff.action.attrs}>
                      <span className={"lab"}>{signoff.action.label}</span>
                      <span className={"spin"} aria-hidden={"true"}></span>
                    </button>
                  ) : null}
                  {signoff.rollback?.attrs ? (
                    <button className={"btn sm"} {...signoff.rollback.attrs}>
                      {"Roll back this import"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
          {signoff.rollback?.reasons.length ? (
            <>
              <div className={"alert bad rv"} style={{ marginTop: "12px", ...i(2) }}>
                <Icon name={"alert"} />
                <div>
                  <b>{"This import can’t be rolled back"}</b>
                  {"Only records the import created, and nobody changed since, can be removed. Nothing has been removed."}
                </div>
              </div>
              <div className={"tw rv"} role={"region"} aria-label={"Why it can’t be rolled back"} tabIndex={0} style={i(3)}>
                <table className={"t"}>
                  <caption className={"sr"}>{"Why it can’t be rolled back"}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"Reason"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signoff.rollback.reasons.map((reason) => (
                      <tr key={reason}>
                        <td>{reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {signoff.history?.length ? (
            <div className={"tw rv"} role={"region"} aria-label={"Imports"} tabIndex={0} style={{ marginTop: "12px", ...i(4) }}>
              <table className={"t"}>
                <caption className={"sr"}>{"Imports"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"File"}</th>
                    <th scope={"col"}>{"Uploaded"}</th>
                    <th scope={"col"}>{"Rows"}</th>
                    <th scope={"col"}>{"State"}</th>
                  </tr>
                </thead>
                <tbody>
                  {signoff.history.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <a href={row.href}>{row.file}</a>
                      </td>
                      <td>{row.when}</td>
                      <td>{row.rows}</td>
                      <td>
                        <Badge badge={row.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : data.empty ? (
        <EmptyPanel n={1} title={data.empty.title} copy={data.empty.copy} />
      ) : null}
    </>
  );
}

export function SheetMigration({ data }: { data: MigrationData }) {
  if (data.tab === "preview") return <PreviewTab data={data} />;
  if (data.tab === "errors") return <ErrorsTab data={data} />;
  if (data.tab === "signoff") return <SignoffTab data={data} />;
  return <MapTab data={data} />;
}
