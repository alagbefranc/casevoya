/**
 * SRC-04: read one official page again, hash it, and take the section text the page prints.
 * Nothing is filled in. A section that is not on the page is unreadable, and the claim is not rewritten.
 * The capture script uses the same hash (claim-capture.ts).
 */
import { createHash } from "node:crypto";
import { federalHost, hashableBytes, lawSectionText, textOf, type PageDates } from "./claim-capture";

export type DueClaim = {
  definition_id: string;
  key: string;
  category: string | null;
  claim: string | null;
  value: string | null;
  section: string | null;
  source_url: string | null;
  excerpt: string | null;
};

export type DueSource = {
  source_id: string;
  url: string;
  content_hash: string | null;
  claims: DueClaim[];
};

const MAX_BYTES = 1_500_000;
const MAX_HOPS = 4;

export function anchorOf(url: string | null): string | null {
  if (!url || !url.includes("#")) return null;
  const anchor = url.split("#")[1]?.trim();
  return anchor ? decodeURIComponent(anchor) : null;
}

function elementText(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = html.search(new RegExp(`id=["']${escaped}["']`, "i"));
  if (at < 0) return null;
  const start = html.lastIndexOf("<", at);
  const rest = html.slice(at + 1);
  const next = rest.search(/<h[1-6]\b/i);
  const chunk = html.slice(start < 0 ? at : start, next < 0 ? Math.min(html.length, at + 8000) : at + 1 + next);
  const text = textOf(chunk);
  return text.length >= 3 ? text.slice(0, 2000) : null;
}

/** The section as the page prints it, or null when it cannot be found. */
export function extractSection(html: string, claim: DueClaim): string | null {
  const anchor = anchorOf(claim.source_url);
  const sectionId = [anchor, claim.section].find((value) => value && /^s-[0-9]+(\.[0-9]+)?$/.test(value));
  if (sectionId) {
    const law = lawSectionText(html, sectionId);
    if (law) return law.slice(0, 2000);
  }
  if (anchor) return elementText(html, anchor);
  return null;
}

/** Keep a stored short value only when the new section still prints it. */
export function valueStillPrinted(previous: string | null, extracted: string): string | null {
  if (!previous) return null;
  return extracted.includes(previous) ? previous : null;
}

export type RecheckBody =
  | { result: "unchanged" | "failed" | "blocked"; source_id: string; sha256?: string; retrieved_at: string; http_status: number | null; final_url: string; error_code?: string }
  | {
      result: "changed" | "partial";
      source_id: string;
      sha256: string;
      retrieved_at: string;
      http_status: number | null;
      final_url: string;
      modified_on: string | null;
      last_amended_on: string | null;
      current_to: string | null;
      error_code?: string;
      claims?: { definition_id: string; claim: string; value: string | null; section: string; excerpt: string | null; source_url: string | null }[];
    };

/**
 * What the database should record for one fetched page. The hash is of the bytes the capture
 * script would hash. A matching hash is unchanged. A different hash with every section read is
 * changed. A different hash with a missing section is partial, and no claim text is sent.
 */
export function recheckBody(source: DueSource, fetched: { sha256: string; html: string | null; retrievedAt: string; httpStatus: number | null; finalUrl: string; dates: PageDates }): RecheckBody {
  const base = {
    source_id: source.source_id,
    sha256: fetched.sha256,
    retrieved_at: fetched.retrievedAt,
    http_status: fetched.httpStatus,
    final_url: fetched.finalUrl,
  };
  if (source.content_hash && source.content_hash === fetched.sha256) {
    return { ...base, result: "unchanged" };
  }
  const dates = {
    modified_on: fetched.dates.modifiedOn,
    last_amended_on: fetched.dates.lastAmendedOn,
    current_to: fetched.dates.currentTo,
  };
  if (!fetched.html) {
    return { ...base, result: "partial", ...dates, error_code: "section_not_read" };
  }
  const claims = [];
  for (const claim of source.claims) {
    const text = extractSection(fetched.html, claim);
    const section = claim.section ?? anchorOf(claim.source_url);
    if (!text || !section) return { ...base, result: "partial", ...dates, error_code: "section_not_read" };
    claims.push({
      definition_id: claim.definition_id,
      claim: text,
      value: valueStillPrinted(claim.value, text),
      section,
      excerpt: text.slice(0, 600),
      source_url: claim.source_url,
    });
  }
  if (claims.length === 0) return { ...base, result: "partial", ...dates, error_code: "section_not_read" };
  return { ...base, result: "changed", ...dates, claims };
}

export function hashPage(bytes: Uint8Array, contentType: string | null): { sha256: string; html: string | null } {
  const hashed = hashableBytes(bytes, contentType);
  const sha256 = createHash("sha256").update(hashed.bytes).digest("hex");
  const html = contentType?.toLowerCase().includes("html") || hashed.basis === "html-without-injected-scripts"
    ? new TextDecoder("utf-8").decode(hashed.bytes)
    : null;
  return { sha256, html };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Follow redirects only while every hop stays on an official federal host. */
export async function fetchOfficialPage(url: string, fetchImpl: FetchLike = fetch): Promise<
  | { ok: true; status: number; finalUrl: string; contentType: string | null; bytes: Uint8Array }
  | { ok: false; result: "failed" | "blocked"; code: string; status: number | null; finalUrl: string }
> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    if (!federalHost(current)) return { ok: false, result: "blocked", code: "off_allowlist", status: null, finalUrl: current };
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(25_000),
        headers: { accept: "text/html,application/pdf", "user-agent": "Casevoya source re-check" },
      });
    } catch {
      return { ok: false, result: "failed", code: "fetch_failed", status: null, finalUrl: current };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, result: "failed", code: "redirect_without_location", status: response.status, finalUrl: current };
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status !== 200) return { ok: false, result: "failed", code: `http_${response.status}`, status: response.status, finalUrl: current };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return { ok: false, result: "failed", code: "too_large", status: response.status, finalUrl: current };
    return { ok: true, status: response.status, finalUrl: current, contentType: response.headers.get("content-type"), bytes };
  }
  return { ok: false, result: "failed", code: "too_many_redirects", status: null, finalUrl: current };
}

export function isDueSource(value: unknown): value is DueSource {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.source_id === "string" && typeof row.url === "string" && Array.isArray(row.claims);
}
