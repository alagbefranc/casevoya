/**
 * Deterministic fr-CA (OQLF) typography for machine drafts. Pure string code with only erasable
 * TypeScript, so scripts/i18n/*.mjs can import it under Node's type stripping.
 *
 * - « » get a no-break space (U+00A0) inside.
 * - A no-break space goes before ":" and a narrow no-break space (U+202F) before ";", "!" and "?"
 *   when the mark ends a word (followed by a space or the end), so "10:30", "https://" and
 *   "?invoice=" are left alone.
 * - Straight apostrophes between letters become ’ (the English copy uses ’).
 *
 * It never removes words, placeholders or characters other than the spaces it replaces.
 */
export const NBSP = " ";
export const NNBSP = " ";

const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

function fixSegment(text: string): string {
  return text
    .replace(/«[   ]*/g, `«${NBSP}`)
    .replace(/[   ]*»/g, `${NBSP}»`)
    .replace(/(\S)[   ]*:(?=\s|$)/g, `$1${NBSP}:`)
    .replace(/(\S)[   ]*([;!?])(?=\s|$|»)/g, `$1${NNBSP}$2`)
    .replace(/(\p{L})'(\p{L})/gu, "$1’$2");
}

/** Applies the rules outside URLs; URLs are kept byte for byte. */
export function frTypography(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(URL_LIKE)) {
    const start = match.index ?? 0;
    out += fixSegment(text.slice(last, start)) + match[0];
    last = start + match[0].length;
  }
  return out + fixSegment(text.slice(last));
}

/** Every {placeholder} in a string, sorted, with repeats. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{[a-z_]+\}/g)].map((match) => match[0]).sort();
}

/** True when both strings carry exactly the same placeholders. */
export function samePlaceholders(a: string, b: string): boolean {
  const left = placeholders(a);
  const right = placeholders(b);
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
