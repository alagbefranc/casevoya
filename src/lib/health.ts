import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * GET /api/health. No auth, no secrets, no personal data. The body is only
 * `{ status, build_id, time }`. Reachability is GoTrue's public health route
 * (`GET /auth/v1/health` with the publishable key as `apikey`). PostgREST's
 * `/rest/v1/` refuses that key with 401. Any 2xx is healthy. A missing key, any
 * other status, or a timeout is unreachable.
 *
 * build_id is the Next build id served at `/BUILD_ID`. OpenNext sets
 * `NEXT_BUILD_ID` from that file before the worker handles a request. The same
 * file is `.next/BUILD_ID` when this process can read it.
 */

export const HEALTH_DB_TIMEOUT_MS = 2_000;

export type HealthBody = {
  status: "ok" | "unavailable";
  build_id: string;
  time: string;
};

function cleanBuildId(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!text || text.length > 80 || /[\r\n]/.test(text) || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  return text;
}

/** The Next build id on disk (the same bytes OpenNext serves at /BUILD_ID). */
export function readNextBuildIdFile(cwd = process.cwd()): string | null {
  try {
    return readFileSync(path.join(cwd, ".next", "BUILD_ID"), "utf8");
  } catch {
    return null;
  }
}

export function buildId(env: NodeJS.ProcessEnv = process.env, bundled: string | null = readNextBuildIdFile()): string {
  return cleanBuildId(env.NEXT_BUILD_ID) ?? cleanBuildId(env.__NEXT_BUILD_ID) ?? cleanBuildId(bundled) ?? cleanBuildId(env.CASEVOYA_BUILD_ID) ?? "unknown";
}

export function healthBody(reachable: boolean, time: string, env: NodeJS.ProcessEnv = process.env): HealthBody {
  return { status: reachable ? "ok" : "unavailable", build_id: buildId(env), time };
}

type ReachOptions = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

/** True when GoTrue's public health route answers 2xx. False when it cannot be reached in time. */
export async function databaseReachable(options: ReachOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !key) return false;
  let endpoint: string;
  try {
    endpoint = new URL("/auth/v1/health", supabaseUrl).href;
  } catch {
    return false;
  }
  const fetcher = options.fetch ?? fetch;
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { apikey: key },
      signal: AbortSignal.timeout(options.timeoutMs ?? HEALTH_DB_TIMEOUT_MS),
      cache: "no-store",
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}
