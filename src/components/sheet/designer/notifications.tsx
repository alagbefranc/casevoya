/**
 * The Designer's Notifications page (`markup/notifications.tsx`), rendered from the signed-in
 * staff member's notifications (public.staff_notifications). Same DOM, classes and order as the
 * capture. Live-only attributes: `data-org` on Mark all read, `data-notif` / `data-nav` on rows.
 */
import { Fragment, type CSSProperties } from "react";
import { Empty, Icon } from "./frame";
import { Avatar, type SidebarPerson } from "./sidebar";

export type NotificationsTab = "all" | "mentions" | "system";
export type NotificationPart = string | { b: string };
export type NotificationRow = {
  id?: string;
  href?: string;
  /** A person (photo or initials), "system" for the info glyph, or "vo" for a Vo draft. */
  lead: SidebarPerson | "system" | "vo";
  parts: NotificationPart[];
  time: string;
  unread: boolean;
};
export type NotificationGroup = { label: string; rows: NotificationRow[] };
export type NotificationsData = {
  tab: NotificationsTab;
  unread: number;
  /** Live: more notifications exist than were read, so the unread count is a floor ("N+ unread"). */
  more?: boolean;
  groups: NotificationGroup[];
  /** Live only: wires Mark all read. */
  organizationId?: string;
};

const UNDERLINE: Record<NotificationsTab, CSSProperties> = {
  all: { left: "0px", width: "19px" },
  mentions: { left: "45px", width: "55px" },
  system: { left: "125px", width: "43px" },
};

const TABS: [NotificationsTab, string][] = [
  ["all", "All"],
  ["mentions", "Mentions"],
  ["system", "System"],
];

const EMPTY: Record<NotificationsTab, { title: string; copy: string }> = {
  all: { title: "You’re all caught up", copy: "New client messages, uploads, payments, bookings and deadline reminders on your matters appear here." },
  mentions: { title: "No mentions", copy: "Mentions aren’t available yet. Notes and messages don’t tag people." },
  system: { title: "Nothing from the system", copy: "Deadline reminders on your matters appear here when they come due." },
};

const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;

export function NotificationsHeader({ data }: { data: NotificationsData }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"bell"} cls={"ic s"} />
          {"Notifications"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"pill"}>{`${data.unread}${data.more ? "+" : ""} unread`}</span>
        <span className={"acts"}>
          <button className={"btn s sm"} id={"mar"} data-org={data.organizationId}>
            {"Mark all read"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === data.tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[data.tab]}></i>
      </div>
    </>
  );
}

/** Vo, needing review: for Vo draft notifications once drafts are stored (none are yet). */
function VoReview() {
  return (
    <svg className={"mascot m-review"} width={28} height={28} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo, the Casevoya assistant, needs review"}>
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
        <circle cx={"80"} cy={"22"} r={"11"} fill={"#ffb110"} />
        <path d={"M80 16v7"} stroke={"#111"} strokeWidth={"2.6"} strokeLinecap={"round"} />
        <circle cx={"80"} cy={"27.5"} r={"1.6"} fill={"#111"} />
      </g>
    </svg>
  );
}

function Lead({ lead }: { lead: NotificationRow["lead"] }) {
  if (lead === "vo") return <VoReview />;
  if (lead === "system") {
    return (
      <span style={{ width: "28px", display: "grid", placeItems: "center" }}>
        <Icon name={"info"} cls={"ic s"} />
      </span>
    );
  }
  return <Avatar person={lead} />;
}

export function SheetNotifications({ data }: { data: NotificationsData }) {
  let index = 0;
  return (
    <>
      <div className={"ph rv"} style={i(index++)}>
        <h1 className={"display"}>{"Notifications"}</h1>
        <p>
          {"Grouped by day. Choose what reaches you by email in "}
          {data.organizationId ? (
            <a className={"tl"} href={"/sheet/settings?tab=notifications"}>
              {"Settings"}
            </a>
          ) : (
            "Settings"
          )}
          {"."}
        </p>
      </div>
      {data.groups.length === 0 ? (
        <div className={"panel rv"} style={i(index++)}>
          <Empty art={"portal-caught-up"} title={EMPTY[data.tab].title} copy={EMPTY[data.tab].copy} />
        </div>
      ) : (
        data.groups.map((group) => (
          <Fragment key={group.label}>
            <h3 className={"sub rv"} style={{ fontWeight: "500", ...i(index++) }}>
              {group.label}
            </h3>
            {group.rows.map((row, n) => (
              <div key={row.id ?? `${group.label}-${n}`} className={"li nfr rv"} style={i(index++)} data-notif={row.id} data-nav={row.href}>
                <Lead lead={row.lead} />
                <div style={{ flex: "1" }}>
                  {row.parts.map((part, k) => (typeof part === "string" ? <Fragment key={k}>{part}</Fragment> : <b key={k}>{part.b}</b>))}
                </div>
                <span className={"r"}>
                  <small className={"num"} style={{ color: "var(--t2)", fontSize: "13px" }}>
                    {row.time}
                  </small>
                  <i className={"ud"} style={{ width: "7px", height: "7px", borderRadius: "50%", background: row.unread ? "var(--blue)" : "transparent" }}></i>
                </span>
              </div>
            ))}
          </Fragment>
        ))
      )}
    </>
  );
}
