/**
 * GET /api/health. No auth, no secrets, no personal data. The body is only
 * `{ status, build_id, time }`. The database check is one short request to PostgREST
 * with the public publishable key; the OpenAPI body is discarded. A missing key, a
 * non-2xx answer, or a timeout is "unreachable".
 */

export const HEALTH_DB_TIMEOUT_MS = 2_000;

export type HealthBody = {
  status: "ok" | "unavailable";
  build_id: string;
  time: string;
};

export function buildId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CASEVOYA_BUILD_ID?.trim() ?? "";
  if (!raw || /[\r\n]/.test(raw)) return "unknown";
  return raw.slice(0, 80);
}

export function healthBody(reachable: boolean, time: string, env: NodeJS.ProcessEnv = process.env): HealthBody {
  return { status: reachable ? "ok" : "unavailable", build_id: buildId(env), time };
}

type ReachOptions = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

/** True when PostgREST answers. False when it cannot be reached in time. */
export async function databaseReachable(options: ReachOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !key) return false;
  let endpoint: string;
  try {
    endpoint = new URL("/rest/v1/", supabaseUrl).href;
  } catch {
    return false;
  }
  const fetcher = options.fetch ?? fetch;
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? HEALTH_DB_TIMEOUT_MS),
      cache: "no-store",
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}
