"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** SEC-06: "Download" on a delivered privacy response. The download is recorded, then the file opens. */
export function PrivacyDownload({ organizationId, deliveryId }: { organizationId: string; deliveryId: string }) {
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
          setError(null);
          void fetch(`/api/portal/privacy-responses/${encodeURIComponent(deliveryId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId }),
          })
            .then(async (response) => {
              const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
              setBusy(false);
              if (!response.ok || !body.url) {
                setError(body.error ?? "That download isn’t available.");
                return;
              }
              window.location.assign(body.url);
              router.refresh();
            })
            .catch(() => {
              setBusy(false);
              setError("That download isn’t available right now.");
            });
        }}
      >
        Download
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  );
}
