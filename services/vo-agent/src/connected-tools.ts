/**
 * Ask Vo's tools for the staff member's own connected apps (Composio), on top of the matter tools.
 * They exist in a run only when the firm owner has turned on connected accounts
 * (composio_connection_ready, checked as the staff member when the run starts). Each call is
 * checked again, for that app, before Composio is called:
 *
 *   connected_app_read     runs one listed read action as the staff member (Composio user id =
 *                          their membership id), and hands the result back with a marker [C#]
 *   connected_app_propose  never runs anything: it saves a proposal (propose_connected_action) that
 *                          the staff member confirms or dismisses in Settings > Integrations
 *
 * The actions are the explicit list in src/modules/integrations/vo-connected-tools.ts; anything
 * else is refused. App data comes back inside a nonce-delimited DATA block: an email or event
 * title is data, never an instruction. What the person must do next (connect the app, confirm the
 * proposal) is said by Casevoya, not by the model (ctx.notices).
 */
import { z } from "zod";
import {
  VO_MAIL_MAX,
  voCompactMail,
  VO_COMPOSIO_TOOLKIT,
  VO_CONNECTED_ACTIONS,
  VO_CONNECTED_TOOLKITS,
  voConnectedAction,
  voConnectedArguments,
  voProposalSummary,
  type VoConnectedToolkit,
} from "../../../src/modules/integrations/vo-connected-tools";
import { dataBlock, oneLine } from "../../../src/modules/vo/prompt";
import { cite } from "./cite";
import type { RunContext, ToolResult, ToolSpec } from "./tools";

export type ConnectedToolName = "connected_app_read" | "connected_app_propose";

export const CONNECTED_APP_NAME: Record<VoConnectedToolkit, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  googlecalendar: "Google Calendar",
  outlook_calendar: "Microsoft 365 calendar",
  zoom: "Zoom",
  googlemeet: "Google Meet",
  microsoft_teams: "Microsoft Teams",
  calendly: "Calendly",
  dropbox: "Dropbox",
  quickbooks: "QuickBooks",
};

const MAX_RESULT = 6000;

/** The run's view of connected accounts: the firm switch, and which of this person's apps are active. */
export type ConnectedState = { membershipId: string; active: { id: string; toolkit: VoConnectedToolkit }[]; timeZone?: string | null };

/**
 * The firm's own clock for Vo (the service runs in UTC), so "tomorrow at 10am" lands on the firm's
 * tomorrow, in the firm's zone. Falls back to America/Toronto when the zone is missing or unknown.
 */
export function firmClock(timeZone: string | null | undefined, now: Date = new Date()): string {
  let zone = timeZone || "America/Toronto";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    zone = "America/Toronto";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23", timeZoneName: "longOffset" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const offset = String(parts.timeZoneName ?? "GMT").replace("GMT", "UTC") || "UTC";
  return `Firm's local date and time now: ${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${zone}, ${offset === "UTC" ? "UTC+00:00" : offset}). Work out relative dates and times ("today", "tomorrow at 10am", "next Monday") in this zone, never in UTC. When an action takes a start time, give the local time in this zone and set its timezone argument (if it has one) to "${zone}".`;
}

/** Composio, as the service calls it (tests replace it). */
export type ComposioExec = (input: { userId: string; slug: string; arguments: Record<string, unknown> }) => Promise<{ successful: boolean; data: unknown }>;

/** Composio's REST execute endpoint (https://docs.composio.dev, POST /api/v3/tools/execute/{slug}). */
export function composioRest(apiKey: string, fetcher: typeof fetch = fetch): ComposioExec {
  return async ({ userId, slug, arguments: args }) => {
    const response = await fetcher(`https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, arguments: args }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json().catch(() => null)) as { successful?: boolean; data?: unknown } | null;
    return { successful: response.ok && body?.successful === true, data: body?.data ?? null };
  };
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}
function refused(value: string): ToolResult {
  return { content: [{ type: "text", text: value }], isError: true };
}
function notice(ctx: RunContext, value: string) {
  ctx.notices ??= [];
  if (!ctx.notices.includes(value)) ctx.notices.push(value);
}

const READS = VO_CONNECTED_TOOLKITS.flatMap((toolkit) => VO_CONNECTED_ACTIONS[toolkit].filter((a) => a.kind === "read").map((a) => a.slug));
const WRITES = VO_CONNECTED_TOOLKITS.flatMap((toolkit) => VO_CONNECTED_ACTIONS[toolkit].filter((a) => a.kind === "write").map((a) => a.slug));

/** The catalogue Vo is shown: every app, whether it is connected, and its actions with their arguments. */
export function connectedCatalogue(state: ConnectedState, now: Date = new Date()): string {
  const active = new Set(state.active.map((row) => row.toolkit));
  return `${firmClock(state.timeZone, now)}\n` + VO_CONNECTED_TOOLKITS.map((toolkit) => {
    const actions = VO_CONNECTED_ACTIONS[toolkit].map((a) => `${a.slug} [${a.kind === "read" ? "connected_app_read" : "connected_app_propose"}] ${a.description}${a.args.length ? ` args: ${a.args.join(", ")}` : ""}`).join("; ");
    return `- app "${toolkit}" (${CONNECTED_APP_NAME[toolkit]}, ${active.has(toolkit) ? "connected" : "not connected"}): ${actions}`;
  }).join("\n");
}

function ready(ctx: RunContext, toolkit: VoConnectedToolkit): Promise<{ ok: true; mailLabel: string | null } | { ok: false; why: string }> {
  return ctx.data.connectedReady!(toolkit).then((out) => {
    if (out.ok) return out;
    if (/turned on/i.test(out.why)) {
      notice(ctx, "Connected accounts are off for this firm. The firm owner can turn them on in Settings › Integrations.");
      return { ok: false, why: "Connected accounts are off for this firm." };
    }
    notice(ctx, `Connect your ${CONNECTED_APP_NAME[toolkit]} first: Settings › Integrations › Connect next to ${CONNECTED_APP_NAME[toolkit]}. Then ask again.`);
    return { ok: false, why: `connect that account first: ${CONNECTED_APP_NAME[toolkit]} isn't connected for this person.` };
  });
}

const APP = z.enum(VO_CONNECTED_TOOLKITS as [VoConnectedToolkit, ...VoConnectedToolkit[]]);

export const CONNECTED_TOOL_SPECS: Record<ConnectedToolName, ToolSpec> = {
  connected_app_read: {
    name: "connected_app_read",
    description:
      "Read from the staff member's OWN connected app (Gmail label, calendars, Zoom, Google Meet, Calendly, Dropbox, QuickBooks) with one listed read action. The result carries a marker [C#] to cite. If the app isn't connected you get an error; then say so in one short sentence.",
    shape: {
      app: APP.describe("The app, e.g. zoom"),
      action: z.enum(READS as [string, ...string[]]).describe("A read action listed for that app"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("Only the argument names listed for the action"),
    },
    readOnly: true,
    async run(ctx, args) {
      const toolkit = String(args.app ?? "") as VoConnectedToolkit;
      const action = voConnectedAction(toolkit, args.action);
      if (!action || action.kind !== "read") return refused("That action isn't on Vo's list for that app.");
      if (!ctx.composio) return refused("Connected apps aren't available on this server.");
      const gate = await ready(ctx, toolkit);
      if (!gate.ok) return refused(gate.why);
      const callArgs = voConnectedArguments(action, args.arguments, { mailLabel: gate.mailLabel });
      if ("error" in callArgs) return refused(String(callArgs.error));
      const row = ctx.connected?.active.find((item) => item.toolkit === toolkit);
      if (!row || !ctx.connected) return refused(`connect that account first: ${CONNECTED_APP_NAME[toolkit]} isn't connected for this person.`);
      let out: { successful: boolean; data: unknown };
      try {
        out = await ctx.composio({ userId: ctx.connected.membershipId, slug: action.slug, arguments: callArgs });
      } catch {
        return refused(`${CONNECTED_APP_NAME[toolkit]} didn't answer. Try again later.`);
      }
      if (!out.successful) return refused(`${CONNECTED_APP_NAME[toolkit]} didn't answer that.`);
      const raw = action.slug === "GMAIL_FETCH_EMAILS"
        ? JSON.stringify({ messages: voCompactMail(out.data, Number(callArgs.max_results) || VO_MAIL_MAX) })
        : JSON.stringify(out.data ?? null);
      const shown = raw.length > MAX_RESULT ? `${raw.slice(0, MAX_RESULT)}…` : raw;
      const mark = cite(ctx, { kind: "connected_app", id: row.id, label: `${CONNECTED_APP_NAME[toolkit]} (your account)` }, shown);
      return text(`${mark}${CONNECTED_APP_NAME[toolkit]} · ${oneLine(action.description, 120)}\n${dataBlock(ctx.nonce, shown, MAX_RESULT + 10)}`);
    },
  },
  connected_app_propose: {
    name: "connected_app_propose",
    description:
      "Propose creating something in the staff member's OWN connected app (a Zoom, Google Meet or Teams meeting, a calendar event, an email draft, a Dropbox folder, a one-time Calendly link). Nothing runs: the person confirms or dismisses it in Settings > Integrations. Call it at most once per request.",
    shape: {
      app: APP.describe("The app, e.g. zoom"),
      action: z.enum(WRITES as [string, ...string[]]).describe("A create action listed for that app"),
      arguments: z.record(z.string(), z.unknown()).optional().describe("Only the argument names listed for the action"),
    },
    readOnly: false,
    async run(ctx, args) {
      const toolkit = String(args.app ?? "") as VoConnectedToolkit;
      const action = voConnectedAction(toolkit, args.action);
      if (!action || action.kind !== "write") return refused("That action isn't on Vo's list for that app.");
      if ((ctx.proposals ?? 0) >= 1) return refused("One proposal per request. It is already waiting.");
      const gate = await ready(ctx, toolkit);
      if (!gate.ok) return refused(gate.why);
      const callArgs = voConnectedArguments(action, args.arguments);
      if ("error" in callArgs) return refused(String(callArgs.error));
      const summary = voProposalSummary(toolkit, action, callArgs);
      const saved = await ctx.data.proposeConnected!({ toolkit, action: action.slug, arguments: callArgs, summary });
      if (!saved.ok) {
        if (/connect that account|turned on/i.test(saved.why)) return refused(`connect that account first: ${CONNECTED_APP_NAME[toolkit]} isn't connected for this person.`);
        return refused("The proposal couldn't be saved.");
      }
      ctx.proposals = (ctx.proposals ?? 0) + 1;
      cite(ctx, { kind: "connected_app", id: saved.id, label: `${CONNECTED_APP_NAME[toolkit]}: waiting for you to confirm` });
      notice(ctx, `Vo is waiting for you to confirm: ${oneLine(summary, 300)}. Confirm or dismiss it in Settings › Integrations. Nothing was created yet.`);
      return text("Saved as a proposal. Nothing was created; the person confirms it in Settings › Integrations. Answer in one short sentence.");
    },
  },
};

/** Composio's toolkit for our connection kind (Outlook mail and calendar share one). */
export function composioToolkit(toolkit: VoConnectedToolkit): string {
  return VO_COMPOSIO_TOOLKIT[toolkit];
}
