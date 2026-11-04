/**
 * The plan picked on casevoya.ca/pricing (#330): `/start-trial?plan=solo|practice|firm&interval=month|year`
 * is remembered in this browser so the Choose a plan dialog opens with it pressed. Only known
 * values are kept; the server still checks the choice at checkout.
 */
export const PLAN_CHOICE_KEY = "cv-plan-choice";
const PLANS = ["solo", "practice", "firm"] as const;
const INTERVALS = ["month", "year"] as const;
export type PlanChoice = { plan: (typeof PLANS)[number]; interval: (typeof INTERVALS)[number] | null };

export function parsePlanChoice(plan: string | null | undefined, interval: string | null | undefined): PlanChoice | null {
  const p = (plan ?? "").trim().toLowerCase();
  if (!(PLANS as readonly string[]).includes(p)) return null;
  const raw = (interval ?? "").trim().toLowerCase();
  const i = raw === "annual" || raw === "yearly" ? "year" : raw === "monthly" ? "month" : raw;
  return { plan: p as PlanChoice["plan"], interval: (INTERVALS as readonly string[]).includes(i) ? (i as PlanChoice["interval"]) : null };
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Keeps `?plan=` / `?interval=` from a URL query, if any. */
export function rememberPlanChoice(search: string, store: Store): PlanChoice | null {
  const params = new URLSearchParams(search);
  const choice = parsePlanChoice(params.get("plan"), params.get("interval"));
  if (choice) {
    try {
      store.setItem(PLAN_CHOICE_KEY, JSON.stringify(choice));
    } catch {
      // Storage can be unavailable; the owner picks again in the dialog.
    }
  }
  return choice;
}

export function readPlanChoice(store: Store): PlanChoice | null {
  try {
    const raw = store.getItem(PLAN_CHOICE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { plan?: string; interval?: string | null };
    return parsePlanChoice(saved.plan, saved.interval);
  } catch {
    return null;
  }
}
