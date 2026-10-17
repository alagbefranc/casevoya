import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The live Worker has no R2 or KV binding, so OpenNext's default (no incremental cache) is used.
export default defineCloudflareConfig({});
