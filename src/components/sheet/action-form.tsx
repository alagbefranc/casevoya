"use client";

import { useState, type ReactNode } from "react";

export function ActionForm({
  action,
  label,
  children,
}: {
  action: (form: FormData) => Promise<{ error?: string } | { version?: number | null } | void>;
  label: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <form
      data-live="1"
      onSubmit={async (event) => {
        event.preventDefault();
        setDone(false);
        const result = await action(new FormData(event.currentTarget));
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
        setError(null);
        setDone(true);
      }}
    >
      {children}
      <button className="btn p sm" type="submit">{label}</button>
      {error ? <p role="alert">{error}</p> : null}
      {done ? <p role="status">Saved.</p> : null}
    </form>
  );
}
