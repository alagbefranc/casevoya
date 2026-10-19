import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The live Worker has no R2 or KV binding, so OpenNext's default (no incremental cache) is used.
const config = defineCloudflareConfig({});

// The Workers build compiles with webpack: Turbopack's native compiler grew past the build
// machine's memory (about 15 GB) as the app grew, and the Node heap cap does not bound it.
// webpack builds the same app in about 4 GB. Local and CI builds keep Turbopack (`pnpm build`).
config.buildCommand = "pnpm run build:webpack";

export default config;
