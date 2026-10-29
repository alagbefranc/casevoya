/**
 * PREP-01: how a form template's transcribed fields read the matter's approved facts.
 * A field with no fact key is completed by hand. A field with a fact key is filled when at least
 * one approved fact uses that key, and missing otherwise. This does not fill a government PDF.
 */

export type ApprovedFactRef = {
  answerId: string;
  personName: string;
  label: string;
  valueText: string;
  reviewedAt: string;
  fieldKey: string;
};

export type TemplateFieldRef = {
  fieldKey: string;
  label: string;
  required: boolean;
  factFieldKey: string | null;
};

export type FieldStatus = "filled" | "missing" | "manual";

export type FieldFill = TemplateFieldRef & {
  status: FieldStatus;
  facts: ApprovedFactRef[];
};

export type StaleReason = "not_current" | "not_yet_effective" | "recheck_due";

export function fieldStatus(factFieldKey: string | null, matches: number): FieldStatus {
  if (!factFieldKey) return "manual";
  return matches > 0 ? "filled" : "missing";
}

/** One row per template field, with every approved fact that supplies its value. */
export function mapTemplateFields(fields: TemplateFieldRef[], facts: ApprovedFactRef[]): FieldFill[] {
  return fields.map((field) => {
    const matched = field.factFieldKey ? facts.filter((fact) => fact.fieldKey === field.factFieldKey) : [];
    return { ...field, status: fieldStatus(field.factFieldKey, matched.length), facts: matched };
  });
}

export function staleLabel(reason: StaleReason): string {
  switch (reason) {
    case "not_current":
      return "This form version is no longer the approved one. Pin the current template.";
    case "not_yet_effective":
      return "The effective date recorded on this template has not arrived.";
    case "recheck_due":
      return "The official page is due for a re-check. Approve a new template from that page before release.";
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}

export function isStaleReason(value: string | null | undefined): value is StaleReason {
  return value === "not_current" || value === "not_yet_effective" || value === "recheck_due";
}
