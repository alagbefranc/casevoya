/**
 * The Designer's Consultations page (`markup/consultations.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for the Upcoming, Availability and Booking page tabs and for the
 * Book for a client, Reschedule and Cancel dialogs. The Consultation record tab is not ported
 * (consultation notes and outcome summaries are not built) and keeps its old view.
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
  client: string;
  with: { left: string; right: string };
  agreement: string;
  fee: string | Chip;
  state: Chip;
  actions: RowAction[];
};

export type DlItem = { term: string; value: string | { left: string; right: string } | "video-planned" };

export type HostPanel = { name: string; items: DlItem[]; edit?: Record<string, string> | null };

export type MonthCal = { month: string; leading: number; days: CalendarDay[] };

export type BookingPreview = {
  logo: string | null;
  firm: string;
  title: string;
  note: string;
  chips: string[];
  href: string;
};

export type BookingTypeRow = { title: string; detail: string; state: Chip; edit?: Record<string, string> | null };

export type ConsultationsData = {
  tab: ConsultationsTab;
  upcoming?: { rows: ConsultationRow[]; empty?: { title: string; copy: string } | null };
  availability?: { hosts: HostPanel[]; calendar: MonthCal; empty?: { title: string; copy: string; action?: Record<string, string> | null } | null };
  booking?: {
    preview: BookingPreview | null;
    share: { url: string; copy?: string | null; embedNote: boolean } | null;
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
                <tr key={index}>
                  <td>
                    <span className={"num"}>{row.when}</span>
                  </td>
                  <td>{row.client}</td>
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
          <span key={day.day} className={["num", day.today ? "t" : "", day.marked ? "d" : ""].filter(Boolean).join(" ")}>
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
              {"This week"}
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
                  <button key={chip} className={"fchip"}>
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
