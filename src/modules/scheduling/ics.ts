/**
 * iCalendar (RFC 5545) text for one consultation. The UID is the booking's reference and never
 * changes, so a reschedule (SEQUENCE + 1) updates the calendar entry instead of adding a second one,
 * and a cancellation (METHOD:CANCEL, STATUS:CANCELLED) removes it (REPORT §10.7). No names, emails
 * or notes are put in the file.
 */
export type IcsInput = {
  publicRef: string;
  sequence: number;
  startsAt: string | number;
  endsAt: string | number;
  title: string;
  firmName: string;
  location?: string | null;
  url?: string | null;
  cancelled?: boolean;
  /** When the file was made; passed in so output is deterministic. */
  stampedAt: string | number;
};

function utc(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("ICS needs valid times.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapes text values (backslash, semicolon, comma, newlines) and strips control characters. */
export function icsText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, as RFC 5545 §3.1 asks. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = new TextEncoder().encode(char).length;
    if (size + width > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(input: IcsInput): string {
  if (!/^[a-z2-7]{26}$/.test(input.publicRef)) throw new Error("ICS needs a booking reference.");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Casevoya//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${input.publicRef}@casevoya`,
    `SEQUENCE:${Math.max(0, Math.floor(input.sequence))}`,
    `DTSTAMP:${utc(input.stampedAt)}`,
    `DTSTART:${utc(input.startsAt)}`,
    `DTEND:${utc(input.endsAt)}`,
    `SUMMARY:${icsText(`${input.title} with ${input.firmName}`)}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
  ];
  if (input.location) lines.push(`LOCATION:${icsText(input.location)}`);
  if (input.url && /^https:\/\/[^\s]+$/.test(input.url)) lines.push(`URL:${input.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
