/**
 * The Designer's Consultations page (`markup/consultations.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for the Upcoming, Availability and Booking page tabs and for the
 * Book for a client, Reschedule and Cancel dialogs. The Consultation record tab follows the
 * Designer's layout: staff notes and the client's outcome summary (CRM-04) on the left, the
 * booking, agreement and fee on the right, with live additions (the picker, attendance, history).
 *
 * Live rows and dialogs carry data attributes (`data-booking-open`, `data-booking-submit`,
 * `data-avail-open`, `data-type-open`, `data-copy`) that use-sheet wires to the server actions;
 * the captured markup has none. Given the Designer's sample values the components render the
 * captured HTML exactly (tests/designer-fidelity.test.tsx).
 */
import type { ReactNode } from "react";
import { Empty, Icon, Pair, Sep, type CalendarDay } from "./frame";

export type ConsultationsTab = "upcoming" | "availability" | "booking";
type Tone = "ok" | "blue" | "rev" | "bad" | "gr" | "chg";
export type Chip = { tone: Tone; label: string };

/** A row button: the Designer's dialog or toast button, or a live action keyed by data attributes. */
export type RowAction = {
  label: string;
  icon?: string;
  dlg?: string;
  toast?: string;
  data?: Record<string, string>;
};

export type ConsultationRow = {
  when: string;
  /** Live: the client and the booking type ("Ana Ferreira · Initial consultation"). */
  client: string | { left: string; right: string };
  /** Live: the row opens this consultation's record. */
  href?: string;
  with: { left: string; right: string };
  agreement: string;
  fee: string | Chip;
  state: Chip;
  actions: RowAction[];
};

export type DlItem = { term: string; value: string | { left: string; right: string } | "video-planned" };

export type HostPanel = { name: string; items: DlItem[]; edit?: Record<string, string> | null };

/**
 * nav (live): where the month arrows go (each becomes a button); a day with `href` (live) opens
 * that link. Without them the arrows and days are the Designer's static marks.
 */
export type MonthCal = {
  month: string;
  leading: number;
  days: (CalendarDay & { href?: string; label?: string })[];
  nav?: { prev: string; next: string; prevLabel: string; nextLabel: string } | null;
};

export type BookingPreview = {
  logo: string | null;
  firm: string;
  title: string;
  note: string;
  chips: string[];
  href: string;
  /** Live: each time opens the booking page (the preview's times are for looking, not booking). */
  chipHref?: string | null;
};

/** archive (live): the owner archives the type (it is unpublished and leaves the list). */
export type BookingTypeRow = { title: string; detail: string; state: Chip; edit?: Record<string, string> | null; archive?: Record<string, string> | null };

export type ConsultationsData = {
  tab: ConsultationsTab;
  upcoming?: { rows: ConsultationRow[]; empty?: { title: string; copy: string } | null };
  /** calendarTitle (live): the month box's heading; the Designer's says "This week". */
  availability?: { hosts: HostPanel[]; calendar: MonthCal; calendarTitle?: string | null; empty?: { title: string; copy: string; action?: Record<string, string> | null } | null };
  booking?: {
    preview: BookingPreview | null;
    /** note: live only, the practice-page line in sample mode (absent on the Designer render). */
    share: { url: string; copy?: string | null; embedNote: boolean; note?: string | null } | null;
    /** Live: the firm's booking types (owner edits them). */
    types?: { rows: BookingTypeRow[]; create?: Record<string, string> | null } | null;
    empty?: { title: string; copy: string } | null;
  };
};

const UNDERLINE: Record<ConsultationsTab | "record", { left: string; width: string }> = {
  upcoming: { left: "0px", width: "61px" },
  availability: { left: "87px", width: "68px" },
  booking: { left: "181px", width: "81px" },
  record: { left: "288px", width: "115px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function ChipView({ chip }: { chip: Chip }) {
  return (
    <span className={`bd ${chip.tone}`}>
      <i></i>
      {chip.label}
    </span>
  );
}

function ActionButton({ action }: { action: RowAction }) {
  const data = action.data ?? {};
  if (action.dlg) {
    return (
      <button className={"btn sm"} data-dlg={action.dlg} data-fpd={"1"} {...data}>
        {action.icon ? <Icon name={action.icon} cls={"ic s"} /> : null}
        {action.label}
      </button>
    );
  }
  if (action.toast) {
    return (
      <button className={"btn sm"} data-toast={action.toast} data-sub={""} data-fpb={"1"} {...data}>
        {action.icon ? <Icon name={action.icon} cls={"ic s"} /> : null}
        {action.label}
      </button>
    );
  }
  return (
    <button className={"btn sm"} type={"button"} {...data}>
      {action.icon ? <Icon name={action.icon} cls={"ic s"} /> : null}
      {action.label}
    </button>
  );
}

/** The page's own top bar ("Leads / Consultations"), its pills, Book for a client, and the tabs. */
export function ConsultationsHeader({
  tab,
  pills,
  book,
}: {
  tab: ConsultationsTab | "record";
  pills: string[];
  /** Live: data attributes for Book for a client (absent when nobody can be booked). */
  book?: Record<string, string> | null;
}) {
  const tabs: [ConsultationsTab | "record", string][] = [
    ["upcoming", "Upcoming"],
    ["availability", "Availability"],
    ["booking", "Booking page"],
    ["record", "Consultation record"],
  ];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"users"} cls={"ic s"} />
          {"Leads"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"calendar"} cls={"ic s"} />
          {"Consultations"}
        </button>
        {pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}>
          <button className={"btn p sm"} data-dlg={"dlgBook"} data-fpd={"1"} {...(book ?? {})}>
            <Icon name={"plus"} cls={"ic s"} />
            {"Book for a client"}
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

function Heading({ title, copy, art }: { title: ReactNode; copy: string; art?: string }) {
  return (
    <div className={art ? "ph v rv" : "ph rv"} style={i(0)}>
      {art ? (
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={`/assets/generated/b2/${art}-160@1x.webp`}
            srcSet={`/assets/generated/b2/${art}-160@2x.webp 2x`}
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

function EmptyPanel({ n, title, copy, children }: { n: number; title: string; copy: string; children?: ReactNode }) {
  return (
    <div className={"panel rv"} style={i(n)}>
      <Empty art={"calendar-link"} title={title} copy={copy}>
        {children}
      </Empty>
    </div>
  );
}

function Upcoming({ data }: { data: NonNullable<ConsultationsData["upcoming"]> }) {
  return (
    <>
      <Heading
        art={"calendar-link"}
        title={"Consultations"}
        copy={"Initial consultations booked by clients or by staff. A consultation has its own agreement, separate from any later service agreement."}
      />
      {data.rows.length === 0 ? (
        <EmptyPanel n={1} title={data.empty?.title ?? "No consultations yet"} copy={data.empty?.copy ?? "Bookings appear here."} />
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Upcoming consultations"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Upcoming consultations"}</caption>
            <thead>
              <tr>
                {["When (your time)", "Client", "With", "Agreement", "Booking fee", "State"].map((label) => (
                  <th key={label} scope={"col"}>
                    {label}
                  </th>
                ))}
                <th scope={"col"}></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={index} data-href={row.href} style={row.href ? { cursor: "pointer" } : undefined}>
                  <td>
                    <span className={"num"}>{row.when}</span>
                  </td>
                  <td>{typeof row.client === "string" ? row.client : <Pair left={row.client.left} right={row.client.right} />}</td>
                  <td>
                    <Pair left={row.with.left} right={row.with.right} />
                  </td>
                  <td>{row.agreement}</td>
                  <td>{typeof row.fee === "string" ? row.fee : <ChipView chip={row.fee} />}</td>
                  <td>
                    <ChipView chip={row.state} />
                  </td>
                  <td>
                    {row.actions.map((action, n) => (
                      <ActionButton key={`${action.label}-${n}`} action={action} />
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={"fp-note rv"} style={i(2)}>
        {"A booking fee paid before the meeting is an advance and goes to the client account. Booking can’t relabel it as earned (PRD §9)."}
      </p>
    </>
  );
}

function DlValue({ value }: { value: DlItem["value"] }) {
  if (value === "video-planned") {
    return (
      <span style={{ display: "inline-flex", gap: "14px", alignItems: "center" }}>
        <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <img src={"/assets/logos/integrations/googlemeet.svg"} alt={""} width={16} height={16} style={{ opacity: ".75" }} />
          {"Google Meet"}
        </span>
        <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <img src={"/assets/logos/integrations/microsoftteams.svg"} alt={""} width={16} height={16} style={{ opacity: ".75" }} />
          {"Teams"}
        </span>
        <span className={"mu"}>
          {" "}
          <Sep />
          {" planned, link added to the invite"}
        </span>
      </span>
    );
  }
  if (typeof value === "string") return <>{value}</>;
  return <Pair left={value.left} right={value.right} />;
}

export function MonthCalendar({ data }: { data: MonthCal }) {
  return (
    <>
      <h4 style={{ fontWeight: "500" }}>
        {`${data.month} `}
        <span style={{ color: "var(--t2)", display: "flex", gap: "6px" }}>
          {data.nav ? (
            <>
              <button type={"button"} data-nav={data.nav.prev} aria-label={data.nav.prevLabel} title={data.nav.prevLabel} style={{ display: "inline-flex", color: "inherit" }}>
                <Icon name={"chevron-left"} cls={"ic s"} />
              </button>
              <button type={"button"} data-nav={data.nav.next} aria-label={data.nav.nextLabel} title={data.nav.nextLabel} style={{ display: "inline-flex", color: "inherit" }}>
                <Icon name={"chevron-right"} cls={"ic s"} />
              </button>
            </>
          ) : (
            <>
              <Icon name={"chevron-left"} cls={"ic s"} />
              <Icon name={"chevron-right"} cls={"ic s"} />
            </>
          )}
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
          <span
            key={day.day}
            className={["num", day.today ? "t" : "", day.marked ? "d" : ""].filter(Boolean).join(" ")}
            data-nav={day.href}
            role={day.href ? "link" : undefined}
            tabIndex={day.href ? 0 : undefined}
            aria-label={day.href ? day.label : undefined}
            style={day.href ? { cursor: "pointer" } : undefined}
          >
            {String(day.day)}
          </span>
        ))}
      </div>
    </>
  );
}

function Availability({ data }: { data: NonNullable<ConsultationsData["availability"]> }) {
  return (
    <>
      <Heading title={"Availability"} copy={"Only the calendars you choose are read. Two people can’t book the same slot."} />
      <div className={"fp-g2 rv"} style={i(1)}>
        <div>
          {data.hosts.length === 0 ? (
            <div className={"panel"}>
              <Empty art={"calendar-link"} title={data.empty?.title ?? "No working hours yet"} copy={data.empty?.copy ?? "Set the hours you take consultations."}>
                {data.empty?.action ? (
                  <button className={"btn p sm"} type={"button"} {...data.empty.action}>
                    {"Set my hours"}
                  </button>
                ) : null}
              </Empty>
            </div>
          ) : (
            data.hosts.map((host, index) => (
              <section key={`${host.name}-${index}`} className={"panel"}>
                <h2>
                  <Icon name={"clock"} />
                  {host.name}
                </h2>
                <div className={"fp-pad"}>
                  <dl className={"fp-dl"}>
                    {host.items.map((item) => (
                      <div key={item.term}>
                        <dt>{item.term}</dt>
                        <dd>
                          <DlValue value={item.value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {host.edit ? (
                    <div className={"fp-row"} style={{ marginTop: "12px" }}>
                      <button className={"btn sm"} type={"button"} {...host.edit}>
                        <Icon name={"edit"} cls={"ic s"} />
                        {"Edit hours"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>
            ))
          )}
        </div>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"calendar"} />
              {data.calendarTitle ?? "This week"}
            </h2>
            <div className={"fp-pad"}>
              <MonthCalendar data={data.calendar} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Booking({ data }: { data: NonNullable<ConsultationsData["booking"]> }) {
  return (
    <>
      <Heading title={"Booking page"} copy={"The firm-branded page clients use to book. Share it as a link or embed it on your site."} />
      <div className={"fp-g2 rv"} style={i(1)}>
        {data.preview ? (
          <div className={"panel"}>
            <div className={"fp-pad"}>
              {data.preview.logo ? <img src={data.preview.logo} alt={""} width={28} height={28} /> : null}{" "}
              <b style={{ fontWeight: "500", verticalAlign: "8px" }}>{data.preview.firm}</b>
              <h3 style={{ fontSize: "20px", fontWeight: "400", margin: "10px 0 4px" }}>{data.preview.title}</h3>
              <p className={"fp-note"} style={{ margin: "0 0 12px" }}>
                {data.preview.note}
              </p>
              <div className={"fp-row"}>
                {data.preview.chips.map((chip) => (
                  <button
                    key={chip}
                    className={"fchip"}
                    data-book-href={data.preview?.chipHref ?? undefined}
                    title={data.preview?.chipHref ? "Opens the booking page, where this time can be booked" : undefined}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <a className={"btn p sm"} style={{ marginTop: "14px" }} href={data.preview.href}>
                {"Open the client booking page"}
              </a>
            </div>
          </div>
        ) : (
          <div className={"panel"}>
            <Empty art={"calendar-link"} title={data.empty?.title ?? "No booking page yet"} copy={data.empty?.copy ?? "Publish a booking type to share a booking page."} />
          </div>
        )}
        <div>
          {data.share ? (
            <section className={"panel"}>
              <h2>
                <Icon name={"link"} />
                {"Share"}
              </h2>
              <div className={"fp-pad"}>
                <p className={"fp-note"} style={{ margin: "0 0 8px" }}>
                  {"Link"}
                </p>
                <div className={"fp-row"}>
                  <code style={{ fontSize: "13px" }}>{data.share.url}</code>
                  <button className={"btn s sm"} type={"button"} data-toast={"Link copied"} data-fpb={"1"} data-copy={data.share.copy ?? undefined}>
                    <Icon name={"copy"} cls={"ic s"} />
                    {"Copy link"}
                  </button>
                </div>
                {data.share.note ? (
                  <p className={"fp-note"} role={"note"}>
                    {data.share.note}
                  </p>
                ) : null}
                {data.share.embedNote ? (
                  <p className={"fp-note"}>
                    {"Embed code and the enquiry form are on "}
                    <a href={"/enquiry"} style={{ color: "var(--blue)" }}>
                      {"the enquiry page"}
                    </a>
                    {"."}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
          {data.types ? (
            <section className={"panel"}>
              <h2>
                <Icon name={"calendar"} />
                {"Booking types"}
                {data.types.create ? (
                  <span className={"r"}>
                    <button className={"btn s sm"} type={"button"} {...data.types.create}>
                      <Icon name={"plus"} cls={"ic s"} />
                      {"New booking type"}
                    </button>
                  </span>
                ) : null}
              </h2>
              <div className={"fp-pad"}>
                {data.types.rows.length === 0 ? (
                  <p className={"fp-note"} style={{ margin: "0" }}>
                    {"No booking types yet. The firm owner creates them here."}
                  </p>
                ) : (
                  data.types.rows.map((row, index) => (
                    <div key={`${row.title}-${index}`} className={"li"}>
                      <div>
                        <b>{row.title}</b>
                        <small>{row.detail}</small>
                      </div>
                      <span className={"r"}>
                        <ChipView chip={row.state} />
                        {row.edit ? (
                          <button className={"btn sm"} type={"button"} style={{ marginLeft: "8px" }} {...row.edit}>
                            {"Edit"}
                          </button>
                        ) : null}
                        {row.archive ? (
                          <button className={"btn sm"} type={"button"} style={{ marginLeft: "8px" }} {...row.archive}>
                            {"Archive"}
                          </button>
                        ) : null}

                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function SheetConsultations({ data }: { data: ConsultationsData }) {
  if (data.tab === "availability" && data.availability) return <Availability data={data.availability} />;
  if (data.tab === "booking" && data.booking) return <Booking data={data.booking} />;
  return <Upcoming data={data.upcoming ?? { rows: [] }} />;
}

// ---------------------------------------------------------------------------
// Consultation record (live): one real booking's notes, outcome and details, in the Designer's
// record layout (heading, Notes and Outcome panels on the left, a details panel on the right).
// ---------------------------------------------------------------------------

/** "Join video call" on a Casevoya video call's record: a link inside the window, else the toast. */
export type ConsultationRecordJoin = { href: string; toast: null } | { href: null; toast: string };

/**
 * The Designer's "Outcome summary for Tomás" panel (CRM-04): written after an attended
 * consultation, "Needs consultant review" until a licensed reviewer approves and shares it.
 */
export type OutcomeSummaryData = {
  /** "Outcome summary for Tomás". */
  title: string;
  chip: Chip | null;
  /** The current text, or why there is none yet. */
  body: string | null;
  empty: string;
  /** Approve and share: only for a licensed reviewer, while it needs review. */
  share: Record<string, string> | null;
  /** Edit (or Write the summary): staff, after the consultation was attended. */
  edit: { label: string; attrs: Record<string, string> } | null;
  /** The text the client sees now, when an edit is waiting for review. */
  sharedNote?: string | null;
};

/** Write or edit the outcome summary (#dlgSum). */
export type SummaryDialogData = { title: string; body: string; hint: string; submit: Record<string, string> };

export function SummaryDialog({ data }: { data: SummaryDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgSum"} aria-labelledby={"dlgSumH"}>
      <div className={"dh"}>
        <h2 id={"dlgSumH"}>{data.title}</h2>
        <CloseX id={"dlgSum"} />
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"smB"}>{"Summary for the client"}</label>
          <textarea className={"ta"} id={"smB"} rows={6} maxLength={4000} defaultValue={data.body} aria-describedby={"smB-h"}></textarea>
          <span className={"hint"} id={"smB-h"}>
            {data.hint}
          </span>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgSum"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...data.submit}>
          {"Save for review"}
        </button>
      </div>
    </dialog>
  );
}

export type ConsultationRecordData = {
  /** Bookings to choose from; each option's value is the record's URL. */
  picker: { label: string; value: string; selected: boolean }[];
  record: {
    attendee: string;
    notes: { items: { who: string; when: string; body: string }[]; copy: string; lead: { href: string; label: string } | null };
    outcome: { chip: Chip; copy: string; actions: RowAction[] };
    /** Live: the client's outcome summary (CRM-04). */
    summary?: OutcomeSummaryData | null;
    /** Live addition (no Designer control): only on a Casevoya video call, for its host and firm owners. */
    join?: ConsultationRecordJoin | null;
    details: DlItem[];
    history: { what: string; who: string; when: string }[];
  } | null;
  empty: { title: string; copy: string };
};

function OutcomeSummaryPanel({ data }: { data: OutcomeSummaryData }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={"check-circle"} />
        {data.title}
        {data.chip ? (
          <span className={"r"}>
            <ChipView chip={data.chip} />
          </span>
        ) : null}
      </h2>
      <div className={"fp-pad"}>
        {data.body ? <p style={{ fontSize: "14.5px" }}>{data.body}</p> : <p className={"fp-note"}>{data.empty}</p>}
        {data.sharedNote ? (
          <p className={"fp-note"} style={{ marginTop: "8px" }}>
            {data.sharedNote}
          </p>
        ) : null}
        {data.share || data.edit ? (
          <div className={"fp-row"} style={{ marginTop: "10px" }}>
            {data.share ? (
              <button className={"btn p sm"} type={"button"} {...data.share}>
                {"Approve and share"}
              </button>
            ) : null}
            {data.edit ? (
              <button className={"btn sm"} type={"button"} {...data.edit.attrs}>
                {data.edit.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function SheetConsultationRecord({ data }: { data: ConsultationRecordData }) {
  const record = data.record;
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>
            {record ? (
              <>
                {"Consultation record "}
                <Sep />
                {` ${record.attendee}`}
              </>
            ) : (
              "Consultation record"
            )}
          </h1>
          <p>{"Notes are staff-only. The outcome summary the client sees is reviewed by the consultant first."}</p>
        </div>
      </div>
      {data.picker.length ? (
        <div className={"fld rv"} style={{ maxWidth: "520px", "--i": "1" } as React.CSSProperties}>
          <label htmlFor={"crB"}>{"Consultation"}</label>
          <select className={"sel"} id={"crB"} data-nav-select={"1"} defaultValue={data.picker.find((option) => option.selected)?.value ?? ""}>
            {record ? null : <option value={""}>{"Choose a consultation"}</option>}
            {data.picker.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {record ? (
        <div className={"fp-g2 rv"} style={i(2)}>
          <div>
            <section className={"panel"}>
              <h2>
                <Icon name={"note"} />
                {"Notes (staff only)"}
              </h2>
              <div className={"fp-pad"}>
                {record.notes.items.map((note, index) => (
                  <div key={index} className={"fp-mail"}>
                    <small style={{ color: "var(--t2)" }}>
                      <Pair left={note.who} right={note.when} />
                    </small>
                    <p style={{ fontSize: "14.5px" }}>{note.body}</p>
                  </div>
                ))}
                <p className={"fp-note"} style={{ margin: record.notes.items.length ? "10px 0 0" : "0" }}>
                  {record.notes.copy}
                </p>
                {record.notes.lead ? (
                  <div className={"fp-row"} style={{ marginTop: "10px" }}>
                    <a className={"btn sm"} href={record.notes.lead.href}>
                      {record.notes.lead.label}
                    </a>
                  </div>
                ) : null}
              </div>
            </section>
            {record.summary ? <OutcomeSummaryPanel data={record.summary} /> : null}
            <section className={"panel"}>
              <h2>
                <Icon name={"check-circle"} />
                {record.summary ? "Attendance" : "Outcome"}
                <span className={"r"}>
                  <ChipView chip={record.outcome.chip} />
                </span>
              </h2>
              <div className={"fp-pad"}>
                <p style={{ fontSize: "14.5px" }}>{record.outcome.copy}</p>
                {record.join ? (
                  <div className={"fp-row"} style={{ marginTop: "10px" }}>
                    {record.join.href ? (
                      <a className={"btn p sm"} href={record.join.href} target={"_blank"} rel={"noopener noreferrer"}>
                        <Icon name={"video"} cls={"ic s"} />
                        {"Join video call"}
                      </a>
                    ) : (
                      <button className={"btn p sm"} type={"button"} aria-disabled={"true"} data-toast={record.join.toast} data-sub={""} data-fpb={"1"}>
                        <Icon name={"video"} cls={"ic s"} />
                        {"Join video call"}
                      </button>
                    )}
                  </div>
                ) : null}
                {record.outcome.actions.length ? (
                  <div className={"fp-row"} style={{ marginTop: "10px" }}>
                    {record.outcome.actions.map((action, n) => (
                      <ActionButton key={`${action.label}-${n}`} action={action} />
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
          <div>
            <section className={"panel"}>
              <h2>
                <Icon name={"file-check"} />
                {"Booking, agreement and fee"}
              </h2>
              <div className={"fp-pad"}>
                <dl className={"fp-dl"}>
                  {record.details.map((item) => (
                    <div key={item.term}>
                      <dt>{item.term}</dt>
                      <dd>
                        <DlValue value={item.value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
            {record.history.length ? (
              <section className={"panel"}>
                <h2>
                  <Icon name={"history"} />
                  {"History"}
                </h2>
                <div className={"fp-pad"}>
                  <ol className={"fp-steps"}>
                    {record.history.map((item, index) => (
                      <li key={index} className={index === 0 ? "now" : ""}>
                        <span className={"d"} aria-hidden={"true"}></span>
                        <div>
                          <b>{item.what}</b>
                          <small>
                            <Pair left={item.who} right={item.when} />
                          </small>
                        </div>
                        {index === 0 ? <span className={"sr"}>{"latest"}</span> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyPanel n={2} title={data.empty.title} copy={data.empty.copy} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs (after the frame, as captured)
// ---------------------------------------------------------------------------

export type Option = { label: string; value?: string; data?: Record<string, string> };

export type BookDialogData = {
  clients: Option[];
  times: Option[];
  /** The Designer's agreement choice; the live dialog has none (consultation agreements are not linked yet). */
  agreements?: string[] | null;
  /** Live: booking types (shown only when there is more than one). */
  types?: Option[] | null;
  submit: { toast: string; sub: string; kind: string } | { data: Record<string, string> };
  hint?: string;
};

function OptionView({ option }: { option: Option }) {
  return (
    <option value={option.value} {...(option.data ?? {})}>
      {option.label}
    </option>
  );
}

function CloseX({ id }: { id: string }) {
  return (
    <button className={"x"} aria-label={"Close"} data-close={id}>
      <Icon name={"close"} cls={"ic s"} />
    </button>
  );
}

export function BookDialog({ data }: { data: BookDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgBook"} aria-labelledby={"dlgBookH"}>
      <div className={"dh"}>
        <h2 id={"dlgBookH"}>{"Book for a client"}</h2>
        <CloseX id={"dlgBook"} />
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"bkC"}>{"Client"}</label>
          <select className={"sel"} id={"bkC"}>
            {data.clients.map((option, index) => (
              <OptionView key={`${option.value ?? option.label}-${index}`} option={option} />
            ))}
          </select>
        </div>
        {data.types && data.types.length > 1 ? (
          <div className={"fld"}>
            <label htmlFor={"bkT"}>{"Booking type"}</label>
            <select className={"sel"} id={"bkT"}>
              {data.types.map((option, index) => (
                <OptionView key={`${option.value}-${index}`} option={option} />
              ))}
            </select>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"bkS"}>{"Time"}</label>
          <small className={"hint"} id={"bkS-h"}>
            {data.hint ?? "Only free slots with buffer are shown"}
          </small>
          <select className={"sel"} id={"bkS"}>
            {data.times.map((option, index) => (
              <OptionView key={`${option.value ?? option.label}-${index}`} option={option} />
            ))}
          </select>
        </div>
        {data.agreements ? (
          <div className={"fld"}>
            <label htmlFor={"bkA"}>{"Agreement"}</label>
            <select className={"sel"} id={"bkA"}>
              {data.agreements.map((label) => (
                <option key={label}>{label}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgBook"}>
          {"Cancel"}
        </button>
        {"toast" in data.submit ? (
          <button className={"btn p"} data-close={"dlgBook"} data-toast={data.submit.toast} data-toast-sub={data.submit.sub} data-toast-kind={data.submit.kind}>
            {"Book"}
          </button>
        ) : (
          <button className={"btn p"} {...data.submit.data}>
            {"Book"}
          </button>
        )}
      </div>
    </dialog>
  );
}

export type RescheduleDialogData = {
  title: string;
  times: Option[];
  note: string;
  submit: { toast: string; kind: string } | { data: Record<string, string> };
};

export function RescheduleDialog({ data }: { data: RescheduleDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgRes"} aria-labelledby={"dlgResH"}>
      <div className={"dh"}>
        <h2 id={"dlgResH"}>{data.title}</h2>
        <CloseX id={"dlgRes"} />
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"rsS"}>{"New time"}</label>
          <select className={"sel"} id={"rsS"}>
            {data.times.map((option, index) => (
              <OptionView key={`${option.value ?? option.label}-${index}`} option={option} />
            ))}
          </select>
        </div>
        <p className={"fp-note"}>{data.note}</p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgRes"}>
          {"Cancel"}
        </button>
        {"toast" in data.submit ? (
          <button className={"btn p"} data-close={"dlgRes"} data-toast={data.submit.toast} data-toast-kind={data.submit.kind}>
            {"Reschedule"}
          </button>
        ) : (
          <button className={"btn p"} {...data.submit.data}>
            {"Reschedule"}
          </button>
        )}
      </div>
    </dialog>
  );
}

export type CancelDialogData = { body: string; submit: { toast: string } | { data: Record<string, string> } };

export function CancelDialog({ data }: { data: CancelDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgCan"} aria-labelledby={"dlgCanH"}>
      <div className={"dh"}>
        <h2 id={"dlgCanH"}>{"Cancel this consultation?"}</h2>
        <CloseX id={"dlgCan"} />
      </div>
      <div className={"db"}>
        <p>{data.body}</p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgCan"}>
          {"Keep it"}
        </button>
        {"toast" in data.submit ? (
          <button className={"btn p"} style={{ background: "#a12c20" }} data-close={"dlgCan"} data-toast={data.submit.toast}>
            {"Cancel consultation"}
          </button>
        ) : (
          <button className={"btn p"} style={{ background: "#a12c20" }} {...data.submit.data}>
            {"Cancel consultation"}
          </button>
        )}
      </div>
    </dialog>
  );
}
