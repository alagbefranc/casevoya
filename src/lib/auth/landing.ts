import type { HomeRoute } from "@/lib/auth/home-route";

export const SAMPLE_MODE_LANDING = "/sheet/sample-mode";

/**
 * Where /app (the default after sign-in and two-step, used whenever there is no explicit
 * `next`) sends a person. Staff of a firm in sample mode land on Finish setup; everyone else
 * goes to their usual home. An explicit `next` never reaches /app, so a deep link still wins.
 */
export function defaultLanding(home: HomeRoute, sampleMode: boolean): string {
  if (home === "/sign-in") return "/sign-in?next=/app";
  if (home === "/sheet" && sampleMode) return SAMPLE_MODE_LANDING;
  return home;
}
