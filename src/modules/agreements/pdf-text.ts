/**
 * Text helpers for the sealed agreement PDF. Pure: no PDF library, no I/O.
 *
 * The PDF uses the standard Helvetica and Courier fonts with WinAnsi (Windows-1252) encoding, so
 * it embeds no font file and runs anywhere (Node, Cloudflare Workers). WinAnsi covers every
 * French letter (é è ê ë à â ç î ï ô œ ù û ü ÿ æ and capitals), guillemets, curly quotes, dashes
 * and the euro sign. Anything else is transliterated (accents stripped) or shown as "?".
 */

/** The code points WinAnsiEncoding can draw: printable ASCII, Latin-1, and the CP1252 extras. */
const WIN_ANSI_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function isWinAnsi(code: number): boolean {
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa1 && code <= 0xff && code !== 0xad) return true;
  return WIN_ANSI_EXTRAS.includes(String.fromCodePoint(code));
}

/** Characters with a WinAnsi stand-in. Spaces of every width become a plain space. */
const SUBSTITUTE: Record<string, string> = {
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "‐": "-",
  "‑": "-",
  "‒": "–",
  "―": "—",
  "−": "-",
  "′": "'",
  "″": '"',
  "․": ".",
  "‧": "·",
  "⁃": "-",
  "●": "•",
  "▪": "•",
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "✓": "v",
  "✔": "v",
  "\t": "    ",
};

/** Zero-width and formatting characters that draw nothing. */
const INVISIBLE = /[­​-‍⁠﻿\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * One line of text the PDF's standard fonts can draw. Line breaks are the caller's job, so any
 * that remain become spaces.
 */
export function pdfSafeText(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.normalize("NFC").replace(/\r\n?|\n/g, " ").replace(INVISIBLE, "");
  let out = "";
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (isWinAnsi(code)) {
      out += char;
      continue;
    }
    const substitute = SUBSTITUTE[char];
    if (substitute !== undefined) {
      out += substitute;
      continue;
    }
    // Transliterate: drop combining accents (e.g. "ő" -> "o", "ș" -> "s") when the base letter fits.
    const stripped = char.normalize("NFD").replace(/\p{M}+/gu, "");
    if (stripped && [...stripped].every((part) => isWinAnsi(part.codePointAt(0) ?? 0))) {
      out += stripped;
      continue;
    }
    out += "?";
  }
  return out;
}

/** Splits text into paragraphs (blank line between) of lines (single line break). */
export function paragraphs(value: string | null | undefined): string[][] {
  if (!value) return [];
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.split("\n").map((line) => line.replace(/\s+$/, "")).filter((line) => line.trim() !== ""))
    .filter((block) => block.length > 0);
}

/**
 * Wraps one line of text to a width. Breaks between words; a word wider than the line (a hash,
 * a URL) is broken between characters. Never returns an empty array.
 */
export function wrapText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const words = text.split(/ +/).filter((word) => word !== "");
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }
    let piece = "";
    for (const char of word) {
      if (piece && measure(piece + char) > maxWidth) {
        lines.push(piece);
        piece = "";
      }
      piece += char;
    }
    current = piece;
  }
  if (current) lines.push(current);
  return lines;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function validZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return null;
  }
}

function zoneParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: Number(get("month")),
    day: Number(get("day")),
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    zoneName: get("timeZoneName"),
  };
}

/** "18 October 2026, 14:05:07 EDT" in the firm's time zone (UTC when the zone is unknown). */
export function formatInZone(iso: string | null | undefined, zone: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const tz = validZone(zone) ?? "UTC";
  const parts = zoneParts(date, tz);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}, ${parts.time} ${parts.zoneName || tz}`;
}

/** "2026-10-18 18:05:07 UTC". */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** A fee in minor units as "CAD 1,500.00". Integer arithmetic, no floating point. */
export function formatMoney(cents: number | string | null | undefined, currency: string): string | null {
  if (cents == null || cents === "") return null;
  const value = BigInt(String(cents).split(".")[0]);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minor = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${currency} ${negative ? "-" : ""}${whole}.${minor}`;
}
