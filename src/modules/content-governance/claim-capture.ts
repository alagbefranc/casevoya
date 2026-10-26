/**
 * SRC-01 / SRC-02: reading an official page for a claim, without inventing anything. Pure and
 * import-free, so the capture script (scripts/ops/capture-official-claims.mjs) runs the same code
 * as the server. A date the page doesn't print stays null (Unknown); a section that isn't found
 * returns null and nothing is captured for it.
 *
 * Dates read, exactly as the page shows them:
 *   - "Date modified": `<time property="dateModified">` (Justice Laws and the older canada.ca
 *     footer), or `<gcds-date-modified>YYYY-MM-DD</gcds-date-modified>` (current canada.ca pages,
 *     shown to readers as "Date modified");
 *   - Justice Laws "… current to YYYY-MM-DD and last amended on YYYY-MM-DD".
 * A page's hidden metadata (for example `dcterms:issued`) is not shown to readers and isn't used.
 *
 * Page hash: `hashableBytes` removes the script a CDN injects into every response (canada.ca's
 * Akamai mPulse/boomerang loader carries per-request `ak.rid`, `ak.t` and `ak.ak` values), so two
 * fetches of an unchanged page hash the same. Nothing else is removed: an HTML page without such a
 * script, and any PDF, is hashed exactly as the bytes received.
 */

export type PageDates = { modifiedOn: string | null; lastAmendedOn: string | null; currentTo: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | undefined | null): string | null {
  if (!value || !ISO.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

export function readPageDates(html: string): PageDates {
  const modified = /<time\b[^>]*property=["']dateModified["'][^>]*>\s*(?:﻿)?\s*(\d{4}-\d{2}-\d{2})\s*<\/time>/i.exec(html)?.[1];
  const gcdsModified = /<gcds-date-modified\b[^>]*>\s*(?:﻿)?\s*(\d{4}-\d{2}-\d{2})\s*<\/gcds-date-modified>/i.exec(html)?.[1];
  const currentTo = /\bcurrent to\s+(\d{4}-\d{2}-\d{2})\b/i.exec(html)?.[1];
  const amended = /\blast amended(?:\s*<\/a>)?\s+on\s+(\d{4}-\d{2}-\d{2})\b/i.exec(html)?.[1];
  return { modifiedOn: validDate(modified) ?? validDate(gcdsModified), lastAmendedOn: validDate(amended), currentTo: validDate(currentTo) };
}

/** A script a CDN injects per request: Akamai mPulse (boomerang) and its per-request ak.* values. */
const INJECTED_SCRIPT = /BOOMR|go-mpulse\.net|["']ak\.(?:rid|ak|t)["']/;

/** What a page's SHA-256 was taken over (stored with each captured page as `sha256Of`). */
export type HashBasis = "bytes" | "html-without-injected-scripts";

/**
 * The bytes to hash for a fetched page: an HTML page with the CDN's per-request scripts removed (see
 * the header), otherwise the bytes received, unchanged. The capture script and the server's Add claim
 * fetch both hash through this, so their hashes compare.
 */
export function hashableBytes(bytes: Uint8Array, contentType: string | null): { bytes: Uint8Array; basis: HashBasis } {
  const type = (contentType ?? "").toLowerCase();
  const start = new TextDecoder("utf-8").decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  const html = type.includes("html") || (!type && (start.startsWith("<!doctype html") || start.startsWith("<html")));
  if (!html) return { bytes, basis: "bytes" };
  let removed = 0;
  const kept = new TextDecoder("utf-8").decode(bytes).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (script) => {
    if (!INJECTED_SCRIPT.test(script)) return script;
    removed += 1;
    return "";
  });
  return removed === 0 ? { bytes, basis: "bytes" } : { bytes: new TextEncoder().encode(kept), basis: "html-without-injected-scripts" };
}

const LANGUAGE_OR_INDEX = /^(en|fr|eng|fra|english|francais|index|home|default|accueil|welcome)$/;

/** True for canada.ca or a gc.ca site over https (the hosts Casevoya captures for IRCC claims). */
export function federalHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !parsed.port && !parsed.username && !parsed.password && (host === "canada.ca" || host.endsWith(".canada.ca") || host.endsWith(".gc.ca"));
  } catch {
    return false;
  }
}

/**
 * Why a URL can't be a claim's source, or null when it can: an official federal page that is not a
 * homepage or landing page (two path segments besides language folders and index pages), with a
 * section anchor unless a section is named. Mirrors app.official_claim_url in the database.
 */
export function claimUrlProblem(url: string, section: string | null = null): string | null {
  const raw = url.trim();
  if (!federalHost(raw)) return "The source must be an official Government of Canada page (canada.ca or a gc.ca site).";
  const parsed = new URL(raw);
  const meaningful = parsed.pathname
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/\.(html?|aspx?|php)$/, ""))
    .filter((part) => part !== "" && !LANGUAGE_OR_INDEX.test(part));
  if (meaningful.length < 2) return "A homepage is not evidence: give the exact page the claim is on.";
  if (!parsed.hash.replace(/^#/, "") && !(section ?? "").trim()) return "Give the link with its section anchor (#…), or name the section.";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };

/** Tags out, entities decoded, whitespace collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .trim();
}

/**
 * The whole of one Justice Laws section as the live page prints it (`id="s-12"`): every subsection
 * and paragraph with their marginal notes, from the section's list (`<ul class="Section …">`) to its
 * end, e.g. "12 (1) A foreign national … Marginal note: Economic immigration (2) …". This is the
 * shape Justice Canada's XML text takes, so the two can be compared. Null when the page has no such
 * section.
 */
export function lawFullSectionText(html: string, sectionId: string): string | null {
  if (!/^s-[0-9]+(\.[0-9]+)?$/.test(sectionId)) return null;
  const at = html.search(new RegExp(`id=["']${sectionId.replace(".", "\\.")}["']`));
  if (at < 0) return null;
  // The section starts at its own element: a list of subsections (`<ul class="Section …">`) or a
  // single provision (`<p class="Section">`, then any paragraphs under it).
  const start = Math.max(html.lastIndexOf('<ul class="Section', at), html.lastIndexOf('<p class="Section"', at));
  if (start < 0) return null;
  // A list of subsections ends with its own closing tag (nested lists hold paragraphs).
  let listEnd = -1;
  if (html.startsWith("<ul", start)) {
    const tags = /<(\/?)ul\b[^>]*>/gi;
    tags.lastIndex = start;
    let depth = 0;
    for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
      depth += tag[1] ? -1 : 1;
      if (depth === 0) {
        listEnd = tag.index + tag[0].length;
        break;
      }
    }
  }
  // It ends before the amendment history, the next heading or the next section (with its marginal
  // note), whichever is first.
  const rest = html.slice(at);
  const stops = [rest.search(/<div class="HistoricalNote"/), rest.search(/<h[1-6]\b/i)];
  const next = rest.slice(1).search(/id=["']s-[0-9]+(\.[0-9]+)?["']/);
  if (next >= 0) {
    const nextAt = at + 1 + next;
    const nextStart = Math.max(html.lastIndexOf('<ul class="Section', nextAt), html.lastIndexOf('<p class="Section"', nextAt));
    const note = html.lastIndexOf('<p class="MarginalNote"', nextStart);
    stops.push((note > Math.max(at, listEnd) ? note : nextStart) - at);
  }
  const valid = stops.filter((stop) => stop > 0);
  let end = valid.length ? at + Math.min(...valid) : html.length;
  if (listEnd > at) end = Math.min(end, listEnd);
  const chunk = html.slice(start, end).replace(/<div class="HistoricalNote"[\s\S]*?<\/div>/gi, " ");
  const text = textOf(chunk).replace(/\s*Previous Version\s*/g, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * The words of one Justice Laws section (`id="s-216"`) up to its first marginal note, i.e. the
 * section's opening provision as printed: "216 (1) Subject to subsections (2) and (3), …". Null when
 * the page has no such section.
 */
export function lawSectionText(html: string, sectionId: string): string | null {
  if (!/^s-[0-9]+(\.[0-9]+)?$/.test(sectionId)) return null;
  const at = html.search(new RegExp(`id=["']${sectionId.replace(".", "\\.")}["']`));
  if (at < 0) return null;
  const start = html.lastIndexOf("<", at);
  const rest = html.slice(at);
  const next = rest.slice(1).search(/id=["']s-[0-9]+(\.[0-9]+)?["']/);
  const chunk = html.slice(start, next < 0 ? at + 20_000 : at + 1 + next);
  const text = textOf(chunk);
  const cut = text.indexOf(" Marginal note:");
  const body = (cut > 0 ? text.slice(0, cut) : text).replace(/\s*Previous Version\s*$/, "").trim();
  return body.length > 0 ? body : null;
}
