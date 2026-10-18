import "server-only";
import { Composio } from "@composio/core";

/**
 * Composio Platform (https://docs.composio.dev/docs/how-composio-works.md, read 2026-10-18).
 * Each Casevoya staff member is one Composio user: the Composio user id is their staff
 * membership id, so a consultant's connected Gmail or Outlook is theirs alone and never shared
 * across firms. COMPOSIO_API_KEY is a Worker secret; the SDK reads it from the environment.
 * Without it the integration is reported as not configured and nothing else changes.
 */
export function composioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

let client: Composio | null = null;

function composio(): Composio {
  if (!composioConfigured()) throw new Error("Composio is not configured");
  client ??= new Composio();
  return client;
}

/** A Composio session for one staff member (membership id). */
export async function staffSession(membershipId: string) {
  return composio().create(membershipId);
}

/** Whether this staff member has an active connection for a toolkit, e.g. "gmail". */
export async function toolkitConnected(membershipId: string, toolkit: string): Promise<boolean> {
  const session = await staffSession(membershipId);
  const { items } = await session.toolkits({ toolkits: [toolkit] });
  return items.some((item) => item.slug === toolkit && item.connection?.isActive === true);
}

/** A Connect Link the staff member opens to authorize a toolkit (Composio-managed OAuth). */
export async function connectLink(membershipId: string, toolkit: string, callbackUrl?: string): Promise<string> {
  const session = await staffSession(membershipId);
  const request = await session.authorize(toolkit, callbackUrl ? { callbackUrl } : undefined);
  if (!request.redirectUrl) throw new Error("Composio returned no Connect Link");
  return request.redirectUrl;
}
