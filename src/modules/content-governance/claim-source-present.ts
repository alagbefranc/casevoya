/** SRC-07: the official link and the date checked, for a client. No claim text. */

export type ClaimSourceContext = {
  url: string;
  checkedOn: string | null;
  reviewPending: boolean;
  conflictUrls: string[] | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}/;

export function claimSourcesFrom(data: unknown): Map<string, ClaimSourceContext> {
  const rows = Array.isArray(data) ? data : [];
  const out = new Map<string, ClaimSourceContext>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.request_id !== "string" || typeof row.url !== "string") continue;
    const urls = Array.isArray(row.conflict_urls) ? row.conflict_urls.filter((url): url is string => typeof url === "string") : null;
    out.set(row.request_id, {
      url: row.url,
      checkedOn: typeof row.checked_on === "string" && ISO.test(row.checked_on) ? row.checked_on.slice(0, 10) : null,
      reviewPending: row.review_pending === true,
      conflictUrls: urls && urls.length > 0 ? urls : null,
    });
  }
  return out;
}

/** Words next to a client request that cites a claim. */
export function claimSourceCopy(source: ClaimSourceContext, checkedLabel: string | null): { pending: string | null; checked: string } {
  return {
    pending: source.reviewPending ? "Your consultant is reviewing a difference between official sources." : null,
    checked: checkedLabel ? `Checked ${checkedLabel}` : "Checked date not recorded",
  };
}
