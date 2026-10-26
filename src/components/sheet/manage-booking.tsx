"use client";

import { useMemo, useState } from "react";
import { locationLabel, longWhen, slotLabel } from "@/modules/scheduling/format";
import { manageCancel, manageReschedule, manageRescheduleStarts } from "@/modules/scheduling/manage-actions";
import type { ManagedBooking } from "@/modules/scheduling/manage-present";

/**
 * "Manage your booking" (CRM-03), in the booking page's frame (.pb, .card, .btn): the booking,
 * then Change the time (the same type and host, the type's rules applied by the database) or
 * Cancel with a reason. Times are shown in the visitor's own time zone.
 */
function browserZone(fallback: string): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}

type Mode = { kind: "view" } | { kind: "move"; starts: number[] | null; chosen: number | null } | { kind: "cancel" } | { kind: "moved"; start: number } | { kind: "cancelled"; late: boolean };

export function ManageBooking({ booking, token }: { booking: ManagedBooking; token: string }) {
  const zone = useMemo(() => browserZone(booking.timeZone), [booking.timeZone]);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const start = Date.parse(booking.startsAt);

  const openMove = async () => {
    setError(null);
    setMode({ kind: "move", starts: null, chosen: null });
    const result = await manageRescheduleStarts({ ref: booking.ref, token });
    if ("error" in result) {
      setError(result.error);
      setMode({ kind: "view" });
      return;
    }
    setMode({ kind: "move", starts: result.starts, chosen: null });
  };

  const move = async (chosen: number) => {
    setBusy(true);
    setError(null);
    const result = await manageReschedule({ ref: booking.ref, token, start: new Date(chosen).toISOString(), timeZone: zone, version: booking.version });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setMode({ kind: "moved", start: chosen });
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    const result = await manageCancel({ ref: booking.ref, token, reason, version: booking.version, bookingId: booking.id });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setMode({ kind: "cancelled", late: result.late === true });
  };

  const days = useMemo(() => {
    if (mode.kind !== "move" || !mode.starts) return [];
    const groups = new Map<string, number[]>();
    for (const ms of mode.starts) {
      const label = slotLabel(ms, zone).split(" · ")[0];
      groups.set(label, [...(groups.get(label) ?? []), ms]);
    }
    return [...groups.entries()];
  }, [mode, zone]);

  return (
    <div className="pb">
      <header>
        <span>{booking.firmName}</span>
      </header>
      <main id="m" style={{ display: "block", maxWidth: "640px" }}>
        <h1>Manage your booking</h1>
        <div className="card" style={{ marginTop: "20px" }}>
          <b style={{ fontWeight: 500 }}>{booking.title}</b>
          <small style={{ color: "#615d59" }}>
            {mode.kind === "moved" ? `Now ${longWhen(mode.start, zone)}` : longWhen(start, zone)}
            {booking.hostName ? ` · with ${booking.hostName}` : ""}
          </small>
          <small style={{ color: "#615d59" }}>
            {locationLabel(booking.locationKind)}
            {booking.locationKind === "video" ? " · the call opens 15 minutes before the start · it isn’t recorded" : ""}
          </small>
        </div>

        {error ? (
          <p role="alert" style={{ color: "#b42318", marginTop: "14px" }}>
            {error}
          </p>
        ) : null}

        {mode.kind === "moved" ? (
          <div className="card" role="status" style={{ marginTop: "16px" }}>
            <b style={{ fontWeight: 500 }}>Your consultation moved</b>
            <small style={{ color: "#615d59" }}>{`${booking.firmName} has been told. You’ll get an email with the new time and a new link to manage it.`}</small>
          </div>
        ) : mode.kind === "cancelled" ? (
          <div className="card" role="status" style={{ marginTop: "16px" }}>
            <b style={{ fontWeight: 500 }}>Your consultation is cancelled</b>
            <small style={{ color: "#615d59" }}>
              {`${booking.firmName} has been told.${mode.late ? " It was inside the firm’s notice period, so it may count as a missed consultation." : ""} This link no longer works.`}
            </small>
          </div>
        ) : !booking.upcoming ? (
          <p style={{ marginTop: "16px", color: "#615d59" }}>
            {booking.status === "cancelled"
              ? `This consultation was cancelled${booking.cancelledBy === "client" ? " by you" : ` by ${booking.firmName}`}.`
              : "This consultation can’t be changed here any more. Contact the firm if you need to."}
          </p>
        ) : mode.kind === "move" ? (
          <section style={{ marginTop: "20px" }} aria-label="Choose a new time">
            <h2 style={{ fontSize: "18px", fontWeight: 500 }}>Choose a new time</h2>
            <p className="lead" style={{ fontSize: "14px" }}>{`Times are in your time zone (${zone}). Same consultation, same person.`}</p>
            {mode.starts === null ? (
              <p aria-busy="true">Loading times…</p>
            ) : mode.starts.length === 0 ? (
              <p>No other times are free in the next four weeks. Contact the firm to find one.</p>
            ) : (
              <div style={{ display: "grid", gap: "14px", marginTop: "12px" }}>
                {days.map(([day, starts]) => (
                  <div key={day}>
                    <b style={{ fontWeight: 500, display: "block", marginBottom: "6px" }}>{day}</b>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {starts.map((ms) => (
                        <button
                          key={ms}
                          type="button"
                          className={mode.chosen === ms ? "btn p sm" : "btn sm"}
                          aria-pressed={mode.chosen === ms}
                          onClick={() => setMode({ ...mode, chosen: ms })}
                        >
                          {slotLabel(ms, zone).split(" · ")[1]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "18px", flexWrap: "wrap" }}>
              <button type="button" className="btn p" disabled={busy || mode.chosen === null} aria-busy={busy || undefined} onClick={() => mode.chosen !== null && void move(mode.chosen)}>
                {mode.chosen === null ? "Choose a time" : `Move to ${slotLabel(mode.chosen, zone)}`}
              </button>
              <button type="button" className="btn" onClick={() => setMode({ kind: "view" })}>
                Keep the current time
              </button>
            </div>
          </section>
        ) : mode.kind === "cancel" ? (
          <section style={{ marginTop: "20px" }} aria-label="Cancel the consultation">
            <h2 style={{ fontSize: "18px", fontWeight: 500 }}>Cancel the consultation</h2>
            {booking.late ? (
              <p style={{ color: "#a15c00" }}>{`This is inside ${booking.firmName}’s notice period, so it may count as a missed consultation.`}</p>
            ) : null}
            <label htmlFor="mbR" style={{ display: "block", fontWeight: 500, margin: "10px 0 6px" }}>
              Why are you cancelling?
            </label>
            <textarea id="mbR" className="ta" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} style={{ width: "100%" }} />
            <small style={{ color: "#615d59" }}>{`Sent to ${booking.firmName}.`}</small>
            <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
              <button type="button" className="btn p" disabled={busy || reason.trim().length < 3} aria-busy={busy || undefined} onClick={() => void cancel()}>
                Cancel the consultation
              </button>
              <button type="button" className="btn" onClick={() => setMode({ kind: "view" })}>
                Keep it
              </button>
            </div>
          </section>
        ) : (
          <div style={{ display: "flex", gap: "8px", marginTop: "20px", flexWrap: "wrap" }}>
            {booking.locationKind === "video" ? (
              // The call page lets them in only from 15 minutes before the start (CRM-03).
              <a className="btn p" href={`/call/${booking.ref}?t=${encodeURIComponent(token)}`}>
                Join the video call
              </a>
            ) : null}
            <button type="button" className={booking.locationKind === "video" ? "btn" : "btn p"} onClick={() => void openMove()}>
              Change the time
            </button>
            <button type="button" className="btn" onClick={() => setMode({ kind: "cancel" })}>
              Cancel the consultation
            </button>
          </div>
        )}
      </main>
      <footer>
        <span>{booking.firmName}</span>
        <span>Powered by Casevoya</span>
      </footer>
    </div>
  );
}
