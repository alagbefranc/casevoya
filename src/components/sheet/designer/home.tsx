/**
 * The Designer's Sheet home (`#content` of `markup/index.tsx`), rendered from the firm's records.
 * Same DOM, classes and order; empty data uses the Designer's empty-state panel.
 */
import type { ReactNode } from "react";
import type { TaskBadge } from "@/modules/sheet/home-present";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair } from "./frame";

export type GaugeSegment = { label: string; count: number; color: string };

export type HomeTask = {
  href: string;
  title: string;
  who: string;
  when: string;
  badge: TaskBadge;
  owner: SidebarPerson;
};

export type HomeData = {
  greeting: string;
  summary: string;
  quick: { lead: string; document: string; consultation: string; invoice: string; draft: string };
  gauge: GaugeSegment[];
  needs: { href: string; count: number; label: string }[];
  byDeadline: (SidebarPerson & { href: string; date: string })[];
  tasks: HomeTask[];
};

/** Semicircle radius 80. Each segment is its share of the arc less a 4px gap, offset by the segments before it. */
const ARC = Math.PI * 80;
const GAP = 4;

export function gaugeArcs(segments: GaugeSegment[]) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  let before = 0;
  return segments.map((segment, index) => {
    // With nothing tracked yet, the last segment draws the empty track so the gauge keeps its shape.
    const share = total === 0 ? (index === segments.length - 1 ? 1 : 0) : segment.count / total;
    const full = share * ARC;
    const dash = `${Math.max(0, full - GAP)} ${ARC}`;
    const offset = String(before === 0 ? 0 : -before);
    before += full;
    return { color: segment.color, dash, offset };
  });
}

export function percent(count: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((count / total) * 100)}%`;
}

const NUM_STYLE = { fontSize: "30px", fontWeight: "300", minWidth: "44px" };

export type HomeReveal = { ph: string; quick: string; panel: string; bar: string; tasks: string };

/**
 * `lead` sits between the greeting and the quick actions (the sample-mode page puts its
 * sample-case panel there). `before` sits above the greeting and `reveal` overrides the
 * reveal order (the licence-suspended home puts its alert first).
 */
export function SheetHome({ data, lead, before, reveal }: { data: HomeData; lead?: ReactNode; before?: ReactNode; reveal?: HomeReveal }) {
  const total = data.gauge.reduce((sum, segment) => sum + segment.count, 0);
  const arcs = gaugeArcs(data.gauge);
  // Reveal order (`--i`) as the Designer numbers it, with and without the lead panel.
  const order = reveal ?? (lead ? { ph: "0", quick: "2", panel: "2", bar: "4", tasks: "5" } : { ph: "0", quick: "1", panel: "2", bar: "3", tasks: "4" });
  return (
    <>
      {before}
      <div className={"ph rv"} style={{ "--i": order.ph } as React.CSSProperties}>
        <h1 className={"display"} id={"hi"}>
          {data.greeting}
        </h1>
        <p>{data.summary}</p>
      </div>
      {lead}
      <div
        style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "24px", "--i": order.quick } as React.CSSProperties}
        id={"quick"}
        className={"rv"}
      >
        <a className={"qa"} href={data.quick.lead}>
          <Icon name={"user-plus"} />
          {"New lead"}
        </a>
        <a className={"qa"} href={data.quick.document}>
          <Icon name={"upload"} />
          {"Request document"}
        </a>
        <a className={"qa"} href={data.quick.consultation}>
          <Icon name={"calendar"} />
          {"Book consultation"}
        </a>
        <a className={"qa"} href={data.quick.invoice}>
          <Icon name={"invoice"} />
          {"Issue invoice"}
        </a>
        <a className={"qa"} href={data.quick.draft}>
          <Icon name={"sparkles"} />
          {"Ask Vo for a draft"}
        </a>
      </div>
      <div className={"panel rv"} style={{ "--i": order.panel } as React.CSSProperties}>
        <h2>
          <Icon name={"dashboard"} />
          {"Your practice today"}
        </h2>
        <div className={"split"}>
          <div>
            <h3>
              <Icon name={"file-check"} cls={"ic s"} />
              {"Documents across your matters"}
            </h3>
            <div className={"gauge"} id={"g"}>
              <svg viewBox={"0 0 190 104"} aria-hidden={"true"}>
                {arcs.map((arc) => (
                  <path
                    key={arc.color}
                    d={"M 15 96 A 80 80 0 0 1 175 96"}
                    fill={"none"}
                    stroke={arc.color}
                    strokeWidth={"16"}
                    strokeLinecap={"butt"}
                    strokeDasharray={arc.dash}
                    strokeDashoffset={arc.offset}
                    data-d={arc.dash}
                    data-o={arc.offset}
                  />
                ))}
              </svg>
              <div className={"c"}>
                <b className={"num"} data-count={String(total)} data-done={"1"}>
                  {String(total)}
                </b>
                <small>{"documents tracked"}</small>
              </div>
            </div>
            <div className={"leg"}>
              {data.gauge.map((segment) => (
                <div key={segment.label}>
                  <i style={{ background: segment.color }}></i>
                  {segment.label}
                  <span className={"num"}>
                    <b>{String(segment.count)}</b>
                  </span>
                  <span className={"num"}>{percent(segment.count, total)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>
              <Icon name={"flag"} cls={"ic s"} />
              {"Needs you"}
            </h3>
            <div className={"rank"}>
              {data.needs.map((item) => (
                <a key={item.label} href={item.href} style={{ alignItems: "baseline" }}>
                  <b className={"num"} data-count={String(item.count)} style={NUM_STYLE} data-done={"1"}>
                    {String(item.count)}
                  </b>
                  <span style={{ color: "var(--t2)" }}>{item.label}</span>
                  <Icon name={"chevron-right"} cls={"ic s"} />
                </a>
              ))}
            </div>
          </div>
          <div>
            <h3>
              <Icon name={"clock"} cls={"ic s"} />
              {"Matters by next deadline"}
            </h3>
            <div className={"rank"}>
              {data.byDeadline.length === 0 ? (
                <div>{"No deadlines recorded yet"}</div>
              ) : (
                data.byDeadline.map((row) => (
                  <a key={`${row.href}-${row.date}`} href={row.href}>
                    <Avatar person={row} />
                    {row.name}
                    <span className={"r num"}>{row.date}</span>
                  </a>
                ))
              )}
            </div>
            <a className={"btn s sm"} href={"/sheet/matters"} style={{ width: "100%", marginTop: "10px" }}>
              {"View all matters"}
            </a>
          </div>
        </div>
      </div>
      <div className={"bar rv"} style={{ marginTop: "4px", "--i": order.bar } as React.CSSProperties}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search today’s tasks"} aria-label={"Search today’s tasks"} />
        <span className={"fchip on"}>{"Mine"}</span>
        <span className={"fchip"}>{"Today"}</span>
        <span className={"fchip"}>
          <Icon name={"filter"} cls={"ic s"} />
          {"Filter"}
        </span>
      </div>
      <div id={"tasks"} className={"rv"} style={{ "--i": order.tasks } as React.CSSProperties}>
        {data.tasks.length === 0 ? (
          <div className={"panel"}>
            <Empty
              art={"portal-caught-up"}
              title={"Nothing needs you today"}
              copy={"Due tasks, documents to review and unsigned agreements appear here as they come in."}
            />
          </div>
        ) : (
          data.tasks.map((task) => (
            <a key={`${task.href}-${task.title}`} className={"li"} href={task.href}>
              <span className={"ck"} data-toggle-on={"1"}></span>
              <div>
                <b>{task.title}</b>
                <small>
                  <Pair left={task.who} right={task.when} />
                </small>
              </div>
              <span className={"r"}>
                <span className={`bd ${task.badge.tone}`}>
                  <i></i>
                  {task.badge.label}
                </span>
                <Avatar person={task.owner} />
              </span>
            </a>
          ))
        )}
      </div>
    </>
  );
}
