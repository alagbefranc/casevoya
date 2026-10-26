/**
 * Reads IRCC's fee list page (FIN-06, RULES: official source, URL, retrieval time and a snapshot
 * hash with every value). The page groups fees under `<h2 id="...">` sections and `<h3>` groups,
 * each fee a table row: the fee's name (bold) and its amount in CAD. Nothing here invents a fee:
 * a row whose amount isn't a plain dollar figure is left out, and an empty result means the page
 * changed shape and nothing is recorded.
 */

export const IRCC_FEE_LIST_URL = "https://ircc.canada.ca/english/information/fees/fees.asp";

export type FeeListRow = { section: string | null; group: string | null; name: string; amount_cents: number; anchor: string | null };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };

/** Tags out, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** "1,050.00" or "150.00 (per child)" into cents and the qualifier; null for anything else. */
export function readFeeAmount(text: string): { cents: number; qualifier: string | null } | null {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(?:\s+(\(.{1,80}\)))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) return null;
  return { cents, qualifier: match[3] ?? null };
}

type Token = { at: number; kind: "section" | "group" | "row"; html: string; anchor?: string };

/** The fee rows, in page order, with the section and group each sits under. At most 500. */
export function parseIrccFeeList(html: string): FeeListRow[] {
  const main = html.indexOf("<main");
  const body = main >= 0 ? html.slice(main) : html;
  const tokens: Token[] = [];
  for (const m of body.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)) {
    const id = /\bid\s*=\s*["']([A-Za-z0-9_-]{1,80})["']/.exec(m[1])?.[1];
    if (id) tokens.push({ at: m.index ?? 0, kind: "section", html: m[2], anchor: id });
  }
  for (const m of body.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) tokens.push({ at: m.index ?? 0, kind: "group", html: m[1] });
  for (const m of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) tokens.push({ at: m.index ?? 0, kind: "row", html: m[1] });
  tokens.sort((a, b) => a.at - b.at);

  const rows: FeeListRow[] = [];
  let section: string | null = null;
  let anchor: string | null = null;
  let group: string | null = null;
  for (const token of tokens) {
    if (token.kind === "section") {
      section = plainText(token.html) || null;
      anchor = token.anchor ?? null;
      group = null;
      continue;
    }
    if (token.kind === "group") {
      group = plainText(token.html) || null;
      continue;
    }
    if (!section) continue;
    const cells = [...token.html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length !== 2) continue;
    // The fee's name is its bold text; a popup's text ("What's this?") is never part of it.
    const named = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(cells[0]);
    const name = plainText(named ? named[1] : cells[0].replace(/<section\b[\s\S]*?<\/section>/gi, ""));
    const amount = readFeeAmount(plainText(cells[1]));
    if (!name || !amount) continue;
    rows.push({
      section,
      group,
      name: (amount.qualifier ? `${name} ${amount.qualifier}` : name).slice(0, 300),
      amount_cents: amount.cents,
      anchor,
    });
    if (rows.length === 500) break;
  }
  return rows;
}

function officialHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (host === "canada.ca" || host.endsWith(".canada.ca"));
  } catch {
    return false;
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetches the fee list (server side) and reads it: the rows, the retrieval time and the SHA-256 of
 * the bytes received. Any failure says so and returns no rows; nothing is guessed.
 */
export async function readFeeListPage(
  fetcher: typeof fetch,
  now: () => Date = () => new Date(),
): Promise<{ rows: FeeListRow[]; sha256: string; retrievedAt: string } | { error: string }> {
  let response: Response;
  try {
    response = await fetcher(IRCC_FEE_LIST_URL, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { accept: "text/html" } });
  } catch {
    return { error: "IRCC’s fee list couldn’t be reached. Nothing was recorded; enter government fees by hand with their source." };
  }
  if (!response.ok || (response.url && !officialHost(response.url))) {
    return { error: "IRCC’s fee list didn’t answer as expected. Nothing was recorded." };
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 2_000_000) return { error: "IRCC’s fee list didn’t answer as expected. Nothing was recorded." };
  const retrievedAt = now().toISOString();
  const sha256 = await sha256Hex(bytes);
  const rows = parseIrccFeeList(new TextDecoder("utf-8").decode(bytes));
  if (rows.length === 0) return { error: "No fees could be read from IRCC’s page; its layout may have changed. Nothing was recorded." };
  return { rows, sha256, retrievedAt };
}
