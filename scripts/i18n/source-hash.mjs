// The hash of one template's English source strings (src/modules/email/designs/i18n-source.json).
// fr-drafts.json stores it per template; a different hash means the English changed after the
// French was drafted or approved, so the French is stale. Used by draft-email-fr.mjs and the tests.
import { createHash } from "node:crypto";

export function sourceHash(strings) {
  const entries = Object.keys(strings)
    .sort()
    .map((key) => [key, strings[key]]);
  return `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
}

/** Template ids whose draft is missing, has a different key set, or a different English hash. */
export function staleDrafts(source, drafts) {
  const stale = [];
  for (const [id, strings] of Object.entries(source)) {
    const entry = drafts.templates?.[id];
    const keys = Object.keys(strings).sort().join(",");
    if (
      !entry ||
      entry.sourceHash !== sourceHash(strings) ||
      Object.keys(entry.strings ?? {}).sort().join(",") !== keys ||
      Object.entries(strings).some(([key, en]) => entry.strings[key]?.en !== en || !entry.strings[key]?.fr)
    ) {
      stale.push(id);
    }
  }
  return stale;
}
