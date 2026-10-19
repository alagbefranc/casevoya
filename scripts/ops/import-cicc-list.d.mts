export type CiccMapping = { index: Record<string, number>; extra: [string, number][] };
export type CiccRow = {
  licence_number: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  entitlement: string | null;
  licence_class: string | null;
  fields: Record<string, string>;
};
export function parseCsv(text: string, delimiter?: string): string[][];
export function mapHeaders(headers: string[], columns?: Record<string, string[]>): CiccMapping;
export function toRow(cells: string[], mapping: CiccMapping, statusMap?: Record<string, string>): CiccRow | null;
