/**
 * The Designer's Vo and AI page (`markup/ai.tsx`): Settings (default), Run log, Citations library,
 * Abstain and offline, Human approval and Draft audit. Same DOM, classes and order as each captured
 * tab; the switches, runs, sources and audit rows come from the firm's Vo settings, runs, drafts
 * and approved source register (PRD AI-01..AI-06). Switches save only for the firm owner.
 */
import type { ReactNode } from "react";
import { Empty, Icon, Pair, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import type { Attrs } from "./drafts";
import { AiVendorTerms } from "./ai-vendor-terms";
import type { AiVendorTermsData } from "@/modules/sheet/vo-vendor-terms-present";

export type AiTab = "settings" | "runs" | "sources" | "states" | "rules" | "audit";

const TABS: { key: AiTab; label: string; ul: { left: string; width: string } }[] = [
  { key: "settings", label: "Settings", ul: { left: "0px", width: "47px" } },
  { key: "runs", label: "Run log", ul: { left: "73px", width: "46px" } },
  { key: "sources", label: "Citations library", ul: { left: "145px", width: "95px" } },
  { key: "states", label: "Abstain and offline", ul: { left: "266px", width: "112px" } },
  { key: "rules", label: "Human approval", ul: { left: "403px", width: "97px" } },
  { key: "audit", label: "Draft audit", ul: { left: "526px", width: "63px" } },
];

type Text = string | { left: string; right: string };

function Show({ text }: { text: Text }) {
  return typeof text === "string" ? <>{text}</> : <Pair left={text.left} right={text.right} />;
}

/** `disabled` (live only): why the switch can't be used now (Vo is off for the whole firm). */
export type AiSwitch = { id: string; label: string; small?: string; sr: string; on: boolean; attrs: Attrs; disabled?: string };
export type AiTerm = { term: string; value: string };

export type AiSettings = {
  intro: string;
  firm: AiSwitch[];
  categories: AiSwitch[];
  dataUse: AiTerm[];
  /** A live-only note under the firm switches (sample mode, who may change them). */
  note?: string | null;
  /** Live only (AI-06): the AI vendor terms panel and the owner's acknowledgement dialog. */
  vendorTerms?: AiVendorTermsData;
};

export type AiRunRow = {
  when: string;
  matter: string;
  /** Live only: the matter's page, linked from its reference. */
  matterHref?: string;
  task: string;
  model: { left: string; right: string };
  prompt: string;
  sources: string;
  actor: string;
  cost: string;
  review: MatterBadge;
  useful: { up: boolean; down: boolean; upAttrs: Attrs; downAttrs: Attrs } | null;
  attrs?: Attrs;
};

export type AiRuns = { intro: string; chips: string[]; rows: AiRunRow[]; note: string; empty: { title: string; copy: string } | null };

/** `href` (live only): the source's official page, opened from its name. */
export type AiSourceRow = { source: string; href?: string; publisher: string; effective: string; review: Text; owner: string; state: MatterBadge };
export type AiSourceDetail = {
  publisher: string;
  state: MatterBadge;
  rows: { term: string; value: string; href?: string; time?: boolean }[];
};
export type AiSources = { intro: string; rows: AiSourceRow[]; detail: AiSourceDetail | null; empty: { title: string; copy: string } | null };

export type AiStates = {
  abstain: { title: { left: string; right: string }; quote: string; badge: MatterBadge; tag: { left: string; right: string }; note: string };
  cite: { quote: string; timeline: { done: boolean; clock: string; said: string; items: string[] } };
  offline: { lead: string; text: string; actions: { label: string; primary?: boolean; attrs: Attrs }[] };
  uncertain: string;
};

export type AiRules = { approvals: [string, string][]; never: string[]; gates: AiTerm[] };

/** `href` (live only): the row opens the draft on its matter. */
export type AiAuditRow = { draft: string; matter: string; result: MatterBadge; by: string; when: string; change: Text; href?: string };
export type AiAudit = { rows: AiAuditRow[]; empty: { title: string; copy: string } | null };

export type AiData = {
  tab: AiTab;
  pills: string[];
  settings?: AiSettings;
  runs?: AiRuns;
  sources?: AiSources;
  states?: AiStates;
  rules?: AiRules;
  audit?: AiAudit;
};

const I = (n: number) => ({ "--i": String(n) }) as React.CSSProperties;

export function AiHeader({ data, fromSettings = false }: { data: Pick<AiData, "tab" | "pills">; fromSettings?: boolean }) {
  const current = TABS.find((tab) => tab.key === data.tab) ?? TABS[0];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {/* Live: opened from Settings › AI, the trail says where the person came from. */}
          {fromSettings ? "Settings" : "Practice"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"sparkles"} cls={"ic s"} />
          {"Vo and AI"}
        </button>
        {data.pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {TABS.map((tab) => (
          <button key={tab.key} role={"tab"} data-t={tab.key} className={tab.key === data.tab ? "on" : undefined}>
            {tab.label}
          </button>
        ))}
        <i className={"ul"} style={{ left: current.ul.left, width: current.ul.width }}></i>
      </div>
    </>
  );
}

function Head({ title, intro }: { title: string; intro: string }) {
  return (
    <div className={"ph rv"} style={I(0)}>
      <div>
        <h1 className={"display"}>{title}</h1>
        <p>{intro}</p>
      </div>
    </div>
  );
}

function Switch({ item }: { item: AiSwitch }) {
  return (
    <div className={"li"}>
      <div>
        <b>{item.label}</b>
        {item.small ? <small>{item.small}</small> : null}
      </div>
      <span className={"r"}>
        <button
          type={"button"}
          className={"k2-sw"}
          role={"switch"}
          aria-checked={item.on ? "true" : "false"}
          id={item.id}
          {...item.attrs}
          {...(item.disabled ? { disabled: true, "aria-disabled": "true", title: item.disabled, style: { opacity: 0.5, cursor: "not-allowed" } } : {})}
        >
          <span className={"k2-th"} aria-hidden={"true"}></span>
          <span className={"k2-sr"}>{item.sr}</span>
        </button>
      </span>
    </div>
  );
}

function Panel({ icon, title, children }: { icon: string; title: ReactNode; children: ReactNode }) {
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

function Terms({ rows }: { rows: AiTerm[] }) {
  return (
    <dl className={"fp-dl"}>
      {rows.map((row) => (
        <div key={row.term}>
          <dt>{row.term}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyPanel({ empty, index }: { empty: { title: string; copy: string }; index: number }) {
  return (
    <div className={"panel rv"} style={I(index)}>
      <Empty art={"review-queue-empty"} title={empty.title} copy={empty.copy} />
    </div>
  );
}

function SettingsTab({ data }: { data: AiSettings }) {
  return (
    <>
      <Head title={"Vo and AI"} intro={data.intro} />
      <div className={"fp-g2 rv"} style={I(1)}>
        <div>
          <Panel icon={"sparkles"} title={"For this firm"}>
            <div className={"fp-pad"}>
              {data.firm.map((item) => (
                <Switch key={item.id} item={item} />
              ))}
              {data.note ? <p className={"fp-note"}>{data.note}</p> : null}
            </div>
          </Panel>
        </div>
        <div>
          <Panel icon={"lock"} title={"By document category"}>
            <div className={"fp-pad"}>
              {data.categories.map((item) => (
                <Switch key={item.id} item={item} />
              ))}
            </div>
          </Panel>
          <Panel icon={"shield"} title={"Data use"}>
            <div className={"fp-pad"}>
              <Terms rows={data.dataUse} />
            </div>
          </Panel>
        </div>
      </div>
      {data.vendorTerms ? <AiVendorTerms data={data.vendorTerms} /> : null}
    </>
  );
}

const RUN_COLUMNS = ["When", "Matter", "Task", null, "Prompt", "Allowed sources", "Actor", "Cost", "Review", "Useful?"];

function RunsTab({ data }: { data: AiRuns }) {
  return (
    <>
      <Head title={"Run log"} intro={data.intro} />
      <div className={"bar fp-bar rv"} role={"search"} style={I(1)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search runs"} aria-label={"Search runs"} />
        {data.chips.map((chip, index) => (
          <button key={chip} className={index === 0 ? "fchip on" : "fchip"} aria-pressed={index === 0 ? "true" : "false"}>
            {chip}
          </button>
        ))}
      </div>
      {data.empty && data.rows.length === 0 ? (
        <EmptyPanel empty={data.empty} index={2} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Vo runs"} tabIndex={0} style={I(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Vo runs"}</caption>
            <thead>
              <tr>
                {RUN_COLUMNS.map((column, index) => (
                  <th key={index} scope={"col"}>
                    {column ?? <Pair left={"Model"} right={"config"} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index} {...(row.attrs ?? {})}>
                  <td>{row.when}</td>
                  <td>
                    {row.matterHref ? (
                      <a className={"tl"} href={row.matterHref}>
                        {row.matter}
                      </a>
                    ) : (
                      row.matter
                    )}
                  </td>
                  <td>{row.task}</td>
                  <td>
                    <Pair left={row.model.left} right={row.model.right} />
                  </td>
                  <td>{row.prompt}</td>
                  <td>{row.sources}</td>
                  <td>{row.actor}</td>
                  <td>{row.cost}</td>
                  <td>
                    <Badge badge={row.review} />
                  </td>
                  {row.useful ? (
                    <td>
                      <span className={"fp-row"} style={{ gap: "4px" }}>
                        <button className={"btn sm"} style={{ background: "none" }} aria-label={"Useful"} aria-pressed={row.useful.up ? "true" : "false"} {...row.useful.upAttrs}>
                          <Icon name={"thumb-up"} cls={"ic s"} />
                        </button>
                        <button className={"btn sm"} style={{ background: "none" }} aria-label={"Not useful"} aria-pressed={row.useful.down ? "true" : "false"} {...row.useful.downAttrs}>
                          <Icon name={"thumb-down"} cls={"ic s"} />
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.rows.length ? (
        // Live only: shown by the page's filter when no run matches the chip or search.
        <div className={"fp-fe rv"} hidden style={I(2)}>
          <Empty art={"filter-empty"} title={"No runs match"} copy={"Try another filter or clear the search."} />
        </div>
      ) : null}
      <p className={"fp-note rv"} style={I(3)}>
        {data.note}
      </p>
    </>
  );
}

function SourcesTab({ data }: { data: AiSources }) {
  return (
    <>
      <Head title={"Citations library"} intro={data.intro} />
      {data.empty && data.rows.length === 0 ? (
        <EmptyPanel empty={data.empty} index={1} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Approved sources"} tabIndex={0} style={I(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Approved sources"}</caption>
            <thead>
              <tr>
                {["Source", "Publisher", "Effective", "Review by", "Owner", "State"].map((column) => (
                  <th key={column} scope={"col"}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    {row.href ? (
                      <a className={"tl"} href={row.href} target={"_blank"} rel={"noopener noreferrer"}>
                        {row.source}
                      </a>
                    ) : (
                      row.source
                    )}
                  </td>
                  <td>{row.publisher}</td>
                  <td>{row.effective}</td>
                  <td>
                    <Show text={row.review} />
                  </td>
                  <td>{row.owner}</td>
                  <td>
                    <Badge badge={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.detail ? (
        <div style={{ marginTop: "6px", "--i": "2" } as React.CSSProperties} className={"rv"}>
          <details className={"src"}>
            <summary>
              <Icon name={"link"} cls={"ic s"} />
              <span>
                <b style={{ fontWeight: "500" }}>{"Source"}</b> <Sep />
                {` ${data.detail.publisher}`}
              </span>
              <Badge badge={data.detail.state} />
              <Icon name={"chevron-down"} cls={"ic s ch"} />
            </summary>
            <dl>
              {data.detail.rows.map((row) => (
                <SourceTerm key={row.term} row={row} />
              ))}
            </dl>
          </details>
        </div>
      ) : null}
    </>
  );
}

function SourceTerm({ row }: { row: AiSourceDetail["rows"][number] }) {
  return (
    <>
      <dt>{row.term}</dt>
      <dd>
        {row.href ? (
          <a href={row.href} rel={"noopener"} target={"_blank"}>
            {`${row.value} `}
            <Icon name={"external-link"} cls={"ic s"} />
            <span className={"sr"}>{"(opens in a new tab)"}</span>
          </a>
        ) : row.time ? (
          <time className={"num"}>{row.value}</time>
        ) : (
          row.value
        )}
      </dd>
    </>
  );
}

const PAD_ROW: React.CSSProperties = { display: "flex", gap: "14px", alignItems: "flex-start" };

function Pose({ name }: { name: string }) {
  return <img src={`/assets/vo/vo-${name}-96.png`} srcSet={`/assets/vo/vo-${name}-192.png 2x`} width={72} height={72} alt={""} />;
}

function StatesTab({ data }: { data: AiStates }) {
  const tl = data.cite.timeline;
  return (
    <>
      <Head title={"Abstain and offline"} intro={"What Vo does when it shouldn’t answer, and what happens when it isn’t available."} />
      <div className={"fp-g2 rv"} style={I(1)}>
        <div>
          <Panel
            icon={"help"}
            title={
              <span>
                <Pair left={data.abstain.title.left} right={data.abstain.title.right} />
              </span>
            }
          >
            <div className={"fp-pad"} style={PAD_ROW}>
              <Pose name={"abstain"} />
              <div>
                <p style={{ fontSize: "15px" }}>{data.abstain.quote}</p>
                <div className={"fp-row"} style={{ marginTop: "10px" }}>
                  <Badge badge={data.abstain.badge} />
                  <span className={"fp-tag"}>
                    <span>
                      <Pair left={data.abstain.tag.left} right={data.abstain.tag.right} />
                    </span>
                  </span>
                </div>
                <p className={"fp-note"}>{data.abstain.note}</p>
              </div>
            </div>
          </Panel>
          <Panel icon={"file-check"} title={"With a citation"}>
            <div className={"fp-pad"} style={PAD_ROW}>
              <Pose name={"cite"} />
              <div>
                <p style={{ fontSize: "15px" }}>{data.cite.quote}</p>
                <div id={"thAI"} style={{ marginTop: "10px" }} className={tl.done ? "k2-tl is-done shut" : "k2-tl"}>
                  <button type={"button"} className={"k2-tl-h"} aria-expanded={tl.done ? "false" : "true"} aria-controls={"tlfgjb4"} disabled={tl.done ? undefined : true}>
                    <Icon name={"sparkles"} cls={"ic s k2-tl-g"} />
                    <span className={"k2-tl-say"}>
                      <span className={"k2-tl-w k2-shiny"}>{"Checking sources…"}</span>
                      <span className={"k2-tl-d"}>{tl.done ? tl.said : null}</span>
                    </span>
                    <span className={"k2-tl-c num"}>{tl.done ? null : tl.clock}</span>
                    <Icon name={"chevron-down"} cls={"ic s k2-tl-ch"} />
                  </button>
                  <div className={"k2-tl-b"} id={"tlfgjb4"}>
                    <ol>
                      {tl.items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
        <div>
          <Panel icon={"wifi-off"} title={"Vo is unavailable"}>
            <div className={"fp-pad"} style={PAD_ROW}>
              <Pose name={"offline"} />
              <div>
                <p style={{ fontSize: "15px" }}>
                  <b style={{ fontWeight: "500" }}>{data.offline.lead}</b>
                  {data.offline.text}
                </p>
                {data.offline.actions.length ? (
                  <div className={"fp-row"} style={{ marginTop: "10px" }}>
                    {data.offline.actions.map((action) => (
                      <button key={action.label} className={action.primary ? "btn p sm" : "btn sm"} {...action.attrs}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Panel>
          <Panel icon={"alert"} title={"Uncertain answer"}>
            <div className={"fp-pad"}>
              <p style={{ fontSize: "14.5px" }}>{data.uncertain}</p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function RulesTab({ data }: { data: AiRules }) {
  return (
    <>
      <Head title={"Human approval"} intro={"Vo and automations can prepare work, but people make the decisions that matter."} />
      <div className={"fp-g2 rv"} style={I(1)}>
        <div>
          <Panel icon={"user-check"} title={"Always needs a person"}>
            <div className={"tw"} role={"region"} aria-label={"Needs human approval"} tabIndex={0}>
              <table className={"t"}>
                <caption className={"sr"}>{"Needs human approval"}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Action"}</th>
                    <th scope={"col"}>{"Who approves"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.approvals.map(([action, who]) => (
                    <tr key={action}>
                      <td>{action}</td>
                      <td>{who}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <div>
          <Panel icon={"x-circle"} title={"Vo can never"}>
            <div className={"fp-pad"}>
              <ul style={{ margin: "0 0 0 18px", fontSize: "14.5px", lineHeight: "1.9" }}>
                {data.never.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel icon={"check-circle"} title={"Release gates"}>
            <div className={"fp-pad"}>
              <Terms rows={data.gates} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function AuditTab({ data }: { data: AiAudit }) {
  return (
    <>
      <Head title={"Draft audit"} intro={"What happened to every draft: accepted as is, edited, or rejected, and by whom."} />
      {data.empty && data.rows.length === 0 ? (
        <EmptyPanel empty={data.empty} index={1} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Draft audit"} tabIndex={0} style={I(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Draft audit"}</caption>
            <thead>
              <tr>
                {["Draft", "Matter", "Result", "By", "When", "Change"].map((column) => (
                  <th key={column} scope={"col"}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index} data-href={row.href}>
                  <td>{row.draft}</td>
                  <td>{row.matter}</td>
                  <td>
                    <Badge badge={row.result} />
                  </td>
                  <td>{row.by}</td>
                  <td>{row.when}</td>
                  <td>
                    <Show text={row.change} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function SheetAi({ data }: { data: AiData }) {
  if (data.tab === "runs" && data.runs) return <RunsTab data={data.runs} />;
  if (data.tab === "sources" && data.sources) return <SourcesTab data={data.sources} />;
  if (data.tab === "states" && data.states) return <StatesTab data={data.states} />;
  if (data.tab === "rules" && data.rules) return <RulesTab data={data.rules} />;
  if (data.tab === "audit" && data.audit) return <AuditTab data={data.audit} />;
  return data.settings ? <SettingsTab data={data.settings} /> : null;
}
