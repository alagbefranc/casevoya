import { clock, locationLabel, safeZone, zoneAbbr } from "@/modules/scheduling/format";
import type { PortalAppointment, PortalAppointments } from "@/modules/scheduling/portal-load";
import type { PortalViewer } from "@/modules/portal/load";
import { utcToLocal } from "@/modules/scheduling/slots";

const SPRITE = "/assets/icons-coreui/sprite.svg";
const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Sep() {
  return <span className="sep" aria-hidden="true"></span>;
}

function Icon({ name }: { name: string }) {
  return (
    <svg className="ic s" aria-hidden="true">
      <use href={`${SPRITE}#i-${name}`}></use>
    </svg>
  );
}

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function parts(row: PortalAppointment) {
  const zone = safeZone(row.timeZone);
  const start = Date.parse(row.startsAt);
  const local = utcToLocal(start, zone);
  return { zone, start, local, day: Number(local.date.slice(8)), month: MONTH[Number(local.date.slice(5, 7)) - 1] };
}

function pastChip(status: string): { tone: string; label: string } {
  if (status === "completed") return { tone: "ok", label: "Attended" };
  if (status === "no_show") return { tone: "bad", label: "Missed" };
  if (status === "cancelled") return { tone: "gr", label: "Cancelled" };
  return { tone: "gr", label: "Done" };
}

/**
 * The Designer's portal Appointments page (`components/portal/markup/portal-appointments.tsx`)
 * for the client's own bookings: heading, "Coming up" with the date tile, "Past", and "Book a
 * call". Each time carries its zone. Join, reschedule and cancel by the client are not built yet
 * (BUILD-SPEC slices 5 and 7), so those buttons are not shown; "Add to calendar" downloads the
 * booking's calendar file.
 */
export function AppointmentsLive({ viewer, data }: { viewer: PortalViewer; data: PortalAppointments }) {
  const now = data.now;
  const upcoming = data.rows.filter((row) => row.status === "confirmed" && Date.parse(row.endsAt) > now);
  const past = data.rows.filter((row) => !upcoming.includes(row)).reverse();
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={i(0)}>
        <div>
          <h1 className="display">Appointments</h1>
          <p>{`Your calls with ${viewer.organizationName}. Each time is shown with its timezone.`}</p>
        </div>
      </div>
      <div className="grid2">
        <div>
          <div className="panel rv" style={i(1)}>
            <h2>
              <Icon name="calendar" />
              Coming up
            </h2>
            <div className="pad">
              {upcoming.length === 0 ? (
                <div className="emp">
                  <b>No calls booked</b>
                  <small>When you or your firm book a consultation, it appears here.</small>
                </div>
              ) : (
                upcoming.map((row) => {
                  const p = parts(row);
                  const end = Date.parse(row.endsAt);
                  return (
                    <div key={row.id} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
                      <div style={{ background: "var(--blue)", color: "#fff", borderRadius: "14px", textAlign: "center", padding: "10px 0" }}>
                        <small style={{ fontSize: "13px" }}>{WEEKDAY[p.local.weekday]}</small>
                        <b style={{ display: "block", fontSize: "30px", fontWeight: "300" }} className="num">
                          {p.day}
                        </b>
                        <small style={{ fontSize: "13px" }}>{p.month}</small>
                      </div>
                      <div>
                        <b style={{ fontWeight: "500", fontSize: "17px" }}>{row.title}</b>
                        <p className="lbl num">
                          {`${p.local.time}–${clock(end, p.zone)} ${zoneAbbr(p.start, p.zone)} `}
                          <Sep />
                          {` ${locationLabel(row.locationKind, row.locationDetail)}`}
                          {row.hostName ? (
                            <>
                              {" "}
                              <Sep />
                              {` with ${row.hostName}`}
                            </>
                          ) : null}
                        </p>
                        <div className="kd-row" style={{ marginTop: "10px" }}>
                          <a className="btn sm" href={`/api/appointments/${row.id}/ics?organizationId=${viewer.organizationId}`}>
                            <Icon name="calendar" />
                            Add to calendar
                          </a>
                          {row.locationKind === "meeting_link" && row.locationDetail ? (
                            <a className="btn p sm" href={row.locationDetail} rel="noopener noreferrer" target="_blank">
                              <Icon name="video" />
                              Open meeting link
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="panel rv" style={i(2)}>
            <h2>
              <Icon name="history" />
              Past
            </h2>
            <div className="pad">
              {past.length === 0 ? (
                <div className="emp">
                  <b>Nothing yet</b>
                  <small>Past and cancelled calls stay listed here.</small>
                </div>
              ) : (
                past.map((row) => {
                  const p = parts(row);
                  const minutes = Math.round((Date.parse(row.endsAt) - p.start) / 60_000);
                  const chip = pastChip(row.status);
                  return (
                    <div key={row.id} className="li">
                      <div>
                        <b>{row.title}</b>
                        <small className="num">
                          {`${p.day} ${p.month} `}
                          <Sep />
                          {` ${minutes} min`}
                          {row.hostName ? (
                            <>
                              {" "}
                              <Sep />
                              {` ${row.hostName}`}
                            </>
                          ) : null}
                        </small>
                      </div>
                      <span className="r">
                        <span className={`bd ${chip.tone}`}>
                          <i></i>
                          {chip.label}
                        </span>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className="panel rv" style={i(3)} id="book">
          <h2>
            <Icon name="plus" />
            Book a call
          </h2>
          <div className="pad">
            {data.bookable.length === 0 ? (
              <p className="lbl">{`${viewer.organizationName} hasn’t published a booking page yet. Message your firm to arrange a call.`}</p>
            ) : (
              data.bookable.map((type) => (
                <a key={type.href} className="btn" style={{ width: "100%", marginTop: "8px", justifyContent: "space-between" }} href={type.href}>
                  <span>{type.title}</span>
                  <span className="num">{`${type.durationMin} min`}</span>
                </a>
              ))
            )}
            <p className="lbl" style={{ marginTop: "8px" }}>
              Times are shown in your timezone on the booking page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
