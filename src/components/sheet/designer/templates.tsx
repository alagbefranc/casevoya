/**
 * The Designer's Templates page (`markup/templates.tsx`): Program templates (default), Message
 * templates, Checklists, Source review and Rule detail tabs. Same DOM, classes and order; the
 * rows come from the firm's records and the approved email catalog.
 *
 * Live-only addition: `data-nav` on New template (it opens the Agreements page's template
 * dialog, where firm templates are made). On Message templates (OPS-04) it opens the firm's own
 * message template dialog instead (`newTemplateDialog`, `MessageTemplateDialog`), and the firm's
 * templates are rows above the email catalog.
 *
 * Live-only additions (SRC-01/02/03, source-claims.tsx): Add claim on Source review
 * (`sources.addClaim`), and on Rule detail the claim's evidence with every date on its own
 * (`rule.evidence`) and the review panel (`rule.review`). The Designer's demo "Actions for your
 * role" panel (`rule.actions`) stays demo-only; live data leaves it null.
 */
import { Empty, Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import { AddClaimButton, ClaimEvidenceList, ClaimReviewPanel, type AddClaimData, type ClaimEvidenceItem, type ClaimReviewData } from "./source-claims";

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
  /** Live only (SRC-01/02): each piece of evidence with its capture and every date on its own. */
  evidence?: ClaimEvidenceItem[];
  /** Live only (SRC-03): the review workbench panel for this version. */
  review?: ClaimReviewData;
};

export type TemplatesData = {
  tab: TemplatesTab;
  pills: string[];
  reviewCount: number;
  newTemplateHref?: string;
  /** Live: the button's honest label ("New agreement template": it can only make those). */
  newTemplateLabel?: string;
  /** Live (OPS-04): the dialog New template opens instead of a toast or a page. */
  newTemplateDialog?: string;
  program: { rows: ProgramRow[]; note: string };
  messages: { rows: MessageRow[] };
  checklists: { cards: ChecklistCard[] };
  /** `addClaim` (live only, SRC-01): the Add claim button and dialog. */
  sources: { kpis: SourceKpi[]; rows: SourceRow[]; addClaim?: AddClaimData };
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
            data-toast={data.newTemplateDialog ? undefined : "New template"}
            data-sub={data.newTemplateDialog ? undefined : "Starts as a draft. A licensed reviewer approves it before use."}
            data-fpb={"1"}
            data-nav={data.newTemplateDialog ? undefined : data.newTemplateHref}
            data-dlg={data.newTemplateDialog}
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
      {data.checklists.cards.length === 0 ? (
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
      {data.sources.addClaim ? <AddClaimButton data={data.sources.addClaim} /> : null}
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
          {rule.evidence ? <ClaimEvidenceList items={rule.evidence} /> : null}
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
          {rule.review ? <ClaimReviewPanel review={rule.review} /> : null}
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


export type MessageTemplateEdit = {
  id: string;
  version: number;
  useFor: "message" | "announcement";
  name: string;
  title: string;
  body: string;
  status: "draft" | "approved";
};

export type MessageTemplateDialogData = {
  organizationId: string;
  /** The template opened from its row (?view=), or null for a new one. */
  edit: MessageTemplateEdit | null;
  /** Firm owner or licensed consultant: may approve a draft. */
  canApprove: boolean;
  /** Firm owner, licensed consultant or case manager: may write templates. */
  canWrite: boolean;
};

const FIELD_HELP = "Fields: {client_first_name}, {matter_reference}, {firm_name}, {consultant_name}. An announcement can use {firm_name} only. A field Casevoya has no value for stays in the text for the sender to fill.";

/**
 * Live only (OPS-04): write or edit one of the firm's message templates (a message the composer can
 * insert, or an announcement). Saving makes it a draft; a firm owner or licensed consultant
 * approves it. Built from the Designer's dialog and field classes; buttons carry `data-mt-*`
 * (message-template-acts.ts). Opened by New template, or straight away for `?view=<template>`.
 */
export function MessageTemplateDialog({ data }: { data: MessageTemplateDialogData }) {
  const edit = data.edit;
  const announcement = edit?.useFor === "announcement";
  const ids = { "data-org": data.organizationId, "data-id": edit?.id ?? "", "data-v": edit ? String(edit.version) : "" };
  return (
    <dialog className={"dlg"} id={"dlgMt"} aria-labelledby={"dlgMtH"} data-autoopen={edit ? "1" : undefined}>
      <div className={"dh"}>
        <h2 id={"dlgMtH"}>{edit ? (edit.status === "approved" ? "Message template (approved)" : "Message template (draft)") : "New message template"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgMt"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"mtU"}>{"Use"}</label>
          <select className={"sel"} id={"mtU"} defaultValue={edit?.useFor ?? "message"}>
            <option value={"message"}>{"Message (the composer inserts it)"}</option>
            <option value={"announcement"}>{"Announcement (to many clients)"}</option>
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"mtN"}>{"Name"}</label>
          <input className={"inp"} id={"mtN"} maxLength={120} defaultValue={edit?.name ?? ""} />
        </div>
        <div className={"fld"} id={"mtTf"} hidden={announcement ? undefined : true}>
          <label htmlFor={"mtT"}>{"Title clients see"}</label>
          <input className={"inp"} id={"mtT"} maxLength={120} defaultValue={edit?.title ?? ""} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"mtB"}>{"Text"}</label>
          <textarea className={"ta"} id={"mtB"} maxLength={4000} defaultValue={edit?.body ?? ""}></textarea>
          <small style={{ color: "var(--t2)", display: "block", marginTop: "6px" }}>{FIELD_HELP}</small>
        </div>
        {edit?.status === "approved" ? (
          <p className={"fp-note"} role={"note"}>
            {"Saving a change makes it a draft again until it is approved."}
          </p>
        ) : null}
        {data.canWrite ? null : (
          <p className={"fp-note"} role={"note"}>
            {"Only a firm owner, licensed consultant or case manager can write templates."}
          </p>
        )}
      </div>
      <div className={"df"}>
        {edit && data.canWrite ? (
          <button className={"btn"} data-mt-archive={"1"} {...ids}>
            {"Archive"}
          </button>
        ) : null}
        <button className={"btn"} data-close={"dlgMt"}>
          {"Cancel"}
        </button>
        {edit?.status === "draft" && data.canApprove ? (
          <button className={"btn"} data-mt-approve={"1"} {...ids}>
            {"Approve"}
          </button>
        ) : null}
        <button className={"btn p"} data-mt-save={"1"} {...ids} disabled={data.canWrite ? undefined : true}>
          {"Save draft"}
        </button>
      </div>
    </dialog>
  );
}
