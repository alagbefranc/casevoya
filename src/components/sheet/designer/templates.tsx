/**
 * The Designer's Templates page (`markup/templates.tsx`): Program templates (default), Message
 * templates, Checklists, Source review and Rule detail tabs. Same DOM, classes and order; the
 * rows come from the firm's records and the approved email catalog. Read only here: rule review
 * and publication stay in the source-governance workflow (T013).
 *
 * Live-only addition: `data-nav` on New template (it opens the Agreements page's template
 * dialog, where firm templates are made). DOC-01, also live only: the Checklists tab shows the
 * firm's checklist templates with New checklist, Edit, New version and Approve (`ChecklistsLive`).
 */
import type { ChecklistsLiveData } from "@/modules/sheet/checklist-present";
import { ChecklistsLive } from "./checklists-live";
import { Empty, Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type TemplatesTab = "program" | "messages" | "checklists" | "sources" | "rule";

type Text = string | { left: string; right: string };

/** `href` (live only): the row opens its detail (an agreement template) or preview (an email design). */
export type ProgramRow = { template: string; jurisdiction: Text; version: string; state: MatterBadge; source: Text; reviewer: string; effective: string; pinned: Text; href?: string };
export type MessageRow = { template: string; channel: Text; usedBy: string; languages: Text; state: MatterBadge; href?: string };
export type ChecklistCard = { title: Text; note: Text; tag: string };
export type SourceKpi = { label: string; value: string; count?: number; note: string; warn?: boolean; href: string };
export type SourceRow = { rule: string; href?: string; jurisdiction: Text; state: MatterBadge; effective: string; reviewer: string; lastChecked: string; nextReview: Text | { num: Text }; affected: string };

export type RuleDetail = {
  title: Text;
  summary: string;
  claim: string;
  note: string | null;
  diff: { label: string; old: string; new: Text }[] | null;
  tests: { case: string; expected: string; result: string | MatterBadge }[] | null;
  source: { publisher: string; url: string; linkText: string; appliesTo: string; version: string; checked: string; reviewer: Text; state: MatterBadge } | null;
  actions: { role: string } | null;
};

export type TemplatesData = {
  tab: TemplatesTab;
  pills: string[];
  reviewCount: number;
  newTemplateHref?: string;
  /** Live: the button's honest label ("New agreement template": it can only make those). */
  newTemplateLabel?: string;
  program: { rows: ProgramRow[]; note: string };
  messages: { rows: MessageRow[] };
  /** `live` (DOC-01): the firm's own checklist templates, with editing for staff who may. */
  checklists: { cards: ChecklistCard[]; live?: ChecklistsLiveData };
  sources: { kpis: SourceKpi[]; rows: SourceRow[] };
  rule: RuleDetail | null;
};

const UL: Record<TemplatesTab, React.CSSProperties> = {
  program: { left: "0px", width: "109px" },
  messages: { left: "135px", width: "110px" },
  checklists: { left: "271px", width: "60px" },
  sources: { left: "358px", width: "104px" },
  rule: { left: "488px", width: "63px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Show({ text }: { text: Text }) {
  return typeof text === "string" ? <>{text}</> : <Pair left={text.left} right={text.right} />;
}

export function TemplatesHeader({ data }: { data: TemplatesData }) {
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
          <Icon name={"templates"} cls={"ic s"} />
          {"Templates"}
        </button>
        {data.pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          <button
            className={"btn p sm"}
            data-toast={"New template"}
            data-sub={"Starts as a draft. A licensed reviewer approves it before use."}
            data-fpb={"1"}
            data-nav={data.newTemplateHref}
          >
            <Icon name={"plus"} cls={"ic s"} />
            {data.newTemplateLabel ?? "New template"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"program"} className={data.tab === "program" ? "on" : undefined}>
          {"Program templates"}
        </button>
        <button role={"tab"} data-t={"messages"} className={data.tab === "messages" ? "on" : undefined}>
          {"Message templates"}
        </button>
        <button role={"tab"} data-t={"checklists"} className={data.tab === "checklists" ? "on" : undefined}>
          {"Checklists"}
        </button>
        <button role={"tab"} data-t={"sources"} className={data.tab === "sources" ? "on" : undefined}>
          <Pair left={"Source review"} right={String(data.reviewCount)} />
        </button>
        <button role={"tab"} data-t={"rule"} className={data.tab === "rule" ? "on" : undefined}>
          {"Rule detail"}
        </button>
        <i className={"ul"} style={UL[data.tab]}></i>
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

function Program({ data }: { data: TemplatesData }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <Art name={"templates-empty"} />
        <div>
          <h1 className={"display"}>{"Program templates"}</h1>
          <p>{"Each matter pins the template version it started with. A new release never changes an existing file or package."}</p>
        </div>
      </div>
      {data.program.rows.length === 0 ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"templates-empty"} title={"No program templates yet"} copy={"A program template appears here once its official sources are reviewed and it is published."} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Program templates"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Program templates"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Template"}</th>
                <th scope={"col"}>{"Jurisdiction"}</th>
                <th scope={"col"}>{"Version"}</th>
                <th scope={"col"}>{"Source"}</th>
                <th scope={"col"}>{"Reviewer"}</th>
                <th scope={"col"}>{"Effective"}</th>
                <th scope={"col"}>{"Matters pinned"}</th>
              </tr>
            </thead>
            <tbody>
              {data.program.rows.map((row, index) => (
                <tr key={index} data-href={row.href}>
                  <td>{row.template}</td>
                  <td>
                    <Show text={row.jurisdiction} />
                  </td>
                  <td>
                    {`${row.version} `}
                    <Badge badge={row.state} />
                  </td>
                  <td>
                    <Show text={row.source} />
                  </td>
                  <td>{row.reviewer}</td>
                  <td>{row.effective}</td>
                  <td>
                    <Show text={row.pinned} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={"fp-note rv"} style={i(2)}>
        {data.program.note}
      </p>
    </>
  );
}

function Messages({ data }: { data: TemplatesData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Message templates"}</h1>
          <p>{"Approved administrative templates that automations and staff can send. Notification versions carry minimal content and a portal link only."}</p>
        </div>
      </div>
      <div className={"tw rv"} role={"region"} aria-label={"Message templates"} tabIndex={0} style={i(1)}>
        <table className={"t"}>
          <caption className={"sr"}>{"Message templates"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Template"}</th>
              <th scope={"col"}>{"Channel"}</th>
              <th scope={"col"}>{"Used by"}</th>
              <th scope={"col"}>{"Languages"}</th>
              <th scope={"col"}>{"State"}</th>
            </tr>
          </thead>
          <tbody>
            {data.messages.rows.map((row, index) => (
              <tr key={index} data-href={row.href}>
                <td>{row.template}</td>
                <td>
                  <Show text={row.channel} />
                </td>
                <td>{row.usedBy}</td>
                <td>
                  <Show text={row.languages} />
                </td>
                <td>
                  <Badge badge={row.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Checklists({ data }: { data: TemplatesData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Checklist templates"}</h1>
          <p>{"Per-person and per-matter checklists generated from the program template and the intake answers."}</p>
        </div>
      </div>
      {data.checklists.live && (data.checklists.live.templates.length || data.checklists.live.edit) ? (
        <>
          {data.checklists.live.templates.length === 0 ? (
            <div className={"panel rv"} style={i(1)}>
              <Empty art={"templates-empty"} title={"No checklist templates yet"} copy={"Make the firm’s first checklist: what to ask for, from whom, and when it applies. A licensed consultant approves it before it reaches clients."} />
            </div>
          ) : null}
          <ChecklistsLive data={data.checklists.live} />
        </>
      ) : data.checklists.cards.length === 0 ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"templates-empty"} title={"No checklist templates yet"} copy={"Checklists come with a reviewed program template. None is published for your firm yet."} />
        </div>
      ) : (
        <div className={"fp-cards rv"} style={i(1)}>
          {data.checklists.cards.map((card, index) => (
            <div key={index} className={"fp-card"}>
              <h3>
                <Show text={card.title} />
              </h3>
              <p>
                <Show text={card.note} />
              </p>
              <span className={"fp-tag"} style={{ marginTop: "8px" }}>
                {card.tag}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Sources({ data }: { data: TemplatesData }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <Art name={"source-review-clear"} />
        <div>
          <h1 className={"display"}>{"Source review"}</h1>
          <p>{"The official sources behind every rule in your templates. If a source is missing or stale, the rule shows “Review required” and who owns it, never a made-up answer."}</p>
        </div>
      </div>
      <div className={"fp-kpi rv"} style={i(1)}>
        {data.sources.kpis.map((kpi) => (
          <a key={kpi.label} className={kpi.warn ? "fp-k warn k2-spot" : "fp-k k2-spot"} href={kpi.href} data-spot={"1"}>
            <small>{kpi.label}</small>
            {kpi.count !== undefined ? (
              <b className={"num"} data-count={String(kpi.count)} data-done={"1"}>
                {kpi.value}
              </b>
            ) : (
              <b className={"num"}>{kpi.value}</b>
            )}
            <span>{kpi.note}</span>
          </a>
        ))}
      </div>
      {data.sources.rows.length === 0 ? (
        <div className={"panel rv"} style={i(2)}>
          <Empty art={"source-review-clear"} title={"No rules to review"} copy={"Rules appear here with their official source, reviewer and next review date once they are drafted."} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Source register"} tabIndex={0} style={i(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Source register"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Rule"}</th>
                <th scope={"col"}>
                  <Pair left={"Jurisdiction"} right={"program"} />
                </th>
                <th scope={"col"}>{"Status"}</th>
                <th scope={"col"}>{"Effective"}</th>
                <th scope={"col"}>{"Reviewer"}</th>
                <th scope={"col"}>{"Last checked"}</th>
                <th scope={"col"}>{"Next review"}</th>
                <th scope={"col"}>{"Affected"}</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    {row.href ? (
                      <a href={row.href} style={{ color: "var(--blue)" }}>
                        {row.rule}
                      </a>
                    ) : (
                      row.rule
                    )}
                  </td>
                  <td>
                    <Show text={row.jurisdiction} />
                  </td>
                  <td>
                    <Badge badge={row.state} />
                  </td>
                  <td>{row.effective}</td>
                  <td>{row.reviewer}</td>
                  <td>{row.lastChecked}</td>
                  <td>
                    {typeof row.nextReview === "object" && "num" in row.nextReview ? (
                      <span className={"num"}>
                        <Show text={row.nextReview.num} />
                      </span>
                    ) : (
                      <Show text={row.nextReview as Text} />
                    )}
                  </td>
                  <td>{row.affected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Rule({ rule }: { rule: RuleDetail | null }) {
  if (!rule) {
    return (
      <>
        <div className={"ph rv"} style={i(0)}>
          <div>
            <h1 className={"display"}>{"Rule detail"}</h1>
            <p>{"Choose a rule in Source review to see its claim, its official source and who reviewed it."}</p>
          </div>
        </div>
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"source-review-clear"} title={"No rule chosen"} copy={"Open a rule from the Source review tab."} />
        </div>
      </>
    );
  }
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>
            <Show text={rule.title} />
          </h1>
          <p>{rule.summary}</p>
        </div>
      </div>
      <div className={"fp-g2 rv"} style={i(1)}>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"note"} />
              {"Draft claim"}
            </h2>
            <div className={"fp-pad"}>
              <p style={{ fontSize: "15px" }}>{rule.claim}</p>
              {rule.note ? <p className={"fp-note"}>{rule.note}</p> : null}
            </div>
          </section>
          {rule.diff ? (
            <section className={"panel"}>
              <h2>
                <Icon name={"repeat"} />
                {"Version comparison"}
              </h2>
              <div className={"fp-pad fp-diff"}>
                {rule.diff.map((line, index) => (
                  <p key={index} style={index > 0 ? { marginTop: "6px" } : undefined}>
                    {`${line.label}: `}
                    <del>{line.old}</del>{" "}
                    <ins>
                      <Show text={line.new} />
                    </ins>
                  </p>
                ))}
              </div>
            </section>
          ) : null}
          {rule.tests ? (
            <section className={"panel"}>
              <h2>
                <Icon name={"check-circle"} />
                {"Tests"}
              </h2>
              <div className={"tw"} role={"region"} aria-label={"Rule tests"} tabIndex={0}>
                <table className={"t"}>
                  <caption className={"sr"}>{"Rule tests"}</caption>
                  <thead>
                    <tr>
                      <th scope={"col"}>{"Case"}</th>
                      <th scope={"col"}>{"Expected"}</th>
                      <th scope={"col"}>{"Result"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.tests.map((test, index) => (
                      <tr key={index}>
                        <td>{test.case}</td>
                        <td>{test.expected}</td>
                        <td>{typeof test.result === "string" ? test.result : <Badge badge={test.result} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
        <div>
          {rule.source ? (
            <details className={"src"}>
              <summary>
                <Icon name={"link"} cls={"ic s"} />
                <span>
                  <b style={{ fontWeight: "500" }}>{"Source"}</b> <span className={"sep"} aria-hidden={"true"}></span>
                  {` ${rule.source.publisher}`}
                </span>
                <Badge badge={rule.source.state} />
                <Icon name={"chevron-down"} cls={"ic s ch"} />
              </summary>
              <dl>
                <dt>{"Publisher"}</dt>
                <dd>{rule.source.publisher}</dd>
                <dt>{"Link"}</dt>
                <dd>
                  <a href={rule.source.url} rel={"noopener"} target={"_blank"}>
                    {`${rule.source.linkText} `}
                    <Icon name={"external-link"} cls={"ic s"} />
                    <span className={"sr"}>{"(opens in a new tab)"}</span>
                  </a>
                </dd>
                <dt>{"Applies to"}</dt>
                <dd>{rule.source.appliesTo}</dd>
                <dt>{"Version"}</dt>
                <dd>{rule.source.version}</dd>
                <dt>{"Checked"}</dt>
                <dd>
                  <time className={"num"}>{rule.source.checked}</time>
                </dd>
                <dt>{"Reviewer"}</dt>
                <dd>
                  <Show text={rule.source.reviewer} />
                </dd>
              </dl>
            </details>
          ) : null}
          {rule.actions ? (
            <div className={"panel"} style={{ marginTop: "16px" }}>
              <div className={"fp-pad"}>
                <h3 style={{ fontSize: "15px", fontWeight: "500", marginBottom: "10px" }}>{`Actions for your role (${rule.actions.role})`}</h3>
                <div className={"fp-row"}>
                  <button className={"btn sm"} data-run={"ok"} data-done={"Evidence captured"} data-sub={"Page saved with today’s date."} data-fpr={"1"}>
                    <span className={"lab"}>
                      <Icon name={"camera"} cls={"ic s"} />
                      {" Capture evidence"}
                    </span>
                    <span className={"spin"} aria-hidden={"true"}></span>
                  </button>
                  <button className={"btn sm"} data-toast={"Review requested from Grace Lin"} data-sub={""} data-fpb={"1"}>
                    {"Request review"}
                  </button>
                  <button className={"btn sm"} data-run={"ok"} data-done={"Version 4 approved"} data-sub={"Publishing is a separate step."} data-fpr={"1"}>
                    <span className={"lab"}>{"Approve version"}</span>
                    <span className={"spin"} aria-hidden={"true"}></span>
                  </button>
                  <button className={"btn p sm"} data-toast={"Publishes after approval"} data-sub={"Existing matters keep their pinned version."} data-fpb={"1"}>
                    {"Publish"}
                  </button>
                  <button className={"btn sm"} data-toast={"Rule suspended"} data-sub={"Matters using it show “Review required”."} data-fpb={"1"}>
                    {"Suspend rule"}
                  </button>
                </div>
                <p className={"fp-note"}>{"There’s no single “Verified” switch. Each step is logged with who did it."}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function SheetTemplates({ data }: { data: TemplatesData }) {
  if (data.tab === "messages") return <Messages data={data} />;
  if (data.tab === "checklists") return <Checklists data={data} />;
  if (data.tab === "sources") return <Sources data={data} />;
  if (data.tab === "rule") return <Rule rule={data.rule} />;
  return <Program data={data} />;
}

