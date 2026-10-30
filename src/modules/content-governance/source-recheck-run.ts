import { readPageDates } from "./claim-capture";
import { fetchOfficialPage, hashPage, isDueSource, movedOffHost, recheckBody, type DueClaim, type DueSource } from "./source-recheck";

type Query = {
  due: (limit: number) => Promise<unknown>;
  record: (payload: unknown) => Promise<unknown>;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

function claimsOf(value: unknown): DueClaim[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.definition_id !== "string") return [];
    return [{
      definition_id: row.definition_id,
      key: typeof row.key === "string" ? row.key : "",
      category: typeof row.category === "string" ? row.category : null,
      claim: typeof row.claim === "string" ? row.claim : null,
      value: typeof row.value === "string" ? row.value : null,
      section: typeof row.section === "string" ? row.section : null,
      source_url: typeof row.source_url === "string" ? row.source_url : null,
      excerpt: typeof row.excerpt === "string" ? row.excerpt : null,
    }];
  });
}

function sourcesOf(data: unknown): DueSource[] {
  const list = Array.isArray(data) ? data : [];
  return list.flatMap((item) => {
    if (!isDueSource(item)) return [];
    return [{
      source_id: item.source_id,
      url: item.url,
      content_hash: typeof item.content_hash === "string" ? item.content_hash : null,
      claims: claimsOf(item.claims),
    }];
  });
}

type Outcome = "unchanged" | "changed" | "partial" | "failed";

/**
 * A failure is recorded against the source's own URL (the page it was sent to is never recorded),
 * so the database takes it and the source leaves the front of the queue.
 */
function failure(source: DueSource, result: "failed" | "blocked", code: string, status: number | null) {
  return {
    result,
    source_id: source.source_id,
    retrieved_at: new Date().toISOString(),
    http_status: status,
    final_url: source.url.split("#")[0],
    error_code: code,
  };
}

async function recheckOne(query: Query, source: DueSource): Promise<Outcome> {
  const fetched = await fetchOfficialPage(source.url, query.fetch);
  if (!fetched.ok) {
    await query.record(failure(source, fetched.result, fetched.code, fetched.status));
    return "failed";
  }
  // The database records a page only on its own host; a move to another host is recorded as blocked.
  if (movedOffHost(source.url, fetched.finalUrl)) {
    await query.record(failure(source, "blocked", "moved_off_host", fetched.status));
    return "failed";
  }
  const retrievedAt = new Date().toISOString();
  const hashed = hashPage(fetched.bytes, fetched.contentType);
  const body = recheckBody(source, {
    sha256: hashed.sha256,
    html: hashed.html,
    retrievedAt,
    httpStatus: fetched.status,
    finalUrl: fetched.finalUrl,
    dates: hashed.html ? readPageDates(hashed.html) : { modifiedOn: null, lastAmendedOn: null, currentTo: null },
  });
  const recorded = await query.record(body);
  const result = recorded && typeof recorded === "object" && "result" in recorded ? String((recorded as { result: unknown }).result) : body.result;
  if (result === "changed" || result === "partial" || result === "unchanged") return result;
  return "failed";
}

/**
 * One pass of the scheduled re-check. A failed fetch is recorded and does not change a claim. One
 * source that fails (or that the database refuses) does not stop the others.
 */
export async function runSourceRechecks(query: Query, limit = 5): Promise<{ checked: number; unchanged: number; changed: number; partial: number; failed: number }> {
  const due = sourcesOf(await query.due(limit));
  const summary = { checked: 0, unchanged: 0, changed: 0, partial: 0, failed: 0 };
  for (const source of due) {
    summary.checked += 1;
    try {
      summary[await recheckOne(query, source)] += 1;
    } catch {
      summary.failed += 1;
      try {
        await query.record(failure(source, "failed", "record_refused", null));
      } catch {
        // Recorded on the next pass.
      }
    }
  }
  return summary;
}
