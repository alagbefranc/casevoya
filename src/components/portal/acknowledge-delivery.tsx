"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acknowledgeDecisionDelivery } from "@/modules/decisions/actions";

/** DEC-02: "I received it" on a decision document the firm delivered; records it, then redraws Home. */
export function AcknowledgeDelivery({ organizationId, deliveryId }: { organizationId: string; deliveryId: string }) {
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
          void acknowledgeDecisionDelivery({ organizationId, deliveryId }).then((result) => {
            setBusy(false);
            if ("error" in result) setError(result.error);
            else router.refresh();
          });
        }}
      >
        I received it
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  );
}
