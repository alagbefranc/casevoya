"use client";

import { useState } from "react";
import { enrollTotp, verifyTotp, type EnrollState } from "./actions";

export function EnrollPanel({ next }: { next: string }) {
  const [state, setState] = useState<EnrollState>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    const result = await enrollTotp();
    setState(result);
    setPending(false);
  }

  if (state && "secret" in state) {
    return (
      <form action={verifyTotp} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="factorId" value={state.factorId} />
        <p>Add this key to an authenticator app, then enter the 6-digit code.</p>
        {/* The secret is shown once so the user can type it. Do not log it. */}
        <p className="break-all rounded-control bg-surface-muted px-3 py-2 font-mono text-sm">{state.secret}</p>
        {/* Data-URL QR from the enroll response. next/image does not optimize it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.qr} alt="Authenticator setup code" className="h-40 w-40 bg-surface" />
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Authenticator code</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            pattern="[0-9]{6}"
            className="h-11 rounded-control border border-line-strong bg-surface px-3"
          />
        </label>
        <button type="submit" className="h-11 rounded-control bg-action px-5 font-semibold text-on-action">
          Confirm code
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {state && "error" in state ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="h-11 rounded-control bg-action px-5 font-semibold text-on-action disabled:opacity-60"
      >
        {pending ? "Starting…" : "Set up authenticator app"}
      </button>
    </div>
  );
}
