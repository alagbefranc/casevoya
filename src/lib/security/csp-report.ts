/**
 * CSP violation reports. One request may carry several. Nothing is stored.
 * Logged fields are a directive name, an origin, a path, and a line number.
 * Query strings, cookies, and full URLs are not logged.
 */

export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_MAX_PER_REQUEST = 8;

const KEYWORD = /^(inline|eval|data|blob|self|none|wasm-unsafe-eval)$/i;

export type CspViolationLog = {
  event: "csp.violation";
  directive: string;
  blocked_uri: string;
  document_uri: string;
  disposition: string;
  source_file: string;
  line: number | null;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function field(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key];
  }
  return undefined;
}

/** http(s) origin, or a CSP keyword such as "inline". Anything else is dropped. */
export function originOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (text.length === 0 || text.length > 2000) return "";
  if (KEYWORD.test(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.origin || url.origin === "null") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** Path only. The query string and fragment are dropped. */
export function pathOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (text.length === 0 || text.length > 2000) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.pathname.slice(0, 200);
  } catch {
    return "";
  }
}

function directiveOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const token = value.trim().split(/\s+/)[0] ?? "";
  return /^[a-zA-Z0-9-]{1,64}$/.test(token) ? token.toLowerCase() : "";
}

function dispositionOf(value: unknown): string {
  return value === "report" || value === "enforce" ? value : "";
}

function lineOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

function toLog(source: Record<string, unknown>): CspViolationLog | null {
  const log: CspViolationLog = {
    event: "csp.violation",
    directive: directiveOf(field(source, "effective-directive", "effectiveDirective", "violated-directive", "violatedDirective")),
    blocked_uri: originOnly(field(source, "blocked-uri", "blockedURL", "blocked-url")),
    document_uri: pathOnly(field(source, "document-uri", "documentURL", "document-url")),
    disposition: dispositionOf(field(source, "disposition")),
    source_file: originOnly(field(source, "source-file", "sourceFile")),
    line: lineOf(field(source, "line-number", "lineNumber")),
  };
  if (!log.directive && !log.blocked_uri && !log.document_uri) return null;
  return log;
}

function legacyReports(parsed: unknown): CspViolationLog[] {
  const body = record(parsed);
  const report = body ? record(body["csp-report"]) : null;
  const log = report ? toLog(report) : null;
  return log ? [log] : [];
}

function reportingApiReports(parsed: unknown): CspViolationLog[] {
  if (!Array.isArray(parsed)) return [];
  const logs: CspViolationLog[] = [];
  for (const item of parsed) {
    if (logs.length >= CSP_REPORT_MAX_PER_REQUEST) break;
    const row = record(item);
    if (!row || row.type !== "csp-violation") continue;
    const body = record(row.body);
    const log = body ? toLog(body) : null;
    if (log) logs.push(log);
  }
  return logs;
}

/** The first reports in the body. A shape this does not understand yields nothing. */
export function cspViolationLogs(mediaType: string, parsed: unknown): CspViolationLog[] {
  const type = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "application/csp-report") return legacyReports(parsed).slice(0, CSP_REPORT_MAX_PER_REQUEST);
  if (type === "application/reports+json") return reportingApiReports(parsed);
  return [];
}
