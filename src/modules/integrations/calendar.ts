/**
 * Calendar providers (pure parts and the Composio busy-time sync with an injected session).
 *
 *  casevoya  DEFAULT: availability schedules, rules, overrides and bookings; Vo proposes free times
 *            from these (services/vo-agent find_free_slots) with the published booking page link.
 *  composio  OPTIONAL: the staff member's Google Calendar busy times, read with the free/busy tool
 *            (https://docs.composio.dev/toolkits/googlecalendar.md, 2026-10-18:
 *            GOOGLECALENDAR_FREE_BUSY_QUERY(items, timeMin, timeMax)) and written, times only, into
 *            `external_busy_blocks` through public.replace_external_busy_blocks, which the existing
 *            slot engine already subtracts. Nothing is ever written to the external calendar.
 *            Outlook free/busy isn't documented on the page we could read and is not wired.
 */
import { toolSlugs } from "./composio-policy";
import { runAllowed, type ComposioSessionLike } from "./mail/composio-mail";

export type CalendarProviderId = "casevoya" | "composio";
export type BusyBlock = { start: string; end: string };

export function selectCalendarProvider(input: { googleConnected: boolean; firmAllowsComposio: boolean; composioConfigured: boolean }): CalendarProviderId[] {
  // Casevoya's own calendar always counts; a connected calendar adds busy time on top.
  return input.googleConnected && input.firmAllowsComposio && input.composioConfigured ? ["casevoya", "composio"] : ["casevoya"];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Busy intervals from a free/busy answer, in whatever nesting it comes: calendars.*.busy[]. */
export function busyFromFreeBusy(data: unknown): BusyBlock[] {
  const root = typeof data === "string" ? safeJson(data) : data;
  const calendars = record(record(root).calendars);
  const out: BusyBlock[] = [];
  for (const calendar of Object.values(calendars)) {
    const busy = record(calendar).busy;
    if (!Array.isArray(busy)) continue;
    for (const item of busy) {
      const start = String(record(item).start ?? "");
      const end = String(record(item).end ?? "");
      if (!Number.isNaN(Date.parse(start)) && !Number.isNaN(Date.parse(end)) && Date.parse(end) > Date.parse(start)) out.push({ start, end });
    }
  }
  return out.slice(0, 500);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Reads busy times for the next `days` from the connected Google Calendar (never writes to it). */
export async function readGoogleBusy(session: ComposioSessionLike, from: Date, days: number): Promise<{ blocks: BusyBlock[]; to: Date } | { error: string }> {
  const slugs = toolSlugs(await session.tools());
  const slug = slugs.find((s) => s === "GOOGLECALENDAR_FREE_BUSY_QUERY");
  if (!slug) return { error: "Busy times aren’t available for this calendar." };
  const to = new Date(from.getTime() + Math.min(Math.max(days, 1), 62) * 86_400_000);
  const result = await runAllowed(session, slug, "freebusy", { items: [{ id: "primary" }], timeMin: from.toISOString(), timeMax: to.toISOString() });
  if (result.error) return { error: "The calendar didn’t answer. Nothing was changed." };
  return { blocks: busyFromFreeBusy(result.data), to };
}
