/**
 * Settings dialogs for scheduling, in the Designer's dialog anatomy (`.dlg`, `.dh`, `.db`, `.fld`,
 * `.df`). The Designer has no capture for these screens (BUILD-SPEC §4 Settings → Booking types and
 * Availability); they reuse its classes. Openers fill them from data attributes (booking-acts.ts).
 */
import { Icon } from "./frame";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Close({ id }: { id: string }) {
  return (
    <button className={"x"} aria-label={"Close"} data-close={id}>
      <Icon name={"close"} cls={"ic s"} />
    </button>
  );
}

/** Weekly working hours (one range per day), days off, and the schedule's time zone. */
export function AvailabilityDialog({ organizationId, zones }: { organizationId: string; zones: string[] }) {
  return (
    <dialog className={"dlg"} id={"dlgAvail"} aria-labelledby={"dlgAvailH"}>
      <div className={"dh"}>
        <h2 id={"dlgAvailH"}>{"Working hours"}</h2>
        <Close id={"dlgAvail"} />
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"avZ"}>{"Time zone"}</label>
          <small className={"hint"} id={"avZ-h"}>
            {"Hours are in this zone. Clients see times in their own."}
          </small>
          <select className={"sel"} id={"avZ"}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {WEEKDAYS.map((day, index) => (
          <div key={day} className={"fld"}>
            <label htmlFor={`avS${index + 1}`}>{day}</label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input className={"inp"} id={`avS${index + 1}`} type={"time"} step={300} aria-label={`${day} from`} />
              <span aria-hidden={"true"}>{"to"}</span>
              <input className={"inp"} id={`avE${index + 1}`} type={"time"} step={300} aria-label={`${day} until`} />
            </div>
          </div>
        ))}
        <div className={"fld"}>
          <label htmlFor={"avOff"}>{"Days off"}</label>
          <small className={"hint"} id={"avOff-h"}>
            {"Dates with no bookings, as YYYY-MM-DD, separated by commas"}
          </small>
          <input className={"inp"} id={"avOff"} type={"text"} placeholder={"2026-12-24, 2026-12-25"} />
        </div>
        <p className={"fp-note"}>{"Leave a day empty when you don’t take consultations. Existing bookings stay as they are."}</p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgAvail"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-avail-submit={"1"} data-org={organizationId}>
          {"Save hours"}
        </button>
      </div>
    </dialog>
  );
}

export type HostOption = { membershipId: string; name: string };

/** A booking type (firm owner, with a recent step-up). Free consultations only in this release. */
/**
 * practice: the firm is in sample mode, so a published type is a practice page (staff only).
 * agreements: the firm's approved consultation agreements; one can go out with each booking from
 * the booking page (the choice shows only when there is one).
 */
export function BookingTypeDialog({
  organizationId,
  hosts,
  practice = false,
  agreements = [],
}: {
  organizationId: string;
  hosts: HostOption[];
  practice?: boolean;
  agreements?: { label: string; value?: string }[];
}) {
  const select = (id: string, label: string, options: [string, string][], hint?: string) => (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      <select className={"sel"} id={id}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <dialog className={"dlg"} id={"dlgType"} aria-labelledby={"dlgTypeH"}>
      <div className={"dh"}>
        <h2 id={"dlgTypeH"}>{"Booking type"}</h2>
        <Close id={"dlgType"} />
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"etT"}>{"Name"}</label>
          <input className={"inp"} id={"etT"} type={"text"} maxLength={120} placeholder={"Initial consultation"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"etS"}>{"Link name"}</label>
          <small className={"hint"} id={"etS-h"}>
            {"Lowercase letters, numbers and dashes, used in the booking link"}
          </small>
          <input className={"inp"} id={"etS"} type={"text"} maxLength={64} placeholder={"initial-consultation"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"etD"}>{"Description (optional)"}</label>
          <input className={"inp"} id={"etD"} type={"text"} maxLength={1000} />
        </div>
        {select("etL", "Length", [["15", "15 minutes"], ["20", "20 minutes"], ["30", "30 minutes"], ["45", "45 minutes"], ["60", "60 minutes"], ["90", "90 minutes"]])}
        {select("etP", "Start times every", [["", "Same as the length"], ["15", "15 minutes"], ["30", "30 minutes"], ["60", "60 minutes"]])}
        {select("etBB", "Buffer before", [["0", "None"], ["5", "5 minutes"], ["10", "10 minutes"], ["15", "15 minutes"], ["30", "30 minutes"]])}
        {select("etBA", "Buffer after", [["0", "None"], ["5", "5 minutes"], ["10", "10 minutes"], ["15", "15 minutes"], ["30", "30 minutes"]])}
        <div className={"fld"}>
          <label htmlFor={"etN"}>{"Minimum notice (hours)"}</label>
          <input className={"inp"} id={"etN"} type={"number"} min={0} max={8760} step={1} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"etW"}>{"Bookable up to (days ahead)"}</label>
          <input className={"inp"} id={"etW"} type={"number"} min={1} max={365} step={1} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"etC"}>{"Daily limit per person (optional)"}</label>
          <input className={"inp"} id={"etC"} type={"number"} min={1} max={48} step={1} />
        </div>
        {select("etK", "How you meet", [["video", "Video call in Casevoya"], ["phone", "Phone"], ["in_person", "In person"], ["meeting_link", "Meeting link"]])}
        <div className={"fld"}>
          <label htmlFor={"etX"}>{"Address or meeting link"}</label>
          <small className={"hint"} id={"etX-h"}>
            {"An office address for in person, or an https:// link for a meeting link"}
          </small>
          <input className={"inp"} id={"etX"} type={"text"} maxLength={300} />
        </div>
        <fieldset className={"fld"} style={{ border: "0", padding: "0", margin: "0" }}>
          <legend>{"Who takes these bookings"}</legend>
          {hosts.length === 0 ? <small className={"hint"}>{"No staff can host yet."}</small> : null}
          {hosts.map((host) => (
            <label key={host.membershipId} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input type={"checkbox"} name={"etH"} value={host.membershipId} />
              {host.name}
            </label>
          ))}
        </fieldset>
        {agreements.length ? (
          <div className={"fld"}>
            <label htmlFor={"etA"}>{"Consultation agreement"}</label>
            <small className={"hint"} id={"etA-h"}>
              {"Sent with each booking from the booking page. The client signs it from a private link."}
            </small>
            <select className={"sel"} id={"etA"} aria-describedby={"etA-h"}>
              <option value={""}>{"None"}</option>
              {agreements.map((option) => (
                <option key={option.value ?? ""} value={option.value ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type={"checkbox"} id={"etPub"} />
          {practice ? "Published as a practice page (only your team can open it until your firm is verified)" : "Published (clients can book from the link)"}
        </label>
        <p className={"fp-note"}>
          {"Free consultations only. A booking fee paid before a consultation is an advance for the client account, so paid booking types are not available yet."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgType"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-type-submit={"1"} data-org={organizationId}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}
