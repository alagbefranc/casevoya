/**
 * The Designer's Lead pipeline page (`markup/pipeline.tsx`), rendered from the firm's leads.
 * Same DOM, classes, order and CSS (`styles/kit/pipeline.css`) for the Board, List and Timeline
 * tabs, the Stage and Owner filters and the Import leads from CSV dialog. Given the Designer's
 * sample values the components render the captured HTML exactly (tests/designer-fidelity.test.tsx).
 *
 * Live-only additions, all absent from the Designer render: data attributes the board script
 * (components/sheet/pipeline-acts.ts) reads — `data-org` on `#pipe`, `data-stage-id` and
 * `data-kind` on a column, `data-version` and `data-href` on a card, `data-href` on a filter
 * option, `data-lead-open` on Import CSV and + Lead — and the New lead dialog (`#dlgLead`), which
 * the Designer does not have (its + Lead goes to `/sheet/lead?new=1`).
 */
import type { ReactNode } from "react";
import { ShareEnquiryButton } from "./enquiry-share";
import { Empty, Icon, Pair, Sep } from "./frame";
import { Avatar, type SidebarPerson } from "./sidebar";

export type PipelineTab = "board" | "list" | "timeline";

type Attrs = Record<string, string>;

export type FilterOption = { label: string; count?: string | null; selected: boolean; data?: Attrs };
export type FilterSelect = { id: string; listId: string; key: string; value: string; options: FilterOption[] };

export type LeadCard = {
  id: string;
  /** The `.lbar` colour. */
  bar: string;
  name: string;
  /** A due date or time (`dt`), or days overdue (`od`). Absent: the `.nx` arrow. */
  chip?: { tone: "dt" | "od"; label: string } | null;
  program: string;
  source: string;
  /** A Vo draft suggestion. Vo is not connected, so live cards never have one. */
  ai?: string | null;
  /** "Possible duplicate of …". */
  flag?: string | null;
  owner: SidebarPerson;
  fee: string;
  data?: Attrs;
  /** Live: which ‹ › buttons can move this card (a disabled one says why in its title). */
  moves?: { back: boolean; forward: boolean } | null;
};

export type PipelineColumn = {
  label: string;
  total: string;
  /** "2 leads", "1 lead". */
  count: string;
  /** The ring's stroke-dashoffset. */
  offset: string;
  cards: LeadCard[];
  data?: Attrs;
  /** Live: hidden while the Stage filter shows another stage. */
  hidden?: boolean;
};

export type PipelineRow = {
  href: string;
  name: string;
  duplicate: boolean;
  stage: string;
  program: string;
  source: string;
  owner: string;
  fee: string;
  next: string;
};

/** href (live): the lead the item belongs to; the item opens it. */
export type TimelineItem = { when: string; who: string; what: string; href?: string };

export type PipelineData = {
  tab: PipelineTab;
  filters: [FilterSelect, FilterSelect];
  columns: PipelineColumn[];
  rows: PipelineRow[];
  timeline: TimelineItem[];
  /** Live: attributes on `#pipe` (the firm, for the board script). */
  board?: Attrs | null;
  /** Live: empty states for the List and Timeline tabs. */
  empty?: { list: { title: string; copy: string }; timeline: { title: string; copy: string } } | null;
  /** Live: public bookings that are not a lead yet (the alert above the filters opens #dlgBk). */
  bookings?: BookingLeadsData | null;
  /** Live: changes whenever the firm's leads change, so the board is rebuilt after the script moved cards. */
  boardKey?: string;
};

export type BookingLeadsData = { title: string; copy: string; rows: { label: string; data: Attrs }[] };

export type PipelineHeaderData = {
  tab: PipelineTab;
  pills: string[];
  /** Live: attributes on Import CSV and + Lead. */
  csv?: Attrs | null;
  newLead?: Attrs | null;
  /** Live only: "Share enquiry form" (opens #dlgShare, designer/enquiry-share.tsx) before Import CSV. */
  share?: boolean;
};

const UNDERLINE: Record<PipelineTab, { left: string; width: string }> = {
  board: { left: "0px", width: "35px" },
  list: { left: "61px", width: "23px" },
  timeline: { left: "110px", width: "52px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The page's own top bar ("Leads / Pipeline"), its pills, Import CSV, + Lead, and the tabs. */
export function PipelineHeader({ data }: { data: PipelineHeaderData }) {
  const tabs: [PipelineTab, string][] = [
    ["board", "Board"],
    ["list", "List"],
    ["timeline", "Timeline"],
  ];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"users"} cls={"ic s"} />
          {"Leads"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"kanban"} cls={"ic s"} />
          {"Pipeline"}
        </button>
        {data.pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          {data.share ? <ShareEnquiryButton /> : null}
          <button className={"btn s sm"} {...(data.csv ?? {})}>
            <Icon name={"upload"} cls={"ic s"} />
            {"Import CSV"}
          </button>
          <a className={"btn p sm"} href={"/sheet/lead?new=1"} {...(data.newLead ?? {})}>
            <Icon name={"plus"} cls={"ic s"} />
            {"Lead"}
          </a>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {tabs.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === data.tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[data.tab]}></i>
      </div>
    </>
  );
}

function Filter({ select }: { select: FilterSelect }) {
  return (
    <span id={select.id} className={"k2-gs"}>
      <button type={"button"} className={"k2-gs-tr"} aria-haspopup={"listbox"} aria-expanded={"false"} aria-controls={select.listId}>
        <span className={"k2-gs-k"}>{select.key}</span>
        <span className={"k2-gs-v"}>{select.value}</span>
        <Icon name={"chevron-down"} cls={"ic s k2-gs-ch"} />
      </button>
      <div className={"k2-gs-m"} data-state={"closed"}>
        <ul className={"k2-gs-l"} role={"listbox"} id={select.listId} tabIndex={-1} aria-label={select.key}>
          <span className={"k2-gs-p"} aria-hidden={"true"}></span>
          {select.options.map((option, index) => (
            <li key={index} role={"option"} id={`${select.listId}-${index}`} aria-selected={option.selected ? "true" : "false"} {...(option.data ?? {})}>
              <span>{option.label}</span>
              {option.count != null ? <small>{option.count}</small> : null}
              <Icon name={"check-circle"} cls={"ic s k2-gs-ck"} />
            </li>
          ))}
        </ul>
      </div>
    </span>
  );
}

function Card({ card }: { card: LeadCard }) {
  return (
    <div className={"lc"} data-id={card.id} tabIndex={0} {...(card.data ?? {})}>
      <i className={"lbar"} style={{ background: card.bar }}></i>
      <div className={"lt"}>
        <b>{card.name}</b>
        {card.chip ? (
          <span className={`chip ${card.chip.tone}`}>
            {card.chip.tone === "od" ? <Icon name={"alarm"} cls={"ic s"} /> : null}
            {card.chip.label}
          </span>
        ) : (
          <span className={"nx"}>
            <Icon name={"arrow-right"} cls={"ic s"} />
          </span>
        )}
      </div>
      <div className={"lm"}>
        <Pair left={card.program} right={card.source} />
      </div>
      {card.ai ? (
        <button className={"aichip"}>
          <Icon name={"sparkles"} cls={"ic s"} />
          {`Draft: ${card.ai}`}
        </button>
      ) : null}
      {card.flag ? (
        <div className={"lflag"}>
          <Icon name={"users"} cls={"ic s"} />
          {card.flag}
        </div>
      ) : null}
      <div className={"lf"}>
        <Avatar person={card.owner} />
        <span className={"num"}>{card.fee}</span>
        <span className={"mv"}>
          <button
            aria-label={"Move back"}
            data-mv={"-1"}
            data-wt={"1"}
            className={"k2-wt-t"}
            disabled={card.moves && !card.moves.back ? true : undefined}
            title={card.moves && !card.moves.back ? "Already in the first stage it can be in" : undefined}
          >
            <Icon name={"chevron-left"} cls={"ic s"} />
          </button>
          <button
            aria-label={"Move forward"}
            data-mv={"1"}
            data-wt={"1"}
            className={"k2-wt-t"}
            disabled={card.moves && !card.moves.forward ? true : undefined}
            title={card.moves && !card.moves.forward ? "It can’t move forward from this stage" : undefined}
          >
            <Icon name={"chevron-right"} cls={"ic s"} />
          </button>
        </span>
      </div>
    </div>
  );
}

function Column({ column, index }: { column: PipelineColumn; index: number }) {
  return (
    <section className={"col"} data-st={String(index)} {...(column.data ?? {})} hidden={column.hidden || undefined}>
      <div className={"colh"}>
        <div>
          <b>{column.label}</b>
          <small>
            <span className={"num"}>{column.total}</span> <Sep />
            {` ${column.count}`}
          </small>
        </div>
        <svg className={"ring"} viewBox={"0 0 26 26"}>
          <circle className={"bg"} cx={"13"} cy={"13"} r={"10"} />
          <circle className={"fg"} cx={"13"} cy={"13"} r={"10"} strokeDasharray={"62.8"} strokeDashoffset={column.offset} transform={"rotate(-90 13 13)"} />
        </svg>
      </div>
      <div className={"cards"}>
        {column.cards.length ? column.cards.map((card) => <Card key={card.id} card={card} />) : <p className={"empty"}>{"No leads here yet."}</p>}
      </div>
    </section>
  );
}

function List({ rows }: { rows: PipelineRow[] }) {
  return (
    <div className={"tw"} role={"region"} aria-label={"Leads"} tabIndex={0}>
      <table className={"t"}>
        <caption className={"sr"}>{"Leads"}</caption>
        <thead>
          <tr>
            <th scope={"col"}>{"Lead"}</th>
            <th scope={"col"}>{"Stage"}</th>
            <th scope={"col"}>{"Program"}</th>
            <th scope={"col"}>{"Source"}</th>
            <th scope={"col"}>{"Owner"}</th>
            <th scope={"col"} style={{ textAlign: "right" }}>
              {"Proposed fee"}
            </th>
            <th scope={"col"}>{"Next follow-up"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.href}>
              <td>
                <a href={row.href} style={{ color: "var(--blue)" }}>
                  {row.name}
                </a>
                {row.duplicate ? (
                  <>
                    {" "}
                    <span className={"bd chg"}>
                      <i></i>
                      {"Possible duplicate"}
                    </span>
                  </>
                ) : null}
              </td>
              <td>{row.stage}</td>
              <td>{row.program}</td>
              <td>{row.source}</td>
              <td>{row.owner}</td>
              <td className={"num"} style={{ textAlign: "right" }}>
                {row.fee}
              </td>
              <td>{row.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className={"panel"}>
      <div className={"fp-pad"}>
        <ol className={"fp-steps"}>
          {items.map((item, index) => (
            <li
              key={index}
              className={index === 0 ? "now" : ""}
              data-href={item.href}
              tabIndex={item.href ? 0 : undefined}
              style={item.href ? { cursor: "pointer" } : undefined}
            >
              <span className={"d"} aria-hidden={"true"}></span>
              <div>
                <b>{item.when}</b>
                <small>
                  <Pair left={item.who} right={item.what} />
                </small>
              </div>
              {index === 0 ? <span className={"sr"}>{"current step"}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Alt({ data }: { data: PipelineData }): ReactNode {
  if (data.tab === "list") {
    if (!data.rows.length && data.empty) {
      return (
        <div className={"panel"}>
          <Empty art={"filter-empty"} title={data.empty.list.title} copy={data.empty.list.copy} />
        </div>
      );
    }
    return <List rows={data.rows} />;
  }
  if (!data.timeline.length && data.empty) {
    return (
      <div className={"panel"}>
        <Empty art={"calendar-link"} title={data.empty.timeline.title} copy={data.empty.timeline.copy} />
      </div>
    );
  }
  return <Timeline items={data.timeline} />;
}

export function SheetPipeline({ data }: { data: PipelineData }) {
  const board = data.tab === "board";
  return (
    <>
      {data.bookings && data.bookings.rows.length ? (
        <div className={"alert info"} style={{ marginBottom: "12px" }}>
          <Icon name={"calendar"} />
          <div>
            <b>{data.bookings.title}</b>
            {data.bookings.copy}
          </div>
          <div className={"acts"}>
            <button className={"btn sm"} data-dlg={"dlgBk"} data-fpd={"1"}>
              {"Review"}
            </button>
          </div>
        </div>
      ) : null}
      <div className={"k2-pf rv"} role={"group"} aria-label={"Filter leads"} style={i(0)}>
        <Filter select={data.filters[0]} />
        <Filter select={data.filters[1]} />
      </div>
      <div key={data.boardKey} className={"pipe rv"} id={"pipe"} hidden={!board} style={i(1)} {...(data.board ?? {})}>
        {data.columns.map((column, index) => (
          <Column key={index} column={column} index={index} />
        ))}
      </div>
      {board ? null : (
        <div id={"pvAlt"}>
          <Alt data={data} />
        </div>
      )}
      {/* Live: the board's note only shows with the board (List and Timeline have no cards to drag). */}
      {board || !data.board ? (
        <p style={{ color: "var(--t2)", fontSize: "13px", marginTop: "10px", "--i": "2" } as React.CSSProperties} className={"rv"}>
          {"Drag a card between stages, or use its arrow buttons. Converting a lead never merges people automatically; matches need your confirmation."}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Import leads from CSV
// ---------------------------------------------------------------------------

export type CsvMapRow = { column: string; sample: string; field: string };

export type CsvDialogData = {
  /** "leads-oct.csv · 26 rows" once a file is chosen. Live: the dialog starts without a file. */
  file?: { name: string; rows: string } | null;
  map: CsvMapRow[];
  duplicates?: { title: string; copy: string } | null;
  submit: { label: string; toast?: { title: string; sub: string } | null; data?: Attrs | null };
  /** Live: the file input the Choose button opens. */
  input?: ReactNode;
  /**
   * Live: the table's name. Columns are matched by their header names and can't be re-mapped
   * here, so the live dialog says what it found instead of "Map lead columns".
   */
  mapLabel?: string | null;
  /** Live: how columns are matched, under the table. */
  mapNote?: string | null;
};

export function CsvDialog({ data }: { data: CsvDialogData }) {
  return (
    <dialog className={"dlg wide"} id={"dlgCsv"} aria-labelledby={"dlgCsvH"}>
      <div className={"dh"}>
        <h2 id={"dlgCsvH"}>{"Import leads from CSV"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgCsv"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"csvF"}>{"File"}</label>
          <small className={"hint"} id={"csvF-h"}>
            {"Name, email or phone, service interest, source"}
          </small>
          <button className={"btn sm"} {...(data.input ? { type: "button", "data-csv-choose": "1" } : {})}>
            <Icon name={"upload"} cls={"ic s"} />
            {"Choose a .csv file"}
          </button>
          {data.input}
        </div>
        {data.file ? (
          <h4 style={{ fontSize: "14px", fontWeight: "500", margin: "14px 0 6px" }}>
            <Pair left={data.file.name} right={data.file.rows} />
          </h4>
        ) : data.file === null ? (
          <h4 style={{ fontSize: "14px", fontWeight: "500", margin: "14px 0 6px" }} id={"csvName"} hidden></h4>
        ) : null}
        <div className={"tw"} role={"region"} aria-label={data.mapLabel ?? "Map lead columns"} tabIndex={0}>
          <table className={"t"}>
            <caption className={"sr"}>{data.mapLabel ?? "Map lead columns"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Your column"}</th>
                <th scope={"col"}>{"Sample"}</th>
                <th scope={"col"}>{"Lead field"}</th>
              </tr>
            </thead>
            <tbody>
              {data.map.map((row, index) => (
                <tr key={index}>
                  <td>{row.column}</td>
                  <td>{row.sample}</td>
                  <td>{row.field}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.mapNote ? (
          <p className={"fp-note"} style={{ marginTop: "8px" }}>
            {data.mapNote}
          </p>
        ) : null}
        {data.duplicates ? (
          <div className={"alert warn"} style={{ marginTop: "10px" }}>
            <Icon name={"users"} />
            <div>
              <b>{data.duplicates.title}</b>
              {data.duplicates.copy}
            </div>
          </div>
        ) : null}
        <p className={"fp-note"}>
          {"We suggest possible duplicates using several details and never merge on a shared family email. You confirm each match. Leads come in without passports or histories."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgCsv"}>
          {"Cancel"}
        </button>
        {data.submit.toast ? (
          <button className={"btn p"} data-close={"dlgCsv"} data-toast={data.submit.toast.title} data-toast-sub={data.submit.toast.sub} data-toast-kind={"ok"}>
            {data.submit.label}
          </button>
        ) : (
          <button className={"btn p"} {...(data.submit.data ?? {})}>
            {data.submit.label}
          </button>
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// New lead (live only: the Designer has no create form)
// ---------------------------------------------------------------------------

export type NewLeadDialogData = {
  organizationId: string;
  owners: { value: string; label: string }[];
  /** The owner selected when the dialog opens: the signed-in staff member. */
  owner: string;
  sampleMode: boolean;
};

function Field({ id, label, hint, type = "text" }: { id: string; label: string; hint?: string; type?: string }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      <input className={"inp"} id={id} type={type} autoComplete={"off"} aria-describedby={hint ? `${id}-h` : undefined} />
    </div>
  );
}

export const LEAD_SOURCES: [string, string][] = [
  ["phone", "Phone"],
  ["email", "Email"],
  ["referral", "Referral"],
  ["event", "Event"],
  ["walk_in", "Walk-in"],
  ["other", "Other"],
];

/**
 * New lead, built from the Designer's dialog, `.fld`, `.inp`, `.sel` and `label.check` parts (the
 * public enquiry form's consent checkboxes). Reply and marketing consent are separate boxes.
 */
export function NewLeadDialog({ data }: { data: NewLeadDialogData }) {
  return (
    <dialog className={"dlg wide"} id={"dlgLead"} aria-labelledby={"dlgLeadH"}>
      <div className={"dh"}>
        <h2 id={"dlgLeadH"}>{"New lead"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgLead"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{"Only what you need to reply. Passports and detailed histories wait until intake."}</p>
        {data.sampleMode ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"This firm is in sample mode"}</b>
              {"Leads you add now are sample records."}
            </div>
          </div>
        ) : null}
        <div className={"g2"}>
          <Field id={"nlN"} label={"Name"} />
          <Field id={"nlS"} label={"Service interest"} hint={"Optional. For example, study permit."} />
          <Field id={"nlE"} label={"Email"} hint={"Email or phone"} type={"email"} />
          <Field id={"nlP"} label={"Phone"} hint={"Email or phone"} type={"tel"} />
          <div className={"fld"}>
            <label htmlFor={"nlC"}>{"Preferred contact"}</label>
            <select className={"sel"} id={"nlC"} defaultValue={"email"}>
              <option value={"email"}>{"Email"}</option>
              <option value={"phone"}>{"Phone"}</option>
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"nlSrc"}>{"Source"}</label>
            <select className={"sel"} id={"nlSrc"} defaultValue={"phone"}>
              {LEAD_SOURCES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Field id={"nlK"} label={"Country now"} hint={"Optional"} />
          <Field id={"nlL"} label={"Language"} hint={"Optional"} />
          <div className={"fld"}>
            <label htmlFor={"nlO"}>{"Owner"}</label>
            <select className={"sel"} id={"nlO"} defaultValue={data.owner}>
              {data.owners.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <Field id={"nlF"} label={"Proposed fee (CAD)"} hint={"Optional. The firm’s own fee."} type={"number"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"nlNote"}>{"First note"}</label>
          <textarea className={"ta"} id={"nlNote"}></textarea>
        </div>
        <label className={"check"}>
          <input type={"checkbox"} id={"nlR"} />
          <span>
            {"They agreed we may use these details to reply"}
            <small>{"Replies about this enquiry only. We record that you noted it."}</small>
          </span>
        </label>
        <label className={"check"}>
          <input type={"checkbox"} id={"nlM"} />
          <span>
            {"They asked for our news "}
            <span className={"opt"}>{"(optional)"}</span>
            <small>{"Marketing is separate from replies. Tick only if they said yes."}</small>
          </span>
        </label>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgLead"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-lead-act={"create"} data-org={data.organizationId}>
          {"Add lead"}
        </button>
      </div>
    </dialog>
  );
}

/** Live only: public bookings to turn into leads, one button each. */
export function BookingLeadsDialog({ data }: { data: BookingLeadsData }) {
  return (
    <dialog className={"dlg wide"} id={"dlgBk"} aria-labelledby={"dlgBkH"}>
      <div className={"dh"}>
        <h2 id={"dlgBkH"}>{"Bookings without a lead"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgBk"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{"People who booked on your public page. Make a lead to track them here, or open a lead and link the booking to it."}</p>
        <div className={"tw"} role={"region"} aria-label={"Bookings without a lead"} tabIndex={0}>
          <table className={"t"}>
            <caption className={"sr"}>{"Bookings without a lead"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Booking"}</th>
                <th scope={"col"}>
                  <span className={"sr"}>{"Action"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.label}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className={"btn sm"} type={"button"} {...row.data}>
                      {"Make a lead"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgBk"}>
          {"Close"}
        </button>
      </div>
    </dialog>
  );
}
