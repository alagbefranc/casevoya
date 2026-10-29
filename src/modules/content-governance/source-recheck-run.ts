import { readPageDates } from "./claim-capture";
import { fetchOfficialPage, hashPage, isDueSource, recheckBody, type DueClaim, type DueSource } from "./source-recheck";

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

/** One pass of the scheduled re-check. A failed fetch is recorded and does not change a claim. */
export async function runSourceRechecks(query: Query, limit = 5): Promise<{ checked: number; unchanged: number; changed: number; partial: number; failed: number }> {
  const due = sourcesOf(await query.due(limit));
  const summary = { checked: 0, unchanged: 0, changed: 0, partial: 0, failed: 0 };
  for (const source of due) {
    summary.checked += 1;
    const fetched = await fetchOfficialPage(source.url, query.fetch);
    const retrievedAt = new Date().toISOString();
    if (!fetched.ok) {
      await query.record({
        result: fetched.result,
        source_id: source.source_id,
        retrieved_at: retrievedAt,
        http_status: fetched.status,
        final_url: fetched.finalUrl,
        error_code: fetched.code,
      });
      summary.failed += 1;
      continue;
    }
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
    if (result === "changed") summary.changed += 1;
    else if (result === "partial") summary.partial += 1;
    else if (result === "unchanged") summary.unchanged += 1;
    else summary.failed += 1;
  }
  return summary;
}
