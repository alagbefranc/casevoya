/**
 * The Designer's Clients page (`markup/clients.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for each tab: People, one person, and a household.
 * People rows carry `data-f` (the role filter chips: applicant, sponsor, dependant, lead)
 * so the kit can filter real rows; the captured rows have none. Panels the firm has no
 * records for are left out (null) rather than filled with words that are not true.
 */
import { Fragment, type ReactNode } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import { FilterEmpty } from "./filter-empty";
import { Badge, type MatterBadge } from "./matters";
import { personEditProps } from "./person-edit";
import type { PersonEditData } from "@/modules/sheet/edit-person";

export type ClientsTab = "dir" | "person" | "household";

/** Plain words, or the Designer's two-part line ("Own login · own consent"). */
export type ClientsText = string | { left: string; right: string };

export type ClientRow = {
  href: string;
  /** Filter chip tokens: "applicant", "sponsor", "dependant", "lead". */
  flags?: string[];
  person: SidebarPerson;
  role: string;
  matter: string;
  language: string;
  timezone: string;
  portal: ClientsText;
};

export type DuplicateData = {
  title: string;
  detail: string;
  /** Column headings that tell the two records apart ("2024 record", "Lead L4"). */
  columns: [string, string];
  rows: { label: string; values: [string, string] }[];
  merge: { toast: string; kind: string; sub: string };
};

export type FactValue = { num: string; suffix?: string } | { text: string } | { unknown: true };

export type FactRow = { fact: string; value: FactValue; source: ClientsText; review: string | MatterBadge };
export type SupersededRow = { fact: string; old: string; new: string; when: ClientsText };
export type RelationshipRow = { person: SidebarPerson; label: ClientsText };
export type PersonMatterRow = { href?: string; reference: string; role: string; state: MatterBadge };
export type PreferenceRow = { label: string; value: ClientsText };

export type PersonData = {
  name: string;
  summary: string;
  facts: FactRow[];
  /** Earlier values of a fact. Null when the firm keeps no such history to show. */
  superseded: SupersededRow[] | null;
  relationships: { rows: RelationshipRow[]; note: string };
  matters: { rows: PersonMatterRow[]; note: string[] };
  /** Contact and language preferences. Null when none are stored for the person. */
  preferences: PreferenceRow[] | null;
};

export type HouseholdData = {
  name: string;
  copy: string;
  members: string[];
  rows: { record: string; cells: ClientsText[] }[];
};

export type ClientsData = {
  tab: ClientsTab;
  counts: { people: number; households: number };
  /** The top bar's add-client control; null (live) for a role that can't add one (a finance user). */
  add: { href: string; label: string } | null;
  /** Labels of the second and third tabs: the person and household shown there. */
  tabs: { person: string; household: string };
  dir?: {
    copy: string;
    rows: ClientRow[];
    duplicate: DuplicateData | null;
    /** Live: the people couldn't be read, which is not the same as having none. */
    failed?: boolean;
    /** Live: the chips and search filter the rows, so the hidden "Nothing matches" panel is rendered. */
    filter?: boolean;
  };
  /** Null when there is no person to show. */
  person?: PersonData | null;
  /** Null when no household is recorded. */
  household?: HouseholdData | null;
  /**
   * The person tab's person, when the viewer's role may edit people: the top bar offers
   * "Edit details" (`PersonEditDialog`). Absent, the top bar is the Designer's.
   */
  edit?: PersonEditData | null;
};

const UNDERLINE: Record<ClientsTab, { left: string; width: string }> = {
  dir: { left: "0px", width: "39px" },
  person: { left: "65px", width: "79px" },
  household: { left: "170px", width: "108px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Text({ value }: { value: ClientsText }) {
  return typeof value === "string" ? <>{value}</> : <Pair left={value.left} right={value.right} />;
}

/** "Last portal sign-in 16 Oct · 2 tasks open · 1 invoice due 6 Nov.", the Designer's separator between parts. */
function Parts({ parts }: { parts: string[] }) {
  const last = parts.length - 1;
  return (
    <>
      {parts.map((part, index) =>
        index === 0 ? (
          `${part}${last > 0 ? " " : ""}`
        ) : (
          <Fragment key={index}>
            <Sep />
            {` ${part}${index < last ? " " : ""}`}
          </Fragment>
        ),
      )}
    </>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The Clients page's own top bar and its tab strip. */
export function ClientsHeader({ data }: { data: Pick<ClientsData, "tab" | "counts" | "add" | "tabs" | "edit"> }) {
  const tabs: [ClientsTab, string][] = [
    ["dir", "People"],
    ["person", data.tabs.person],
    ["household", data.tabs.household],
  ];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"folder"} cls={"ic s"} />
          {"Work"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"users"} cls={"ic s"} />
          {"Clients"}
        </button>
        <span className={"pill"}>{plural(data.counts.people, "person", "people")}</span>
        <span className={"pill"}>{plural(data.counts.households, "household", "households")}</span>
        <span className={"acts"}>
          {data.tab === "person" && data.edit ? (
            <button className={"btn s sm"} {...personEditProps(data.edit)}>
              <Icon name={"edit"} cls={"ic s"} />
              {"Edit details"}
            </button>
          ) : null}
          {data.add ? (
            <a className={"btn p sm"} href={data.add.href}>
              <Icon name={"user-plus"} cls={"ic s"} />
              {data.add.label}
            </a>
          ) : null}
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

function Art({ name }: { name: string }) {
  return (
    <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
      <img
        src={`/assets/generated/b2/${name}-160@1x.webp`}
        srcSet={`/assets/generated/b2/${name}-160@2x.webp 2x`}
        width={64}
        height={64}
        alt={""}
        loading={"lazy"}
        decoding={"async"}
      />
    </span>
  );
}

function Heading({ art, title, copy }: { art: string; title: string; copy: string }) {
  return (
    <div className={"ph v rv"} style={i(0)}>
      <Art name={art} />
      <div>
        <h1 className={"display"}>{title}</h1>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function Table({ label, head, children, region }: { label: string; head: ReactNode[]; children: ReactNode; region?: { n: number } }) {
  return (
    <div
      className={region ? "tw rv" : "tw"}
      role={"region"}
      aria-label={label}
      tabIndex={0}
      style={region ? i(region.n) : undefined}
    >
      <table className={"t"}>
        <caption className={"sr"}>{label}</caption>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope={"col"}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Directory({ data, add }: { data: NonNullable<ClientsData["dir"]>; add: ClientsData["add"] }) {
  return (
    <>
      <Heading art={"clients-empty"} title={"Clients"} copy={data.copy} />
      <div className={"bar fp-bar rv"} role={"search"} style={i(1)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search people"} aria-label={"Search people"} />
        <button className={"fchip on"} aria-pressed={"true"}>
          {"All"}
        </button>
        {["Applicants", "Sponsors", "Dependants", "Leads"].map((label) => (
          <button key={label} className={"fchip"} aria-pressed={"false"}>
            {label}
          </button>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <div className={"panel rv"} style={i(2)}>
          {data.failed ? (
            <Empty art={"clients-empty"} title={"Clients couldn’t load"} copy={"Nothing was changed. Reload the page to try again."} />
          ) : (
            <Empty art={"clients-empty"} title={"No clients yet"} copy={"A client appears here once you’re assigned to their matter."}>
              {add ? (
                <a className={"btn p sm"} href={add.href}>
                  {add.label}
                </a>
              ) : null}
            </Empty>
          )}
        </div>
      ) : (
        <Table label={"People"} head={["Person", "Role", "Matter", "Language", "Timezone", "Portal"]} region={{ n: 2 }}>
          {data.rows.map((row) => (
            <tr key={row.href} data-f={row.flags?.length ? row.flags.join(" ") : undefined}>
              <td>
                <a className={"fp-row"} href={row.href}>
                  <Avatar person={row.person} />
                  <b style={{ fontWeight: "500" }}>{row.person.name}</b>
                </a>
              </td>
              <td>{row.role}</td>
              <td>
                <span className={"num"}>{row.matter}</span>
              </td>
              <td>{row.language}</td>
              <td>{row.timezone}</td>
              <td>
                <Text value={row.portal} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      {/* The chips and search can hide every row: say so (use-sheet shows it), with Clear filters. */}
      {data.filter && data.rows.length ? <FilterEmpty n={3} /> : null}
      {data.duplicate ? (
        <div className={"alert info rv"} style={i(3)}>
          <Icon name={"merge"} />
          <div>
            <b>{data.duplicate.title}</b>
            {data.duplicate.detail}
          </div>
          <div className={"acts"}>
            <button className={"btn p sm"} data-dlg={"dlgDup"} data-fpd={"1"}>
              {"Compare"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Fact({ value }: { value: FactValue }) {
  if ("unknown" in value) return <i>{"Unknown"}</i>;
  if ("text" in value) return <>{value.text}</>;
  return (
    <>
      <span className={"num"}>{value.num}</span>
      {value.suffix ? ` ${value.suffix}` : null}
    </>
  );
}

function Panel({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={icon} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Person({ data }: { data: PersonData }) {
  return (
    <div className={"fp-g2 rv"} style={i(0)}>
      <div>
        <div className={"ph"}>
          <div>
            <h1 className={"display"}>{data.name}</h1>
            <p>{data.summary}</p>
          </div>
        </div>
        <Panel icon={"id-card"} title={"Facts and where they came from"}>
          <Table label={"Facts with provenance"} head={["Fact", "Value", "Source", "Review"]}>
            {data.facts.map((row) => (
              <tr key={row.fact}>
                <td>{row.fact}</td>
                <td>
                  <Fact value={row.value} />
                </td>
                <td>
                  <Text value={row.source} />
                </td>
                <td>{typeof row.review === "string" ? row.review : <Badge badge={row.review} />}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        {data.superseded ? (
          <Panel icon={"history"} title={"Superseded values"}>
            <Table label={"Superseded"} head={["Fact", "Old", "New", "When"]}>
              {data.superseded.map((row, index) => (
                <tr key={index}>
                  <td>{row.fact}</td>
                  <td>{row.old}</td>
                  <td>{row.new}</td>
                  <td>
                    <Text value={row.when} />
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
        ) : null}
      </div>
      <div>
        <Panel icon={"users"} title={"Relationships"}>
          <div className={"fp-pad"}>
            {data.relationships.rows.map((row, index) => (
              <div key={index} className={"li"}>
                <Avatar person={row.person} />
                <div>
                  <b>{row.person.name}</b>
                  <small>
                    <Text value={row.label} />
                  </small>
                </div>
              </div>
            ))}
            <p className={"fp-note"}>{data.relationships.note}</p>
          </div>
        </Panel>
        <Panel icon={"folder"} title={"Matters and history"}>
          {data.matters.rows.length ? (
            <Table label={"Matters"} head={["Matter", "Role", "State"]}>
              {data.matters.rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    {row.href ? (
                      <a href={row.href} className={"num"}>
                        {row.reference}
                      </a>
                    ) : (
                      <span className={"num"}>{row.reference}</span>
                    )}
                  </td>
                  <td>{row.role}</td>
                  <td>
                    <Badge badge={row.state} />
                  </td>
                </tr>
              ))}
            </Table>
          ) : null}
          <div className={"fp-pad"}>
            <p className={"fp-note"} style={{ margin: "0" }}>
              <Parts parts={data.matters.note} />
            </p>
          </div>
        </Panel>
        {data.preferences ? (
          <Panel icon={"settings"} title={"Preferences"}>
            <div className={"fp-pad"}>
              <dl className={"fp-dl"}>
                {data.preferences.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>
                      <Text value={row.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function Household({ data }: { data: HouseholdData }) {
  return (
    <>
      <Heading art={"family-tags"} title={data.name} copy={data.copy} />
      <Table label={"Who can see what"} head={["Record", ...data.members]} region={{ n: 1 }}>
        {data.rows.map((row, index) => (
          <tr key={index}>
            <td>{row.record}</td>
            {row.cells.map((cell, column) => (
              <td key={column}>
                <Text value={cell} />
              </td>
            ))}
          </tr>
        ))}
      </Table>
    </>
  );
}

function Nobody({ art, title, copy }: { art: string; title: string; copy: string }) {
  return (
    <div className={"panel rv"} style={i(0)}>
      <Empty art={art} title={title} copy={copy} />
    </div>
  );
}

export function SheetClients({ data }: { data: ClientsData }) {
  if (data.tab === "person") {
    return data.person ? (
      <Person data={data.person} />
    ) : (
      <Nobody art={"clients-empty"} title={"No client to show"} copy={"Choose someone on the People tab. Only people on matters you’re assigned to are listed."} />
    );
  }
  if (data.tab === "household") {
    return data.household ? (
      <Household data={data.household} />
    ) : (
      <Nobody art={"family-tags"} title={"No household recorded"} copy={"People grouped as a household appear here. A household never grants anyone access."} />
    );
  }
  return <Directory data={data.dir ?? { copy: "", rows: [], duplicate: null }} add={data.add} />;
}

/** The Designer's "Compare before merging" dialog. It sits after the frame, beside the scrim. */
export function DuplicateDialog({ data }: { data: DuplicateData }) {
  return (
    <dialog className={"dlg"} id={"dlgDup"} aria-labelledby={"dlgDupH"}>
      <div className={"dh"}>
        <h2 id={"dlgDupH"}>{"Compare before merging"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgDup"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <Table label={"Duplicate check"} head={["", ...data.columns]}>
          {data.rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.values[0]}</td>
              <td>{row.values[1]}</td>
            </tr>
          ))}
        </Table>
        <p className={"fp-note"}>{"Matching uses several details. A shared email alone is never enough."}</p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgDup"}>
          {"Keep separate"}
        </button>
        <button className={"btn p"} data-close={"dlgDup"} data-toast={data.merge.toast} data-toast-sub={data.merge.sub} data-toast-kind={data.merge.kind}>
          {"Merge these records"}
        </button>
      </div>
    </dialog>
  );
}
