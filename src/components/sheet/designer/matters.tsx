/**
 * The Designer's Matters list (`markup/matters.tsx`), rendered from the firm's records.
 * Same DOM, classes and order. Rows carry `data-href` (open the matter) and `data-mine`
 * (the Mine switch) so the kit can act on real rows; the captured rows have neither.
 */
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair } from "./frame";
import type { NewMatterDialogData } from "@/modules/sheet/new-matter";

export type MatterBadge = { tone: "blue" | "ok" | "unv" | "chg" | "bad" | "rev" | "gr"; label: string; detail?: string };

export type MatterRow = {
  href?: string;
  mine?: boolean;
  client: SidebarPerson;
  reference: string;
  program: string;
  stage: MatterBadge;
  government: MatterBadge;
  money: string;
  nextDeadline: string;
  consultant: SidebarPerson | null;
};

export type MattersData = {
  title: string;
  counts: { active: number; blocked: number; mine: number; everyone: number };
  rows: MatterRow[];
  /** "Showing 6 of 18". */
  shown: number;
  total: number;
  more: string | null;
  /**
   * No rows: the firm has no matters yet, the search and view match none, or (`error`, live) the
   * matters couldn't be read, which is not the same as having none.
   */
  empty: null | { kind: "none" } | { kind: "error" } | { kind: "filtered"; title: string; copy: string; clear: string };
  /**
   * Live only: the saved view shown (its chip is marked on), why the office, program and priority
   * chips are not filters yet, and the hidden "no match" panel search and Mine show.
   */
  live?: { view: string | null; chips: string } | null;
};

const SAVED_VIEWS = [
  ["due", "Due this week"],
  ["review", "Awaiting my review"],
  ["blocked", "Blocked"],
] as const;

export function Badge({ badge }: { badge: MatterBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.detail ? (
        <span>
          <Pair left={badge.label} right={badge.detail} />
        </span>
      ) : (
        badge.label
      )}
    </span>
  );
}

/** `newMatter` wires the button to the New matter dialog on this page. */
export function MattersTopBar({ counts, newMatter = false }: { counts: MattersData["counts"]; newMatter?: boolean }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"folder"} cls={"ic s"} />
        {"Matters"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"pill"}>{`${counts.active} active`}</span>
      <span className={"pill"}>{`${counts.blocked} blocked`}</span>
      <span className={"pill"}>{"On-hold counts as active"}</span>
      <span className={"acts"}>
        <button className={"btn p sm"} data-open={newMatter ? "dlgNew" : undefined}>
          <Icon name={"plus"} cls={"ic s"} />
          {"New matter"}
        </button>
      </span>
    </header>
  );
}

function Row({ row }: { row: MatterRow }) {
  return (
    <tr style={{ cursor: "pointer" }} data-href={row.href} data-mine={row.mine ? "1" : undefined}>
      <td>
        <span className={"ck"}></span>
      </td>
      <td>
        <span style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Avatar person={row.client} />
          <span>
            <b style={{ fontWeight: "500" }}>{row.client.name}</b>
            <br />
            <small style={{ color: "var(--t2)" }}>{row.reference}</small>
          </span>
        </span>
      </td>
      <td>{row.program}</td>
      <td>
        <Badge badge={row.stage} />
      </td>
      <td>
        <Badge badge={row.government} />
      </td>
      <td>{row.money}</td>
      <td className={"num"}>{row.nextDeadline}</td>
      <td>{row.consultant ? <Avatar person={row.consultant} /> : "—"}</td>
    </tr>
  );
}

export function SheetMatters({ data }: { data: MattersData }) {
  return (
    <>
      <div className={"ph rv"} style={{ "--i": "0" } as React.CSSProperties}>
        <h1 className={"display"}>{data.title}</h1>
        <p>{"Stage, government status and money are kept in separate columns. A paid invoice never changes a government status."}</p>
      </div>
      <div className={"bar rv"} style={{ "--i": "1" } as React.CSSProperties}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search by client or reference"} aria-label={"Search matters"} />
        <div className={"k2-rsw k2-rs"} role={"radiogroup"} aria-label={"Whose matters"} data-rubber={"1"}>
          <span className={"k2-rs-th"} aria-hidden={"true"} style={{ transition: "none", left: "102px", right: "4px" }}></span>
          <button type={"button"} role={"radio"} aria-checked={"false"} tabIndex={-1}>
            <Pair left={"Mine"} right={String(data.counts.mine)} />
          </button>
          <button type={"button"} role={"radio"} aria-checked={"true"} tabIndex={0}>
            <Pair left={"Everyone"} right={String(data.counts.everyone)} />
          </button>
        </div>
        {["All offices", "Any program", "Priority"].map((label) => (
          <span key={label} className={"fchip"} {...(data.live ? { "aria-disabled": "true" as const, title: data.live.chips } : {})}>
            {label}
          </span>
        ))}
      </div>
      <p className={"sr rv"} aria-live={"polite"} style={{ "--i": "2" } as React.CSSProperties}></p>
      <div className={"fp-row rv"} style={{ margin: "-6px 0px 14px", gap: "8px", "--i": "3" } as React.CSSProperties} aria-label={"Saved views"}>
        {SAVED_VIEWS.map(([view, label]) => {
          const on = data.live?.view === view;
          return (
            <a
              key={view}
              className={on ? "fchip on" : "fchip"}
              href={on ? "/sheet/matters" : `?view=${view}`}
              {...(on ? { "aria-current": "page" as const, title: "Showing this view. Click to show every matter." } : {})}
            >
              <Icon name={"star"} cls={"ic s"} />
              {label}
            </a>
          );
        })}
      </div>
      {data.empty ? (
        <div className={"panel rv"} style={{ "--i": "4" } as React.CSSProperties}>
          {data.empty.kind === "none" ? (
            <Empty art={"matters-empty"} title={"No matters yet"} copy={"Convert a lead or start a matter from scratch."}>
              <a className={"btn p sm"} href={"/sheet/matters?new=1"}>
                {"New matter"}
              </a>
            </Empty>
          ) : data.empty.kind === "error" ? (
            <Empty art={"matters-empty"} title={"Matters couldn’t load"} copy={"Nothing was changed. Reload the page to try again."}>
              <a className={"btn s sm"} href={"/sheet/matters"}>
                {"Reload"}
              </a>
            </Empty>
          ) : (
            <Empty art={"filter-empty"} title={data.empty.title} copy={data.empty.copy}>
              <a className={"btn s sm"} href={data.empty.clear}>
                {"Clear filters"}
              </a>
            </Empty>
          )}
        </div>
      ) : (
        <>
          <div className={"tw rv"} style={{ "--i": "4" } as React.CSSProperties}>
            <table className={"t"}>
              <caption className={"sr"}>{"Matters"}</caption>
              <thead>
                <tr>
                  <th>
                    <span className={"ck"} role={"checkbox"} aria-checked={"false"} tabIndex={0} aria-label={"Select all"}></span>
                  </th>
                  <th>{"Client"}</th>
                  <th>{"Program"}</th>
                  <th>{"Firm stage"}</th>
                  <th>{"Government"}</th>
                  <th>{"Money"}</th>
                  <th>{"Next deadline"}</th>
                  <th>{"Consultant"}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <Row key={row.href ?? index} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          {data.live ? (
            <div className={"panel rv"} style={{ "--i": "4" } as React.CSSProperties} data-matters-none={""} hidden>
              <Empty art={"filter-empty"} title={"No matters match"} copy={"Nothing on this page matches the search and the Mine switch. Clear the search, or switch to Everyone."}>
                <button className={"btn s sm"} type={"button"} data-matters-clear={""}>
                  {"Clear search"}
                </button>
              </Empty>
            </div>
          ) : null}
          <p
            style={{ color: "var(--t2)", fontSize: "13px", marginTop: "12px", "--i": "5" } as React.CSSProperties}
            className={"rv"}
            {...(data.live ? { "data-matters-showing": "" } : {})}
          >
            {`Showing ${data.shown} of ${data.total} `}
            {data.more ? (
              <>
                <span className={"sep"} aria-hidden={"true"}></span>{" "}
                <a href={data.more} style={{ color: "#0066c0", textDecoration: "underline", textUnderlineOffset: "3px" }}>
                  {"Load more"}
                </a>
              </>
            ) : null}
          </p>
        </>
      )}
    </>
  );
}

/** The Designer's `.fld` with a label, an optional hint and an `.inp`. */
export function Field({ id, label, hint, type = "text", max }: { id: string; label: string; hint?: string; type?: string; max?: string }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      <input className={"inp"} id={id} type={type} autoComplete={"off"} aria-describedby={hint ? `${id}-h` : undefined} min={type === "date" ? "1900-01-01" : undefined} max={max} />
    </div>
  );
}

/**
 * The New matter dialog. The Designer has no create dialog of its own (its "New matter" links
 * only toast "Starts from a versioned program template"), so this is the Designer's
 * "Convert to a matter" dialog (`markup/lead.tsx`, `#dlgConv`) with the client's people added
 * as the Designer's own `.fld` / `.inp` fields. Saving is wired in use-sheet (`data-new-matter`).
 */
export function NewMatterDialog({ data }: { data: NewMatterDialogData }) {
  const noConsultant = data.consultants.length === 0;
  return (
    <dialog className={"dlg wide"} id={"dlgNew"} aria-labelledby={"dlgNewH"}>
      <div className={"dh"}>
        <h2 id={"dlgNewH"}>{"New matter"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgNew"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{"A new matter starts from a versioned program template. It doesn’t invite anyone or sign anything."}</p>
        {data.sampleMode ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{"This firm is in sample mode"}</b>
              {"This matter and its people are saved as sample (practice) records. Real client matters open once sample mode is turned off."}
            </div>
          </div>
        ) : null}
        <div className={"g2"}>
          <Field id={"nmA"} label={"Applicant"} />
          <Field id={"nmS"} label={"Sponsor"} hint={"Optional. Leave blank if there is none."} />
          <Field id={"nmAE"} label={"Applicant email"} hint={"Optional. Used for the portal invitation."} type={"email"} />
          <Field id={"nmSE"} label={"Sponsor email"} hint={"Optional"} type={"email"} />
          <Field id={"nmAD"} label={"Applicant date of birth"} hint={"Optional. Only adults get a portal login."} type={"date"} max={data.maxBirthDate} />
          <Field id={"nmSD"} label={"Sponsor date of birth"} hint={"Optional"} type={"date"} max={data.maxBirthDate} />
          <div className={"fld"}>
            <label htmlFor={"nmT"}>{"Program template"}</label>
            <select className={"sel"} id={"nmT"} defaultValue={data.programs[0]?.value ?? ""}>
              {data.programs.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value={""}>{data.programs.length ? "Choose later" : "No published template yet (choose later)"}</option>
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"nmC"}>{"Responsible consultant"}</label>
            <select className={"sel"} id={"nmC"} defaultValue={data.consultants[0]?.value ?? ""}>
              {noConsultant ? <option value={""}>{"No licensed consultant yet"}</option> : null}
              {data.consultants.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {noConsultant ? (
          <div className={"alert warn"}>
            <Icon name={"users"} />
            <div>
              <b>{"A matter needs a licensed consultant"}</b>
              {"Invite a licensed consultant from Settings before opening a matter."}
            </div>
          </div>
        ) : (
          <div className={"alert info"}>
            <Icon name={"signature"} />
            <div>
              <b>{"Needs a signed service agreement"}</b>
              {"The matter opens in “Engagement pending” until the agreement is signed."}
            </div>
          </div>
        )}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgNew"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-new-matter={"1"} data-org={data.organizationId}>
          {"Create matter"}
        </button>
      </div>
    </dialog>
  );
}
