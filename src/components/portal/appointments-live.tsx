"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeDlg, openDlg, toast2 } from "@/components/port/kit";
import { clock, safeZone, zoneAbbr } from "@/modules/scheduling/format";
import { portalCancelBooking, portalRescheduleBooking, portalRescheduleStarts } from "@/modules/scheduling/portal-actions";
import type { PortalAppointment, PortalAppointments } from "@/modules/scheduling/portal-load";
import { cancelBody, cancelTitle, joinState, pickLabel, pickerDays, slotTime, whereLabel } from "@/modules/scheduling/portal-present";
import type { PortalViewer } from "@/modules/portal/load";
import { utcToLocal } from "@/modules/scheduling/slots";

const SPRITE = "/assets/icons-coreui/sprite.svg";
const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TICK_MS = 30_000;

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

const ROW: React.CSSProperties = { display: "grid", gridTemplateColumns: "72px 1fr", gap: "16px", alignItems: "center" };

/** The browser's clock, read every half minute (the join window opens and closes on it). */
function subscribeClock(onTick: () => void) {
  const timer = window.setInterval(onTick, TICK_MS);
  return () => window.clearInterval(timer);
}
const clockNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;

/** The Designer's dialog close button (class "ic " as captured). */
function CloseX({ onClick }: { onClick: () => void }) {
  return (
    <button className="x" aria-label="Close" data-x="" onClick={onClick}>
      <svg className="ic " aria-hidden="true">
        <use href={`${SPRITE}#i-close`}></use>
      </svg>
    </button>
  );
}

/**
 * The Designer's portal Appointments page (`components/portal/markup/portal-appointments.tsx`)
 * for the client's own bookings: heading, "Coming up" with the date tile and its Join video call /
 * Reschedule / Cancel row, "Past", and "Book a call". Each time carries its zone.
 *
 * Live wiring (CRM-03): "Join video call" is the firm's meeting link from 10 minutes before the
 * call until it ends, or for a Casevoya video call its call page (/call/<reference>) from 15
 * minutes before until 30 minutes after; before that it is the Designer's button with its toast,
 * marked aria-disabled (phone and in-person calls show their location copy instead). Reschedule opens a dialog built from the Designer's
 * "Book a call" pieces (day and time pickers, in the client's zone) over the free times for the
 * same type and host; Cancel opens the Designer's #cxd dialog, whose late warning shows only when
 * cancelling now is inside the type's minimum notice. Both call the portal server actions, then
 * toast and refresh. Live-only additions, stripped in the fidelity test: "Add to calendar"
 * (downloads the booking's calendar file), aria-disabled on the join button, and the #rsd dialog.
 */
export function AppointmentsLive({ viewer, data }: { viewer: PortalViewer; data: PortalAppointments }) {
  const router = useRouter();
  // The server's clock on render (so the HTML matches on hydration), then the browser's.
  const now = useSyncExternalStore(subscribeClock, clockNow, () => data.now);

  const upcoming = data.rows.filter((row) => row.status === "confirmed" && Date.parse(row.endsAt) > data.now);
  const past = data.rows.filter((row) => !upcoming.includes(row)).reverse();

  // Which call the dialogs are about (the first upcoming one until a button is pressed).
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = upcoming.find((row) => row.id === activeId) ?? upcoming[0] ?? null;

  // Cancel.
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, startCancel] = useTransition();
  const openCancel = (row: PortalAppointment) => {
    setActiveId(row.id);
    setCancelError(null);
    openDlg("cxd");
  };
  const confirmCancel = () => {
    if (!active || cancelling) return;
    const row = active;
    startCancel(async () => {
      const result = await portalCancelBooking({ organizationId: viewer.organizationId, bookingId: row.id, version: row.version });
      if ("error" in result) {
        setCancelError(result.error);
        return;
      }
      closeDlg("cxd");
      toast2("Call cancelled", {
        kind: "ok",
        sub: row.isSample
          ? "Sample booking: your firm has been told in the app. No email is sent."
          : result.late
            ? "Your firm has been told. This was inside the notice period, so it may count as a missed call."
            : "Your firm has been told. You can book another time below.",
      });
      router.refresh();
    });
  };

  // Reschedule.
  const [starts, setStarts] = useState<number[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  const [loading, startLoad] = useTransition();
  const openMove = (row: PortalAppointment) => {
    setActiveId(row.id);
    setStarts(null);
    setLoadError(null);
    setMoveError(null);
    setPickedDay(null);
    setPicked(null);
    openDlg("rsd");
    startLoad(async () => {
      const result = await portalRescheduleStarts({ organizationId: viewer.organizationId, bookingId: row.id });
      if ("error" in result) {
        setLoadError(result.error);
        setStarts([]);
        return;
      }
      const current = Date.parse(row.startsAt);
      setStarts(result.starts.filter((start) => start !== current));
    });
  };
  const confirmMove = () => {
    if (!active || picked == null || moving) return;
    const row = active;
    const start = picked;
    const zone = safeZone(row.timeZone);
    startMove(async () => {
      const result = await portalRescheduleBooking({ organizationId: viewer.organizationId, bookingId: row.id, start: new Date(start).toISOString(), timeZone: zone, version: row.version });
      if ("error" in result) {
        setMoveError(result.error);
        if (/no longer free/.test(result.error)) {
          setPicked(null);
          setStarts((current) => (current ?? []).filter((item) => item !== start));
        }
        return;
      }
      closeDlg("rsd");
      toast2("Call moved", {
        kind: "ok",
        sub: `Now ${pickLabel(start, zone)} ${zoneAbbr(start, zone)}. ${row.isSample ? "Sample booking: no email is sent." : "Your firm has been told."}`,
      });
      router.refresh();
    });
  };

  const zone = active ? safeZone(active.timeZone) : safeZone(viewer.timezone);
  const days = pickerDays(starts ?? [], zone);
  const day = days.find((item) => item.date === pickedDay) ?? days[0] ?? null;
  const pickerNote = starts == null || loading ? "Loading times…" : loadError ? loadError : days.length === 0 ? "No other times are open in the next four weeks. Message your firm to arrange a time." : null;

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
                upcoming.map((row, index) => {
                  const p = parts(row);
                  const end = Date.parse(row.endsAt);
                  const join = joinState(row, now, viewer.organizationName);
                  return (
                    <div key={row.id} style={index === 0 ? ROW : { ...ROW, marginTop: "16px" }}>
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
                          {` ${whereLabel(row)}`}
                          {row.hostName ? (
                            <>
                              {" "}
                              <Sep />
                              {` with ${row.hostName}`}
                            </>
                          ) : null}
                        </p>
                        <div className="kd-row" style={{ marginTop: "10px" }}>
                          {join.kind === "open" ? (
                            <a className="btn p sm" href={join.href} rel="noopener noreferrer" target="_blank">
                              <Icon name="video" />
                              Join video call
                            </a>
                          ) : join.kind === "wait" || join.kind === "firm" ? (
                            <button
                              className="btn p sm"
                              data-toast={join.toast}
                              data-fpb="1"
                              aria-disabled="true"
                              onClick={(event) => {
                                // The portal's own [data-toast] script shows the toast when it is armed.
                                if (event.defaultPrevented) return;
                                event.preventDefault();
                                toast2(join.toast);
                              }}
                            >
                              <Icon name="video" />
                              Join video call
                            </button>
                          ) : null}
                          <button className="btn sm" id={index === 0 ? "rs" : undefined} onClick={() => openMove(row)}>
                            Reschedule
                          </button>
                          <button className="btn sm" id={index === 0 ? "cx" : undefined} onClick={() => openCancel(row)}>
                            Cancel
                          </button>
                          <a className="btn sm" href={`/api/appointments/${row.id}/ics?organizationId=${viewer.organizationId}`}>
                            <Icon name="calendar" />
                            Add to calendar
                          </a>
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
                  // A Casevoya video call stays joinable for 30 minutes after its end (it may run over).
                  const rejoin = row.locationKind === "video" && row.status !== "cancelled" ? joinState(row, now, viewer.organizationName) : null;
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
                        {rejoin?.kind === "open" ? (
                          <a className="btn p sm" href={rejoin.href} rel="noopener noreferrer" target="_blank" style={{ marginRight: "8px" }}>
                            <Icon name="video" />
                            Rejoin call
                          </a>
                        ) : null}
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
      {active ? (
        <>
          <dialog className="dlg" id="cxd" aria-labelledby="cxt">
            <div className="dh">
              <h2 id="cxt">{cancelTitle(active)}</h2>
              <CloseX onClick={() => closeDlg("cxd")} />
            </div>
            <div className="db">
              {cancelBody(active, viewer.organizationName)}
              {cancelError ? (
                <p className="lbl" role="alert" style={{ marginTop: "8px" }}>
                  {cancelError}
                </p>
              ) : null}
            </div>
            <div className="df">
              <button className="btn" data-x="" autoFocus onClick={() => closeDlg("cxd")}>
                Keep the call
              </button>
              <button className="btn" style={{ background: "var(--bad)", color: "#fff" }} data-x="" id="cxy" onClick={confirmCancel} disabled={cancelling || undefined} aria-busy={cancelling || undefined}>
                Cancel call
              </button>
            </div>
          </dialog>
          <dialog className="dlg" id="rsd" aria-labelledby="rst">
            <div className="dh">
              <h2 id="rst">{`Move the ${active.title.trim().toLowerCase()}`}</h2>
              <CloseX onClick={() => closeDlg("rsd")} />
            </div>
            <div className="db">
              <span className="lbl">Pick a day</span>
              <div className="days" role="group" aria-label="Day" style={{ marginTop: "6px" }}>
                {days.map((item) => (
                  <button
                    key={item.date}
                    aria-pressed={item === day ? "true" : "false"}
                    onClick={() => {
                      setPickedDay(item.date);
                      setPicked(null);
                      setMoveError(null);
                    }}
                  >
                    {item.weekday}
                    <b className="num">{item.day}</b>
                  </button>
                ))}
              </div>
              <span className="lbl">{`Times in ${zone}`}</span>
              <div className="slots" role="group" aria-label="Time" style={{ marginTop: "6px" }}>
                {(day?.starts ?? []).map((start) => (
                  <button
                    key={start}
                    className="num"
                    aria-pressed={start === picked ? "true" : "false"}
                    onClick={() => {
                      setPicked(start);
                      setMoveError(null);
                    }}
                  >
                    {slotTime(start, zone)}
                  </button>
                ))}
              </div>
              {pickerNote ? (
                <p className="lbl" role="status" style={{ marginTop: "8px" }}>
                  {pickerNote}
                </p>
              ) : null}
              {moveError ? (
                <p className="lbl" role="alert" style={{ marginTop: "8px" }}>
                  {moveError}
                </p>
              ) : null}
              <p className="lbl" style={{ marginTop: "8px" }}>
                {active.isSample ? "Sample booking: your firm is told in the app; no email is sent." : "You’ll get the new time by email. Your firm is told in the app."}
              </p>
            </div>
            <div className="df">
              <button className="btn" data-x="" onClick={() => closeDlg("rsd")}>
                Keep the time
              </button>
              <button className={moving ? "btn p is-loading" : "btn p"} id="rsy" disabled={picked == null || moving} aria-busy={moving || undefined} onClick={confirmMove}>
                <span className="lab">{picked == null ? "Choose a time" : `Move to ${pickLabel(picked, zone)}`}</span>
                <span className="spin"></span>
              </button>
            </div>
          </dialog>
        </>
      ) : null}
    </div>
  );
}
