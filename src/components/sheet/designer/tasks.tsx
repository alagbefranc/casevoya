/**
 * The Designer's Tasks page (`markup/tasks.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for each tab: Internal, Client tasks and Deadlines.
 * Rows carry `data-href` (open the matter) and `data-f` (the filter chips: mine, overdue,
 * blocked, high) so the kit can act on real rows; the captured rows have neither.
 */
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair, Sep } from "./frame";
import type { NewTaskWire, TaskDialogOption } from "@/modules/sheet/new-task";

export type TasksTab = "internal" | "client" | "deadlines";
export type TaskTone = "bad" | "chg" | "gr" | "blue" | "ok" | "rev";
export type TaskChip = { tone: TaskTone; label: string };

export type InternalTaskRow = {
  href?: string;
  /** Filter chip tokens: "mine", "overdue", "blocked", "high". */
  flags?: string[];
  title: string;
  matter: string;
  owner: { person: SidebarPerson; label: string } | null;
  due: string;
  priority: TaskChip;
  dependsOn: string;
  /** A chip, or plain words ("Open"). */
  state: TaskChip | string;
  /** Live only: Manage opens the Task dialog (edit, reassign, mark done). */
  manage?: TaskWire | null;
};

/** `data-*` a live control carries to the Sheet's task and deadline acts. */
export type TaskWire = Record<`data-${string}`, string>;

export type ClientTaskRow = {
  href?: string;
  title: string;
  person: string;
  /** Inside `.num` while due; plain words once done ("Done 10 Oct"). */
  due: { num: string } | string;
  /** Reminder offsets in days, largest first, or none. */
  reminders: { offsets: number[]; quietHours: boolean } | null;
  state: TaskChip;
  /** Live only: Manage opens the Task dialog (edit, mark done). */
  manage?: TaskWire | null;
};

export type DeadlineRow = {
  href?: string;
  label: string;
  matter: string;
  source: string;
  local: { left: string; right: string };
  verifiedBy: string;
  state: TaskChip;
  /** Live only: "Confirm" beside "Tentative, confirm", for someone the database lets confirm it. */
  confirm?: TaskWire | null;
  /** Live only: why it can't be confirmed here (the chip's title). */
  confirmWhy?: string | null;
};

export type TasksDialogData = {
  owners: TaskDialogOption[];
  dependsOn: TaskDialogOption[];
  /** The captured Designer form toasts on Create. */
  create?: { toast: string; kind: string; sub?: string };
  /** The live form: a matter picker, option values, and Create saves through create_task. */
  wire?: NewTaskWire;
};

export type TasksData = {
  tab: TasksTab;
  counts: { open: number; escalated: number };
  internal?: {
    alert: { title: string; detail: string; href: string } | null;
    rows: InternalTaskRow[];
  };
  client?: { rows: ClientTaskRow[] };
  deadlines?: { rows: DeadlineRow[] };
  dialog: TasksDialogData;
  /** Live only: the Task dialog the rows' Manage buttons open. */
  edit?: TaskEditDialogData | null;
};

const UNDERLINE: Record<TasksTab, { left: string; width: string }> = {
  internal: { left: "0px", width: "45px" },
  client: { left: "71px", width: "68px" },
  deadlines: { left: "165px", width: "58px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Chip({ chip }: { chip: TaskChip }) {
  return (
    <span className={`bd ${chip.tone}`}>
      <i></i>
      {chip.label}
    </span>
  );
}

/** The Tasks page's own top bar and its tab strip. */
export function TasksHeader({ tab, counts }: { tab: TasksTab; counts: TasksData["counts"] }) {
  const tabs: [TasksTab, string][] = [
    ["internal", "Internal"],
    ["client", "Client tasks"],
    ["deadlines", "Deadlines"],
  ];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"folder"} cls={"ic s"} />
          {"Work"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"task"} cls={"ic s"} />
          {"Tasks"}
        </button>
        <span className={"pill"}>{`${counts.open} open`}</span>
        <span className={"pill"}>{`${counts.escalated} escalated`}</span>
        <span className={"acts"}>
          <button className={"btn p sm"} data-dlg={"dlgTask"} data-fpd={"1"}>
            <Icon name={"plus"} cls={"ic s"} />
            {"New task"}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {tabs.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[tab]}></i>
      </div>
    </>
  );
}

function Heading({ title, copy, art }: { title: string; copy: string; art?: boolean }) {
  return (
    <div className={art ? "ph v rv" : "ph rv"} style={i(0)}>
      {art ? (
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/portal-nothing-due-160@1x.webp"}
            srcSet={"/assets/generated/b2/portal-nothing-due-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
      ) : null}
      <div>
        <h1 className={"display"}>{title}</h1>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function EmptyPanel({ n, title, copy }: { n: number; title: string; copy: string }) {
  return (
    <div className={"panel rv"} style={i(n)}>
      <Empty art={"portal-nothing-due"} title={title} copy={copy} />
    </div>
  );
}

function Internal({ data }: { data: NonNullable<TasksData["internal"]> }) {
  const rows = data.rows;
  return (
    <>
      <Heading art title={"Tasks"} copy={"Work for the team, across every matter. Every queue filters by owner, office, program, priority and date."} />
      {data.alert ? (
        <div className={"alert bad rv"} style={i(1)}>
          <Icon name={"alarm"} />
          <div>
            <b>{`Escalated: ${data.alert.title}`}</b>
            {data.alert.detail}
          </div>
          <div className={"acts"}>
            <a className={"btn p sm"} href={data.alert.href}>
              {"Open"}
            </a>
          </div>
        </div>
      ) : null}
      <div className={"bar fp-bar rv"} role={"search"} style={i(2)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search tasks"} aria-label={"Search tasks"} />
        <button className={"fchip on"} aria-pressed={"true"}>
          {"All"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"Mine"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"Overdue"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"Blocked"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"High priority"}
        </button>
      </div>
      <p className={"sr rv"} aria-live={"polite"} style={i(3)}>
        {`${rows.length} of ${rows.length} shown`}
      </p>
      {rows.length === 0 ? (
        <EmptyPanel n={4} title={"No open tasks"} copy={"Client tasks and internal tasks appear here with owners and due dates."} />
      ) : (
        <>
          <div className={"tw rv"} role={"region"} aria-label={"Internal tasks"} tabIndex={0} style={i(4)}>
            <table className={"t"}>
              <caption className={"sr"}>{"Internal tasks"}</caption>
              <thead>
                <tr>
                  {["Task", "Matter", "Owner", "Due", "Priority", "Depends on", "State"].map((label) => (
                    <th key={label} scope={"col"}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} data-href={row.href} data-f={row.flags?.length ? row.flags.join(" ") : undefined} style={row.href ? { cursor: "pointer" } : undefined}>
                    <td>{row.title}</td>
                    <td>{row.matter}</td>
                    <td>
                      {row.owner ? (
                        <span className={"fp-row"}>
                          <Avatar person={row.owner.person} />
                          {row.owner.label}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={"num"}>{row.due}</span>
                    </td>
                    <td>
                      <Chip chip={row.priority} />
                    </td>
                    <td>{row.dependsOn}</td>
                    <td>
                      {typeof row.state === "string" ? row.state : <Chip chip={row.state} />}
                      {row.manage ? <Manage title={row.title} wire={row.manage} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={"fp-fe rv"} hidden style={i(5)}>
            <Empty art={"filter-empty"} title={"Nothing matches"} copy={"Try another filter or clear the search."}>
              <button className={"btn s sm"} type={"button"}>
                {"Clear filters"}
              </button>
            </Empty>
          </div>
        </>
      )}
      <p className={"fp-note rv"} style={i(6)}>
        {"Reassigning a task keeps its history and tells the new owner. Completing a task cancels its pending reminders."}
      </p>
    </>
  );
}

function Reminders({ value }: { value: ClientTaskRow["reminders"] }) {
  if (!value || value.offsets.length === 0) return <>{"—"}</>;
  const last = value.offsets.length - 1;
  const tail = `days${value.quietHours ? ", quiet hours on" : ""}`;
  // "14 · 7 · 3 · 1 days, quiet hours on", with the Designer's separator between offsets.
  return (
    <>
      {value.offsets.map((offset, index) => {
        const text = `${index === 0 ? "" : " "}${offset} ${index === last ? tail : ""}`;
        return index === 0 ? text : <ReminderStep key={index} text={text} />;
      })}
    </>
  );
}

function ReminderStep({ text }: { text: string }) {
  return (
    <>
      <Sep />
      {text}
    </>
  );
}

function Client({ data }: { data: NonNullable<TasksData["client"]> }) {
  return (
    <>
      <Heading title={"Client tasks"} copy={"What clients have been asked to do, shown the way they see it in the portal."} />
      {data.rows.length === 0 ? (
        <EmptyPanel n={1} title={"No client tasks"} copy={"Tasks you ask a client to do appear here, the way they see them in the portal."} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Client tasks"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Client tasks"}</caption>
            <thead>
              <tr>
                {["Task", "Person", "Due", "Reminders", "State"].map((label) => (
                  <th key={label} scope={"col"}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index} data-href={row.href} style={row.href ? { cursor: "pointer" } : undefined}>
                  <td>{row.title}</td>
                  <td>{row.person}</td>
                  <td>{typeof row.due === "string" ? row.due : <span className={"num"}>{row.due.num}</span>}</td>
                  <td>
                    <Reminders value={row.reminders} />
                  </td>
                  <td>
                    <Chip chip={row.state} />
                    {row.manage ? <Manage title={row.title} wire={row.manage} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Live only: a row's Manage button, in the State cell (the Designer's `.btn s sm` with the more icon). */
function Manage({ title, wire }: { title: string; wire: TaskWire }) {
  return (
    <button className={"btn s sm"} aria-label={`Manage ${title}`} style={{ marginLeft: "8px" }} {...wire}>
      <Icon name={"more"} cls={"ic s"} />
    </button>
  );
}

function Deadlines({ data }: { data: NonNullable<TasksData["deadlines"]> }) {
  return (
    <>
      <Heading
        title={"Deadlines"}
        copy={"Every deadline keeps its source evidence and who verified it. OCR dates stay tentative until a consultant confirms them (OPS-02)."}
      />
      {data.rows.length === 0 ? (
        <EmptyPanel n={1} title={"No deadlines"} copy={"Deadlines recorded on a matter appear here with their source and who verified them."} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Deadlines"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Deadlines"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Deadline"}</th>
                <th scope={"col"}>{"Matter"}</th>
                <th scope={"col"}>{"Source"}</th>
                <th scope={"col"}>
                  <Pair left={"Local"} right={"official time"} />
                </th>
                <th scope={"col"}>{"Verified by"}</th>
                <th scope={"col"}>{"State"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index} data-href={row.href} style={row.href ? { cursor: "pointer" } : undefined}>
                  <td>{row.label}</td>
                  <td>{row.matter}</td>
                  <td>{row.source}</td>
                  <td>
                    <Pair left={row.local.left} right={row.local.right} />
                  </td>
                  <td>{row.verifiedBy}</td>
                  <td {...(row.confirmWhy && !row.confirm ? { title: row.confirmWhy } : {})}>
                    <Chip chip={row.state} />
                    {row.confirm ? (
                      <button className={"btn s sm"} style={{ marginLeft: "8px" }} {...row.confirm}>
                        {"Confirm"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function SheetTasks({ data }: { data: TasksData }) {
  if (data.tab === "client" && data.client) return <Client data={data.client} />;
  if (data.tab === "deadlines" && data.deadlines) return <Deadlines data={data.deadlines} />;
  return <Internal data={data.internal ?? { alert: null, rows: [] }} />;
}

function DialogOption({ option }: { option: TaskDialogOption }) {
  return (
    <option value={option.value} data-k={option.kind} data-m={option.matter}>
      {option.label}
    </option>
  );
}

const optionKey = (option: TaskDialogOption, index: number) => `${option.matter ?? ""}:${option.value ?? index}`;

/** The Task dialog: the firm's active staff (internal owners) and what Save needs. */
export type TaskEditDialogData = {
  organizationId: string;
  /** The firm's timezone: the due date is a calendar date there. */
  timezone: string;
  /** The firm's today (`YYYY-MM-DD`), the earliest new due date offered. */
  today: string;
  owners: { value: string; label: string }[];
};

/**
 * Live only: one task's controls (title, due date, owner, Mark done). The Designer has no task
 * dialog, so this is its New task dialog (`#dlgTask`: `.fld` / `.inp` / `.sel`, `.df` footer).
 * The opener (`data-task-open`) fills it; Save and Mark done are saved in work-acts.
 */
export function TaskEditDialog({ data }: { data: TaskEditDialogData }) {
  return (
    <dialog className={"dlg"} id={"dTask"} aria-labelledby={"dTaskH"} data-org={data.organizationId} data-tz={data.timezone}>
      <div className={"dh"}>
        <h2 id={"dTaskH"}>{"Task"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dTask"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"teT"}>{"Task"}</label>
          <input className={"inp"} id={"teT"} type={"text"} autoComplete={"off"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"teD"}>{"Due"}</label>
          <small className={"hint"} id={"teD-h"}>
            {"Optional. A new due date can’t be in the past."}
          </small>
          <input className={"inp"} id={"teD"} type={"date"} min={data.today} aria-describedby={"teD-h"} />
        </div>
        <div className={"fld"} id={"teOF"}>
          <label htmlFor={"teO"}>{"Owner"}</label>
          <small className={"hint"} id={"teO-h"}>
            {"Reassigning keeps the task’s history and tells the new owner. It asks you to confirm with your authenticator."}
          </small>
          <select className={"sel"} id={"teO"} aria-describedby={"teO-h"}>
            {data.owners.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className={"hint"} id={"teC"} hidden>
          {"A client task stays with the client it was asked of."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dTask"}>
          {"Cancel"}
        </button>
        <button className={"btn s"} data-task-done={"dialog"}>
          {"Mark done"}
        </button>
        <button className={"btn p"} data-task-save={"1"}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}

/**
 * The Designer's "New task" dialog. It sits after the frame, beside the scrim. With `wire`
 * it gains a Matter field (the database puts every task on a matter) in the Designer's own
 * `.fld` / `.sel` markup, its options carry values, and Create is saved in use-sheet
 * (`data-new-task`) instead of toasting.
 */
export function TasksDialog({ data }: { data: TasksDialogData }) {
  const wire = data.wire;
  return (
    <dialog className={"dlg"} id={"dlgTask"} aria-labelledby={"dlgTaskH"}>
      <div className={"dh"}>
        <h2 id={"dlgTaskH"}>{"New task"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgTask"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        {wire ? (
          <div className={"fld"}>
            <label htmlFor={"tkM"}>{"Matter"}</label>
            <select className={"sel"} id={"tkM"} defaultValue={wire.matters[0]?.value ?? ""}>
              {wire.matters.length === 0 ? <option value={""}>{"No matter you can add tasks to yet"}</option> : null}
              {wire.matters.map((option, index) => (
                <DialogOption key={optionKey(option, index)} option={option} />
              ))}
            </select>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"tkT"}>{"Task"}</label>
          <input className={"inp"} id={"tkT"} type={"text"} placeholder={""} defaultValue={""} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"tkK"}>{"Kind"}</label>
          <select className={"sel"} id={"tkK"}>
            <option value={wire ? "internal" : undefined}>{"Internal (staff only)"}</option>
            <option value={wire ? "client" : undefined}>{"Client task (shows in their portal)"}</option>
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"tkO"}>{"Owner"}</label>
          <select className={"sel"} id={"tkO"} defaultValue={wire?.owner}>
            {data.owners.map((option, index) => (
              <DialogOption key={optionKey(option, index)} option={option} />
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"tkD"}>{"Due"}</label>
          <small className={"hint"} id={"tkD-h"}>
            {"Shown in the owner’s timezone"}
          </small>
          <input className={"inp"} id={"tkD"} type={"text"} placeholder={"DD/MM/YYYY"} defaultValue={""} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"tkP"}>{"Depends on"}</label>
          <select className={"sel"} id={"tkP"}>
            <option value={wire ? "" : undefined}>{"Nothing"}</option>
            {data.dependsOn.map((option, index) => (
              <DialogOption key={optionKey(option, index)} option={option} />
            ))}
          </select>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgTask"}>
          {"Cancel"}
        </button>
        {wire ? (
          <button className={"btn p"} data-new-task={"1"} data-org={wire.organizationId} data-tz={wire.timezone}>
            {"Create"}
          </button>
        ) : (
          <button className={"btn p"} data-close={"dlgTask"} data-toast={data.create?.toast} data-toast-kind={data.create?.kind} data-toast-sub={data.create?.sub}>
            {"Create"}
          </button>
        )}
      </div>
    </dialog>
  );
}
