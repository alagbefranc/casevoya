/**
 * MIG decision 2 (gap #187): one kind of record per file. The database refuses a file whose
 * column headings match more than one import kind (app.migration_kinds_in_headers, at staging and
 * at mapping) with "this file holds more than one kind of record: <kind>; <kind>". Pure: the words
 * the owner reads, naming the kinds found and how to split the file.
 */

/** "Tasks and Key dates", "Notes, Tasks and Key dates". */
function listKinds(kinds: readonly string[]): string {
  if (kinds.length <= 1) return kinds[0] ?? "";
  return `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
}

/** The kinds a refusal names, in the order the upload picker lists them. */
export function mixedKinds(message: string): string[] | null {
  const match = /holds more than one kind of record: ([^\n]+)/i.exec(message);
  if (!match) return null;
  const kinds = match[1]
    .split(";")
    .map((kind) => kind.trim())
    .filter(Boolean);
  return kinds.length > 1 ? kinds : null;
}

/** The owner's message for a mixed file, or null when the refusal is something else. */
export function mixedFileMessage(message: string): string | null {
  const kinds = mixedKinds(message);
  if (!kinds) return null;
  return `This file holds more than one kind of record: ${listKinds(kinds)}. Nothing was imported. Import one kind per file: copy each kind’s columns, with the matter reference or person they belong to, into its own CSV and upload each one with “What’s in the file” set to that kind. Import clients and matters first.`;
}
