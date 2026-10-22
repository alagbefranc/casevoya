import "server-only";
import type { LiveKitConfig } from "./livekit";

/**
 * LiveKit runtime settings. Names only here; the values are Cloudflare Worker secrets:
 *   LIVEKIT_URL         the project's WebSocket URL (wss://<project>.livekit.cloud, or a self-hosted server)
 *   LIVEKIT_API_KEY     API key (the JWT issuer)
 *   LIVEKIT_API_SECRET  API secret (signs join tokens, server calls, and verifies webhooks)
 * Without all three, video calls say they aren't set up and nothing is sent to LiveKit.
 */
export function liveKitConfig(): LiveKitConfig | null {
  const url = (process.env.LIVEKIT_URL ?? "").trim();
  const apiKey = (process.env.LIVEKIT_API_KEY ?? "").trim();
  const apiSecret = (process.env.LIVEKIT_API_SECRET ?? "").trim();
  if (!/^wss?:\/\/\S+$/i.test(url) || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}
