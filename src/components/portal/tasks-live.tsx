"use client";

import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PortalTask } from "@/modules/portal/tasks-load";
import type { PortalViewer } from "@/modules/portal/load";

/**
 * The Designer's portal Tasks page (`markup/portal-tasks.tsx`) from the person's own client tasks:
 * the heading, the To do / Waiting / Done switch, and one `.task` card per task (due date chip,
 * Resume for an intake form). Live-only: the switch shows one group at a time; the empty state is
 * the Designer's "You’re all caught up" (use-portal's empty preview). The checkbox is the
 * Designer's marker only: an intake task is done when the form is sent.
 */

const SPRITE = "/assets/icons-coreui/sprite.svg";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const i = (n: number) => ({ "--i": String(n) }) as CSSProperties;

function dueLabel(dueOn: string): string {
  const [y, m, d] = dueOn.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return `${WEEKDAY[date.getUTCDay()]} ${d} ${MONTH[m - 1]}`;
}

function doneLabel(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric", month: "short" }).formatToParts(new Date(iso));
    return `Done ${parts.find((part) => part.type === "day")?.value ?? ""} ${(parts.find((part) => part.type === "month")?.value ?? "").replace(".", "")}.`;
  } catch {
    return "Done.";
  }
}

export type TaskCard = { id: string; title: string; line: string; due: string | null; done: boolean; href: string | null; action: string | null };

export function taskCards(tasks: readonly PortalTask[], firm: string, timeZone: string): { todo: TaskCard[]; waiting: TaskCard[]; done: TaskCard[] } {
  const card = (task: PortalTask): TaskCard => ({
    id: task.id,
    title: task.title,
    line:
      task.status === "done"
        ? task.completedAt
          ? doneLabel(task.completedAt, timeZone)
          : "Done."
        : task.status === "blocked"
          ? task.blockerNote || `${firm} is working on it.`
          : task.intakeResponseId
            ? "Your answers save as you go, so you can stop any time and come back."
            : `${firm} asked you to do this.`,
    due: task.status !== "done" && task.dueOn ? dueLabel(task.dueOn) : null,
    done: task.status === "done",
    href: task.intakeResponseId ? `/portal/intake?response=${task.intakeResponseId}` : null,
    action: task.intakeResponseId ? (task.status === "done" ? "View" : "Resume") : null,
  });
  return {
    todo: tasks.filter((task) => task.status === "open").map(card),
    waiting: tasks.filter((task) => task.status === "blocked").map(card),
    done: tasks.filter((task) => task.status === "done").map(card),
  };
}

/** One Designer task card. */
export function TaskCardView({ card, index, mine }: { card: TaskCard; index: number; mine: boolean }) {
  return (
    <div className={`task${mine ? " mine" : ""}${card.done ? " done" : ""} rv k2-spot`} style={i(index)} data-spot="1">
      <span className={card.done ? "ck on" : "ck "} role="checkbox" aria-checked={card.done ? "true" : "false"} aria-label={card.title} tabIndex={0}></span>
      <div>
        <h3>{card.title}</h3>
        <p>{card.line}</p>
        <div className="meta">
          {card.due ? (
            <span className="chip dt">
              <svg className="ic s" aria-hidden="true">
                <use href={`${SPRITE}#i-clock`}></use>
              </svg>
              {`Due ${card.due}`}
            </span>
          ) : null}
        </div>
      </div>
      <span className="r">
        {card.href && card.action ? (
          <a className={mine ? "btn p sm" : "btn sm"} href={card.href}>
            {card.action}
          </a>
        ) : null}
      </span>
    </div>
  );
}

export function TasksLive({ viewer, tasks }: { viewer: PortalViewer; tasks: PortalTask[] }) {
  const firm = viewer.organizationName;
  const groups = taskCards(tasks, firm, viewer.timezone);
  const filters = [
    { key: "todo", label: "To do", count: groups.todo.length },
    { key: "waiting", label: `Waiting on ${firm}`, count: groups.waiting.length },
    { key: "done", label: "Done", count: groups.done.length },
  ] as const;
  const [shown, setShown] = useState<"todo" | "waiting" | "done" | null>(null);
  const at = shown ? filters.findIndex((filter) => filter.key === shown) : 0;
  const seg = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = seg.current;
    const thumb = group?.querySelector<HTMLElement>(".k2-rs-th");
    const button = group?.querySelectorAll<HTMLElement>("button")[at];
    if (!group || !thumb || !button) return;
    const box = group.getBoundingClientRect();
    const own = button.getBoundingClientRect();
    if (box.width === 0) return;
    thumb.style.left = `${own.left - box.left}px`;
    thumb.style.right = `${box.right - own.right}px`;
  }, [at]);
  const empty = tasks.length === 0;
  let n = 2;
  const section = (key: "todo" | "waiting" | "done", title: string, cards: TaskCard[]) =>
    cards.length && (shown === null || shown === key) ? (
      <Fragment key={key}>
        <h2 className="sub">{title}</h2>
        {cards.map((card) => (
          <TaskCardView key={card.id} card={card} index={n++} mine={key === "todo" && card === groups.todo[0]} />
        ))}
      </Fragment>
    ) : null;
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={i(0)}>
        <div>
          <h1 className="display" data-rb-done="1" aria-label="Tasks">
            <span aria-hidden="true" className="rbw" style={{ display: "inline-block" }}>
              Tasks
            </span>
          </h1>
          <p>{`What ${firm} needs from you, in the order it matters. You can save and come back to anything.`}</p>
        </div>
      </div>
      {empty ? (
        <div className="panel rv" style={i(1)}>
          <div className="emp">
            <span className="art" style={{ "--a": "88px" } as CSSProperties} aria-hidden="true">
              <img src="/assets/generated/b2/portal-caught-up-160@1x.webp" srcSet="/assets/generated/b2/portal-caught-up-160@2x.webp 2x" width={88} height={88} alt="" loading="lazy" decoding="async" />
            </span>
            <b>You’re all caught up</b>
            <small>Nothing needs you right now. Your firm will tell you when something does.</small>
          </div>
        </div>
      ) : (
        <>
          <div ref={seg} className="seg rv k2-rs" style={{ ...i(1), marginBottom: "18px" }} role="radiogroup" aria-label="Filter" data-rubber="1">
            <span className="k2-rs-th" aria-hidden="true" style={{ transition: "none", left: "3px", right: "331px" }}></span>
            {filters.map((filter, index) => (
              <button
                key={filter.key}
                type="button"
                role="radio"
                aria-checked={index === at ? "true" : "false"}
                tabIndex={index === at ? 0 : -1}
                onClick={() => setShown(shown === filter.key ? null : filter.key)}
              >
                {filter.label} <span className="sep" aria-hidden="true"></span> {filter.count}
              </button>
            ))}
          </div>
          {section("todo", "To do", groups.todo)}
          {section("waiting", `Waiting on ${firm}`, groups.waiting)}
          {section("done", "Done", groups.done)}
        </>
      )}
    </div>
  );
}
