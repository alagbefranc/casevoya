import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { signVoRequest, VO_SIGNATURE_HEADER, VO_TIMESTAMP_HEADER, type VoTaskRequest, type VoTaskResponse } from "./sign";

/**
 * The app Worker's side of Vo: a signed POST to the Vo agent service (services/vo-agent, the Claude
 * Agent SDK in a Cloudflare Container). Reached through the service binding VO_AGENT when the
 * Worker has one, otherwise VO_AGENT_URL (a private URL, for local development of the service).
 * Without VO_AGENT_SECRET and one of those, Vo is unavailable and every workflow works by hand.
 * The request carries the staff member's own short-lived Supabase token, never a service key.
 */
type Fetcher = { fetch: (input: Request | string, init?: RequestInit) => Promise<Response> };

export type VoAgentTransport = { send: (path: string, init: RequestInit) => Promise<Response> } | null;

function env(): Record<string, unknown> {
  try {
    return getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return process.env as Record<string, unknown>;
  }
}

export function voAgentSecret(): string | null {
  const value = env().VO_AGENT_SECRET ?? process.env.VO_AGENT_SECRET;
  return typeof value === "string" && value.length >= 32 ? value : null;
}

export function voAgentTransport(): VoAgentTransport {
  const values = env();
  const binding = values.VO_AGENT as Fetcher | undefined;
  if (binding && typeof binding.fetch === "function") return { send: (path, init) => binding.fetch(new Request(`https://vo-agent${path}`, init)) };
  const url = values.VO_AGENT_URL ?? process.env.VO_AGENT_URL;
  if (typeof url === "string" && /^https?:\/\//.test(url)) return { send: (path, init) => fetch(`${url.replace(/\/$/, "")}${path}`, init) };
  return null;
}

/** Whether Vo can run here at all: the service is reachable and the shared secret is set. */
export function voAgentConfigured(): boolean {
  return Boolean(voAgentSecret() && voAgentTransport());
}

const TIMEOUT_MS = 90_000;

export async function callVoAgent(
  request: VoTaskRequest,
  deps: { transport?: VoAgentTransport; secret?: string | null; now?: () => number; timeoutMs?: number } = {},
): Promise<VoTaskResponse> {
  const transport = deps.transport === undefined ? voAgentTransport() : deps.transport;
  const secret = deps.secret === undefined ? voAgentSecret() : deps.secret;
  if (!transport || !secret) return { result: "failed", failure: "unavailable" };
  const body = JSON.stringify(request);
  const timestamp = (deps.now ?? Date.now)();
  const signature = await signVoRequest(secret, timestamp, body);
  try {
    const response = await transport.send("/v1/run", {
      method: "POST",
      headers: { "content-type": "application/json", [VO_SIGNATURE_HEADER]: signature, [VO_TIMESTAMP_HEADER]: String(timestamp) },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
    });
    if (!response.ok) return { result: "failed", failure: response.status === 503 ? "unavailable" : "failed" };
    const parsed = (await response.json()) as VoTaskResponse;
    return parsed && typeof parsed === "object" && "result" in parsed ? parsed : { result: "failed", failure: "failed" };
  } catch {
    return { result: "failed", failure: "unavailable" };
  }
}
