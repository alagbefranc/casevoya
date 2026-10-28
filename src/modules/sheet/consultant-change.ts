/**
 * ORG-06: Change consultant on a matter's People tab. Pure helpers for the dialog's data and the
 * toast after saving; the database decides who may change it and who is told.
 */
import type { ConsultantDialogData } from "@/components/sheet/designer/matter";

function count(value: unknown): number {
  return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function roleLabel(role: unknown): string {
  const text = typeof role === "string" ? role.replaceAll("_", " ").trim() : "";
  return text ? text[0].toUpperCase() + text.slice(1) : "On the matter";
}

/** public.consultant_change_audience's rows, as the dialog lists them. */
export function parseAudience(raw: unknown): ConsultantDialogData["audience"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
    return name ? [{ name, role: roleLabel(item.role), emailed: item.emailed === true }] : [];
  });
}

/** The dialog: verified consultants (the current one first), and who would be told. */
export function consultantDialog(input: {
  consultants: readonly { id: string; name: string }[];
  current: string | null;
  audience: unknown;
  sample: boolean;
}): ConsultantDialogData {
  const sorted = [...input.consultants].sort((a, b) => (a.id === input.current ? -1 : b.id === input.current ? 1 : a.name.localeCompare(b.name, "en-CA")));
  return { consultants: sorted, current: input.current, audience: parseAudience(input.audience), sample: input.sample };
}

/** The toast's line after a change: how many were told, and how. */
export function consultantChangeDone(result: { told?: unknown; emailed?: unknown }): string {
  const told = count(result.told);
  const emailed = count(result.emailed);
  if (!told) return "Nobody on the matter has a portal account, so tell the client yourself. Recorded in the matter’s history.";
  const how = emailed === told ? "a portal notice and an email" : emailed ? `a portal notice (${plural(emailed, "email")} sent)` : "a portal notice";
  return `${plural(told, "person", "people")} got ${how}. Recorded in the matter’s history.`;
}
