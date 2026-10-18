/**
 * The Designer's Sheet frame: mobile header, sidebar, top bar, right column and status bar.
 * Same DOM, classes and order as the captured markup in `markup/index.tsx`; the values come
 * from props so the same frame shows a firm's real records.
 */
import type { ReactNode } from "react";
import { SheetSidebar, type SidebarData } from "./sidebar";

const SPRITE = "/assets/icons-coreui/sprite.svg";
const WAVE =
  ".m-wave{transform-origin:80px 60px;animation:vwave 300ms var(--ease,ease) infinite}@keyframes vwave{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(14deg)}80%{transform:rotate(-6deg)}90%{transform:rotate(10deg)}}@media (prefers-reduced-motion:reduce){.m-wave{animation:none}}";
const CMDK = "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3";

export function Icon({ name, cls = "ic" }: { name: string; cls?: string }) {
  return (
    <svg className={cls} aria-hidden={"true"}>
      <use href={`${SPRITE}#i-${name}`} />
    </svg>
  );
}

/** The Designer's thin separator between two parts of a line ("Priya Sharma · Today"). */
export function Sep() {
  return <span className={"sep"} aria-hidden={"true"}></span>;
}

export function Pair({ left, right }: { left: string; right: string }) {
  return (
    <>
      {`${left} `}
      <Sep />
      {` ${right}`}
    </>
  );
}

/** The Designer's empty-state panel body (`.emp`) with its generated illustration. */
export function Empty({ art, title, copy, px = 88, children }: { art: string; title: string; copy: string; px?: number; children?: ReactNode }) {
  return (
    <div className={"emp"}>
      <span className={"art"} style={{ "--a": `${px}px` } as React.CSSProperties} aria-hidden={"true"}>
        <img
          src={`/assets/generated/b2/${art}-160@1x.webp`}
          srcSet={`/assets/generated/b2/${art}-160@2x.webp 2x`}
          width={px}
          height={px}
          alt={""}
          loading={"lazy"}
          decoding={"async"}
        />
      </span>
      <b>{title}</b>
      <small>{copy}</small>
      {children ? <div className={"emp-a"}>{children}</div> : null}
    </div>
  );
}

export type TopBarData = { firmName: string; pills: string[] };

export function SheetTopBar({ data }: { data: TopBarData }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"home"} cls={"ic s"} />
        {data.firmName}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      {data.pills.map((pill) => (
        <span key={pill} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}>
        <button className={"btn s sm"} data-palette={"1"}>
          <Icon name={"search"} cls={"ic s"} />
          {"Search"}
        </button>
        <button className={"btn p sm"} id={"newB"}>
          <Icon name={"plus"} cls={"ic s"} />
          {"New"}
        </button>
      </span>
    </header>
  );
}

export type CalendarDay = { day: number; today?: boolean; marked?: boolean };
export type AgendaItem = { time: string; title: string; who: string; note: string; tentative?: boolean; href: string };
export type NotificationItem = { title: string; source: string; ago: string };

export type RbarData = {
  month: string;
  /** Empty cells before the 1st, Monday first. */
  leading: number;
  days: CalendarDay[];
  today: AgendaItem[];
  notifications: NotificationItem[];
  /** The Vo draft card. Absent until Vo is switched on and has a draft to review. */
  vo?: { draft: string; sources: string } | null;
};

function dayClass(day: CalendarDay) {
  return ["num", day.today ? "t" : "", day.marked ? "d" : ""].filter(Boolean).join(" ");
}

export function SheetRbar({ data }: { data: RbarData }) {
  return (
    <aside id={"rbar"} aria-label={"Details"}>
      <h4 style={{ fontWeight: "500" }}>
        {`${data.month} `}
        <span style={{ color: "var(--t2)", display: "flex", gap: "6px" }}>
          <Icon name={"chevron-left"} cls={"ic s"} />
          <Icon name={"chevron-right"} cls={"ic s"} />
        </span>
      </h4>
      <div className={"cal"}>
        {["M", "T", "W", "T", "F", "S", "S"].map((letter, index) => (
          <b key={index}>{letter}</b>
        ))}
        {Array.from({ length: data.leading }, (_, index) => (
          <span key={`blank-${index}`} className={"num"}></span>
        ))}
        {data.days.map((day) => (
          <span key={day.day} className={dayClass(day)}>
            {String(day.day)}
          </span>
        ))}
      </div>
      <h4>{"Today"}</h4>
      {data.today.length === 0 ? (
        <div className={"nf"}>
          <div>
            {"Nothing scheduled"}
            <small>{"Deadlines and consultations for today appear here."}</small>
          </div>
        </div>
      ) : (
        data.today.map((item) => (
          <a key={`${item.time}-${item.title}-${item.who}`} className={"card ag"} href={item.href}>
            <time className={"num"}>{item.time}</time>
            <div>
              <Pair left={item.title} right={item.who} />
              {item.tentative ? <small style={{ color: "#8a5800" }}>{item.note}</small> : <small>{item.note}</small>}
            </div>
          </a>
        ))
      )}
      <h4>
        {"Notifications "}
        <a href={"/sheet/notifications"}>{"All"}</a>
      </h4>
      {data.notifications.length === 0 ? (
        <div className={"nf"}>
          <div>
            {"No new activity"}
            <small>{"Uploads, signatures and payments appear here."}</small>
          </div>
        </div>
      ) : (
        data.notifications.map((item, index) => (
          <div key={index} className={"nf"}>
            <div>
              {item.title}
              <small>
                <Pair left={item.source} right={item.ago} />
              </small>
            </div>
          </div>
        ))
      )}
      {data.vo ? <VoCard draft={data.vo.draft} sources={data.vo.sources} /> : null}
    </aside>
  );
}

function VoCard({ draft, sources }: { draft: string; sources: string }) {
  return (
    <div style={{ marginTop: "18px" }}>
      <div className={"ai"}>
        <div className={"vohd"}>
          <svg className={"mascot m-done"} width={30} height={30} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo, the Casevoya assistant, draft ready"}>
            <g className={"m-body"} style={{ transformOrigin: "50px 90px" }}>
              <path d={"M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
              <ellipse cx={"50"} cy={"60"} rx={"32"} ry={"30"} fill={"#0075DE"} />
              <ellipse cx={"50"} cy={"64"} rx={"21"} ry={"17"} fill={"#fff"} />
              <g className={"m-eyes"} style={{ transformOrigin: "50px 60px" }}>
                <ellipse cx={"42"} cy={"60"} rx={"3.4"} ry={"3.9099999999999997"} fill={"#111"} />
                <ellipse cx={"58"} cy={"60"} rx={"3.4"} ry={"3.9099999999999997"} fill={"#111"} />
                <circle cx={"43.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
                <circle cx={"59.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
              </g>
              <path className={"m-mouth"} d={"M45 70 q5 4 10 0"} fill={"none"} stroke={"#111"} strokeWidth={"2.2"} strokeLinecap={"round"} />
              <ellipse cx={"34"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
              <ellipse cx={"66"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
            </g>
            <g className={"m-badge"}>
              <circle cx={"80"} cy={"22"} r={"11"} fill={"#205c38"} />
              <path d={"M75 22.5l3.4 3.4 6.4-7"} fill={"none"} stroke={"#fff"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"} />
            </g>
          </svg>
          <small>
            <Pair left={"Drafted by Vo"} right={"needs your review"} />
          </small>
        </div>
        <p style={{ marginTop: "8px" }}>{draft}</p>
        <small style={{ display: "block", marginTop: "6px" }}>{sources}</small>
        <div className={"row"}>
          <button className={"btn sm p"} data-ai={"ok"}>
            {"Accept"}
          </button>
          <button className={"btn sm"} data-ai={"edit"}>
            {"Edit"}
          </button>
          <button className={"btn sm"} data-ai={"no"}>
            {"Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type StatusbarData = {
  timezone: string;
  /** "Reminder queue healthy · 0 retries" — shown only when the queue's state is known. */
  queue?: { label: string; detail: string } | null;
  /** The Designer's `.demo` note, used for sample mode. */
  sample?: { label: string; detail: string } | null;
};

export function SheetStatusbar({ data }: { data: StatusbarData }) {
  return (
    <footer className={"statusbar"}>
      <span>
        <i className={"dot"}></i>
        {"All changes saved"}
      </span>
      {data.queue ? (
        <span>
          <Pair left={data.queue.label} right={data.queue.detail} />
        </span>
      ) : null}
      <span>{`Times in ${data.timezone}`}</span>
      <span aria-label={"Command K search"}>
        <svg
          className={"cmdk"}
          viewBox={"0 0 24 24"}
          aria-hidden={"true"}
          fill={"none"}
          stroke={"currentColor"}
          strokeWidth={"1.8"}
          strokeLinecap={"round"}
          strokeLinejoin={"round"}
        >
          <path d={CMDK} />
        </svg>
        {"K search"}
      </span>
      {data.sample ? (
        <span className={"demo"}>
          <Pair left={data.sample.label} right={data.sample.detail} />
        </span>
      ) : null}
    </footer>
  );
}

export function SheetFrame({
  sidebar,
  top,
  header,
  rbar,
  aside,
  styles,
  after,
  statusbar,
  children,
}: {
  sidebar: SidebarData;
  top?: TopBarData;
  /** A page's own top bar (the Designer gives some pages their own crumb and actions). */
  header?: ReactNode;
  rbar?: RbarData | null;
  /** A page's own right column in place of the calendar one. */
  aside?: ReactNode;
  /** A page's own stylesheets, placed after the frame's. */
  styles?: readonly string[];
  /** A page's dialogs, placed after the frame where the capture has them. */
  after?: ReactNode;
  statusbar: StatusbarData;
  children?: ReactNode;
}) {
  const right = aside ?? (rbar ? <SheetRbar data={rbar} /> : null);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: WAVE }} />
      {(styles ?? []).map((sheet, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: sheet }} />
      ))}
      <div className={"mhead"}>
        <a href={"/sheet"}>
          <img src={"/assets/brand/casevoya-wordmark-white.svg"} alt={"Casevoya"} width={126} height={20} />
        </a>
        <span className={"mi"}>
          <button aria-label={"Search"} data-wt={"1"} className={"k2-wt-t"} data-palette={"1"}>
            <Icon name={"search"} />
          </button>
          <button id={"mOpen"} aria-label={"Open menu"} data-wt={"1"} className={"k2-wt-t"}>
            <Icon name={"menu"} />
          </button>
        </span>
      </div>
      <div className={"frame"}>
        <SheetSidebar data={sidebar} />
        <main className={right ? "sheet wr" : "sheet"}>
          <div className={"main"} id={"main"}>
            {header ?? (top ? <SheetTopBar data={top} /> : null)}
            <div id={"content"}>{children}</div>
          </div>
          {right}
        </main>
        <SheetStatusbar data={statusbar} />
      </div>
      <div className={"scrimd"} id={"scrimd"}></div>
      {after}
      <div id={"k2wt"} className={"k2-wt"} role={"tooltip"} aria-hidden={"true"}></div>
    </>
  );
}
