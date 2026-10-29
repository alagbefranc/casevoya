"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { goStepUp } from "@/lib/auth/step-up-resume";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { recordSourceConflict, resolveSourceConflict } from "@/modules/content-governance/pack-actions";

export type ConflictEvidence = { id: string; url: string; excerpt: string };
export type OpenConflict = {
  id: string;
  leftUrl: string;
  rightUrl: string;
  reason: string;
  resolution: string | null;
  status: string;
};

/** SRC-08: record that two stored captures disagree. The excerpts are the ones already stored. */
export function SourceConflictPanel({
  organizationId,
  definitionId,
  evidence,
  conflict,
}: {
  organizationId: string;
  definitionId: string;
  evidence: ConflictEvidence[];
  conflict: OpenConflict | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const back = `/sheet/templates?tab=rule&claim=${definitionId}`;

  const record = async (form: FormData) => {
    setPending(true);
    const result = await recordSourceConflict({
      organizationId,
      definitionId,
      leftEvidenceId: String(form.get("left") ?? ""),
      rightEvidenceId: String(form.get("right") ?? ""),
      reason: String(form.get("reason") ?? ""),
    });
    setPending(false);
    if ("error" in result) {
      if (/authenticator|step-up/i.test(result.error)) {
        goStepUp(stepUpHref(back, "source_conflict"));
        return;
      }
      setMessage(result.error);
      return;
    }
    router.refresh();
  };

  const resolve = async (form: FormData) => {
    if (!conflict) return;
    setPending(true);
    const result = await resolveSourceConflict({ organizationId, conflictId: conflict.id, note: String(form.get("note") ?? "") });
    setPending(false);
    if ("error" in result) {
      if (/authenticator|step-up/i.test(result.error)) {
        goStepUp(stepUpHref(back, "source_conflict"));
        return;
      }
      setMessage(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <section className="panel" id="source-conflict">
      <h2>When two sources disagree</h2>
      <div className="fp-pad">
        {conflict?.status === "open" ? (
          <>
            <p role="status">This claim is blocked. Vo will not cite it, and a new request cannot use it, until this review is closed.</p>
            <p><a href={conflict.leftUrl}>First official page</a></p>
            <p><a href={conflict.rightUrl}>Second official page</a></p>
            <p>{conflict.reason}</p>
            <form action={(form) => void resolve(form)}>
              <label className="fld">How this was resolved
                <textarea className="inp" name="note" required minLength={3} maxLength={1000} />
              </label>
              {message ? <p role="alert">{message}</p> : null}
              <button className="btn sm" type="submit" disabled={pending}>Close the review</button>
            </form>
          </>
        ) : (
          <form action={(form) => void record(form)}>
            <p className="fp-note" style={{ marginTop: 0 }}>
              Choose two captures already stored, on different official pages, whose stored excerpts disagree. This does not type a new rule.
            </p>
            {evidence.length < 2 ? <p>A second stored capture is needed before a conflict can be recorded.</p> : null}
            <label className="fld">First capture
              <select className="inp" name="left">{evidence.map((row) => <option key={row.id} value={row.id}>{row.url}</option>)}</select>
            </label>
            <label className="fld">Second capture
              <select className="inp" name="right">{evidence.map((row) => <option key={row.id} value={row.id}>{row.url}</option>)}</select>
            </label>
            <label className="fld">Why they disagree
              <textarea className="inp" name="reason" required minLength={3} maxLength={500} />
            </label>
            {message ? <p role="alert">{message}</p> : null}
            <button className="btn sm" type="submit" disabled={pending || evidence.length < 2}>Record the conflict</button>
          </form>
        )}
      </div>
    </section>
  );
}
