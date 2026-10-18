/**
 * The Designer's Team queue (`markup/queue.tsx`), rendered from the firm's open work: internal
 * tasks, documents waiting for review, deadlines waiting for verification and money waiting for
 * a second person. Same DOM, classes and order as the capture.
 *
 * Live-only additions (absent when the Designer's own values are given): each item's `data-f`
 * filter tokens and `data-href`, an item without an owner shows no avatar, a person without
 * working hours says so, and an empty list shows the Designer's empty state.
 */
import type { CSSProperties } from "react";
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Sep } from "./frame";

export type QueueTone = "chg" | "bad" | "rev" | "gr" | "dk" | "ok" | "blue";

export type QueueLoad = {
  person: SidebarPerson;
  role: string;
  bookedHours: number;
  availableHours: number;
};

export type QueueItem = {
  /** The list item's id (the kit's rubber-band list keys rows by it). */
  id: string;
  title: string;
  who: string;
  kind: string;
  owner: SidebarPerson | null;
  due: { tone: QueueTone; label: string };
  /** Filter tokens: overdue, unassigned, money, government. Live only. */
  flags?: string[];
  href?: string;
};

export type QueueData = {
  counts: { open: number; overdue: number; people: number };
  load: QueueLoad[];
  items: QueueItem[];
};

const AMBER = "rgb(184, 110, 0)";
const BLUE = "rgb(0, 117, 222)";
const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;
const SMALL: CSSProperties = { color: "var(--t2)", fontSize: "13px" };

export function QueueHeader({ counts }: { counts: QueueData["counts"] }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"menu"} cls={"ic s"} />
        {"Team queue"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"pill"}>{`${counts.open} open`}</span>
      <span className={"pill"}>{`${counts.overdue} overdue`}</span>
      <span className={"pill"}>{`Workload is shared across ${counts.people} ${counts.people === 1 ? "person" : "people"}`}</span>
      <span className={"acts"}>
        <button className={"btn s sm"}>
          <Icon name={"filter"} cls={"ic s"} />
          {"Filter"}
        </button>
      </span>
    </header>
  );
}

/** The share of working hours booked, as the Designer's bar writes it. */
export function loadShare(booked: number, available: number): number {
  return available > 0 ? (Math.min(booked, available) / available) * 100 : 0;
}

function Load({ load }: { load: QueueLoad }) {
  const share = loadShare(load.bookedHours, load.availableHours);
  return (
    <div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <Avatar person={load.person} />
        <div>
          <b style={{ fontWeight: "500" }}>{load.person.name}</b>
          <br />
          <small style={SMALL}>{load.role}</small>
        </div>
      </div>
      <div style={{ height: "6px", borderRadius: "4px", background: "var(--muted)", margin: "14px 0 8px", overflow: "hidden" }}>
        <i
          className={"ld"}
          style={{
            display: "block",
            height: "100%",
            width: `${Number(share.toFixed(4))}%`,
            background: share > 75 ? AMBER : BLUE,
            borderRadius: "4px",
            transition: "width .9s var(--ease)",
          }}
          data-w={`${share}%`}
        ></i>
      </div>
      {load.availableHours > 0 ? (
        <small style={SMALL}>
          <span className={"num"}>{String(load.bookedHours)}</span>
          {" of "}
          <span className={"num"}>{String(load.availableHours)}</span>
          {" hours booked"}
        </small>
      ) : (
        <small style={SMALL}>{"No working hours set"}</small>
      )}
    </div>
  );
}

const CHIPS = ["All", "Overdue", "Unassigned", "Money", "Government"];

export function SheetQueue({ data }: { data: QueueData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <h1 className={"display"}>{"Team queue"}</h1>
        <p>{"Everyone’s open work in one list. Reassign by choosing a person. Nothing moves without someone choosing to move it."}</p>
      </div>
      <div className={"panel rv"} style={i(1)}>
        <h2>
          <Icon name={"users"} />
          {"Load this week"}
        </h2>
        {data.load.length ? (
          <div className={"split"} style={{ "--n": String(data.load.length) } as CSSProperties}>
            {data.load.map((load) => (
              <Load key={`${load.person.name}-${load.role}`} load={load} />
            ))}
          </div>
        ) : (
          <Empty art={"review-queue-empty"} title={"No active staff"} copy={"People appear here once they join the firm."} />
        )}
      </div>
      <div className={"bar rv"} style={i(2)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search tasks"} aria-label={"Search tasks"} />
        {CHIPS.map((chip, index) => (
          <span key={chip} className={index === 0 ? "fchip on" : "fchip"}>
            {chip}
          </span>
        ))}
      </div>
      {data.items.length ? (
        <div id={"ql"} aria-label={"Review queue"} data-rb-list={"1"} tabIndex={0} role={"listbox"} className={"rv"} style={{ position: "relative", "--i": "3" } as CSSProperties}>
          <span className={"rb-ind"} aria-hidden={"true"}></span>
          {data.items.map((item) => (
            <div
              key={item.id}
              className={"li"}
              id={item.id}
              aria-selected={"false"}
              role={"option"}
              data-f={item.flags?.join(" ") || undefined}
              data-href={item.href}
            >
              <span className={"ck"}></span>
              <div>
                <b>{item.title}</b>
                <small>
                  {`${item.who} `}
                  <Sep />
                  {` ${item.kind}`}
                </small>
              </div>
              <span className={"r"}>
                {item.owner ? <Avatar person={item.owner} /> : null}
                <span className={`bd ${item.due.tone}`}>
                  <i></i>
                  {item.due.label}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={"panel rv"} style={i(3)}>
          <Empty art={"review-queue-empty"} title={"Nothing is waiting"} copy={"Open tasks, documents to review, deadlines to verify and money to approve appear here."} />
        </div>
      )}
    </>
  );
}
