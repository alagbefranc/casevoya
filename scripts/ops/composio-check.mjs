#!/usr/bin/env node
// Proves the Composio integration end to end with one safe, read-only call for one staff member.
// Usage: node scripts/ops/composio-check.mjs <membership-id> [toolkit=gmail]
// Needs COMPOSIO_API_KEY in the environment (never printed). If the staff member hasn't connected
// the toolkit yet, prints a Connect Link and waits up to 10 minutes for them to authorize.
import { Composio } from "@composio/core";

const [membershipId, toolkit = "gmail"] = process.argv.slice(2);
if (!membershipId) {
  console.error("Usage: node scripts/ops/composio-check.mjs <membership-id> [toolkit]");
  process.exit(2);
}
if (!process.env.COMPOSIO_API_KEY) {
  console.error("COMPOSIO_API_KEY is not set.");
  process.exit(2);
}

const composio = new Composio();
const session = await composio.create(membershipId);

const { items } = await session.toolkits({ toolkits: [toolkit] });
const connected = items.some((item) => item.slug === toolkit && item.connection?.isActive === true);
if (!connected) {
  const request = await session.authorize(toolkit);
  console.log(`CONNECT_LINK ${request.redirectUrl}`);
  const account = await request.waitForConnection(600_000);
  console.log(`CONNECTED ${account.id}`);
} else {
  console.log(`ALREADY_CONNECTED ${toolkit}`);
}

// Find a read-only tool at runtime instead of guessing a slug, then run it once.
const found = await session.search({ query: "get the connected account's email profile", toolkits: [toolkit] });
const slug = found?.results?.[0]?.primaryToolSlugs?.[0];
if (!slug) {
  console.error("No read-only profile tool found for this toolkit.");
  process.exit(1);
}
console.log(`TOOL ${slug}`);
const result = await session.execute(slug, {});
// Print only the shape and identifiers, never mailbox content.
const keys = (value) => (value && typeof value === "object" ? Object.keys(value) : []);
console.log(`RESULT_KEYS ${JSON.stringify(keys(result))} DATA_KEYS ${JSON.stringify(keys(result?.data))}`);
console.log(`SUCCESSFUL ${result?.successful ?? !result?.error} LOG_ID ${result?.logId ?? result?.log_id ?? "(none)"}`);
if (result?.error) console.log(`ERROR ${String(result.error).slice(0, 300)}`);
