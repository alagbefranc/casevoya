import "server-only";
import { createZernioClient } from "./zernio";

/**
 * WhatsApp runtime settings. Names only here; the values are Cloudflare Worker secrets:
 *   ZERNIO_API_KEY          Zernio API key (Bearer). Without it WhatsApp shows "Not available".
 *   ZERNIO_WEBHOOK_SECRET   the secret given to Zernio when the webhook endpoint was registered.
 * The dispatch endpoint uses the mail dispatch bearer (EMAIL_DISPATCH_SECRET) and the service
 * role (SUPABASE_SECRET_KEY), like the mail worker.
 */
export function whatsappRuntimeConfig() {
  return {
    apiKey: process.env.ZERNIO_API_KEY ?? "",
    webhookSecret: process.env.ZERNIO_WEBHOOK_SECRET ?? "",
    dispatchSecret: process.env.EMAIL_DISPATCH_SECRET ?? "",
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? "",
  };
}

export function zernioConfigured(): boolean {
  return Boolean(process.env.ZERNIO_API_KEY);
}

export function zernio() {
  return createZernioClient({ apiKey: process.env.ZERNIO_API_KEY ?? "" });
}
