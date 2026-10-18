import "server-only";

import { headers } from "next/headers";

/** The signer's IP and user agent as this server received them, recorded with each signature. */
export async function clientEvidence(): Promise<{ ip: string; userAgent: string }> {
  const incoming = await headers();
  const forwarded = incoming.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(forwarded) || forwarded.includes(":") ? forwarded : "127.0.0.1";
  const userAgent = (incoming.get("user-agent") ?? "unknown").slice(0, 400);
  return { ip, userAgent };
}
