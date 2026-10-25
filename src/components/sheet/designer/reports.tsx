/**
 * The Designer's Reports page (`markup/reports.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for each tab: Operations, Money, Processing and outcomes, Scheduled.
 *
 * Live-only additions (absent from the capture, so absent when the Designer's own values are
 * given): each panel's metric definition (`definition`, a `.fp-note` in the panel, the same
 * note the Workload panel already has), the source freshness line at the foot of the content,
 * the range chips' `data-nav`, the outcomes tab's firm-work-time table, empty states (`.emp`)
 * for a panel without rows, and a "no permission" panel for a tab the role cannot see.
 * REP-01 (live only): each card's link to the list behind it (`link`), stage ageing rows'
 * `data-href`, attendance's cancelled count, and four more Operations panels (`ops.more`: intake
 * completion, time to internal readiness, overdue tasks, renewal workload) built from the same
 * Panel, Bars, Table and note parts.
 */
import type { CSSProperties, ReactNode } from "react";
import { Empty, Icon, Sep } from "./frame";

export type ReportsTab = "ops" | "money" | "outcomes" | "scheduled";
export type ReportRange = "90d" | "month" | "year";

export type ReportBar = { label: string; count: number; tone: "" | "w" | "g" };

/** Live only (REP-01): a card's link to the filtered list behind it. */
export type ReportLink = { href: string; label: string };

/** Live only (REP-01): the Operations cards added to the Designer's five. */
export type ReportsOpsMore = {
  overdue: { open: number; overdue: number; sample: number; note: string; definition?: string };
  intake: { bars: ReportBar[]; note: string; definition?: string };
  readiness: { matters: number; median: string; longest: string; note: string; recorded: boolean; definition?: string };
  renewals: { bars: ReportBar[]; note: string; definition?: string };
  links?: { overdue?: ReportLink | null; intake?: ReportLink | null; readiness?: ReportLink | null; renewals?: ReportLink | null } | null;
};

export type ReportsOps = {
  leads: { bars: ReportBar[]; note: string; definition?: string; link?: ReportLink | null };
  /** Live: each row's `href` opens the matters list filtered to that stage. */
  ageing: { rows: { stage: string; matters: number; median: string; oldest: string; href?: string }[]; definition?: string; link?: ReportLink | null };
  workload: { rows: { person: string; open: number; overdue: number; matters: number }[]; definition?: string; link?: ReportLink | null };
  documents: { bars: ReportBar[]; definition?: string; link?: ReportLink | null };
  /** `cancelled` is live only. */
  attendance: { booked: number; attended: number; rescheduled: number; noShow: number; cancelled?: number; definition?: string; link?: ReportLink | null };
  more?: ReportsOpsMore | null;
};

export type ReportsMoney = {
  /** The accounting sync tag. Absent while no accounting integration exists. */
  sync?: { logo: string; label: string; detail: string } | null;
  ageing: { rows: { age: string; invoices: number; amount: string }[]; total: { invoices: number; amount: string }; definition?: string; link?: ReportLink | null };
  months: { rows: { month: string; invoiced: string; collected: string }[]; definition?: string; link?: ReportLink | null };
  balances: { rows: { client: string; held: string; pending: string }[]; definition?: string; link?: ReportLink | null };
  recon: { text: string; href: string; definition?: string };
};

export type OutcomeRow = { program: string; cohort: string; decided: number; median: string; pending: number };
export type FirmTimeRow = { program: string; cohort: string; files: number; median: string };

export type ReportsOutcomes = {
  rows: OutcomeRow[];
  note: string;
  definition?: string;
  /** Firm work time (opened to submitted), kept apart from government processing. Live only. */
  firm?: { rows: FirmTimeRow[]; definition: string } | null;
  /** Live: the heading's line, in plain words (no requirement codes). */
  intro?: string | null;
};

export type ReportsScheduled = { rows: { report: string; every: string; recipients: string; format: string; next: string }[] };

export type ReportsExportDialog = {
  filters: [string, string, string];
  timezone: string;
  currency: string;
  note: string;
  toastSub: string;
  /** The live download: its route and the attributes use-sheet reads. Absent in the capture. */
  wire?: { href: string; disabled?: boolean; reason?: string | null } | null;

};

export type ReportsData = {
  tab: ReportsTab;
  range: ReportRange;
  pills: [string, string];
  /** Live: each pill's title (what the period and the scope mean). */
  pillTitles?: [string | null, string | null] | null;
  /** Where each range chip goes. Absent in the capture. */
  rangeNav?: Record<ReportRange, string> | null;
  ops?: ReportsOps | null;
  money?: ReportsMoney | null;
  outcomes?: ReportsOutcomes | null;
  scheduled?: ReportsScheduled | null;
  /** A tab this role cannot see. */
  denied?: { title: string; copy: string } | null;
  /** "Computed 16 Oct, 14:02 (America/Toronto) from …". Live only. */
  freshness?: string | null;
  dialog: ReportsExportDialog;
};

const UNDERLINE: Record<ReportsTab, CSSProperties> = {
  ops: { left: "0px", width: "64px" },
  money: { left: "90px", width: "41px" },
  outcomes: { left: "157px", width: "147px" },
  scheduled: { left: "329px", width: "60px" },
};

const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;
const R: CSSProperties = { textAlign: "right" };

/** pillTitles (live): what each pill means, as its title (the scope pill is a fact, not a filter). */
export function ReportsHeader({ tab, pills, pillTitles }: { tab: ReportsTab; pills: [string, string]; pillTitles?: [string | null, string | null] | null }) {
  const tabs: [ReportsTab, string][] = [
    ["ops", "Operations"],
    ["money", "Money"],
    ["outcomes", "Processing and outcomes"],
    ["scheduled", "Scheduled"],
  ];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Practice"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"reports"} cls={"ic s"} />
          {"Reports"}
        </button>
        <span className={"pill"} title={pillTitles?.[0] ?? undefined}>
          {pills[0]}
        </span>
        <span className={"pill"} title={pillTitles?.[1] ?? undefined}>
          {pills[1]}
        </span>
        <span className={"acts"}>
          <button className={"btn p sm"} data-dlg={"dlgExp"} data-fpd={"1"}>
            <Icon name={"download"} cls={"ic s"} />
            {"Export"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {tabs.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[tab]}></i>
      </div>
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

/** A definition under a table, in the Workload panel's own note markup. */
function TableNote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className={"fp-pad"}>
      <p className={"fp-note"} style={{ margin: "0" }}>
        {text}
      </p>
    </div>
  );
}

/** Live only (REP-01): the card's link to its list, in the Reconciliation panel's link style. */
function ListLink({ link }: { link?: ReportLink | null }) {
  if (!link) return null;
  return (
    <p className={"fp-note"}>
      <a href={link.href} style={{ color: "var(--blue)" }}>
        {link.label}
      </a>
    </p>
  );
}

/** A table panel's link, in its own padded block like TableNote. */
function TableLink({ link }: { link?: ReportLink | null }) {
  if (!link) return null;
  return (
    <div className={"fp-pad"}>
      <ListLink link={link} />
    </div>
  );
}

function Bars({ bars }: { bars: ReportBar[] }) {
  const max = Math.max(0, ...bars.map((bar) => bar.count));
  return (
    <div className={"fp-bars"}>
      {bars.map((bar) => (
        <div key={bar.label}>
          <span>{bar.label}</span>
          <i className={bar.tone} style={{ width: `${max ? (bar.count / max) * 100 : 0}%` }} aria-hidden={"true"}></i>
          <span className={"num"} style={R}>
            {String(bar.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Table({ label, head, children }: { label: string; head: [string, boolean][]; children: ReactNode }) {
  return (
    <div className={"tw"} role={"region"} aria-label={label} tabIndex={0}>
      <table className={"t"}>
        <caption className={"sr"}>{label}</caption>
        <thead>
          <tr>
            {head.map(([text, right]) => (
              <th key={text} scope={"col"} style={right ? R : undefined}>
                {text}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Num({ children }: { children: string }) {
  return (
    <td className={"num"} style={R}>
      {children}
    </td>
  );
}

function NoRows({ title, copy }: { title: string; copy: string }) {
  return <Empty art={"reports-empty"} px={64} title={title} copy={copy} />;
}

function Freshness({ text, n }: { text?: string | null; n: number }) {
  if (!text) return null;
  return (
    <p className={"fp-note rv"} style={i(n)}>
      {text}
    </p>
  );
}

function Denied({ data, n }: { data: { title: string; copy: string }; n: number }) {
  return (
    <div className={"panel rv"} style={i(n)}>
      <Empty art={"privacy-shield"} title={data.title} copy={data.copy} />
    </div>
  );
}

const CHIPS: [ReportRange, string][] = [
  ["90d", "Last 90 days"],
  ["month", "This month"],
  ["year", "This year"],
];

/** Live only (REP-01): intake completion and time to internal readiness, under Stage ageing. */
function OpsMoreLeft({ more }: { more: ReportsOpsMore }) {
  return (
    <>
      <Panel icon={"templates"} title={"Intake completion"}>
        <div className={"fp-pad"}>
          <Bars bars={more.intake.bars} />
          <p className={"fp-note"}>{more.intake.note}</p>
          {more.intake.definition ? <p className={"fp-note"}>{more.intake.definition}</p> : null}
          <ListLink link={more.links?.intake} />
        </div>
      </Panel>
      <Panel icon={"check-circle"} title={"Time to internal readiness"}>
        {more.readiness.recorded ? (
          <Table label={"Time to internal readiness"} head={[["Matters", true], ["Median days", true], ["Longest", true]]}>
            <tr>
              <Num>{String(more.readiness.matters)}</Num>
              <Num>{more.readiness.median}</Num>
              <Num>{more.readiness.longest}</Num>
            </tr>
          </Table>
        ) : (
          <NoRows title={"Not recorded"} copy={"Days from opening to Ready to submit appear here once a matter makes that move in the period."} />
        )}
        <div className={"fp-pad"}>
          <p className={"fp-note"} style={{ margin: "0" }}>
            {more.readiness.note}
          </p>
          {more.readiness.definition ? <p className={"fp-note"}>{more.readiness.definition}</p> : null}
          <ListLink link={more.links?.readiness} />
        </div>
      </Panel>
    </>
  );
}

/** Live only (REP-01): overdue tasks and renewal workload, under Consultation attendance. */
function OpsMoreRight({ more }: { more: ReportsOpsMore }) {
  return (
    <>
      <Panel icon={"alarm"} title={"Overdue tasks"}>
        <div className={"fp-pad"}>
          <p style={{ fontSize: "14.5px" }}>
            {`${more.overdue.overdue} overdue `}
            <Sep />
            {` ${more.overdue.open} open internal tasks`}
          </p>
          <p className={"fp-note"}>{more.overdue.note}</p>
          {more.overdue.definition ? <p className={"fp-note"}>{more.overdue.definition}</p> : null}
          <ListLink link={more.links?.overdue} />
        </div>
      </Panel>
      <Panel icon={"repeat"} title={"Renewal workload"}>
        <div className={"fp-pad"}>
          <Bars bars={more.renewals.bars} />
          <p className={"fp-note"}>{more.renewals.note}</p>
          {more.renewals.definition ? <p className={"fp-note"}>{more.renewals.definition}</p> : null}
          <ListLink link={more.links?.renewals} />
        </div>
      </Panel>
    </>
  );
}

function Operations({ data, ops }: { data: ReportsData; ops: ReportsOps | null | undefined }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/reports-empty-160@1x.webp"}
            srcSet={"/assets/generated/b2/reports-empty-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{"Reports"}</h1>
          <p>
            {"How work is moving across the firm. Every report has a table under its chart, and exports keep your filters, the time they were made and who could see them."}
          </p>
        </div>
      </div>
      <div className={"bar fp-bar rv"} role={"search"} style={i(1)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Filter by owner, office or program"} aria-label={"Filter by owner, office or program"} />
        {CHIPS.map(([key, label]) => (
          <button
            key={key}
            className={key === data.range ? "fchip on" : "fchip"}
            aria-pressed={key === data.range ? "true" : "false"}
            data-nav={data.rangeNav?.[key]}
          >
            {label}
          </button>
        ))}
      </div>
      {data.denied || !ops ? (
        <Denied data={data.denied ?? { title: "Nothing to show", copy: "" }} n={2} />
      ) : (
        <div className={"fp-g2 rv"} style={i(2)}>
          <div>
            <Panel icon={"kanban"} title={"Lead conversion"}>
              <div className={"fp-pad"}>
                <Bars bars={ops.leads.bars} />
                <p className={"fp-note"}>{ops.leads.note}</p>
                {ops.leads.definition ? <p className={"fp-note"}>{ops.leads.definition}</p> : null}
                <ListLink link={ops.leads.link} />
              </div>
            </Panel>
            <Panel icon={"hourglass"} title={"Stage ageing, open matters"}>
              {ops.ageing.rows.length ? (
                <Table label={"Stage ageing"} head={[["Stage", false], ["Matters", true], ["Median days", true], ["Oldest", true]]}>
                  {ops.ageing.rows.map((row) => (
                    <tr key={row.stage} data-href={row.href} style={row.href ? { cursor: "pointer" } : undefined}>
                      <td>{row.stage}</td>
                      <Num>{String(row.matters)}</Num>
                      <Num>{row.median}</Num>
                      <Num>{row.oldest}</Num>
                    </tr>
                  ))}
                </Table>
              ) : (
                <NoRows title={"No open matters"} copy={"Open matters and how long they have been in their stage appear here."} />
              )}
              <TableNote text={ops.ageing.definition} />
              <TableLink link={ops.ageing.link} />
            </Panel>
            {ops.more ? <OpsMoreLeft more={ops.more} /> : null}
          </div>
          <div>
            <Panel icon={"users"} title={"Workload"}>
              {ops.workload.rows.length ? (
                <Table label={"Staff workload"} head={[["Person", false], ["Open tasks", true], ["Overdue", true], ["Matters", true]]}>
                  {ops.workload.rows.map((row) => (
                    <tr key={row.person}>
                      <td>{row.person}</td>
                      <Num>{String(row.open)}</Num>
                      <Num>{String(row.overdue)}</Num>
                      <Num>{String(row.matters)}</Num>
                    </tr>
                  ))}
                </Table>
              ) : (
                <NoRows title={"No staff workload yet"} copy={"Open tasks and matters for each person appear here."} />
              )}
              <div className={"fp-pad"}>
                <p className={"fp-note"} style={{ margin: "0" }}>
                  {"Workload is shown for planning, not ranking. Nobody is ranked by approval rate."}
                </p>
                {ops.workload.definition ? <p className={"fp-note"}>{ops.workload.definition}</p> : null}
                <ListLink link={ops.workload.link} />
              </div>
            </Panel>
            <Panel icon={"file-check"} title={"Outstanding documents"}>
              <div className={"fp-pad"}>
                <Bars bars={ops.documents.bars} />
                {ops.documents.definition ? <p className={"fp-note"}>{ops.documents.definition}</p> : null}
                <ListLink link={ops.documents.link} />
              </div>
            </Panel>
            <Panel icon={"calendar"} title={"Consultation attendance"}>
              <div className={"fp-pad"}>
                <p style={{ fontSize: "14.5px" }}>
                  {`${ops.attendance.booked} booked `}
                  <Sep />
                  {` ${ops.attendance.attended} attended `}
                  <Sep />
                  {` ${ops.attendance.rescheduled} rescheduled `}
                  <Sep />
                  {` ${ops.attendance.noShow} no-show`}
                  {ops.attendance.cancelled === undefined ? null : (
                    <>
                      {" "}
                      <Sep />
                      {` ${ops.attendance.cancelled} cancelled`}
                    </>
                  )}
                </p>
                {ops.attendance.definition ? <p className={"fp-note"}>{ops.attendance.definition}</p> : null}
                <ListLink link={ops.attendance.link} />
              </div>
            </Panel>
            {ops.more ? <OpsMoreRight more={ops.more} /> : null}
          </div>
        </div>
      )}
      <Freshness text={data.freshness} n={3} />
    </>
  );
}

function Money({ data, money }: { data: ReportsData; money: ReportsMoney | null | undefined }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Money reports"}</h1>
          <p>{"Invoiced, collected and owed, plus client-account balances and reconciliation exceptions. Amounts in CAD."}</p>
        </div>
      </div>
      {money?.sync ? (
        <div className={"fp-row rv"} style={{ margin: "-6px 0px 16px", "--i": "1" } as CSSProperties}>
          <span className={"fp-tag"}>
            <img src={money.sync.logo} alt={""} width={16} height={16} style={{ verticalAlign: "-3px" }} />
            <span>
              {` ${money.sync.label} `}
              <Sep />
              {` ${money.sync.detail}`}
            </span>
          </span>
        </div>
      ) : null}
      {data.denied || !money ? (
        <Denied data={data.denied ?? { title: "Nothing to show", copy: "" }} n={2} />
      ) : (
        <div className={"fp-g2 rv"} style={i(2)}>
          <div>
            <Panel icon={"invoice"} title={"Receivables ageing"}>
              <Table label={"Receivables ageing"} head={[["Age", false], ["Invoices", true], ["CAD", true]]}>
                {money.ageing.rows.map((row) => (
                  <tr key={row.age}>
                    <td>{row.age}</td>
                    <Num>{String(row.invoices)}</Num>
                    <Num>{row.amount}</Num>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>{"Total"}</b>
                  </td>
                  <td className={"num"} style={R}>
                    <b>{String(money.ageing.total.invoices)}</b>
                  </td>
                  <td className={"num"} style={R}>
                    <b>{money.ageing.total.amount}</b>
                  </td>
                </tr>
              </Table>
              <TableNote text={money.ageing.definition} />
              <TableLink link={money.ageing.link} />
            </Panel>
            <Panel icon={"wallet"} title={"Invoiced and collected"}>
              <Table label={"Invoiced and collected"} head={[["Month", false], ["Invoiced", true], ["Collected", true]]}>
                {money.months.rows.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <Num>{row.invoiced}</Num>
                    <Num>{row.collected}</Num>
                  </tr>
                ))}
              </Table>
              <TableNote text={money.months.definition} />
              <TableLink link={money.months.link} />
            </Panel>
          </div>
          <div>
            <Panel icon={"bank"} title={"Client-account balances"}>
              {money.balances.rows.length ? (
                <Table label={"Client-account balances"} head={[["Client", false], ["Held", true], ["Pending", true]]}>
                  {money.balances.rows.map((row) => (
                    <tr key={row.client}>
                      <td>{row.client}</td>
                      <Num>{row.held}</Num>
                      <Num>{row.pending}</Num>
                    </tr>
                  ))}
                </Table>
              ) : (
                <NoRows title={"No client funds held"} copy={"Balances appear here once a deposit is recorded in a client account."} />
              )}
              <TableNote text={money.balances.definition} />
              <TableLink link={money.balances.link} />
            </Panel>
            <Panel icon={"reconcile"} title={"Reconciliation exceptions"}>
              <div className={"fp-pad"}>
                <p style={{ fontSize: "14.5px" }}>
                  {`${money.recon.text} `}
                  <a href={money.recon.href} style={{ color: "var(--blue)" }}>
                    {"Open reconciliation"}
                  </a>
                </p>
                {money.recon.definition ? <p className={"fp-note"}>{money.recon.definition}</p> : null}
              </div>
            </Panel>
          </div>
        </div>
      )}
      <Freshness text={data.freshness} n={3} />
    </>
  );
}

function Outcomes({ data, outcomes }: { data: ReportsData; outcomes: ReportsOutcomes | null | undefined }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Processing and outcomes"}</h1>
          <p>{outcomes?.intro ?? "Descriptive history only. These numbers describe past files; they aren’t anyone’s chance of success (REP-02)."}</p>
        </div>
      </div>
      <div className={"alert info rv"} style={i(1)}>
        <Icon name={"info"} />
        <div>
          <b>{"Pending files aren’t counted as outcomes"}</b>
          {"Each row shows its sample size. Rows with fewer than 5 decided files are hidden."}
        </div>
      </div>
      {data.denied || !outcomes ? (
        <Denied data={data.denied ?? { title: "Nothing to show", copy: "" }} n={2} />
      ) : (
        <>
          {outcomes.rows.length ? (
            <div className={"tw rv"} role={"region"} aria-label={"Government processing, decided files only"} tabIndex={0} style={i(2)}>
              <table className={"t"}>
                <caption className={"sr"}>{"Government processing, decided files only"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Program"}</th>
                    <th scope={"col"}>{"Cohort"}</th>
                    <th scope={"col"} style={R}>
                      {"Decided files"}
                    </th>
                    <th scope={"col"} style={R}>
                      {"Median days to decision"}
                    </th>
                    <th scope={"col"} style={R}>
                      {"Still pending (not counted)"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.rows.map((row) => (
                    <tr key={`${row.program}|${row.cohort}`}>
                      <td>{row.program}</td>
                      <td>{row.cohort}</td>
                      <Num>{String(row.decided)}</Num>
                      <Num>{row.median}</Num>
                      <Num>{String(row.pending)}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={"panel rv"} style={i(2)}>
              <NoRows title={"No submitted files yet"} copy={"Once a matter is recorded as submitted, its processing time appears here by program and year."} />
            </div>
          )}
          <p className={"fp-note rv"} style={i(3)}>
            {outcomes.note}
          </p>
          {outcomes.definition ? (
            <p className={"fp-note rv"} style={i(3)}>
              {outcomes.definition}
            </p>
          ) : null}
          {outcomes.firm ? (
            <>
              {outcomes.firm.rows.length ? (
                <div className={"tw rv"} role={"region"} aria-label={"Firm work time, opened to submitted"} tabIndex={0} style={i(4)}>
                  <table className={"t"}>
                    <caption className={"sr"}>{"Firm work time, opened to submitted"}</caption>
                    <thead>
                      <tr>
                        <th scope={"col"}>{"Program"}</th>
                        <th scope={"col"}>{"Cohort"}</th>
                        <th scope={"col"} style={R}>
                          {"Submitted files"}
                        </th>
                        <th scope={"col"} style={R}>
                          {"Median days, opened to submitted"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcomes.firm.rows.map((row) => (
                        <tr key={`${row.program}|${row.cohort}`}>
                          <td>{row.program}</td>
                          <td>{row.cohort}</td>
                          <Num>{String(row.files)}</Num>
                          <Num>{row.median}</Num>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p className={"fp-note rv"} style={i(5)}>
                {outcomes.firm.definition}
              </p>
            </>
          ) : null}
        </>
      )}
      <Freshness text={data.freshness} n={6} />
    </>
  );
}

function Scheduled({ data, scheduled }: { data: ReportsData; scheduled: ReportsScheduled | null | undefined }) {
  const rows = scheduled?.rows ?? [];
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Scheduled reports"}</h1>
          <p>
            {"Recipients are checked again when each report is sent. Confidential reports are never attached to general email; the email links back to Casevoya."}
          </p>
        </div>
      </div>
      {rows.length ? (
        <div className={"tw rv"} role={"region"} aria-label={"Scheduled reports"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Scheduled reports"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Report"}</th>
                <th scope={"col"}>{"Every"}</th>
                <th scope={"col"}>{"Recipients"}</th>
                <th scope={"col"}>{"Format"}</th>
                <th scope={"col"}>{"Next"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.report}>
                  <td>{row.report}</td>
                  <td>{row.every}</td>
                  <td>{row.recipients}</td>
                  <td>{row.format}</td>
                  <td>
                    <span className={"num"}>{row.next}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={"panel rv"} style={i(1)}>
          <NoRows
            title={"No scheduled reports"}
            copy={"Scheduled sending isn’t set up yet. Use Export on any tab to make a file with its filters and the time it was made."}
          />
        </div>
      )}
      <Freshness text={data.freshness} n={2} />
    </>
  );
}

export function SheetReports({ data }: { data: ReportsData }) {
  if (data.tab === "money") return <Money data={data} money={data.money} />;
  if (data.tab === "outcomes") return <Outcomes data={data} outcomes={data.outcomes} />;
  if (data.tab === "scheduled") return <Scheduled data={data} scheduled={data.scheduled} />;
  return <Operations data={data} ops={data.ops} />;
}

/** The Designer's "Export this report" dialog. With `wire`, Export downloads the file (use-sheet `data-report-export`). */
export function ReportsExportDialog({ data }: { data: ReportsExportDialog }) {
  return (
    <dialog className={"dlg"} id={"dlgExp"} aria-labelledby={"dlgExpH"}>
      <div className={"dh"}>
        <h2 id={"dlgExpH"}>{"Export this report"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgExp"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"exF"}>{"Format"}</label>
          <select className={"sel"} id={"exF"}>
            <option>{"CSV"}</option>
            <option>{"PDF"}</option>
          </select>
        </div>
        <dl className={"fp-dl"}>
          <div>
            <dt>{"Filters kept"}</dt>
            <dd>
              {`${data.filters[0]} `}
              <Sep />
              {` ${data.filters[1]} `}
              <Sep />
              {` ${data.filters[2]}`}
            </dd>
          </div>
          <div>
            <dt>{"Made at"}</dt>
            <dd>{`Shown on the file, ${data.timezone}`}</dd>
          </div>
          <div>
            <dt>{"Currency"}</dt>
            <dd>{data.currency}</dd>
          </div>
          <div>
            <dt>{"Who can open it"}</dt>
            <dd>{"People who can see this report today"}</dd>
          </div>
        </dl>
        <p className={"fp-note"}>{data.note}</p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgExp"}>
          {"Cancel"}
        </button>
        <button
          className={"btn p"}
          data-close={data.wire ? undefined : "dlgExp"}
          data-toast={data.wire ? undefined : "Export ready"}
          data-toast-sub={data.wire ? undefined : data.toastSub}
          data-toast-kind={data.wire ? undefined : "ok"}
          data-report-export={data.wire ? data.wire.href : undefined}
          disabled={data.wire?.disabled || undefined}
          title={data.wire?.disabled ? data.wire.reason ?? undefined : undefined}
        >
          {"Export"}
        </button>
      </div>
    </dialog>
  );
}
