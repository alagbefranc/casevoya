/**
 * Calendly scheduled-event import (pure). Reads are parsed here; the database upserts them.
 * Nothing in this module creates a client, a matter, or a booking, and nothing is written back
 * to Calendly. A repeat import updates the same external URI. A complete page can mark events
 * in the window that disappeared as canceled. A truncated page must not, because the missing
 * rows may be on the next page we cannot ask for.
 */

export type CalendlyEvent = {
  uri: string;
  name: string;
  status: "active" | "canceled";
  starts_at: string;
  ends_at: string;
};

const URI = /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]{1,80}$/;
const MAX_PAGE = 100;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One scheduled event from a Calendly list payload, or null when it is not usable. */
export function parseCalendlyEvent(value: unknown): CalendlyEvent | null {
  const row = record(value);
  if (!row) return null;
  const uri = text(row.uri);
  const name = text(row.name).replace(/\s+/g, " ").slice(0, 200);
  const status = text(row.status);
  const starts = text(row.start_time ?? row.starts_at);
  const ends = text(row.end_time ?? row.ends_at);
  if (!URI.test(uri) || !name) return null;
  if (status !== "active" && status !== "canceled") return null;
  const startMs = Date.parse(starts);
  const endMs = Date.parse(ends);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { uri, name, status, starts_at: new Date(startMs).toISOString(), ends_at: new Date(endMs).toISOString() };
}

export type CalendlyPage = { events: CalendlyEvent[]; truncated: boolean; userUri: string | null };

/** The current-user URI Calendly needs before it will list that person's events. */
export function parseCalendlyUser(data: unknown): string | null {
  const row = record(data);
  const resource = row ? record(row.resource) ?? row : null;
  const uri = text(resource?.uri);
  return /^https:\/\/api\.calendly\.com\/users\/[A-Za-z0-9_-]{1,80}$/.test(uri) ? uri : null;
}

const TOKEN = /^[A-Za-z0-9._~%-]{1,500}$/;

/** The next page token, or null when this page is the last. */
export function calendlyNextToken(data: unknown): string | null {
  const pagination = record(record(data)?.pagination);
  const direct = text(pagination?.next_page_token);
  if (TOKEN.test(direct)) return direct;
  const next = text(pagination?.next_page);
  try {
    const token = new URL(next).searchParams.get("page_token") ?? "";
    return TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * One list response. `truncated` is true when Calendly says there is another page or this page
 * was cut. A truncated import must not cancel events that were not fetched.
 */
export function parseCalendlyPage(data: unknown): CalendlyPage {
  const row = record(data) ?? {};
  const list = Array.isArray(row.collection) ? row.collection : Array.isArray(data) ? data : [];
  const events: CalendlyEvent[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const parsed = parseCalendlyEvent(item);
    if (!parsed || seen.has(parsed.uri)) continue;
    seen.add(parsed.uri);
    events.push(parsed);
    if (events.length >= MAX_PAGE) break;
  }
  const truncated = Boolean(calendlyNextToken(data)) || list.length > events.length;
  return { events, truncated, userUri: null };
}

/** Merge pages. Complete only when every stream ended and the caller did not hit the page cap. */
export function mergeCalendlyPages(pages: CalendlyPage[], hitCap: boolean): { events: CalendlyEvent[]; complete: boolean } {
  const byUri = new Map<string, CalendlyEvent>();
  for (const page of pages) for (const event of page.events) byUri.set(event.uri, event);
  return { events: [...byUri.values()], complete: !hitCap && pages.every((page) => !page.truncated) };
}

export type CalendlyImportPlan = {
  userUri: string;
  from: string;
  to: string;
  events: CalendlyEvent[];
  complete: boolean;
};

/** What one import will save. A truncated page is not complete, so the database will not cancel rows it did not see. */
export function planCalendlyImport(input: { user: unknown; page: unknown; from: Date; to: Date }): CalendlyImportPlan | { error: string } {
  const userUri = parseCalendlyUser(input.user);
  if (!userUri) return { error: "Calendly didn’t return your account." };
  const page = parseCalendlyPage(input.page);
  return { userUri, from: input.from.toISOString(), to: input.to.toISOString(), events: page.events, complete: !page.truncated };
}
