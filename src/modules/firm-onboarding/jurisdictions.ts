/** Checkboxes on the “Where you practise” step. Codes are the two letters save_firm_setup stores. */
export const PRACTICE_JURISDICTIONS = [
  ["j0", "CA"],
  ["j1", "ON"],
  ["j2", "BC"],
  ["j3", "AB"],
  ["j4", "MB"],
  ["j5", "SK"],
  ["j6", "NS"],
  ["j7", "QC"],
] as const;

const FIELD_BY_CODE = new Map<string, string>(PRACTICE_JURISDICTIONS.map(([field, code]) => [code, field]));

/** The design opens with Federal and Ontario selected. */
export const DEFAULT_JURISDICTION_CODES = ["CA", "ON"] as const;

export function jurisdictionCodesFromFields(fields: Record<string, string | boolean>): string[] {
  const codes: string[] = [];
  for (const [field, code] of PRACTICE_JURISDICTIONS) {
    if (fields[field] === true) codes.push(code);
  }
  return codes;
}

export function jurisdictionFieldChecked(codes: readonly string[]): Record<string, boolean> {
  const selected = new Set(codes);
  const checked: Record<string, boolean> = {};
  for (const [field, code] of PRACTICE_JURISDICTIONS) {
    checked[field] = selected.has(code);
  }
  return checked;
}

export function jurisdictionCodePatternOk(codes: readonly string[]): boolean {
  return codes.every((code) => FIELD_BY_CODE.has(code) && /^[A-Z]{2}$/.test(code));
}
