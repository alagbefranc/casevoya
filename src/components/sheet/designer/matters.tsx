/**
 * The Designer's Matters list (`markup/matters.tsx`), rendered from the firm's records.
 * Same DOM, classes and order. Rows carry `data-href` (open the matter) and `data-mine`
 * (the Mine switch) so the kit can act on real rows; the captured rows have neither.
 */
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair } from "./frame";

export type MatterBadge = { tone: "blue" | "ok" | "unv" | "chg" | "bad" | "rev"; label: string; detail?: string };

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
  /** No rows: either the firm has no matters yet or the search and view match none. */
  empty: null | { kind: "none" } | { kind: "filtered"; title: string; copy: string; clear: string };
};

function Badge({ badge }: { badge: MatterBadge }) {
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

export function MattersTopBar({ counts }: { counts: MattersData["counts"] }) {
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
        <button className={"btn p sm"}>
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
        <span className={"fchip"}>{"All offices"}</span>
        <span className={"fchip"}>{"Any program"}</span>
        <span className={"fchip"}>{"Priority"}</span>
      </div>
      <p className={"sr rv"} aria-live={"polite"} style={{ "--i": "2" } as React.CSSProperties}></p>
      <div className={"fp-row rv"} style={{ margin: "-6px 0px 14px", gap: "8px", "--i": "3" } as React.CSSProperties} aria-label={"Saved views"}>
        <a className={"fchip"} href={"?view=due"}>
          <Icon name={"star"} cls={"ic s"} />
          {"Due this week"}
        </a>
        <a className={"fchip"} href={"?view=review"}>
          <Icon name={"star"} cls={"ic s"} />
          {"Awaiting my review"}
        </a>
        <a className={"fchip"} href={"?view=blocked"}>
          <Icon name={"star"} cls={"ic s"} />
          {"Blocked"}
        </a>
      </div>
      {data.empty ? (
        <div className={"panel rv"} style={{ "--i": "4" } as React.CSSProperties}>
          {data.empty.kind === "none" ? (
            <Empty art={"matters-empty"} title={"No matters yet"} copy={"Convert a lead or start a matter from scratch."}>
              <a className={"btn p sm"} href={"/sheet/matters?new=1"}>
                {"New matter"}
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
          <p style={{ color: "var(--t2)", fontSize: "13px", marginTop: "12px", "--i": "5" } as React.CSSProperties} className={"rv"}>
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
