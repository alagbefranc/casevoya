import "server-only";

export const DEFAULT_CLOUDFLARE_ACCOUNT_ID = "c8010438fc56280e3ea5747a123e818a";
export const DEFAULT_FROM_ADDRESS = "notices@casevoya.ca";

export function emailRuntimeConfig() {
  return {
    inboundDomain: process.env.INBOUND_EMAIL_DOMAIN?.trim() || "docs.casevoya.ca",
    fromAddress: process.env.CLOUDFLARE_EMAIL_FROM?.trim() || DEFAULT_FROM_ADDRESS,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || DEFAULT_CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
    dispatchSecret: process.env.EMAIL_DISPATCH_SECRET ?? "",
    inboundSecret: process.env.EMAIL_INBOUND_WEBHOOK_SECRET ?? "",
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? "",
  };
}
