"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACTIVITY_BEAT_SECONDS,
  countdown,
  IDLE_STORAGE_KEY,
  idlePhase,
  idleSignInLocation,
  readActivityState,
  type ActivityState,
} from "@/modules/security/idle";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
const TICK_MS = 1000;

function readShared(): number | null {
  try {
    const value = Number(window.localStorage.getItem(IDLE_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeShared(at: number) {
  try {
    window.localStorage.setItem(IDLE_STORAGE_KEY, String(at));
  } catch {
    // Storage can be unavailable; this tab keeps its own time.
  }
}

async function report(active: boolean): Promise<ActivityState> {
  try {
    const response = await fetch("/api/session/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
      credentials: "same-origin",
      cache: "no-store",
    });
    return readActivityState(await response.json().catch(() => null));
  } catch {
    // Offline: the server still ends the session on its own once the time has passed.
    return { state: "none" };
  }
}

function leave() {
  window.location.assign(idleSignInLocation(`${window.location.pathname}${window.location.search}`));
}

/**
 * SEC-01: signs an idle staff member out after the firm's idle time, with a warning two minutes
 * before. Live only: the Designer has no such dialog, so it is the Designer's `.dlg` with its
 * `.dh` / `.db` / `.df` parts and `.btn` buttons. Activity (a click, a key, scrolling) in any open
 * Sheet tab counts; it reaches the server at most once a minute, where
 * public.record_staff_activity enforces the time even if this timer never runs.
 */
export function IdleGuard() {
  const [timeout, setTimeoutMinutes] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const local = useRef<number>(0);
  const sent = useRef<number>(0);
  const busy = useRef(false);

  // The firm's idle time, from the server. A portal-only person or a failed read keeps no timer.
  useEffect(() => {
    let live = true;
    local.current = Date.now();
    void report(false).then((state) => {
      if (!live) return;
      if (state.state === "expired") return leave();
      if (state.state !== "active") return;
      const at = Date.now() - state.idleSeconds * 1000;
      local.current = Math.max(local.current, at);
      sent.current = Date.now();
      setTimeoutMinutes(state.timeoutMinutes);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (timeout === null) return;
    const minutes = timeout;
    const mark = () => {
      // While the warning is open, only "Stay signed in" counts, so a stray scroll can't hide it.
      if (dialog.current?.open) return;
      const now = Date.now();
      local.current = now;
      writeShared(now);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, mark, { passive: true, capture: true });

    const tick = window.setInterval(() => {
      const now = Date.now();
      const last = Math.max(local.current, readShared() ?? 0);
      const phase = idlePhase(last, now, minutes);
      if (phase.phase === "expired") {
        window.clearInterval(tick);
        // The server ends the session; the route clears this browser's copy, then sign in again.
        void report(false).finally(leave);
        return;
      }
      if (phase.phase === "warn") {
        setLeft(phase.secondsLeft);
        if (dialog.current && !dialog.current.open) dialog.current.showModal();
        return;
      }
      if (dialog.current?.open) dialog.current.close();
      setLeft(null);
      // Working: tell the server, at most once a minute.
      if (!busy.current && last > sent.current && now - sent.current >= ACTIVITY_BEAT_SECONDS * 1000) {
        busy.current = true;
        sent.current = now;
        void report(true)
          .then((state) => {
            if (state.state === "expired" || state.state === "ended") leave();
          })
          .finally(() => {
            busy.current = false;
          });
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(tick);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, mark, { capture: true });
    };
  }, [timeout]);

  if (timeout === null) return null;

  const stay = () => {
    const now = Date.now();
    local.current = now;
    writeShared(now);
    sent.current = now;
    dialog.current?.close();
    setLeft(null);
    void report(true).then((state) => {
      if (state.state === "expired" || state.state === "ended") leave();
    });
  };

  return (
    <dialog className={"dlg"} id={"dIdle"} ref={dialog} aria-labelledby={"dIdleH"} onCancel={(event) => {
      event.preventDefault();
      stay();
    }}>
      <div className={"dh"}>
        <h2 id={"dIdleH"}>{"Still there?"}</h2>
      </div>
      <div className={"db"}>
        <p>
          {`You’ve been inactive for a while. To keep client records safe, Casevoya signs you out after ${timeout} minutes without activity.`}
        </p>
        <p role={"timer"} aria-live={"polite"}>
          {`Signing you out in ${countdown(left ?? 0)}.`}
        </p>
      </div>
      <div className={"df"}>
        <form method={"post"} action={"/sign-out"} data-live={"1"}>
          <button className={"btn"} type={"submit"}>
            {"Sign out now"}
          </button>
        </form>
        <button className={"btn p"} type={"button"} onClick={stay}>
          {"Stay signed in"}
        </button>
      </div>
    </dialog>
  );
}
