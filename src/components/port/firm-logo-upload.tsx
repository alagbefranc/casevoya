"use client";

import { useRef, useState } from "react";
import { toast2 } from "./kit";

const MAX_BYTES = 2 * 1024 * 1024;

export type FirmLogo = { locator: string; previewUrl: string };

/**
 * The Designer's Branding logo block (`div.logo-up`) with a real upload behind it. The file goes
 * to /api/firm/logo; the stored file's locator rides in `#logo` with the step's fields.
 */
export function FirmLogoUpload({
  initials,
  logo,
  onChange,
}: {
  initials: string;
  logo: FirmLogo | null;
  onChange: (logo: FirmLogo) => void;
}) {
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast2("Use a logo under 2 MB", { kind: "bad" });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/firm/logo", {
        method: "POST",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      const body = (await response.json().catch(() => ({}))) as { locator?: string; previewUrl?: string | null; error?: string };
      if (!response.ok || !body.locator) throw new Error(body.error || "The logo couldn’t be uploaded. Try again.");
      onChange({ locator: body.locator, previewUrl: body.previewUrl || URL.createObjectURL(file) });
      toast2("Logo uploaded", { kind: "ok", sub: "Saved with this step when you continue." });
    } catch (error) {
      toast2(error instanceof Error ? error.message : "The logo couldn’t be uploaded. Try again.", { kind: "bad" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="logo-up">
      {logo ? (
        <img className="ph" src={logo.previewUrl} alt="Firm logo" width={64} height={64} />
      ) : (
        <span className="ph">{initials || "Logo"}</span>
      )}
      <div>
        <b style={{ "fontWeight": "500" }}>Logo</b>
        <small style={{ "display": "block", "color": "var(--t2)", "fontSize": "13px" }}>Square, at least 256 px. PNG or JPG.</small>
        <button
          className="btn sm"
          type="button"
          style={{ "marginTop": "8px", ...(busy ? { "cursor": "progress" } : {}) }}
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => picker.current?.click()}
        >
          <svg className="ic s" aria-hidden="true">
            <use href="/assets/icons-coreui/sprite.svg#i-upload" />
          </svg>
          Upload logo
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <input type="hidden" id="logo" value={logo?.locator ?? ""} readOnly />
    </div>
  );
}
