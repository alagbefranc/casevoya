import { isEmbeddablePath } from "@/lib/security/framing";

/**
 * The app-wide Content Security Policy, set by the proxy on every page (not on /api routes, which
 * answer JSON or set their own stricter policy).
 *
 * - Enforced: `object-src 'none'; base-uri 'self'`, added to the framing policy. No page uses
 *   <object>, <embed> or <base>, so these change nothing for the app.
 * - Report-only: the full allowlist of what the app loads (Next.js inline scripts, Stripe
 *   Elements and Connect embedded components, Supabase REST/Realtime, LiveKit). Violations are
 *   reported in the browser console; nothing is blocked until it is promoted to enforced.
 *   frame-ancestors follows the framing rules (src/lib/security/framing.ts): `*` on the embedded
 *   enquiry form, `'self'` everywhere else.
 */

export const ENFORCED_CSP = "object-src 'none'; base-uri 'self'";

const STRIPE_SCRIPTS = ["https://js.stripe.com", "https://*.js.stripe.com", "https://connect-js.stripe.com"];
const STRIPE_FRAMES = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://connect-js.stripe.com"];
const STRIPE_CONNECT = ["https://api.stripe.com", "https://connect-js.stripe.com", "https://*.stripe.com"];
const LIVEKIT_CLOUD = ["wss://*.livekit.cloud", "https://*.livekit.cloud"];

export type CspEnv = {
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string;
  /** LIVEKIT_URL (wss://… or a self-hosted server). */
  liveKitUrl?: string;
  /** Development: Next's dev overlay and fast refresh use eval. */
  dev?: boolean;
};

export function cspEnv(): CspEnv {
  return { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, liveKitUrl: process.env.LIVEKIT_URL, dev: process.env.NODE_ENV === "development" };
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

export function reportOnlyCsp(pathname: string, env: CspEnv = cspEnv()): string {
  const scripts = ["'self'", "'unsafe-inline'", ...(env.dev ? ["'unsafe-eval'"] : []), ...STRIPE_SCRIPTS];
  const connect = ["'self'", ...originPair(env.supabaseUrl), ...originPair(env.liveKitUrl), ...LIVEKIT_CLOUD, ...STRIPE_CONNECT];
  const directives = [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    `frame-src 'self' ${STRIPE_FRAMES.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${isEmbeddablePath(pathname) ? "*" : "'self'"}`,
  ];
  return directives.join("; ");
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Adds the enforced baseline to the response's policy (after applyFraming) and the report-only policy. */
export function applyContentSecurityPolicy(headers: Headers, pathname: string, env: CspEnv = cspEnv()): void {
  if (isApiPath(pathname)) return;
  const current = headers.get("Content-Security-Policy");
  if (!current) headers.set("Content-Security-Policy", ENFORCED_CSP);
  else if (!/(^|;)\s*object-src\b/.test(current)) headers.set("Content-Security-Policy", `${current}; ${ENFORCED_CSP}`);
  headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp(pathname, env));
}
