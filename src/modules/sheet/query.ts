import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Row = Record<string, unknown>;

type Loose = {
  select(columns: string): Loose;
  eq(column: string, value: string): Loose;
  is(column: string, value: null): Loose;
  order(column: string, options?: { ascending?: boolean }): Loose;
  limit(count: number): PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
};

/** Tables added with the intake and task migrations are not in database.types.ts yet. */
export function looseFrom(supabase: SupabaseClient<Database>, table: "tasks" | "deadlines" | "intake_templates" | "intake_responses"): Loose {
  return (supabase as unknown as { from(name: string): Loose }).from(table);
}

export function text(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function numberValue(row: Row, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : 0;
}
