"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dismissPortalNotice } from "@/modules/portal/actions";

/** ORG-06: "Got it" on a portal notice: hides it for this person, then redraws Home. */
export function DismissNotice({ organizationId, noticeId }: { organizationId: string; noticeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span style={{ display: "grid", gap: 4, justifyItems: "end" }}>
      <button
        className="btn sm"
        type="button"
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void dismissPortalNotice({ organizationId, noticeId }).then((result) => {
            setBusy(false);
            if ("error" in result) setError(result.error);
            else router.refresh();
          });
        }}
      >
        Got it
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  );
}
