/**
 * SRC-01 / SRC-02: reading an official page for a claim, without inventing anything. Pure and
 * import-free, so the capture script (scripts/ops/capture-official-claims.mjs) runs the same code
 * as the server. A date the page doesn't print stays null (Unknown); a section that isn't found
 * returns null and nothing is captured for it.
 *
 * Dates read, exactly as the page shows them:
 *   - "Date modified" (canada.ca and Justice Laws footers: `<time property="dateModified">`);
 *   - Justice Laws "… current to YYYY-MM-DD and last amended on YYYY-MM-DD".
 * A page's hidden metadata (for example `dcterms:issued`) is not shown to readers and isn't used.
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
  const currentTo = /\bcurrent to\s+(\d{4}-\d{2}-\d{2})\b/i.exec(html)?.[1];
  const amended = /\blast amended(?:\s*<\/a>)?\s+on\s+(\d{4}-\d{2}-\d{2})\b/i.exec(html)?.[1];
  return { modifiedOn: validDate(modified), lastAmendedOn: validDate(amended), currentTo: validDate(currentTo) };
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
