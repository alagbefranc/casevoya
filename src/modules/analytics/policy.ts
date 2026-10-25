/**
 * Product analytics policy (PRD ADM-04, PRD §22).
 *
 * Casevoya runs NO product analytics today: no analytics or telemetry SDK, tag or beacon is in the
 * app, the portal, the Vo agent or the workers, and nothing about how people use the product is
 * sent anywhere. `tests/analytics-policy.test.ts` fails if an analytics SDK or beacon appears
 * without going through this module.
 *
 * The rule any future product analytics must follow: aggregate operational metadata only.
 *   - Allowed: the fields in ANALYTICS_ALLOWED_FIELDS (what happened, where in the product, when,
 *     how long, how many, and pseudonymous tenant/user ids), passed through `operationalEvent`.
 *   - Never: immigration narratives (intake answers, notes, letters, Vo drafts or summaries),
 *     identity numbers (UCI, passport, SIN, licence or application numbers), uploaded documents
 *     (contents, file names, extracted text) or message bodies (portal, email, WhatsApp, SMS),
 *     nor names, emails, phone numbers or free text of any kind.
 * Adding analytics also needs a DECISIONS.md row and an update to the Settings > Security copy.
 */

/** True once Casevoya sends product analytics anywhere. It doesn't. */
export const PRODUCT_ANALYTICS_ENABLED = false;

/** The only fields a product analytics event may carry. */
export const ANALYTICS_ALLOWED_FIELDS = [
  "event", // a fixed event name from code, e.g. "matter.stage_changed"
  "route", // the route pattern, e.g. "/sheet/matters/[id]", never a filled-in URL or query string
  "occurred_at",
  "duration_ms",
  "count",
  "result", // "success" | "error" | "cancelled"
  "tenant_ref", // pseudonymous firm id
  "actor_ref", // pseudonymous user id
  "role", // the staff role or "client"
  "app_version",
] as const;

export type AnalyticsField = (typeof ANALYTICS_ALLOWED_FIELDS)[number];
export type OperationalEvent = Partial<Record<AnalyticsField, string | number | boolean>>;

/** What product analytics must never carry, in the words the Settings copy uses. */
export const ANALYTICS_EXCLUDED = ["immigration narratives", "identity numbers", "uploaded documents", "message bodies"] as const;

/** Known analytics / telemetry SDKs and beacons. Any of these in the code must import this module. */
export const ANALYTICS_SDKS = [
  "posthog-js",
  "posthog-node",
  "@vercel/analytics",
  "@vercel/speed-insights",
  "@segment/analytics-next",
  "@segment/analytics-node",
  "analytics",
  "mixpanel-browser",
  "mixpanel",
  "@amplitude/analytics-browser",
  "@amplitude/analytics-node",
  "amplitude-js",
  "react-ga4",
  "react-ga",
  "@next/third-parties",
  "plausible-tracker",
  "@sentry/nextjs",
  "@sentry/browser",
  "@sentry/node",
  "@datadog/browser-rum",
  "@fullstory/browser",
  "logrocket",
  "hotjar",
  "@hotjar/browser",
] as const;

/** Beacon hosts that would mean a tag was pasted into a page. */
export const ANALYTICS_BEACON_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "static.cloudflareinsights.com",
  "plausible.io/js",
  "posthog.com",
  "cdn.segment.com",
  "cdn.mxpnl.com",
  "cdn.amplitude.com",
  "static.hotjar.com",
  "cdn.logrocket.io",
] as const;

const ALLOWED = new Set<string>(ANALYTICS_ALLOWED_FIELDS);
const MAX_TEXT = 120;

/**
 * Keeps only allowlisted fields with plain values (short strings, finite numbers, booleans).
 * Everything else, including any nested object, is dropped, never forwarded.
 */
export function operationalEvent(input: Record<string, unknown>): OperationalEvent {
  const event: OperationalEvent = {};
  for (const [field, value] of Object.entries(input)) {
    if (!ALLOWED.has(field)) continue;
    if (typeof value === "string" && value.length <= MAX_TEXT) event[field as AnalyticsField] = value;
    else if (typeof value === "number" && Number.isFinite(value)) event[field as AnalyticsField] = value;
    else if (typeof value === "boolean") event[field as AnalyticsField] = value;
  }
  return event;
}

/** Settings > Security: what the firm is told about product analytics. */
export const PRODUCT_ANALYTICS_COPY = {
  title: "Product analytics",
  detail: PRODUCT_ANALYTICS_ENABLED
    ? `Operational metadata only (actions, timings and counts, with pseudonymous ids). Never ${ANALYTICS_EXCLUDED.slice(0, -1).join(", ")} or ${ANALYTICS_EXCLUDED.at(-1)}`
    : `Casevoya runs no product analytics. If it ever does, it will use operational metadata only (actions, timings and counts, with pseudonymous ids), never ${ANALYTICS_EXCLUDED.slice(0, -1).join(", ")} or ${ANALYTICS_EXCLUDED.at(-1)}`,
  badge: PRODUCT_ANALYTICS_ENABLED ? "Metadata only" : "None",
} as const;
