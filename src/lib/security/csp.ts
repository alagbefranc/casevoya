import { ANALYTICS_BEACON_HOSTS } from "@/modules/analytics/policy";
import { isEmbeddablePath } from "@/lib/security/framing";

/**
 * Content-Security-Policy for pages, set by the proxy.
 *
 * Nonces are not used. Next can stamp a per-request nonce onto its own inline scripts when the
 * proxy sets an `x-nonce` request header, but that does not work in this app:
 *
 * 1. The non-Workers build turns on Cache Components (`cacheComponents` in next.config.ts).
 *    A nonce has to be unique per response and present both in the header and in the HTML.
 *    A cached shell would keep a nonce that does not match the next request's header, and
 *    the browser would block the page's scripts.
 * 2. Production is OpenNext on Cloudflare. find.casevoya.ca is prebuilt HTML from the ASSETS
 *    binding (`rewriteFindHost` in src/lib/supabase/proxy.ts), with a same-origin `app.js` and
 *    no per-request nonce. A nonce `script-src` on that response would block the page.
 * 3. Stripe is injected at runtime without a nonce we control. `loadStripe`
 *    (src/components/portal/pay-live.tsx) inserts https://js.stripe.com, and
 *    `loadConnectAndInitialize` (src/components/sheet/stripe-connect.tsx) inserts
 *    https://connect-js.stripe.com. `'strict-dynamic'` would ignore those host allowlists
 *    unless the inserting script itself carried a nonce, which the cached and static HTML
 *    cannot do.
 * 4. LiveKit does not load a remote script (`livekit-client` is bundled). It needs
 *    `connect-src` for its websocket. A nonce would not help it, and a broken script policy
 *    would still take down the call page's Next scripts.
 *
 * The full allowlist, including `script-src` with `'unsafe-inline'` and the Stripe hosts, is
 * sent as Content-Security-Policy-Report-Only unless CSP_ENFORCE=1. Report-only does not block.
 * `frame-ancestors` is ignored in a report-only policy, so a separate enforced
 * Content-Security-Policy carries only that directive: `*` on the embedded enquiry form and
 * `'self'` everywhere else, including API responses. X-Frame-Options stays SAMEORIGIN except
 * on that embed. CSP_ENFORCE=1 moves the full policy onto the enforced header.
 *
 * Sources checked against the app: Next and the find page are `'self'` (public/find/index.html
 * loads `app.js`). Stripe.js and Connect are the hosts below. Supabase REST and Realtime are
 * the project URL and its websocket twin. LiveKit is LIVEKIT_URL plus `*.livekit.cloud`.
 * pdf.js is `/pdfjs/pdf.worker.min.mjs` (`worker-src 'self'`). Turnstile
 * (`https://challenges.cloudflare.com`) is added only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 */

const STRIPE_SCRIPTS = ["https://js.stripe.com", "https://*.js.stripe.com", "https://connect-js.stripe.com"];
const STRIPE_FRAMES = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://connect-js.stripe.com"];
const STRIPE_CONNECT = ["https://api.stripe.com", "https://connect-js.stripe.com", "https://*.stripe.com"];
const LIVEKIT_CLOUD = ["wss://*.livekit.cloud", "https://*.livekit.cloud"];
const TURNSTILE = "https://challenges.cloudflare.com";
// Cloudflare injects its Web Analytics beacon at the edge. We do not load it.
// The beacon (2026.10.1) calls https://cloudflareinsights.com and contains no eval.
const CLOUDFLARE_INSIGHTS_SCRIPT = "https://static.cloudflareinsights.com";
const CLOUDFLARE_INSIGHTS_CONNECT = "https://cloudflareinsights.com";

/** Reports land here. Browsers post them without a reliable Origin. */
export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp";
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

/** CSP_ENFORCE=1 sends the full policy as Content-Security-Policy. Any other value is report-only. */
export function cspEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CSP_ENFORCE === "1";
}

export type CspEnv = {
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string;
  /** LIVEKIT_URL (wss://… or a self-hosted server). */
  liveKitUrl?: string;
  /** Development: Next's dev overlay and fast refresh use eval. */
  dev?: boolean;
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so the challenge script may load. */
  turnstile?: boolean;
};

export function cspEnv(): CspEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    liveKitUrl: process.env.LIVEKIT_URL,
    dev: process.env.NODE_ENV === "development",
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
  };
}

/** The http(s) origin and its ws(s) twin, or none for a missing or malformed URL. */
function originPair(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const url = new URL(raw.trim());
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    const plain = url.protocol === "http:" || url.protocol === "ws:";
    if (!secure && !plain) return [];
    return [`${secure ? "https" : "http"}://${url.host}`, `${secure ? "wss" : "ws"}://${url.host}`];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(pathname: string, env: CspEnv = cspEnv()): string {
  const turnstile = env.turnstile ? [TURNSTILE] : [];
  // unsafe-eval stays development-only. Production booking-page chunks, this repo's
  // source, and the current Cloudflare beacon contain no eval or new Function.
  const insights = (ANALYTICS_BEACON_HOSTS as readonly string[]).includes("static.cloudflareinsights.com") ? [CLOUDFLARE_INSIGHTS_SCRIPT] : [];
  const scripts = ["'self'", "'unsafe-inline'", ...(env.dev ? ["'unsafe-eval'"] : []), ...STRIPE_SCRIPTS, ...turnstile, ...insights];
  const connect = ["'self'", ...originPair(env.supabaseUrl), ...originPair(env.liveKitUrl), ...LIVEKIT_CLOUD, ...STRIPE_CONNECT, ...turnstile, CLOUDFLARE_INSIGHTS_CONNECT];
  const frames = ["'self'", ...STRIPE_FRAMES, ...turnstile];
  const directives = [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    `frame-src ${frames.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${isEmbeddablePath(pathname) ? "*" : "'self'"}`,
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ];
  return directives.join("; ");
}

/** @deprecated The policy is report-only by default. Kept so older imports still name the same allowlist. */
export const reportOnlyCsp = contentSecurityPolicy;

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Enforced clickjacking directive. Report-only policies ignore frame-ancestors. */
export function enforcedFrameAncestors(pathname: string): string {
  if (!isApiPath(pathname) && isEmbeddablePath(pathname)) return "frame-ancestors *";
  return "frame-ancestors 'self'";
}

/**
 * Pages: the full allowlist is report-only, and the enforced header is only frame-ancestors.
 * CSP_ENFORCE=1 moves that same allowlist onto Content-Security-Policy.
 * API responses are not documents: they get frame-ancestors and no script policy.
 */
export function applyContentSecurityPolicy(headers: Headers, pathname: string, env: CspEnv = cspEnv()): void {
  const ancestors = enforcedFrameAncestors(pathname);
  if (isApiPath(pathname)) {
    headers.set("Content-Security-Policy", ancestors);
    headers.delete("Content-Security-Policy-Report-Only");
    headers.delete("Reporting-Endpoints");
    return;
  }
  const policy = contentSecurityPolicy(pathname, env);
  headers.set("Reporting-Endpoints", REPORTING_ENDPOINTS);
  if (cspEnforced()) {
    headers.set("Content-Security-Policy", policy);
    headers.delete("Content-Security-Policy-Report-Only");
    return;
  }
  headers.set("Content-Security-Policy", ancestors);
  headers.set("Content-Security-Policy-Report-Only", policy);
}
