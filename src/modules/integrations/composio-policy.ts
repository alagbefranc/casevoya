/**
 * Which Composio tools Casevoya may run (pure). Tool slugs are never hard-coded as an allowlist:
 * they are discovered at runtime from a toolkit-scoped session (session.tools()) and classified
 * here. Anything that could send, forward, reply, delete, move, import, or create or change a
 * calendar event is BLOCKED, whatever the toolkit. Only three purposes exist:
 *   read      list or read mail (always narrowed to the staff member's Casevoya label/folder)
 *   draft     create a draft in the staff member's own mailbox (they send it themselves)
 *   freebusy  read busy times from their calendar
 * Composio toolkit pages consulted for the block patterns (2026-10-18):
 * https://docs.composio.dev/toolkits/gmail.md, /toolkits/outlook.md, /toolkits/googlecalendar.md.
 */

export type ComposioPurpose = "read" | "draft" | "freebusy";
export type ComposioClass = ComposioPurpose | "blocked";

/** Verbs that change mail or calendars or reach other people. Checked first. */
const BLOCK = /(SEND|REPLY|FORWARD|DELETE|TRASH|REMOVE|MOVE|IMPORT|INSERT|PATCH|UPDATE|MODIFY|CREATE_EVENT|QUICK_ADD|BATCH|CLEAR|ACL|WATCH|CHANNELS_STOP|SUBSCRIBE|SHARE|ARCHIVE|LABEL_(ADD|CREATE)|ADD_LABEL|CREATE_LABEL|CREATE_CALENDAR|DUPLICATE|SETTINGS|FILTER|VACATION|AUTO_?REPLY|RULE)/;

export function classifyComposioTool(slug: string): ComposioClass {
  const s = slug.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(s)) return "blocked";
  if (/(FREE_?BUSY|GET_SCHEDULE|FIND_FREE_SLOTS)/.test(s)) return "freebusy";
  // A draft tool is allowed only when it creates a draft and does nothing else listed above.
  if (/CREATE(_EMAIL)?_DRAFT$/.test(s) && !/SEND/.test(s)) return "draft";
  if (BLOCK.test(s)) return "blocked";
  if (/(FETCH|LIST|GET|SEARCH|READ)/.test(s) && /(EMAIL|MESSAGE|MAIL|LABEL|FOLDER|THREAD)/.test(s)) return "read";
  return "blocked";
}

export function allowedFor(slug: string, purpose: ComposioPurpose): boolean {
  return classifyComposioTool(slug) === purpose;
}

/** Slugs from a session's tool list in whatever shape the provider returns them. */
export function toolSlugs(tools: unknown): string[] {
  const list = Array.isArray(tools) ? tools : tools && typeof tools === "object" ? Object.values(tools as Record<string, unknown>) : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const fn = record.function as Record<string, unknown> | undefined;
      const name = fn?.name ?? record.name ?? record.slug;
      if (typeof name === "string") out.push(name);
    }
  }
  return [...new Set(out)];
}
