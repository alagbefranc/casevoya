"use client";

/**
 * Live only (DOC-05): with "Read documents on upload" on, the matter's Documents tab asks Vo to
 * read its new uploads, one at a time, as the staff member who opened it. Every check of "Read with
 * Vo" still applies (Vo and category switches, sample mode, rate limits, a fresh second factor); a
 * reading Vo can't do is skipped quietly and not retried in this browser session. Proposals wait
 * for a person, as always.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { readDocumentWithVo } from "@/modules/vo/vo-doc-actions";

const TRIED = "cv-vo-auto-read";

function tried(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(TRIED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function remember(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(TRIED, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Without storage a failed reading may be tried again on the next visit; the database refuses it the same way.
  }
}

export type AutoReadState = { reading: number; read: number; stepUp?: boolean; noConsent?: string; skipped?: string[] };

/** "Skipped: Passport, Proof of funds." (#272), or "" when the skipped uploads have no names. */
function skippedList(skipped: readonly string[] | undefined): string {
  return skipped?.length ? ` Skipped: ${skipped.join(", ")}.` : "";
}

/** The Documents tab's line while and after Vo reads new uploads. */
export function autoReadMessage(state: AutoReadState): string {
  if (state.stepUp) return "Vo reads new uploads after you confirm with your authenticator. Use Read with Vo on a document once, then come back.";
  if (state.reading) return `Vo is reading ${state.reading} new upload${state.reading === 1 ? "" : "s"}. Its proposals appear here for you to confirm.`;
  if (state.read) {
    return `Vo read ${state.read} new upload${state.read === 1 ? "" : "s"}. Nothing changes until you accept a proposal.${state.noConsent ? ` It skipped others: ${state.noConsent}${skippedList(state.skipped)}` : ""}`;
  }
  if (state.noConsent) return `${state.noConsent}${skippedList(state.skipped)}`;
  return "Vo couldn’t read the new uploads. Use Read with Vo on a document to see why.";
}

export function VoAutoRead({ data }: { data: { organizationId: string; versionIds: string[]; names?: Record<string, string> } }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<AutoReadState | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const seen = tried();
    const queue = data.versionIds.filter((id) => !seen.has(id));
    if (!queue.length) return;
    void (async () => {
      let read = 0;
      // Decision #263-3: a client who hasn't agreed to AI help is said plainly, not as a failure.
      let noConsent: string | undefined;
      // #272: which uploads were skipped for consent, by their document names.
      const skipped: string[] = [];
      for (const [at, versionId] of queue.entries()) {
        setState({ reading: queue.length - at, read });
        const result = await readDocumentWithVo({ organizationId: data.organizationId, versionId }).catch(() => null);
        // A stale second factor: nothing is marked tried; the next visit after confirming reads them.
        if (result && "error" in result && needsStepUp(result.error)) {
          setState({ reading: 0, read, stepUp: true });
          if (read) router.refresh();
          return;
        }
        seen.add(versionId);
        remember(seen);
        if (result && "ok" in result && result.ok && !("abstained" in result)) read += 1;
        if (result && "code" in result && result.code === "client_ai_off") {
          noConsent = result.error;
          const name = data.names?.[versionId];
          if (name && !skipped.includes(name)) skipped.push(name);
        }
      }
      setState({ reading: 0, read, noConsent, skipped });
      if (read) router.refresh();
    })();
  }, [data, router]);

  if (!state) return null;
  return (
    <p className={"lock"} role={"status"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
      {autoReadMessage(state)}
    </p>
  );
}
