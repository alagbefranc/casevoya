import { z } from "zod";

const intervalUnits = ["days", "months", "business_days"] as const;

export const productIntervalSchema = z.strictObject({
  unit: z.enum(intervalUnits),
  count: z.number().int().min(1).max(3650),
});

export type ProductInterval = z.infer<typeof productIntervalSchema>;

/**
 * Days and months become a duration the database can add.
 * business_days stays null: there is no jurisdiction calendar here, and that
 * unit is not an SLA and is not used to mark a licence verified.
 * The count is whatever the setting row holds. This function has no preferred count.
 */
export function intervalFromSetting(value: unknown): { unit: "days" | "months"; count: number } | null {
  const parsed = productIntervalSchema.safeParse(value);
  if (!parsed.success || parsed.data.unit === "business_days") return null;
  return { unit: parsed.data.unit, count: parsed.data.count };
}
