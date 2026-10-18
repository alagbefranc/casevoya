"use client";

import { useRef, useState } from "react";
import { toast2 } from "./kit";

const MAX_BYTES = 10 * 1024 * 1024;

type Proof =
  | { kind: "empty" }
  | { kind: "uploading"; name: string }
  | { kind: "done"; name: string; size: number; locator: string };

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The Designer's licence proof card (`article.fcard`) with a real upload behind it. The file
 * goes to /api/firm/licence-proof; the stored file's locator rides in `#lproof` with the step.
 */
export function LicenceProofCard() {
  const [proof, setProof] = useState<Proof>({ kind: "empty" });
  const picker = useRef<HTMLInputElement>(null);

  const choose = () => {
    if (proof.kind !== "uploading") picker.current?.click();
  };

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast2("Use a file under 10 MB", { kind: "bad" });
      return;
    }
    const previous = proof;
    setProof({ kind: "uploading", name: file.name });
    try {
      const response = await fetch("/api/firm/licence-proof", {
        method: "POST",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      });
      const body = (await response.json().catch(() => ({}))) as { locator?: string; name?: string; size?: number; error?: string };
      if (!response.ok || !body.locator) throw new Error(body.error || "The file couldn’t be uploaded. Try again.");
      setProof({ kind: "done", name: body.name || file.name, size: body.size ?? file.size, locator: body.locator });
      toast2("Licence proof uploaded", { kind: "ok" });
    } catch (error) {
      setProof(previous);
      toast2(error instanceof Error ? error.message : "The file couldn’t be uploaded. Try again.", { kind: "bad" });
    }
  };

  const title = proof.kind === "empty" ? "No proof uploaded yet" : proof.name;
  return (
    <article
      className="fcard"
      role="button"
      tabIndex={0}
      aria-label={proof.kind === "done" ? `Licence proof ${proof.name}. Replace` : "Upload licence proof"}
      style={{ cursor: proof.kind === "uploading" ? "progress" : "pointer" }}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      }}
    >
      <div className="th">
        <svg className="ic l" aria-hidden="true">
          <use href="/assets/icons-coreui/sprite.svg#i-file" />
        </svg>
      </div>
      <div>
        <h4>{title}</h4>
        <div className="meta">
          <span>Licence proof</span>
          <span className="sep"></span>
          <span>{proof.kind === "done" ? sizeLabel(proof.size) : "You"}</span>
        </div>
      </div>
      <div className="states">
        {proof.kind === "empty" ? (
          <span className="bd unv">
            <i></i>Not uploaded
          </span>
        ) : proof.kind === "uploading" ? (
          <span className="bd unv">
            <i></i>Checking file
          </span>
        ) : (
          <span className="bd ok">
            <i></i>Uploaded
          </span>
        )}
        {proof.kind !== "uploading" ? (
          <button className="btn sm" type="button" onClick={(event) => { event.stopPropagation(); choose(); }}>
            {proof.kind === "done" ? "Replace" : "Upload"}
          </button>
        ) : null}
      </div>
      {proof.kind === "uploading" ? (
        <div className="prog">
          <i style={{ "--v": "60%" } as React.CSSProperties}></i>
        </div>
      ) : null}
      <input
        ref={picker}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <input type="hidden" id="lproof" value={proof.kind === "done" ? proof.locator : ""} readOnly />
    </article>
  );
}
