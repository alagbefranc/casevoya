"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Starts a passkey sign-in. Supabase issues an aal1 session whose amr method is `passkey`. */
export function PasskeyButton({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPasskey();
    if (signInError) {
      setError("That passkey was not accepted.");
      setPending(false);
      return;
    }
    window.location.assign(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="h-11 rounded-control border border-line-strong bg-surface px-5 font-semibold"
      >
        {pending ? "Waiting for the passkey…" : "Use a passkey"}
      </button>
    </div>
  );
}
