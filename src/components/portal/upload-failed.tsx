import type { UploadFailure } from "@/modules/portal/upload-failure";

/**
 * DES-04: a portal upload that didn't go through, laid out as the Designer's failed send on
 * design/portal/pages/portal-upload.html (use-portal.ts armUpload, `?fail`): the heading, what
 * happened, then the retry and "Ask your firm". Live-only: the retry is a button that picks another
 * file or sends the same one again (the demo's was a link back to step 1).
 */
export function UploadFailed({
  failure,
  onRetry,
  busy = false,
}: {
  failure: UploadFailure;
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <div role="alert" data-failure={failure.kind}>
      <b style={{ fontWeight: 500, fontSize: 18 }}>{failure.title}</b>
      <p className="lbl" style={{ marginTop: 4 }}>{failure.copy}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn sm p" type="button" onClick={onRetry} disabled={busy}>
          {failure.retry === "choose" ? "Choose another file" : "Try again"}
        </button>
        <a className="btn sm" href="/portal/messages">Ask your firm</a>
      </div>
    </div>
  );
}
