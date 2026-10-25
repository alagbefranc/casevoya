"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { stepUpHref } from "@/lib/auth/mfa-step";

/**
 * SEC-06: "Download" on a delivered privacy response. The download is recorded, then the file opens.
 * It needs the person's two-step sign-in (SEC-01): without a recent check they confirm it on /mfa and
 * come back here; without two-step at all they're pointed to Account to turn it on.
 */
export function PrivacyDownload({ organizationId, deliveryId }: { organizationId: string; deliveryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTwoStep, setNeedsTwoStep] = useState(false);
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
          setNeedsTwoStep(false);
          void fetch(`/api/portal/privacy-responses/${encodeURIComponent(deliveryId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId }),
          })
            .then(async (response) => {
              const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string; twoStep?: string };
              if (body.twoStep === "check") {
                window.location.assign(stepUpHref(`${window.location.pathname}${window.location.search}`, "privacy_download"));
                return;
              }
              setBusy(false);
              if (body.twoStep === "off") setNeedsTwoStep(true);
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
      {error ? (
        <small role="alert">
          {error}
          {needsTwoStep ? (
            <>
              {" "}
              <a href="/portal/account">Go to Account</a>
            </>
          ) : null}
        </small>
      ) : null}
    </span>
  );
}
