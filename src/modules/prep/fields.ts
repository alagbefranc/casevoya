/**
 * Turns a field list typed in the Add form template dialog into the JSON the database stores.
 * One line per field: key | label as printed | yes or no | fact key.
 * The fact key is optional. It is the intake answer key, not a government field code.
 */

const KEY = /^[a-z][a-z0-9_]{0,79}$/;

export type ProposedField = {
  field_key: string;
  label: string;
  required: boolean;
  fact_field_key: string | null;
};

export function parseFieldLines(raw: string): { fields: ProposedField[] } | { error: string } {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 200) return { error: "A form template holds at most 200 fields." };
  const fields: ProposedField[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 3) return { error: "Each field is: key | label as printed | yes or no | fact key." };
    const fieldKey = parts[0] ?? "";
    const label = parts[1] ?? "";
    const requiredText = parts[2] ?? "";
    const fact = parts[3] ?? "";
    if (!KEY.test(fieldKey)) return { error: "A field key uses lowercase letters, digits and underscores." };
    if (!label || label.length > 200) return { error: "Enter each field label as the form prints it." };
    const yes = /^(yes|required|true)$/i.test(requiredText);
    const no = /^(no|optional|false)$/i.test(requiredText);
    if (!yes && !no) return { error: "Say yes or no for whether the form marks the field required." };
    const factKey = fact || null;
    if (factKey && !KEY.test(factKey)) return { error: "A fact key uses lowercase letters, digits and underscores." };
    if (seen.has(fieldKey)) return { error: "Each field key is used once." };
    seen.add(fieldKey);
    fields.push({ field_key: fieldKey, label, required: yes, fact_field_key: factKey });
  }
  return { fields };
}
