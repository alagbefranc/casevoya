/**
 * The matter page's Submissions and Decisions tabs (`markup/matter.tsx`, variants
 * `tab-submissions`, `tab-submissions--ready-1`, `tab-decisions` and `tab-decisions--outcome-*`),
 * rendered from the firm's records (T036 to T039). Same DOM, classes and order as the capture.
 *
 * What the capture shows only as a sample is left out when it has no record behind it: the
 * "Preview an outcome" segment and its note, the sample document thumbnails, Preview manifest,
 * and client-confirmation approvals (not stored yet). Controls the capture has no screen for are
 * built from the Designer's own classes, like the matter page's Record a deadline dialog: the
 * Record the decision and Confirm outcome forms, the three submission dialogs, a Verify button on
 * an unverified letter, and an Add receipt button on an unverified submission.
 */
import type { CSSProperties, ReactNode } from "react";
import { Icon, Pair, Sep } from "./frame";
import { Avatar, type SidebarPerson } from "./sidebar";

const css = (style: Record<string, string>) => style as CSSProperties;

export type GovWire = Record<`data-${string}`, string>;
export type GovBadge = { tone: string; label: string };

/** "A " · " B " · " C": the Designer's separated facts, each a single text run. */
function Joined({ parts }: { parts: string[] }): ReactNode {
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    const last = index === parts.length - 1;
    out.push(`${index === 0 ? "" : " "}${part}${last ? "" : " "}`);
  });
  return <>{out}</>;
}

function Badge({ badge }: { badge: GovBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.label}
    </span>
  );
}

function Spot({ name }: { name: string }) {
  return (
    <span className={"spot"}>
      <img src={`/assets/generated/spots/${name}@1x.webp`} srcSet={`/assets/generated/spots/${name}@2x.webp 2x`} width={88} height={88} alt={""} />
    </span>
  );
}

function Art({ name, px }: { name: string; px: number }) {
  return (
    <span className={"art"} style={css({ "--a": `${px}px` })} aria-hidden={"true"}>
      <img
        src={`/assets/generated/b2/${name}-160@1x.webp`}
        srcSet={`/assets/generated/b2/${name}-160@2x.webp 2x`}
        width={px}
        height={px}
        alt={""}
        loading={"lazy"}
        decoding={"async"}
      />
    </span>
  );
}

function Doc({ doc, w, h }: { doc: { kind: string; title: string; label: ReactNode }; w: number; h: number }) {
  return (
    <button type={"button"} className={"doct"} data-doc={doc.kind} data-doc-t={doc.title} aria-label={`Preview ${doc.title}`}>
      <img src={`/assets/docs/${doc.kind}-600.webp`} alt={""} width={w} height={h} loading={"lazy"} decoding={"async"} />
      <span>{doc.label}</span>
    </button>
  );
}

/* ----------------------------------------------------------- submissions */

export type SubmissionCheck = { title: string; done: boolean; note?: string | null; wire?: GovWire | null };
export type SubmissionApproval = { person: SidebarPerson; title: string; who: [string, string]; badge: GovBadge };
export type SubmissionRecord = { dot: string; title: [string, string]; parts: string[]; badge: GovBadge; action?: { label: string; wire: GovWire } | null };

export type MatterSubmissionsData = {
  /** The open (or latest) package; null shows the start state. */
  package: {
    title: [string, string];
    badge: GovBadge;
    hash: string | null;
    /** The Designer's sample manifest thumbnail; never set from real data. */
    manifest?: { title: string; label: [string, string] } | null;
    checks: SubmissionCheck[];
    approvals: SubmissionApproval[];
    note: string;
    /** Press and hold to sign off (a licensed consultant, ready). */
    hold: GovWire | null;
    /** Why the sign-off is not open, with the Designer's "Preview a ready package" link when sampled. */
    why: { text: string; link?: { href: string; label: string } | null } | null;
    /** The Designer's Preview manifest button; never set from real data. */
    preview?: string | null;
  } | null;
  /** Start a handoff (no package yet). */
  start?: GovWire | null;
  records: SubmissionRecord[];
  /** Record submission: enabled once signed off. */
  record: GovWire | null;
  earlier: SubmissionRecord[];
};

function RecordRow({ row, index }: { row: SubmissionRecord; index: number }) {
  return (
    <div className={"li rv"} style={css({ "--i": String(index) })}>
      <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: row.dot, flex: "none" }}></i>
      <div>
        <b>
          <Pair left={row.title[0]} right={row.title[1]} />
        </b>
        <small>
          <Joined parts={row.parts} />
        </small>
      </div>
      <span className={"r"}>
        {row.action ? (
          <button className={"btn s sm"} {...row.action.wire}>
            {row.action.label}
          </button>
        ) : null}
        <Badge badge={row.badge} />
      </span>
    </div>
  );
}

export function MatterSubmissions({ data }: { data: MatterSubmissionsData }) {
  const pkg = data.package;
  let index = 0;
  return (
    <>
      {pkg ? (
        <div className={"panel rv"} style={css({ "--i": String(index++) })}>
          <h2>
            <Icon name={"briefcase"} />
            <span>
              <Pair left={pkg.title[0]} right={pkg.title[1]} />
            </span>
            <span className={"r"} style={{ display: "flex", gap: "6px" }}>
              <Badge badge={pkg.badge} />
              {pkg.hash ? <span className={"pill num"}>{pkg.hash}</span> : null}
            </span>
          </h2>
          <div className={"split"} style={css({ "--n": "2" })}>
            <div>
              <h3>{"Submission checklist"}</h3>
              {pkg.manifest ? (
                <div className={"doct-row"}>
                  <Doc doc={{ kind: "package-manifest", title: pkg.manifest.title, label: <Pair left={pkg.manifest.label[0]} right={pkg.manifest.label[1]} /> }} w={72} h={96} />
                </div>
              ) : null}
              <ul className={"clist"} id={"clist"} data-rb-list={"1"}>
                {pkg.checks.map((check, at) => (
                  <li key={at} className={check.done ? "on" : ""}>
                    <span
                      className={check.done ? "ck on" : "ck"}
                      role={"checkbox"}
                      aria-checked={check.done ? "true" : "false"}
                      tabIndex={0}
                      aria-label={check.title}
                      {...(check.wire ?? {})}
                    ></span>
                    <div>
                      <b>{check.title}</b>
                      {check.note ? <small>{check.note}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>{"Approvals"}</h3>
              <div className={"appr"}>
                {pkg.approvals.map((approval, at) => (
                  <div key={at} className={"ap"}>
                    <Avatar person={approval.person} />
                    <div>
                      <b>{approval.title}</b>
                      <small>
                        <Pair left={approval.who[0]} right={approval.who[1]} />
                      </small>
                    </div>
                    <Badge badge={approval.badge} />
                  </div>
                ))}
              </div>
              <p className={"mu"} style={{ fontSize: "13.5px", margin: "14px 0" }}>
                {pkg.note}
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {pkg.hold ? (
                  <button className={"btn p k2-hold"} id={"apprB"} data-hold={"1"} {...pkg.hold}>
                    <i className={"k2-hf"} aria-hidden={"true"}></i>
                    <Icon name={"signature"} cls={"ic s"} />
                    {"Hold to approve package"}
                  </button>
                ) : (
                  <button className={"btn p"} id={"apprB"} aria-disabled={"true"}>
                    <Icon name={"signature"} cls={"ic s"} />
                    {"Hold to approve package"}
                  </button>
                )}
                {pkg.preview ? (
                  <button className={"btn s"} data-doc={"package-manifest"} data-doc-t={pkg.preview}>
                    <Icon name={"package"} cls={"ic s"} />
                    {"Preview manifest"}
                  </button>
                ) : null}
              </div>
              {pkg.hold ? (
                <p className={"why"}>
                  <Icon name={"signature"} cls={"ic s"} />
                  {"Press and hold to approve. Letting go early cancels."}
                </p>
              ) : pkg.why ? (
                <p className={"why"}>
                  <Icon name={"lock"} cls={"ic s"} />
                  {pkg.why.link ? (
                    <>
                      <span>
                        {`${pkg.why.text} `}
                        <Sep />
                        {" "}
                      </span>
                      <a href={pkg.why.link.href}>{pkg.why.link.label}</a>
                    </>
                  ) : (
                    <span>{pkg.why.text}</span>
                  )}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className={"empty rv"} style={css({ "--i": String(index++) })}>
          <Spot name={"submission"} />
          <div>
            <h3>{"No submission package yet"}</h3>
            <p>{"When a package is ready, start a handoff: name its version, and a licensed consultant signs it off. Casevoya doesn’t submit for you."}</p>
            {data.start ? (
              <div className={"ea"}>
                <button className={"btn p sm"} {...data.start}>
                  <Icon name={"plus"} cls={"ic s"} />
                  {"Start a submission handoff"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <h3 className={"sub rv"} style={css({ "--i": String(index++) })}>
        {"Submission records"}
      </h3>
      {data.records.length ? (
        data.records.map((row, at) => <RecordRow key={at} row={row} index={index++} />)
      ) : (
        <div className={"empty rv"} style={css({ "--i": String(index++) })}>
          <Spot name={"submission"} />
          <div>
            <h3>{"Nothing submitted yet"}</h3>
            <p>
              {
                "When the firm submits through the IRCC portal, record the confirmation number, submission time and receipt here. Without a receipt it shows as “Submission unverified”."
              }
            </p>
            <div className={"ea"}>
              <button className={"btn s sm"} {...(data.record ?? { "aria-disabled": "true" })}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Record submission"}
              </button>
            </div>
          </div>
        </div>
      )}
      <h3 className={"sub rv"} style={css({ marginTop: "28px", "--i": String(index++) })}>
        {"Earlier packages"}
      </h3>
      {data.earlier.length ? (
        data.earlier.map((row, at) => <RecordRow key={at} row={row} index={index++} />)
      ) : (
        <div className={"empty rv"} style={css({ "--i": String(index++) })}>
          <Art name={"p3-submission"} px={72} />
          <div>
            <h3>{"No earlier packages"}</h3>
            <p>{"Every version you send to the client or the government is kept here with its hash, who approved it and when."}</p>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- decisions */

export type GovLetterRow = {
  dot: string;
  title: [string, string] | string;
  parts: string[];
  badge: GovBadge;
  verify?: GovWire | null;
  /** The Designer's sample letter thumbnail; never set from real data. */
  thumb?: string | null;
};

export type FollowUpRow = { title: string; note: string; owner: SidebarPerson; urgent?: boolean; wire?: GovWire | null };

export type ConfirmForm = { wire: GovWire };

export type DecisionView = {
  outcome: "approved" | "refused" | "withdrawn" | "other";
  heading: string;
  tint: { art: string; title: string; copy: string };
  badge: GovBadge;
  /** Approved and other outcomes. */
  milestoneLabel?: string | null;
  evidence?: { line: string[]; thumb?: { title: string } | null };
  milestones?: { label: string; badge: GovBadge }[];
  summary?: { title: string; copy: string; review?: boolean };
  /** Refused. */
  record?: { received: string; recordedBy: string; confirmedBy: string };
  reasons?: string | null;
  reasonsSource?: string;
  interpretation?: string | null;
  consultantFirst?: string;
  /** Withdrawn. */
  steps?: { title: string; note: string; done: boolean; wire?: GovWire | null }[];
  /** Shown to a licensed consultant while the decision waits for confirmation. */
  confirm?: ConfirmForm | null;
  followUps: FollowUpRow[];
};

export type MatterDecisionsData = {
  /** The Designer's sample preview segment; never set from real data. */
  preview?: { selected: "none" | "approved" | "refused" | "withdrawn"; note: string } | null;
  decision: DecisionView | null;
  /** A verified decision letter waits for its decision to be recorded. */
  recordForm?: {
    wire: GovWire;
    outcomes: { value: string; label: string }[];
    milestones: { value: string; label: string }[];
  } | null;
  /** The empty state offers Record a government letter. */
  letter: boolean;
  letters: GovLetterRow[];
};

function Seg({ selected }: { selected: string }) {
  const tabs: [string, string, string][] = [
    ["none", "?tab=decisions", "No decision yet"],
    ["approved", "?tab=decisions&outcome=approved", "Approved"],
    ["refused", "?tab=decisions&outcome=refused", "Refused"],
    ["withdrawn", "?tab=decisions&outcome=withdrawn", "Withdrawn"],
  ];
  return (
    <div className={"seg rv"} role={"tablist"} aria-label={"Preview an outcome"} style={css({ "--i": "0" })}>
      {tabs.map(([key, href, label]) => (
        <a key={key} role={"tab"} aria-selected={key === selected ? "true" : "false"} href={href}>
          {label}
        </a>
      ))}
    </div>
  );
}

function ConfirmFields({ form }: { form: ConfirmForm }) {
  return (
    <>
      <label className={"fl"}>
        {"Consultant’s interpretation (optional)"}
        <textarea id={"decInt"} rows={2} />
      </label>
      <label className={"fl"}>
        {"Reviewed next steps"}
        <textarea id={"decNext"} rows={2} />
      </label>
      <button className={"btn p sm"} {...form.wire}>
        <Icon name={"check-circle"} cls={"ic s"} />
        {"Confirm outcome"}
      </button>
    </>
  );
}

function DecisionPanel({ view, index }: { view: DecisionView; index: number }) {
  if (view.outcome === "refused") {
    return (
      <div className={"panel urg rv"} style={css({ "--i": String(index) })}>
        <h2>
          <Icon name={"alert"} />
          {view.heading}
          <span className={"r"}>
            <Badge badge={view.badge} />
          </span>
        </h2>
        <div className={"split"}>
          <div>
            <h3>{"Decision record"}</h3>
            <div className={"kv"}>
              <span>{"Letter received"}</span>
              <b className={"num"}>{view.record?.received}</b>
              <span>{"Recorded by"}</span>
              <b>{view.record?.recordedBy}</b>
              <span>{"Outcome confirmed by"}</span>
              <b>{view.record?.confirmedBy}</b>
            </div>
          </div>
          <div>
            <h3>{"Authority’s reasons"}</h3>
            {view.reasons ? (
              <p className={"quote"}>
                {`“${view.reasons}” `}
                <small>{view.reasonsSource ?? "Quoted from the letter"}</small>
              </p>
            ) : (
              <p className={"mu"} style={{ fontSize: "14px" }}>
                {"Not recorded. Kept apart from the consultant’s interpretation."}
              </p>
            )}
          </div>
          <div>
            <h3>{"Consultant’s interpretation"}</h3>
            {view.interpretation ? (
              <p style={{ fontSize: "14px" }}>{view.interpretation}</p>
            ) : (
              <p className={"mu"} style={{ fontSize: "14px" }}>
                {"Not written yet. Kept separate from the authority’s reasons."}
              </p>
            )}
            {view.confirm ? <ConfirmFields form={view.confirm} /> : null}
          </div>
        </div>
        <div className={"lock"} style={{ margin: "6px 0 0", fontSize: "13.5px" }}>
          <Icon name={"info"} cls={"ic s"} />
          {`Casevoya doesn’t calculate appeal, reconsideration or judicial review rights or deadlines. ${view.consultantFirst ?? "The consultant"} decides next steps. Any new application or appeal opens as a new linked matter.`}
        </div>
      </div>
    );
  }
  if (view.outcome === "withdrawn") {
    return (
      <div className={"panel rv"} style={css({ "--i": String(index) })}>
        <h2>
          <Icon name={"x-circle"} />
          {view.heading}
          <span className={"r"}>
            <Badge badge={view.badge} />
          </span>
        </h2>
        <p className={"mu"} style={{ fontSize: "14px", marginBottom: "12px" }}>
          {"Moving a card on the pipeline is not a withdrawal. Each step below is recorded."}
        </p>
        <ul className={"clist"}>
          {(view.steps ?? []).map((step, at) => (
            <li key={at} className={step.done ? "on" : ""}>
              <span
                className={step.done ? "ck on" : "ck"}
                role={"checkbox"}
                aria-checked={step.done ? "true" : "false"}
                tabIndex={0}
                aria-label={step.title}
                {...(step.wire ?? {})}
              ></span>
              <div>
                <b>{step.title}</b>
                <small>{step.note}</small>
              </div>
            </li>
          ))}
        </ul>
        {view.confirm ? <ConfirmFields form={view.confirm} /> : null}
      </div>
    );
  }
  return (
    <div className={"panel rv"} style={css({ "--i": String(index) })}>
      <h2>
        <Icon name={view.outcome === "approved" ? "check-circle" : "info"} />
        <span>{view.milestoneLabel ? <Pair left={view.heading} right={view.milestoneLabel} /> : view.heading}</span>
        <span className={"r"}>
          <Badge badge={view.badge} />
        </span>
      </h2>
      <div className={"split"}>
        <div>
          <h3>{"Evidence"}</h3>
          {view.evidence?.thumb ? (
            <Doc doc={{ kind: "decision-letter", title: view.evidence.thumb.title, label: view.evidence.thumb.title }} w={84} h={112} />
          ) : null}
          <p style={{ fontSize: "14px" }}>
            <Joined parts={view.evidence?.line ?? []} />
          </p>
          <small className={"mu"}>{"Authority’s wording is stored apart from the consultant’s summary."}</small>
        </div>
        <div>
          <h3>{"Milestones"}</h3>
          <div className={"rank"}>
            {(view.milestones ?? []).map((milestone, at) => (
              <div key={at}>
                <span style={{ flex: "1" }}>{milestone.label}</span>
                <Badge badge={milestone.badge} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>{view.summary?.title ?? "Next steps"}</h3>
          <p style={{ fontSize: "14px" }}>{view.summary?.copy}</p>
          {view.summary?.review ? (
            <button className={"btn s sm"} style={{ marginTop: "8px" }}>
              <Icon name={"edit"} cls={"ic s"} />
              {"Review summary"}
            </button>
          ) : null}
          {view.confirm ? <ConfirmFields form={view.confirm} /> : null}
        </div>
      </div>
    </div>
  );
}

function LetterRows({ letters, start }: { letters: GovLetterRow[]; start: number }) {
  const thumbs = letters.filter((letter) => letter.thumb);
  let index = start;
  return (
    <>
      <h3 className={"sub rv"} style={css({ "--i": String(index++) })}>
        {"Government letters"}
      </h3>
      {thumbs.length ? (
        <div className={"doct-row rv"} style={css({ "--i": String(index++) })}>
          {thumbs.map((letter, at) => (
            <Doc key={at} doc={{ kind: "government-letter", title: letter.thumb as string, label: letter.thumb as string }} w={72} h={96} />
          ))}
        </div>
      ) : null}
      {letters.length ? (
        letters.map((letter, at) => (
          <div key={at} className={"li rv"} style={css({ "--i": String(index++) })}>
            <i style={{ width: "8px", height: "8px", borderRadius: "50%", background: letter.dot, flex: "none" }}></i>
            <div>
              <b>{typeof letter.title === "string" ? letter.title : <Pair left={letter.title[0]} right={letter.title[1]} />}</b>
              <small>
                <Joined parts={letter.parts} />
              </small>
            </div>
            <span className={"r"}>
              {letter.verify ? (
                <button className={"btn s sm"} {...letter.verify}>
                  {"Verify"}
                </button>
              ) : null}
              <Badge badge={letter.badge} />
            </span>
          </div>
        ))
      ) : (
        <div className={"li rv"} style={css({ "--i": String(index++) })}>
          <div>
            <b>{"No letters recorded"}</b>
            <small>{"Letters the firm receives are recorded here with their received date and evidence."}</small>
          </div>
        </div>
      )}
    </>
  );
}

export function MatterDecisionsLive({ data }: { data: MatterDecisionsData }) {
  let index = 0;
  const preview = data.preview ? (
    <>
      <Seg selected={data.preview.selected} />
      <p className={"mu rv"} style={css({ fontSize: "13px", margin: "-8px 0px 18px", "--i": "1" })}>
        {data.preview.note}
      </p>
    </>
  ) : null;
  if (data.preview) index = 2;
  const view = data.decision;
  if (!view) {
    return (
      <>
        {preview}
        {data.recordForm ? (
          <div className={"empty rv"} style={css({ "--i": String(index++) })}>
            <Spot name={"decision"} />
            <div>
              <h3>{"Record the decision"}</h3>
              <p>{"The decision letter is verified. Record what it states; a licensed consultant then confirms the outcome before it counts. Pending is not an outcome."}</p>
              <label className={"fl"}>
                {"Outcome stated in the letter"}
                <select id={"decOut"} defaultValue={data.recordForm.outcomes[0]?.value}>
                  {data.recordForm.outcomes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Milestone (approvals only)"}
                <select id={"decMil"} defaultValue={""}>
                  <option value={""}>{"None"}</option>
                  {data.recordForm.milestones.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Date on the letter"}
                <input id={"decOn"} type={"date"} />
              </label>
              <label className={"fl"}>
                {"Authority’s reasons, quoted"}
                <textarea id={"decWhy"} rows={2} />
              </label>
              <div className={"ea"}>
                <button className={"btn p sm"} {...data.recordForm.wire}>
                  <Icon name={"check-circle"} cls={"ic s"} />
                  {"Record the decision"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={"empty rv"} style={css({ "--i": String(index++) })}>
            <Spot name={"decision"} />
            <div>
              <h3>{"No decision recorded"}</h3>
              <p>{"A decision needs the official letter as evidence and a consultant to confirm it. Pending is not an outcome, so nothing shows here until a letter arrives."}</p>
              {data.letter ? (
                <div className={"ea"}>
                  <button className={"btn p sm"} data-letter={""}>
                    <Icon name={"mail"} cls={"ic s"} />
                    {"Record a government letter"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
        <LetterRows letters={data.letters} start={index} />
      </>
    );
  }
  const tintIndex = index++;
  const panelIndex = index++;
  return (
    <>
      {preview}
      <div className={"tint rv"} style={css({ "--i": String(tintIndex) })}>
        <Art name={view.tint.art} px={40} />
        <div>
          <b>{view.tint.title}</b>
          <small>{view.tint.copy}</small>
        </div>
      </div>
      <DecisionPanel view={view} index={panelIndex} />
      {view.outcome !== "withdrawn" || view.followUps.length ? (
        <>
          <h3 className={"sub rv"} style={css({ "--i": String(index++) })}>
            {"Follow-up after the decision"}
          </h3>
          {view.followUps.map((row, at) => (
            <div key={at} className={"li rv"} style={css({ "--i": String(index++) })}>
              <span className={"ck"} {...(row.wire ?? {})}></span>
              <div>
                <b>{row.title}</b>
                <small>{row.note}</small>
              </div>
              <span className={"r"}>
                {row.urgent ? <Badge badge={{ tone: "bad", label: "Urgent" }} /> : null}
                <Avatar person={row.owner} />
              </span>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- dialogs */

/**
 * The submission handoff dialogs. The Designer has no capture for them, so each is its
 * "Record a government letter" dialog (`.dlg wide`, `.dh`, `.db` with `.drop` and a `.g2` of
 * `.fl` fields, `.mu` and `.lock` notes, `.df` with Cancel and a primary button).
 */
export type GovDialogsData = {
  prepare: { wire: GovWire; channels: { value: string; label: string }[] } | null;
  submit: { wire: GovWire; representatives: { id: string; name: string }[]; now: string } | null;
  receipt: { wire: GovWire; today: string } | null;
};

function DlgHead({ id, title }: { id: string; title: string }) {
  return (
    <div className={"dh"}>
      <h2 id={`${id}T`}>{title}</h2>
      <button className={"x"} aria-label={"Close"} data-x={""}>
        <Icon name={"close"} />
      </button>
    </div>
  );
}

function DlgFoot({ label, wire }: { label: string; wire: GovWire }) {
  return (
    <div className={"df"}>
      <button className={"btn"} data-x={""}>
        {"Cancel"}
      </button>
      <button className={"btn p"} {...wire}>
        {label}
      </button>
    </div>
  );
}

function ReceiptDrop() {
  return (
    <div className={"drop"}>
      <Spot name={"letter"} />
      <div>
        <b data-gov-name={""}>{"Drop the receipt here"}</b>
        <small>
          <Pair left={"PDF or photo"} right={"it’s stored with a hash and never sent to clients by default"} />
        </small>
      </div>
      <button className={"btn s sm"} data-gov-pick={""}>
        <Icon name={"upload"} cls={"ic s"} />
        {"Choose file"}
      </button>
    </div>
  );
}

export function GovDialogs({ data }: { data: GovDialogsData }) {
  return (
    <>
      {data.prepare ? (
        <dialog className={"dlg wide"} id={"dSubPrep"} aria-labelledby={"dSubPrepT"}>
          <DlgHead id={"dSubPrep"} title={"Start a submission handoff"} />
          <div className={"db"}>
            <div className={"g2"}>
              <label className={"fl"}>
                {"Package version"}
                <input id={"spL"} placeholder={"For example: Package v3"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"How it will be submitted"}
                <select id={"spC"} defaultValue={data.prepare.channels[0]?.value}>
                  {data.prepare.channels.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Package hash (optional)"}
                <input id={"spH"} placeholder={"sha256, 64 characters"} autoComplete={"off"} />
              </label>
            </div>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"Casevoya doesn’t submit for you. A licensed consultant signs off this exact version; the authorized representative then submits through the official channel and records it here."}
            </p>
          </div>
          <DlgFoot label={"Start handoff"} wire={data.prepare.wire} />
        </dialog>
      ) : null}
      {data.submit ? (
        <dialog className={"dlg wide"} id={"dSubRec"} aria-labelledby={"dSubRecT"}>
          <DlgHead id={"dSubRec"} title={"Record the submission"} />
          <div className={"db"}>
            <ReceiptDrop />
            <div className={"g2"}>
              <label className={"fl"}>
                {"Submission reference"}
                <input id={"srR"} placeholder={"Type exactly as shown"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Submitted at"}
                <input id={"srT"} type={"datetime-local"} defaultValue={data.submit.now} />
              </label>
              <label className={"fl"}>
                {"Submitted by"}
                <select id={"srB"} defaultValue={data.submit.representatives[0]?.id}>
                  {data.submit.representatives.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={"fl"}>
                {"Where the receipt is kept (if no file)"}
                <input id={"srL"} placeholder={"For example: confirmation page, saved 12 Oct"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Acknowledged on (optional)"}
                <input id={"srA"} type={"date"} />
              </label>
            </div>
            <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
              <Icon name={"info"} cls={"ic s"} />
              {"Without a receipt it shows as “Submission unverified”. The submission and acknowledgement dates are kept apart."}
            </p>
          </div>
          <DlgFoot label={"Record submission"} wire={data.submit.wire} />
        </dialog>
      ) : null}
      {data.receipt ? (
        <dialog className={"dlg wide"} id={"dSubRcpt"} aria-labelledby={"dSubRcptT"}>
          <DlgHead id={"dSubRcpt"} title={"Add the receipt"} />
          <div className={"db"}>
            <ReceiptDrop />
            <div className={"g2"}>
              <label className={"fl"}>
                {"Where the receipt is kept (if no file)"}
                <input id={"rcL"} placeholder={"For example: confirmation page, saved 12 Oct"} autoComplete={"off"} />
              </label>
              <label className={"fl"}>
                {"Acknowledged on (optional)"}
                <input id={"rcA"} type={"date"} max={data.receipt.today} />
              </label>
            </div>
            <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
              {"The receipt verifies the submission and becomes the evidence for the Submitted stage."}
            </p>
          </div>
          <DlgFoot label={"Verify submission"} wire={data.receipt.wire} />
        </dialog>
      ) : null}
    </>
  );
}
