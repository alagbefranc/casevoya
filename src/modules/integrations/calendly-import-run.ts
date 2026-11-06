"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";
import { calendlyNextToken, mergeCalendlyPages, parseCalendlyPage, parseCalendlyUser, type CalendlyEvent, type CalendlyPage } from "./calendly-import";
import { composioConfigured, executeAs } from "./composio";
import { voConnectedAction, voConnectedArguments } from "./vo-connected-tools";

const NOT_CONFIGURED = "Not connected — Composio not configured on this server.";
const WINDOW_DAYS = 60;
const MAX_PAGES = 20;
const MAX_EVENTS = 2000;

type ImportResult = { ok: true; imported: number; canceled: number; truncated: boolean } | { error: string };

function notReady(message: string | undefined): string {
  if (message && /turned on/.test(message)) return "The firm owner hasn’t turned on connected accounts.";
  if (message && /connect that account/i.test(message)) return "Connect Calendly in Settings first.";
  return "Connect Calendly in Settings first.";
}

/**
 * Import the signed-in member's Calendly scheduled events into the firm calendar.
 * Pages active and canceled events until Calendly says it is finished, or until 20 pages.
 * A short or failed fetch does not cancel events that were not returned. Calendly is not changed.
 */
export async function importCalendlyEvents(organizationId: string): Promise<ImportResult> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient({ organizationId });
  const ready = await supabase.rpc("composio_connection_ready", { p_organization_id: organizationId, p_toolkit: "calendly" });
  if (ready.error || !ready.data || typeof ready.data !== "object") return { error: notReady(ready.error?.message) };
  const membershipId = String((ready.data as { membership_id?: string }).membership_id ?? "");
  if (!isUuid(membershipId)) return { error: "Connect Calendly in Settings first." };
  const from = new Date();
  const to = new Date(from.getTime() + WINDOW_DAYS * 86_400_000);
  try {
    const userOut = await executeAs(membershipId, "CALENDLY_GET_CURRENT_USER", {});
    if (!userOut.successful) return { error: "Calendly didn’t answer. Nothing was imported." };
    const userUri = parseCalendlyUser(userOut.data);
    if (!userUri) return { error: "Calendly didn’t return your account. Nothing was imported." };
    const list = voConnectedAction("calendly", "CALENDLY_LIST_SCHEDULED_EVENTS");
    if (!list) return { error: "Calendly import isn’t available." };
    const collected: CalendlyPage[] = [];
    let hitCap = false;
    for (const status of ["active", "canceled"] as const) {
      let token: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const args = voConnectedArguments(list, {
          user: userUri,
          min_start_time: from.toISOString(),
          max_start_time: to.toISOString(),
          status,
          count: 100,
          ...(token ? { page_token: token } : {}),
        });
        if ("error" in args) throw new Error(String(args.error));
        const out = await executeAs(membershipId, list.slug, args);
        if (!out.successful) throw new Error("list refused");
        const parsed = parseCalendlyPage(out.data);
        collected.push(parsed);
        const next = calendlyNextToken(out.data);
        if (!next) break;
        token = next;
        if (page === MAX_PAGES - 1) hitCap = true;
      }
    }
    const merged = mergeCalendlyPages(collected, hitCap);
    const events: CalendlyEvent[] = merged.events.slice(0, MAX_EVENTS);
    const complete = merged.complete && merged.events.length <= MAX_EVENTS;
    const saved = await supabase.rpc("replace_calendly_import", {
      p_organization_id: organizationId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_events: events as unknown as Json,
      p_complete: complete,
    });
    if (saved.error || !saved.data || typeof saved.data !== "object") return { error: notReady(saved.error?.message) };
    const row = saved.data as { imported?: number; canceled?: number; truncated?: boolean };
    return { ok: true, imported: Number(row.imported ?? 0), canceled: Number(row.canceled ?? 0), truncated: row.truncated === true };
  } catch {
    return { error: "Calendly didn’t answer. Nothing was imported." };
  }
}
