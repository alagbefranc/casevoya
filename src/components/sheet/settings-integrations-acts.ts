"use client";

import { toast2 } from "@/components/port/kit";
import { COMPOSIO_DIALOG } from "@/components/sheet/designer/settings-integrations";
import { connectAccount, disconnectAccount, refreshConnection, setComposioEnabled, syncCalendarBusy } from "@/modules/integrations/actions";
import { saveNotificationPreference } from "@/modules/notifications/actions";
import { DEFAULT_QUIET_HOURS } from "@/modules/notifications/preferences";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { INTEGRATIONS_PATH } from "@/modules/sheet/settings-integrations-present";
import { setQuietHours } from "@/modules/tasks/actions";

type Router = { replace: (href: string) => void; refresh: () => void };

const TOOLKITS = ["gmail", "outlook", "googlecalendar", "outlook_calendar"] as const;
type Toolkit = (typeof TOOLKITS)[number];

function isToolkit(value: string | null | undefined): value is Toolkit {
  return (TOOLKITS as readonly string[]).includes(value ?? "");
}

const NAME: Record<Toolkit, string> = { gmail: "Gmail", outlook: "Outlook", googlecalendar: "Google Calendar", outlook_calendar: "Microsoft 365 calendar" };

/** The connected-accounts switch: turning on opens the disclosure; turning off saves at once. */
export async function runComposioSwitch(button: HTMLElement, openDialog: (id: string) => void, router: Router) {
  if (button.dataset.composio === "on") {
    openDialog(COMPOSIO_DIALOG);
    return;
  }
  const result = await setComposioEnabled({ organizationId: button.dataset.org ?? "", enabled: false, acceptDisclosure: false });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Connected accounts turned off", { kind: "ok", sub: "Connections stay listed but aren’t used. People can disconnect them." });
  router.refresh();
}

/** "Accept and turn on" in the disclosure: the owner's acceptance is recorded with the switch. */
export async function runComposioEnable(button: HTMLElement, router: Router) {
  const result = await setComposioEnabled({ organizationId: button.dataset.org ?? "", enabled: true, acceptDisclosure: true });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  button.closest("dialog")?.close();
  toast2("Connected accounts turned on", { kind: "ok", sub: "Each person can now connect their own Gmail, Outlook or Google Calendar." });
  router.refresh();
}

/** Connect or Reconnect: opens Composio's Connect Link; it comes back to this tab. */
export async function runIntConnect(button: HTMLElement) {
  const toolkit = button.dataset.intConnect;
  if (!isToolkit(toolkit)) return;
  const callbackUrl = `${window.location.origin}${INTEGRATIONS_PATH}&connected=${toolkit}`;
  const result = await connectAccount({ organizationId: button.dataset.org ?? "", toolkit, callbackUrl });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was connected." });
    return;
  }
  window.location.assign(result.url);
}

export async function runIntDisconnect(button: HTMLElement, router: Router) {
  const result = await disconnectAccount({ organizationId: button.dataset.org ?? "", connectionId: button.dataset.intDisconnect ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Disconnected", { kind: "ok", sub: "Casevoya no longer uses it. Busy times read from a calendar are removed." });
  router.refresh();
}

export async function runIntSync(button: HTMLElement, router: Router) {
  const result = await syncCalendarBusy({ organizationId: button.dataset.org ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Busy times read", { kind: "ok", sub: `${result.blocks} busy ${result.blocks === 1 ? "time" : "times"} in the next 4 weeks. Booking pages offer fewer times.` });
  router.refresh();
}

/**
 * Back from the Connect Link (`?tab=integrations&connected=gmail`): records the connection when
 * Composio reports it active, then shows the tab without the extra parameters.
 */
export function mountIntegrations(root: HTMLElement, router: Router) {
  const url = new URL(window.location.href);
  const toolkit = url.searchParams.get("connected");
  if (url.searchParams.get("tab") !== "integrations" || !isToolkit(toolkit)) return;
  const organizationId = root.querySelector<HTMLElement>("[data-org]")?.dataset.org ?? "";
  router.replace(INTEGRATIONS_PATH);
  void refreshConnection({ organizationId, toolkit }).then((result) => {
    if ("error" in result) toast2(result.error, { kind: "bad", sub: "Try Reconnect." });
    else if (result.active) toast2(`${NAME[toolkit]} connected`, { kind: "ok", sub: "Only you can use it. Disconnect it here at any time." });
    else toast2(`${NAME[toolkit]} isn’t connected yet`, { kind: "warn", sub: "Finish signing in, or try Reconnect." });
    router.refresh();
  });
}

/** One of the person's own email switches: saved at once, put back if the database refuses. */
export async function runNotifPref(button: HTMLElement, router: Router) {
  const on = button.getAttribute("aria-checked") !== "true";
  button.setAttribute("aria-checked", String(on));
  const result = await saveNotificationPreference({ organizationId: button.dataset.org ?? "", kind: button.dataset.notifPref ?? "", email: on });
  if ("error" in result) {
    button.setAttribute("aria-checked", String(!on));
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2(on ? "Email turned on" : "Email turned off", { kind: "ok", sub: "Only for you. Security notices always go out." });
  router.refresh();
}

/** Quiet hours (firm owner, confirmed with step-up): on uses 21:00–08:00; off clears them. */
export async function runQuietHours(button: HTMLElement, router: Router) {
  const on = button.dataset.quiet === "on";
  const result = await setQuietHours({
    organizationId: button.dataset.org ?? "",
    start: on ? DEFAULT_QUIET_HOURS.start : null,
    end: on ? DEFAULT_QUIET_HOURS.end : null,
    code: null,
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      toast2("Confirm it’s you first", { kind: "warn", sub: "Then turn it on or off again." });
      window.location.assign(`/mfa?step=6&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    toast2(result.error ?? "That didn’t save.", { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2(on ? "Quiet hours on" : "Quiet hours off", { kind: "ok", sub: on ? "Routine reminders wait until 08:00. Critical notices still go out." : "Routine reminders go out at any hour." });
  router.refresh();
}
