/**
 * Firm message templates (PRD OPS-04): merge fields and how they are filled. Pure: no database.
 * The database (public.save_message_template) refuses any other {field}; an announcement merges
 * the firm name only, because it goes to many people at once.
 *
 * Values are only ever ones the screen already has. A field with no value is left in the text as
 * written ("{consultant_name}") so the person sees the gap and fills it; nothing is invented, and
 * a message still holding one is not sent.
 */

export const MERGE_FIELDS = ["client_first_name", "matter_reference", "firm_name", "consultant_name"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeValues = Partial<Record<MergeField, string | null>>;

export const MERGE_LABELS: Record<MergeField, string> = {
  client_first_name: "Client first name",
  matter_reference: "Matter reference",
  firm_name: "Firm name",
  consultant_name: "Consultant name",
};

/** An approved template as the composer offers it. */
export type MessageTemplateOption = { id: string; name: string; body: string };

const FIELD = /\{([^{}]*)\}/g;

/** The template's text with every field that has a value filled; the rest stay as {field}. */
export function fillTemplate(body: string, values: MergeValues): string {
  return body.replace(FIELD, (whole, name: string) => {
    const value = (values as Record<string, string | null | undefined>)[name];
    return typeof value === "string" && value.trim() ? value.trim() : whole;
  });
}

/** Merge fields still in the text (each once, in order). */
export function unfilledFields(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(FIELD)) {
    if ((MERGE_FIELDS as readonly string[]).includes(match[1]) && !found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/** "Fill in {consultant_name} before sending." or null when nothing is left to fill. */
export function unfilledNotice(text: string): string | null {
  const left = unfilledFields(text);
  if (!left.length) return null;
  return `Fill in ${left.map((name) => `{${name}}`).join(", ")} before sending.`;
}

/** Fields the database would refuse in this template. */
export function unknownFields(text: string, announcement: boolean): string[] {
  const allowed: readonly string[] = announcement ? ["firm_name"] : MERGE_FIELDS;
  const found: string[] = [];
  for (const match of text.matchAll(FIELD)) if (!allowed.includes(match[1]) && !found.includes(match[1])) found.push(match[1]);
  return found;
}

/** The first word of a name, or null. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** The database's refusals for templates, said plainly. */
export function templateError(raw: string): string {
  if (/merge field/i.test(raw)) return "That template uses a field Casevoya can’t fill. Use only the fields listed.";
  if (/title/i.test(raw)) return "Give the announcement a title of up to 120 characters.";
  if (/name must be/i.test(raw)) return "Give the template a name of up to 120 characters.";
  if (/text must be/i.test(raw)) return "Write the template text, up to 4,000 characters.";
  if (/changed since/i.test(raw)) return "Someone changed this template since you opened it. Refresh the page and try again.";
  if (/denied|42501/i.test(raw)) return "You can’t do that with templates. A firm owner or licensed consultant approves them.";
  if (/not found/i.test(raw)) return "That template isn’t available any more. Refresh the page.";
  return "That wasn’t saved.";
}
