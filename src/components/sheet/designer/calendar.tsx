/**
 * The Designer's Calendar page (`markup/calendar.tsx`), rendered from the firm's records: the
 * week grid (appointments and deadlines) and its right column (month, upcoming deadlines,
 * connected calendars, meeting links). Same DOM, classes, inline styles and order for the Week and
 * Deadlines tabs. Given the Designer's sample values it renders the captured HTML exactly.
 *
 * Live differences, all data: the week can show seven columns when a weekend day has something on
 * it; a block that starts off the hour is moved down inside its hour cell; staff without a
 * connected calendar are listed without a provider logo.
 */
import type { ReactNode } from "react";
import { Icon, Pair } from "./frame";
import { MonthCalendar, type MonthCal } from "./consultations";

export type CalendarTab = "week" | "deadlines";

export type BlockKind = "consultation" | "internal" | "tentative" | "deadline" | "cancelled";

const BLOCK_STYLE: Record<BlockKind, { background: string; border: string }> = {
  consultation: { background: "var(--tint)", border: "3px solid var(--blue)" },
  internal: { background: "#efedea", border: "3px solid #8c8781" },
  tentative: { background: "#fdf3e1", border: "3px solid #b86e00" },
  deadline: { background: "#fdecea", border: "3px solid #c4372c" },
  cancelled: { background: "#efedea", border: "3px solid #8c8781" },
};

export type WeekBlock = {
  kind: BlockKind;
  title: string | { left: string; right: string };
  note: string | { left: string; right: string };
  /** Pixels; the Designer uses 56 for an hour and 120 for a longer item. */
  height: number;
  /** Minutes past the hour (live); 0 keeps the Designer's `inset: 4px`. */
  offsetMin?: number;
  href?: string;
};

export type WeekGrid = {
  days: { label: string; today: boolean }[];
  hours: { label: string; cells: WeekBlock[][] }[];
};

export type CalendarRbar = {
  calendar: MonthCal;
  deadlines: { date: string; title: string; who: string; chip: { tone: string; label: string } }[];
  calendars: { name: string; tool: string; logo: string | null; chip: { tone: string; label: string } }[];
};

export type CalendarData = {
  tab: CalendarTab;
  heading: { title: string; copy: string };
  week: WeekGrid;
  note: string;
};

const UNDERLINE: Record<CalendarTab, { left: string; width: string }> = {
  week: { left: "0px", width: "33px" },
  deadlines: { left: "59px", width: "58px" },
};

export function CalendarHeader({ tab, pills, create }: { tab: CalendarTab; pills: string[]; create?: Record<string, string> | null }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"calendar"} cls={"ic s"} />
          {"Calendar"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        {pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          <button className={"btn p sm"} {...(create ?? {})}>
            <Icon name={"plus"} cls={"ic s"} />
            {"New appointment"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {(
          [
            ["week", "Week"],
            ["deadlines", "Deadlines"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[tab]}></i>
      </div>
    </>
  );
}

function Text({ value }: { value: string | { left: string; right: string } }) {
  return typeof value === "string" ? <>{value}</> : <Pair left={value.left} right={value.right} />;
}

function Block({ block, index }: { block: WeekBlock; index: number }) {
  const style = BLOCK_STYLE[block.kind];
  const top = 4 + Math.round(((block.offsetMin ?? 0) / 60) * 64);
  const inset = top === 4 && index === 0 ? "4px" : `${top}px 4px 4px ${4 + index * 10}px`;
  return (
    <div
      style={{
        position: "absolute",
        inset,
        height: `${block.height}px`,
        zIndex: String(1 + index),
        borderRadius: "8px",
        padding: "8px",
        fontSize: "13px",
        background: style.background,
        borderLeft: style.border,
      }}
      data-href={block.href}
    >
      <b style={{ fontWeight: "600" }}>
        <Text value={block.title} />
      </b>
      <br />
      <small style={{ color: "var(--t2)", fontSize: "13px" }}>
        <Text value={block.note} />
      </small>
    </div>
  );
}

const CELL = { borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)", position: "relative" } as const;

function Week({ grid }: { grid: WeekGrid }) {
  const cells: ReactNode[] = [<div key={"corner"}></div>];
  grid.days.forEach((day) =>
    cells.push(
      <div
        key={`d-${day.label}`}
        style={{ padding: "10px", borderLeft: "1px solid var(--line)", fontWeight: day.today ? "600" : "500", color: day.today ? "var(--blue)" : "inherit" }}
      >
        {day.label}
      </div>,
    ),
  );
  grid.hours.forEach((hour) => {
    cells.push(
      <div key={`h-${hour.label}`} style={{ padding: "6px", fontSize: "13px", color: "var(--t2)", borderTop: "1px solid var(--line)", height: "64px" }}>
        {hour.label}
      </div>,
    );
    hour.cells.forEach((blocks, column) =>
      cells.push(
        <div key={`c-${hour.label}-${column}`} style={CELL}>
          {blocks.map((block, index) => (
            <Block key={index} block={block} index={index} />
          ))}
        </div>,
      ),
    );
  });
  return (
    <div
      className={"wk"}
      style={{
        display: "grid",
        gridTemplateColumns: `56px repeat(${grid.days.length},1fr)`,
        minWidth: grid.days.length > 5 ? "980px" : "760px",
        border: "1px solid var(--line)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      {cells}
    </div>
  );
}

export function SheetCalendar({ data }: { data: CalendarData }) {
  return (
    <>
      <div className={"ph rv"} style={{ "--i": "0" } as React.CSSProperties}>
        <h1 className={"display"}>{data.heading.title}</h1>
        <p>{data.heading.copy}</p>
      </div>
      <div className={"tw rv"} style={{ "--i": "1" } as React.CSSProperties}>
        <Week grid={data.week} />
      </div>
      <p style={{ color: "var(--t2)", fontSize: "13px", marginTop: "12px", "--i": "2" } as React.CSSProperties} className={"rv"}>
        {data.note}
      </p>
    </>
  );
}

export function CalendarRbarView({ data }: { data: CalendarRbar }) {
  return (
    <aside id={"rbar"} aria-label={"Details"}>
      <MonthCalendar data={data.calendar} />
      <h4>{"Upcoming deadlines"}</h4>
      {data.deadlines.length === 0 ? (
        <div className={"nf"}>
          <div>
            {"No deadlines this month"}
            <small>{"Deadlines recorded on a matter appear here with who verified them."}</small>
          </div>
        </div>
      ) : (
        data.deadlines.map((item, index) => (
          <div key={`${item.date}-${index}`} className={"card"} style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: "6px" }}>
            <b className={"num"} style={{ color: "var(--blue)", fontWeight: "500" }}>
              {item.date}
            </b>
            <div>
              <Pair left={item.title} right={item.who} />
              <div style={{ marginTop: "6px" }}>
                <span className={`bd ${item.chip.tone}`}>
                  <i></i>
                  {item.chip.label}
                </span>
              </div>
            </div>
          </div>
        ))
      )}
      <h4>{"Connected calendars"}</h4>
      <div className={"card"} style={{ display: "flex", gap: "10px", alignItems: "center", background: "transparent", boxShadow: "inset 0 0 0 1px #d9d5d0" }}>
        <img src={"/assets/logos/googlecalendar.svg"} alt={""} className={"logo"} />
        <span>
          <Pair left={"Google Calendar"} right={"planned integration"} />
        </span>
      </div>
      <h4>{"Connected calendars"}</h4>
      <div className={"rank"} style={{ fontSize: "13.5px" }}>
        {data.calendars.map((row, index) => (
          <div key={`${row.name}-${index}`} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {row.logo ? <img src={row.logo} alt={""} width={20} height={20} /> : null}
            <span>
              <Pair left={row.name} right={row.tool} />
            </span>
            <span className={"r"}>
              <span className={`bd ${row.chip.tone}`}>
                <i></i>
                {row.chip.label}
              </span>
            </span>
          </div>
        ))}
      </div>
      <h4 style={{ marginTop: "18px" }}>{"Meeting links"}</h4>
      <div className={"rank"} style={{ fontSize: "13.5px" }}>
        {(
          [
            ["/assets/logos/integrations/googlemeet-color.png", "Google Meet"],
            ["/assets/logos/integrations/microsoftteams-color.svg", "Microsoft Teams"],
            ["/assets/logos/integrations/calendly.svg", "Calendly import"],
          ] as const
        ).map(([logo, label]) => (
          <div key={label} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <img src={logo} alt={""} width={20} height={20} />
            {label}
            <span className={"r"}>{"Planned"}</span>
          </div>
        ))}
      </div>
      <p className={"fp-note"} style={{ fontSize: "12.5px" }}>
        {"Only busy times are read from personal calendars. Event details stay in the calendar they came from."}
      </p>
    </aside>
  );
}
