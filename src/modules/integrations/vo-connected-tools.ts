/**
 * Vo's tools for a staff member's connected apps (pure). Unlike the mail and calendar code, which
 * discovers tool slugs and classifies them (composio-policy.ts), Vo gets an explicit, short list of
 * Composio actions per toolkit, each verified against Composio's tool list (GET /api/v3/tools,
 * read 2026-10-31). Anything not listed here is refused, whatever the model asks for.
 *
 *   read   runs at once, as the staff member, after composio_connection_ready for that toolkit
 *   write  never runs from Vo: it becomes a proposal the staff member reads and confirms
 *          (connected_action_proposals); only their click runs it
 *
 * Nothing here sends mail, posts a message, invites attendees, deletes, moves or cancels anything
 * (calendar writes take no attendee list, so no invitation goes out).
 */
export type VoConnectedKind = "read" | "write";

export type VoConnectedAction = {
  /** Composio's action slug. */
  slug: string;
  kind: VoConnectedKind;
  /** What Vo is told the action does. */
  description: string;
  /** Argument names Vo may pass; anything else is dropped. */
  args: readonly string[];
  /** Arguments always set by Casevoya, overriding the model's. */
  fixed?: Record<string, unknown>;
};

/** Our connection kind (staff_connections.toolkit) for each app Vo can use. */
export type VoConnectedToolkit =
  | "gmail"
  | "outlook"
  | "googlecalendar"
  | "outlook_calendar"
  | "zoom"
  | "googlemeet"
  | "microsoft_teams"
  | "calendly"
  | "dropbox"
  | "quickbooks";

/** Composio's toolkit slug (Outlook mail and calendar share one connection kind's toolkit). */
export const VO_COMPOSIO_TOOLKIT: Record<VoConnectedToolkit, string> = {
  gmail: "gmail",
  outlook: "outlook",
  googlecalendar: "googlecalendar",
  outlook_calendar: "outlook",
  zoom: "zoom",
  googlemeet: "googlemeet",
  microsoft_teams: "microsoft_teams",
  calendly: "calendly",
  dropbox: "dropbox",
  quickbooks: "quickbooks",
};

export const VO_CONNECTED_ACTIONS: Record<VoConnectedToolkit, readonly VoConnectedAction[]> = {
  gmail: [
    // Reads stay inside the staff member's Casevoya label: the query is prefixed server-side.
    { slug: "GMAIL_FETCH_EMAILS", kind: "read", description: "List recent emails in your Casevoya label (optionally matching a search).", args: ["query", "max_results"] },
    { slug: "GMAIL_CREATE_EMAIL_DRAFT", kind: "write", description: "Save an email draft in your Gmail (you send it yourself).", args: ["recipient_email", "subject", "body"] },
  ],
  outlook: [{ slug: "OUTLOOK_OUTLOOK_CREATE_DRAFT", kind: "write", description: "Save an email draft in your Outlook (you send it yourself).", args: ["to_recipients", "subject", "body"] }],
  googlecalendar: [
    { slug: "GOOGLECALENDAR_EVENTS_LIST", kind: "read", description: "List events on your primary Google Calendar in a time range.", args: ["timeMin", "timeMax", "q", "maxResults"], fixed: { calendarId: "primary" } },
    { slug: "GOOGLECALENDAR_FIND_FREE_SLOTS", kind: "read", description: "Find free time on your Google Calendar in a time range.", args: ["time_min", "time_max", "timezone"] },
    { slug: "GOOGLECALENDAR_CREATE_EVENT", kind: "write", description: "Create an event on your Google Calendar, optionally with a Google Meet link.", args: ["summary", "description", "start_datetime", "event_duration_hour", "event_duration_minutes", "timezone", "create_meeting_room"] },
  ],
  outlook_calendar: [
    { slug: "OUTLOOK_OUTLOOK_LIST_EVENTS", kind: "read", description: "List events on your Outlook calendar.", args: ["filter", "top"] },
    { slug: "OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT", kind: "write", description: "Create an event on your Outlook calendar, optionally as a Teams meeting.", args: ["subject", "body", "start_datetime", "end_datetime", "time_zone", "is_online_meeting"] },
  ],
  zoom: [
    { slug: "ZOOM_LIST_MEETINGS", kind: "read", description: "List your upcoming Zoom meetings.", args: ["type", "page_size"], fixed: { userId: "me" } },
    { slug: "ZOOM_GET_A_MEETING", kind: "read", description: "Read one of your Zoom meetings by id.", args: ["meetingId"] },
    { slug: "ZOOM_CREATE_A_MEETING", kind: "write", description: "Create a Zoom meeting and its join link.", args: ["topic", "start_time", "duration", "timezone", "agenda"], fixed: { userId: "me" } },
  ],
  googlemeet: [
    { slug: "GOOGLEMEET_GET_MEET", kind: "read", description: "Read a Google Meet space by its meeting code.", args: ["space_name"] },
    { slug: "GOOGLEMEET_CREATE_MEET", kind: "write", description: "Create a Google Meet link.", args: [] },
  ],
  microsoft_teams: [{ slug: "MICROSOFT_TEAMS_CREATE_MEETING", kind: "write", description: "Create a Microsoft Teams meeting link.", args: ["subject", "start_date_time", "end_date_time"] }],
  calendly: [
    { slug: "CALENDLY_GET_CURRENT_USER", kind: "read", description: "Read your Calendly profile (needed for your user URI).", args: [] },
    { slug: "CALENDLY_LIST_USER_S_EVENT_TYPES", kind: "read", description: "List your Calendly event types.", args: ["user", "active", "count"] },
    { slug: "CALENDLY_LIST_EVENTS", kind: "read", description: "List your scheduled Calendly events.", args: ["user", "min_start_time", "max_start_time", "status", "count"] },
    { slug: "CALENDLY_CREATE_SINGLE_USE_SCHEDULING_LINK", kind: "write", description: "Create a one-time Calendly booking link for one of your event types.", args: ["owner", "max_event_count"], fixed: { owner_type: "EventType" } },
  ],
  dropbox: [
    { slug: "DROPBOX_LIST_FILES_IN_FOLDER", kind: "read", description: "List files in one of your Dropbox folders.", args: ["path", "limit"] },
    { slug: "DROPBOX_SEARCH_FILE_OR_FOLDER", kind: "read", description: "Search your Dropbox by file or folder name.", args: ["query"] },
    { slug: "DROPBOX_CREATE_FOLDER", kind: "write", description: "Create a folder in your Dropbox.", args: ["path", "autorename"] },
  ],
  quickbooks: [
    { slug: "QUICKBOOKS_READ_CUSTOMER", kind: "read", description: "Read one QuickBooks customer by id.", args: ["customer_id"] },
    { slug: "QUICKBOOKS_CUSTOMER_BALANCE_REPORT", kind: "read", description: "The QuickBooks customer balance report (who owes what).", args: ["customer_ids", "report_date", "date_macro"] },
    { slug: "QUICKBOOKS_QUERY_ACCOUNT", kind: "read", description: "List QuickBooks accounts matching a query.", args: ["query"] },
  ],
};

export const VO_CONNECTED_TOOLKITS = Object.keys(VO_CONNECTED_ACTIONS) as VoConnectedToolkit[];

export function isVoConnectedToolkit(value: unknown): value is VoConnectedToolkit {
  return typeof value === "string" && (VO_CONNECTED_TOOLKITS as string[]).includes(value);
}

/** The listed action for this toolkit and slug, or null (refused). */
export function voConnectedAction(toolkit: unknown, slug: unknown): VoConnectedAction | null {
  if (!isVoConnectedToolkit(toolkit) || typeof slug !== "string") return null;
  return VO_CONNECTED_ACTIONS[toolkit].find((action) => action.slug === slug.toUpperCase()) ?? null;
}

const MAX_ARG = 4000;

/**
 * The arguments Composio gets: only the listed names, plain JSON values of bounded size, then the
 * fixed ones on top. Gmail reads are kept inside the staff member's label.
 */
export function voConnectedArguments(action: VoConnectedAction, raw: unknown, ctx: { mailLabel?: string | null } = {}): Record<string, unknown> | { error: string } {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const name of action.args) {
    if (!(name in input)) continue;
    const value = input[name];
    if (value === null || ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value)) {
      if (JSON.stringify(value).length > MAX_ARG) return { error: `${name} is too long.` };
      out[name] = value;
    }
  }
  Object.assign(out, action.fixed ?? {});
  if (action.slug === "GMAIL_FETCH_EMAILS") {
    const label = (ctx.mailLabel ?? "").trim();
    if (!label) return { error: "Connect your mailbox first." };
    const extra = typeof out.query === "string" ? out.query.replace(/\blabel:\S+/gi, "").trim() : "";
    out.query = `label:"${label.replace(/"/g, "")}"${extra ? ` ${extra}` : ""}`;
    out.max_results = Math.min(20, Math.max(1, Number(out.max_results) || 10));
  }
  return out;
}

/** One line a person reads before confirming a write, e.g. "Zoom: Create a Zoom meeting… (topic: Intake call)". */
export function voProposalSummary(toolkit: VoConnectedToolkit, action: VoConnectedAction, args: Record<string, unknown>): string {
  const shown = Object.entries(args)
    .filter(([name]) => !(action.fixed && name in action.fixed))
    .map(([name, value]) => `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`.slice(0, 160))
    .join("; ");
  return `${toolkit}: ${action.description}${shown ? ` (${shown})` : ""}`.slice(0, 600);
}

/** Vo's tool catalogue in words, for its instructions. */
export function voConnectedCatalogue(connected: readonly VoConnectedToolkit[]): string {
  return connected
    .map((toolkit) => `${toolkit}: ${VO_CONNECTED_ACTIONS[toolkit].map((action) => `${action.slug} (${action.kind}${action.kind === "write" ? ", needs the person's confirmation" : ""}) ${action.description}`).join(" | ")}`)
    .join("\n");
}
