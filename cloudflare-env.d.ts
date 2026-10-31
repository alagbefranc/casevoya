// Worker bindings read through getCloudflareContext().env (wrangler.jsonc). Only the rate-limit
// bindings are typed here; other bindings are read as unknown where they are used.

/** A Workers Rate Limiting binding (minimal shape; merges with @cloudflare/workers-types if added). */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface CloudflareEnv {
  RL_AUTH: RateLimit;
  RL_AUTH_EMAIL: RateLimit;
  RL_VERIFY: RateLimit;
  RL_PUBLIC: RateLimit;
  RL_PAYMENT: RateLimit;
  RL_DOCUMENT_WORK: RateLimit;
}
