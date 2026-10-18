"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { BookPage, type BookPageData } from "@/components/sheet/designer/book";
import { COMMON_ZONES, locationLabel, longWhen, safeZone, slotLabel } from "@/modules/scheduling/format";
import type { BookingSummary, PublicEvent } from "@/modules/scheduling/public-api";
import { decodeStarts, isTimeZone } from "@/modules/scheduling/slots";

const PAGE = 12;
const RANGE_DAYS = 28;
const DAY = 86_400_000;

function browserZone(fallback: string): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : fallback;
  } catch {
    return fallback;
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
}

/** Live data for the Designer's booking page, before the visitor's zone is known (server render). */
export function bookPageBase(event: PublicEvent, zone: string): Omit<BookPageData, "slots" | "submit" | "live"> {
  return {
    header: { name: event.firmName },
    title: event.title,
    lead: `${event.durationMin} minutes with ${event.firmName}. Times are shown in your timezone (${zone}).`,
    description: event.description,
    fee: null,
    meet: [locationLabel(event.locationKind, event.locationDetail)],
    note: "This consultation is free. You’ll get a confirmation email with the time in your timezone.",
    footer: { firm: event.firmName, privacyHref: null },
  };
}

function Confirmation({ booking, ics, email, onAgain }: { booking: BookingSummary; ics: string | null; email: string; onAgain: () => void }) {
  const download = () => {
    if (!ics) return;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "consultation.ics";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const start = Date.parse(booking.startsAt);
  const where = booking.locationKind === "meeting_link" && booking.locationDetail ? "Online meeting" : locationLabel(booking.locationKind, booking.locationDetail);
  return (
    <div className={"card"} role={"status"} aria-live={"polite"}>
      <b style={{ fontWeight: "500" }}>{"You’re booked"}</b>
      <p style={{ margin: "0" }}>{`${booking.title}${booking.hostName ? ` with ${booking.hostName}` : ""}`}</p>
      <p className={"num"} style={{ margin: "0" }}>
        {longWhen(start, booking.timeZone)}
      </p>
      {booking.timeZone !== booking.hostTimeZone ? (
        <small style={{ color: "#615d59" }}>{`For ${booking.firmName}: ${longWhen(start, booking.hostTimeZone)}`}</small>
      ) : null}
      <small style={{ color: "#615d59" }}>{where}</small>
      {booking.locationKind === "meeting_link" && booking.locationDetail ? (
        <a href={booking.locationDetail} rel={"noopener noreferrer"} target={"_blank"} style={{ color: "var(--blue)" }}>
          {"Meeting link"}
        </a>
      ) : null}
      <small style={{ color: "#615d59" }}>{`A confirmation is on its way to ${email}.`}</small>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {ics ? (
          <button className={"btn s sm"} type={"button"} onClick={download}>
            {"Add to calendar"}
          </button>
        ) : null}
        <button className={"btn sm"} type={"button"} onClick={onAgain}>
          {"Book another time"}
        </button>
      </div>
    </div>
  );
}

const noSubscribe = () => () => {};

async function fetchStarts(base: string): Promise<{ starts: number[]; error: string | null }> {
  try {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + RANGE_DAYS * DAY).toISOString();
    const response = await fetch(`${base}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" });
    const body = (await response.json()) as { starts?: unknown; message?: string };
    if (!response.ok) return { starts: [], error: body.message || "Times couldn’t be loaded." };
    return { starts: decodeStarts(body.starts), error: null };
  } catch {
    return { starts: [], error: "Times couldn’t be loaded. Check your connection and reload." };
  }
}

export function BookLive({ event }: { event: PublicEvent }) {
  // The visitor's own zone (null while rendering on the server); they can change it below
  // (PRD: confirm the timezone).
  const detected = useSyncExternalStore(noSubscribe, () => browserZone(event.firmTimeZone), () => null);
  const [chosen, setZone] = useState<string | null>(null);
  const zone = chosen ?? detected ?? event.firmTimeZone;
  const [starts, setStarts] = useState<number[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ booking: BookingSummary; ics: string | null; email: string } | null>(null);
  const opened = useRef<number>(0);
  const key = useRef<string>("");

  const base = `/api/book/${encodeURIComponent(event.firmSlug)}/${encodeURIComponent(event.slug)}`;

  // Slots load on mount and again whenever `reload` changes (after a taken slot or a new booking).
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    opened.current = Date.now();
    fetchStarts(base).then((result) => {
      if (!current) return;
      setStarts(result.starts);
      setOffset(0);
      if (result.error) setError(result.error);
    });
    return () => {
      current = false;
    };
  }, [base, reload]);

  const zones = useMemo(() => [...new Set([zone, event.firmTimeZone, ...COMMON_ZONES])].filter(isTimeZone), [zone, event.firmTimeZone]);

  const submit = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    if (busy) return;
    const data = new FormData(form.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    if (picked == null) return setError("Choose a time.");
    if (!name) return setError("Enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email address.");
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`${base}/hold`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start: new Date(picked).toISOString(),
          name,
          email,
          phone: String(data.get("phone") ?? "").trim() || null,
          tz: safeZone(zone),
          idempotencyKey: key.current,
          website: String(data.get("website") ?? ""),
          elapsedMs: Math.max(0, Date.now() - opened.current),
        }),
      });
      const body = (await response.json()) as { booking?: BookingSummary; ics?: string | null; message?: string };
      if (response.status === 201 && body.booking) {
        setDone({ booking: body.booking, ics: body.ics ?? null, email });
        return;
      }
      setError(body.message || "The booking couldn’t be made. Try again.");
      if (response.status === 409) {
        setPicked(null);
        setStarts(null);
        setReload((n) => n + 1);
      }
    } catch {
      setError("The booking couldn’t be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const visible = (starts ?? []).slice(offset, offset + PAGE);
  const data: BookPageData = {
    ...bookPageBase(event, zone),
    slots: visible.map((start) => ({ label: slotLabel(start, zone), value: String(start), pressed: start === picked })),
    submit: { label: busy ? "Booking…" : "Book this time", busy },
    live: {
      zone: { value: zone, options: zones },
      phone: event.locationKind === "phone",
      more: starts != null && (offset + PAGE < starts.length || offset > 0),
      empty: starts == null ? "Loading times…" : starts.length === 0 ? "No times are open in the next four weeks. Please check again later." : null,
      error,
      done: done ? (
        <Confirmation
          booking={done.booking}
          ics={done.ics}
          email={done.email}
          onAgain={() => {
            setDone(null);
            setPicked(null);
            setStarts(null);
            setReload((n) => n + 1);
          }}
        />
      ) : null,
      onSlot: (value) => {
        setPicked(Number(value));
        key.current = newKey();
        setError(null);
      },
      onMore: () => setOffset((current) => (current + PAGE < (starts?.length ?? 0) ? current + PAGE : 0)),
      onZone: (next) => setZone(safeZone(next, zone)),
      onSubmit: submit,
    },
  };
  return <BookPage data={data} />;
}
