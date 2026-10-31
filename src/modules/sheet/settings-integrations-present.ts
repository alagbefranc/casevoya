/**
 * Settings > Integrations and Notifications for a firm (pure). Every row says what is true:
 * Casevoya's own email and calendar are built in; personal Gmail, Outlook and Google Calendar are
 * optional per staff member through Composio, after the firm owner turns it on with the disclosure;
 * Stripe shows the firm's stored card-payments status; anything not built keeps the Designer's
 * "planned" tag and a disabled Connect, never a made-up "Connected".
 */
import type {
  ComposioDialogData,
  IntegrationRow,
  IntegrationsData,
  NotificationPrefRow,
  NotificationPrefsData,
} from "@/components/sheet/designer/settings-integrations";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { DEFAULT_QUIET_HOURS, IN_APP_ROWS, STAFF_EMAIL_ROWS } from "@/modules/notifications/preferences";

export type ComposioToolkit = "gmail" | "googlecalendar" | "outlook" | "outlook_calendar";

export type StaffConnection = { id: string; toolkit: string; status: string; updatedAt: string };

export type IntegrationsInput = {
  organizationId: string;
  firmSlug: string | null;
  fromAddress: string;
  inboundDomain: string;
  isOwner: boolean;
  composio: { configured: boolean; enabled: boolean; acceptedAt: string | null };
  /** The signed-in staff member's own connections. */
  connections: StaffConnection[];
  /** When their Google Calendar busy times were last read, if ever. */
  busySyncedAt: string | null;
  stripe: { canSee: boolean; isOwner: boolean; live?: boolean; account: { cardPayments: string; requirementsDue: number } | null };
  /** The firm's WhatsApp number through Zernio. Absent: shown as not available. */
  whatsapp?: WhatsAppInput;
  timeZone: string;
};

/** The firm's WhatsApp connection (firm_whatsapp_accounts) and Meta's live view of the number. */
export type WhatsAppInput = {
  /** ZERNIO_API_KEY is set on this server. */
  configured: boolean;
  status: "none" | "pending" | "connected" | "disconnected";
  phone: string | null;
  sandbox: boolean;
  connectedAt: string | null;
  /** GET /v1/whatsapp/number-info: null when not read; "dead" when Meta no longer serves the number. */
  live: { status: string | null; quality: string | null } | "dead" | null;
};

/** Where the Connect Link comes back to (connectAccount builds it on the app origin). */
export const INTEGRATIONS_PATH = "/sheet/settings?tab=integrations";

export const COMPOSIO_SOURCE = {
  label: "Privacy Commissioner of Canada, Guidelines for processing personal data across borders",
  href: "https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/",
};

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function day(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

const NOT_CONNECTED: MatterBadge = { tone: "gr", label: "Not connected" };

/** A row for something Casevoya hasn't built: the Designer's planned tag and a Connect that does nothing. */
function planned(name: string, logo: string, sub: IntegrationRow["sub"]): IntegrationRow {
  return {
    logo: `/assets/logos/${logo}`,
    name,
    tag: "planned",
    sub,
    state: NOT_CONNECTED,
    action: { label: "Connect", attrs: { disabled: true, title: "Not available yet" } },
  };
}

function later(name: string, logo: string, sub: string, state: MatterBadge): IntegrationRow {
  return { logo: `/assets/logos/${logo}`, name, tag: "planned", sub, state };
}

function composioRow(input: IntegrationsInput, toolkit: ComposioToolkit, name: string, logo: string, sub: string): IntegrationRow {
  const org = input.organizationId;
  const connection = input.connections.find((row) => row.toolkit === toolkit && row.status !== "disconnected") ?? null;
  const unlink = connection ? { "aria-label": `Disconnect ${name}`, "data-int-disconnect": connection.id, "data-org": org, "data-fpb": "1" } : null;
  const base = { logo: `/assets/logos/${logo}`, name, tag: "optional", sub } as const;
  if (!input.composio.configured) {
    return {
      ...base,
      state: { tone: "gr", label: "Not available" },
      unlink,
      action: { label: "Connect", attrs: { disabled: true, title: "Composio isn’t set up on this server" } },
    };
  }
  if (!input.composio.enabled) {
    return {
      ...base,
      state: connection ? { tone: "gr", label: "Paused", detail: "connected accounts are off" } : NOT_CONNECTED,
      unlink,
      action: { label: "Connect", attrs: { disabled: true, title: "The firm owner turns on connected accounts first" } },
    };
  }
  const connect = (label: string) => ({ label, attrs: { "data-int-connect": toolkit, "data-org": org } });
  if (!connection) return { ...base, state: NOT_CONNECTED, action: connect("Connect") };
  if (connection.status === "pending") {
    return { ...base, state: { tone: "chg", label: "Pending", detail: "finish signing in" }, unlink, action: connect("Reconnect") };
  }
  const synced = toolkit === "googlecalendar" && input.busySyncedAt ? `busy times read ${when(input.busySyncedAt, input.timeZone)}` : null;
  return {
    ...base,
    sub: synced ? { left: sub, right: synced } : sub,
    state: { tone: "ok", label: "Connected" },
    unlink,
    action: toolkit === "googlecalendar" ? { label: "Sync busy times", attrs: { "data-int-sync": "1", "data-org": org } } : connect("Reconnect"),
  };
}

const QUALITY: Record<string, string> = { GREEN: "quality high", YELLOW: "quality medium", RED: "quality low" };

/**
 * WhatsApp through Zernio: the firm's own number, connected by the owner with Meta's Embedded
 * Signup. Only the owner gets Connect and Disconnect (both need a recent step-up); everyone else
 * sees the state. Built from the same row parts as the Composio and Stripe rows.
 */
function whatsappRow(input: IntegrationsInput): IntegrationRow {
  const wa = input.whatsapp;
  const org = input.organizationId;
  const base = {
    logo: "/assets/logos/whatsapp.svg",
    name: "WhatsApp",
    tag: wa?.sandbox ? "sandbox" : "optional",
    sub: "Client notices and replies, with each client’s consent",
  } as const;
  if (!wa?.configured) {
    return { ...base, state: { tone: "gr", label: "Not available" }, action: { label: "Connect", attrs: { disabled: true, title: "WhatsApp isn’t set up on this server" } } };
  }
  if (wa.status === "connected") {
    const live = wa.live;
    const right =
      live === "dead"
        ? "Meta no longer serves this number"
        : live
          ? [live.status ? `Meta: ${live.status.toLowerCase()}` : null, live.quality ? (QUALITY[live.quality] ?? null) : null].filter(Boolean).join(", ") || "Meta status unknown"
          : wa.connectedAt
            ? `connected ${day(wa.connectedAt, input.timeZone)}`
            : "connected";
    return {
      ...base,
      sub: { left: wa.phone ?? "Your firm’s number", right },
      state: live === "dead" ? { tone: "bad", label: "Needs reconnecting" } : { tone: "ok", label: "Connected" },
      unlink: input.isOwner ? { "aria-label": "Disconnect WhatsApp", "data-wa-disconnect": "1", "data-org": org, "data-fpb": "1" } : null,
      action: null,
    };
  }
  const state: MatterBadge = wa.status === "pending" ? { tone: "chg", label: "Pending", detail: "finish with Meta" } : NOT_CONNECTED;
  if (!input.isOwner) {
    return { ...base, state, action: { label: "Connect", attrs: { disabled: true, title: "Only the firm owner can connect WhatsApp" } } };
  }
  // Connect first explains where the person is going (Zernio, then Meta) and asks them to accept.
  return { ...base, state, action: { label: "Connect", attrs: { "data-dlg": WHATSAPP_DIALOG } } };
}

export const WHATSAPP_DIALOG = "dlgWhatsApp";

/** Meta's own rules for business messaging on WhatsApp, linked from the consent step. */
export const WHATSAPP_SOURCE = { label: "WhatsApp Business Messaging Policy (Meta)", href: "https://business.whatsapp.com/policy" };

/**
 * The firm owner's consent step before WhatsApp Connect: what happens next (Zernio, then Meta's
 * sign-up) and what passes through each, in the same parts as the Composio disclosure.
 */
export function whatsappDialog(input: Pick<IntegrationsInput, "organizationId" | "isOwner" | "whatsapp">): ComposioDialogData | null {
  const wa = input.whatsapp;
  if (!input.isOwner || !wa?.configured || wa.status === "connected") return null;
  return {
    organizationId: input.organizationId,
    lead: "Connect sends you to Zernio, the messaging service Casevoya uses for WhatsApp, which opens Meta’s (Facebook’s) WhatsApp Business sign-up. You sign in to Meta there and choose your firm’s number.",
    points: [
      { title: "Zernio carries the messages", detail: "Notices and replies on WhatsApp pass through Zernio, on behalf of your firm. Casevoya keeps the account id and each message’s delivery state." },
      { title: "Meta runs WhatsApp", detail: "Your firm’s WhatsApp Business account is with Meta (WhatsApp), under Meta’s terms and its business messaging policy." },
      { title: "Only clients who agree get WhatsApp", detail: "Each client chooses WhatsApp in their own contact choices. Email notices keep working either way." },
      { title: "You can disconnect at any time", detail: "Nothing more goes out on WhatsApp after you disconnect. Clients’ choices are kept for when you reconnect." },
    ],
    source: WHATSAPP_SOURCE,
  };
}

function stripeRow(input: IntegrationsInput): IntegrationRow {
  const base = { logo: "/assets/logos/stripe.svg", name: "Stripe", tag: input.stripe.live ? "live" : "test mode", sub: "Client card payments" } as const;
  const manage = { label: "Manage", attrs: { "data-nav": "/sheet/settings?tab=billing#card-payments" } };
  if (!input.stripe.canSee) return { ...base, state: { tone: "gr", label: "Billing staff only" } };
  const account = input.stripe.account;
  if (!account) return { ...base, state: NOT_CONNECTED, action: input.stripe.isOwner ? { ...manage, label: "Set up" } : null };
  const state: MatterBadge =
    account.cardPayments === "unsupported"
      ? { tone: "bad", label: "Not supported" }
      : account.cardPayments === "active" && account.requirementsDue === 0
        ? { tone: "ok", label: "Connected" }
        : account.cardPayments === "pending" && account.requirementsDue === 0
          ? { tone: "chg", label: "Pending", detail: "Stripe is checking" }
          : { tone: "chg", label: "Action needed", detail: "finish with Stripe" };
  return { ...base, state, action: manage };
}

function composioSwitch(input: IntegrationsInput): IntegrationRow {
  const base = { logo: null, name: "Connected accounts", tag: "optional" } as const;
  const { configured, enabled, acceptedAt } = input.composio;
  if (!configured) {
    return {
      ...base,
      sub: "Composio isn’t set up on this server, so personal Gmail, Outlook and Google Calendar can’t be connected. Casevoya email and calendar work as usual.",
      state: { tone: "gr", label: "Not available" },
    };
  }
  const sub = enabled
    ? { left: acceptedAt ? `On since ${day(acceptedAt, input.timeZone)}` : "On", right: "mail and busy times pass through Composio (United States)" }
    : "Off. Turning it on lets each person connect their own Gmail, Outlook or Google Calendar through Composio (United States).";
  if (!input.isOwner) {
    return {
      ...base,
      sub: typeof sub === "string" ? `${sub} Only the firm owner can change this.` : { left: sub.left, right: `${sub.right}. Only the firm owner can change this` },
      state: enabled ? { tone: "ok", label: "On" } : { tone: "gr", label: "Off" },
    };
  }
  return {
    ...base,
    sub,
    toggle: { id: "swComposio", on: enabled, sr: "Connected accounts through Composio", attrs: { "data-composio": enabled ? "off" : "on", "data-org": input.organizationId } },
  };
}

export function integrationsData(input: IntegrationsInput): IntegrationsData {
  const inbound = input.firmSlug ? `receives at ${input.firmSlug}@${input.inboundDomain}` : "receives at your firm’s address once it has one";
  return {
    title: "Integrations",
    intro:
      "Casevoya’s own email and calendar work for everyone without any connection. Connecting a personal Gmail, Outlook or Google Calendar is optional and goes through Composio. Integrations marked planned aren’t available yet.",
    lead: [
      {
        logo: "/assets/brand/favicon.svg",
        name: "Casevoya email",
        tag: "built in",
        sub: { left: `Sends from ${input.fromAddress}`, right: inbound },
        state: { tone: "ok", label: "Connected" },
        action: { label: "Manage", attrs: { "data-nav": "/sheet/inbox" } },
      },
      {
        logo: "/assets/brand/favicon.svg",
        name: "Casevoya calendar",
        tag: "built in",
        sub: "Availability, consultations and deadlines",
        state: { tone: "ok", label: "Connected" },
        action: { label: "Manage", attrs: { "data-nav": "/sheet/calendar" } },
      },
      composioSwitch(input),
    ],
    microsoft: { left: "Outlook mail and calendar connect through Composio", right: "Teams planned" },
    rows: [
      stripeRow(input),
      planned("QuickBooks", "quickbooks.svg", "Accounting"),
      composioRow(input, "googlecalendar", "Google Calendar", "googlecalendar.svg", "Calendar busy times"),
      composioRow(input, "gmail", "Gmail", "gmail.svg", "Email from your Casevoya label, drafts only"),
      planned("Zoom", "zoom.svg", "Meetings"),
      planned("Dropbox", "dropbox.svg", "File import"),
      planned("Calendly", "calendly.svg", "Booking"),
      composioRow(input, "outlook", "Microsoft Outlook", "integrations/microsoftoutlook-color.svg", "Email drafts only"),
      composioRow(input, "outlook_calendar", "Microsoft 365 calendar", "integrations/microsoft365-color.svg", "Calendar"),
      planned("Microsoft Teams", "integrations/microsoftteams-color.svg", "Meetings"),
      planned("Google Meet", "googlemeet.svg", "Meetings"),
      planned("Twilio", "twilio.svg", { left: "SMS reminders", right: "optional" }),
      later("Xero", "xero.svg", "Accounting export", { tone: "gr", label: "Later" }),
      whatsappRow(input),
    ],
  };
}

/** The owner's disclosure, shown before connected accounts turn on. */
export function composioDialog(input: Pick<IntegrationsInput, "organizationId" | "isOwner" | "composio">): ComposioDialogData | null {
  if (!input.isOwner || !input.composio.configured || input.composio.enabled) return null;
  return {
    organizationId: input.organizationId,
    lead: "Casevoya’s own email and calendar keep working without this. Turning it on lets each person in the firm connect their own Gmail, Outlook or Google Calendar.",
    points: [
      {
        title: "Mail and busy times pass through Composio, in the United States",
        detail: "Only mail in the label each person chooses (“Casevoya” by default) and calendar busy times, never the whole mailbox or event details.",
      },
      { title: "If Vo drafts from connected mail, that text also goes to the AI provider", detail: "Vo only drafts. A person reviews and sends." },
      { title: "Nothing is sent from a connected mailbox", detail: "Replies are saved as drafts for the person to send. Calendars are never written to." },
      {
        title: "Each person connects their own account",
        detail: "Composio keeps the sign-in; Casevoya keeps only a connection id. Anyone can disconnect, and you can turn this off at any time.",
      },
    ],
    source: COMPOSIO_SOURCE,
  };
}

// ---------------------------------------------------------------------------------------------

export type NotificationPrefsInput = {
  organizationId: string;
  isOwner: boolean;
  /** The signed-in staff member's stored choices (kind -> email on). No entry means on. */
  email: Record<string, boolean>;
  quietHours: { start: string; end: string } | null;
};

export function notificationPrefsData(input: NotificationPrefsInput): NotificationPrefsData {
  const org = input.organizationId;
  const emailRows: NotificationPrefRow[] = STAFF_EMAIL_ROWS.map((row) =>
    row.locked
      ? { label: row.label, small: { left: row.small, right: row.why ?? "can’t be turned off" }, control: { kind: "badge", badge: { tone: "ok", label: "Always on" } } }
      : {
          label: row.label,
          small: row.small,
          control: {
            kind: "switch",
            item: { id: `np-${row.kind}`, on: input.email[row.kind] !== false, sr: row.label, attrs: { "data-notif-pref": row.kind, "data-org": org } },
          },
        },
  );
  const inApp: NotificationPrefRow[] = IN_APP_ROWS.map((row) => ({ label: row.label, small: row.small, control: { kind: "badge", badge: { tone: "gr", label: "In app only" } } }));
  const quiet = input.quietHours;
  const quietRow: NotificationPrefRow = {
    label: "Quiet hours for routine reminders",
    small: quiet
      ? { left: `${quiet.start.slice(0, 5)}–${quiet.end.slice(0, 5)} in the deadline’s timezone`, right: "critical notices still go out" }
      : { left: "Off: routine reminders go out at any hour", right: `turning on uses ${DEFAULT_QUIET_HOURS.start}–${DEFAULT_QUIET_HOURS.end}` },
    art: true,
    control: {
      kind: "switch",
      item: {
        id: "swQuiet",
        on: Boolean(quiet),
        sr: "Quiet hours",
        attrs: input.isOwner ? { "data-quiet": quiet ? "off" : "on", "data-org": org } : { disabled: true, title: "Only the firm owner can change this" },
      },
    },
  };
  return {
    intro: "Choose what reaches you by email. Security notices and anything a client is waiting on always go out. Notifications inside Casevoya always show.",
    sections: [
      { title: "Email me when", rows: emailRows },
      { title: "In Notifications only, never emailed", rows: inApp },
      {
        title: "Weekly digest",
        rows: [{ label: "Monday summary", small: "Not built yet, so nothing is sent", control: { kind: "badge", badge: { tone: "gr", label: "Planned" } } }],
      },
      {
        title: "Service messages and marketing are separate",
        rows: [
          {
            label: "Service messages to clients",
            small: "Deadlines, requests, invoices. Clients can’t turn off critical notices; routine ones follow each client’s own email choice.",
            control: { kind: "badge", badge: { tone: "ok", label: "Always on" } },
          },
          {
            label: "Marketing to clients",
            small: "Casevoya sends clients no marketing. It would need separate, recorded consent",
            control: { kind: "badge", badge: { tone: "gr", label: "Off" } },
          },
          quietRow,
        ],
      },
    ],
  };
}
