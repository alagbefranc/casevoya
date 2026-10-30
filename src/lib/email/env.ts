import "server-only";

export const DEFAULT_CLOUDFLARE_ACCOUNT_ID = "c8010438fc56280e3ea5747a123e818a";
export const DEFAULT_FROM_ADDRESS = "notices@casevoya.ca";

export const DEFAULT_APP_URL = "https://app.casevoya.ca";

/**
 * The origin put in links that leave the app (invitation emails). APP_URL when it is a valid
 * https origin (or http on localhost, for development); otherwise the production app. Request
 * headers are not trusted for this.
 */
export function appOrigin(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
    } catch {
      // Not a URL: fall back to the production app.
    }
  }
  return DEFAULT_APP_URL;
}

export function emailRuntimeConfig() {
  return {
    inboundDomain: process.env.INBOUND_EMAIL_DOMAIN?.trim() || "docs.casevoya.ca",
    fromAddress: process.env.CLOUDFLARE_EMAIL_FROM?.trim() || DEFAULT_FROM_ADDRESS,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || DEFAULT_CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
    routingToken: process.env.CLOUDFLARE_ROUTING_API_TOKEN ?? "",
    routingReconcileSecret: process.env.EMAIL_ROUTING_RECONCILE_SECRET ?? "",
    dispatchSecret: process.env.EMAIL_DISPATCH_SECRET ?? "",
    /** Optional scheduler bearer; when set it replaces EMAIL_DISPATCH_SECRET for route auth (cron-auth.ts). */
    cronSecret: process.env.CRON_SECRET ?? "",
    inboundSecret: process.env.EMAIL_INBOUND_WEBHOOK_SECRET ?? "",
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? "",
  };
}
