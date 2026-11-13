// Zod 4 probes `new Function("")` for its JIT parser; a CSP without 'unsafe-eval' reports the probe.
// jitless skips the probe. Mutate (don't replace) the shared object so load order doesn't matter.
const g = globalThis as typeof globalThis & { __zod_globalConfig?: Record<string, unknown> };
(g.__zod_globalConfig ??= {}).jitless = true;
export {};
