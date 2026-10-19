#!/usr/bin/env node
// WhatsApp through Zernio: the operator steps Francis runs at go-live. Nothing here runs on its
// own, and every call that sends a message, creates something in Meta or links a firm needs --yes.
// Needs ZERNIO_API_KEY (never printed). link-sandbox also needs SUPABASE_ACCESS_TOKEN.
//
//   node scripts/ops/zernio-whatsapp.mjs sandbox                          read GET /v1/phone-numbers -> sandbox
//   node scripts/ops/zernio-whatsapp.mjs sandbox-start +14312753986 --yes  POST /v1/whatsapp/sandbox/sessions
//                                                                          (sends Zernio's sandbox_start template to that phone)
//   node scripts/ops/zernio-whatsapp.mjs sandbox-sessions                 read the sandbox session (pending / active)
//   node scripts/ops/zernio-whatsapp.mjs link-sandbox <org-id> --yes      link the sandbox number to one firm (testing only)
//   node scripts/ops/zernio-whatsapp.mjs templates <account-id> [origin]  print the template requests (dry run)
//   node scripts/ops/zernio-whatsapp.mjs templates <account-id> [origin] --yes   create them for Meta review
//   node scripts/ops/zernio-whatsapp.mjs template-status <account-id>     read Meta's verdict on each template
//   node scripts/ops/zernio-whatsapp.mjs register-webhook <app-origin> --yes      POST /v1/webhooks/settings
//                                                                          (secret from ZERNIO_WEBHOOK_SECRET)
//
// The template copy must match src/modules/whatsapp/templates.ts (tests/whatsapp-zernio.test.ts checks it).
import { pathToFileURL } from "node:url";

const BASE = "https://zernio.com/api/v1";
const DEFAULT_ORIGIN = "https://app.casevoya.ca";
export const WEBHOOK_EVENTS = ["message.received", "message.delivered", "message.read", "message.failed"];

const TEMPLATES = [
  { name: "casevoya_portal_notice", body: "Hello. {{1}} has a new item for you in your secure portal. Sign in to see it: {portal}" },
  { name: "casevoya_portal_reminder", body: "Hello. {{1}} has a reminder for you in your secure portal. Sign in to see it: {portal}" },
];

/** POST /v1/whatsapp/templates bodies: UTILITY, English, one variable (the firm's name). */
export function templateRequests(accountId, origin = DEFAULT_ORIGIN) {
  const portal = `${origin.replace(/\/+$/, "")}/portal`;
  return TEMPLATES.map((template) => ({
    accountId,
    name: template.name,
    category: "UTILITY",
    language: "en",
    components: [{ type: "body", text: template.body.replace("{portal}", portal), example: { body_text: [["Northline Immigration"]] } }],
  }));
}

async function zernio(method, path, body) {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY is not set.");
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!response.ok) throw new Error(`Zernio ${response.status}: ${JSON.stringify(json).slice(0, 800)}`);
  return json;
}

function requireYes(args, what) {
  if (!args.includes("--yes")) {
    console.error(`${what}. Add --yes to do it.`);
    process.exit(2);
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = rest.filter((arg) => arg !== "--yes");
  switch (command) {
    case "sandbox": {
      const numbers = await zernio("GET", "/phone-numbers");
      console.log(JSON.stringify({ sandbox: numbers?.sandbox ?? null, connected: (numbers?.connected ?? []).length, numbers: (numbers?.numbers ?? []).length }, null, 2));
      return;
    }
    case "sandbox-start": {
      const phone = args[0];
      if (!/^\+[1-9]\d{7,14}$/.test(phone ?? "")) throw new Error("Give the phone in E.164, like +14312753986.");
      requireYes(rest, `This sends Zernio's sandbox_start template to ${phone}`);
      console.log(JSON.stringify(await zernio("POST", "/whatsapp/sandbox/sessions", { phone }), null, 2));
      return;
    }
    case "sandbox-sessions": {
      console.log(JSON.stringify(await zernio("GET", "/whatsapp/sandbox/sessions"), null, 2));
      return;
    }
    case "link-sandbox": {
      const org = args[0];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org ?? "")) throw new Error("Give the firm's organization id.");
      const numbers = await zernio("GET", "/phone-numbers");
      const sandbox = numbers?.sandbox;
      if (!sandbox?.accountId) throw new Error("Zernio has no sandbox for this key.");
      requireYes(rest, `This links Zernio's sandbox number (${sandbox.phoneNumber}) to firm ${org} for testing`);
      const { runSql } = await import("./supabase-api.mjs");
      const quoted = (value) => `'${String(value).replace(/'/g, "''")}'`;
      await runSql(
        `begin; select set_config('request.jwt.claims', '{"role":"service_role"}', true); ` +
          `select public.connect_firm_whatsapp(${quoted(org)}::uuid, ${quoted(sandbox.accountId)}, ${quoted(sandbox.phoneNumber ?? "")}, true); commit;`,
      );
      console.log(`Linked the sandbox number to ${org}. Disconnect it from Settings > Integrations when testing is done.`);
      return;
    }
    case "templates": {
      const [accountId, origin] = args;
      if (!accountId) throw new Error("Give the firm's Zernio WhatsApp account id.");
      const requests = templateRequests(accountId, origin);
      if (!rest.includes("--yes")) {
        console.log(JSON.stringify(requests, null, 2));
        console.log("Dry run. Add --yes to create these for Meta's review.");
        return;
      }
      for (const request of requests) {
        const created = await zernio("POST", "/whatsapp/templates", request);
        console.log(`${request.name}: ${created?.template?.status ?? "submitted"}`);
      }
      return;
    }
    case "template-status": {
      const [accountId] = args;
      if (!accountId) throw new Error("Give the firm's Zernio WhatsApp account id.");
      const listed = await zernio("GET", `/whatsapp/templates?accountId=${encodeURIComponent(accountId)}`);
      for (const template of listed?.templates ?? []) {
        if (String(template.name).startsWith("casevoya_")) console.log(`${template.name} (${template.language}): ${template.status}`);
      }
      return;
    }
    case "register-webhook": {
      const [origin] = args;
      if (!/^https:\/\//.test(origin ?? "")) throw new Error("Give the app origin, like https://app.casevoya.ca.");
      const secret = process.env.ZERNIO_WEBHOOK_SECRET;
      if (!secret || secret.length < 32) throw new Error("Set ZERNIO_WEBHOOK_SECRET (32+ random characters) first; the same value goes in the Worker secret.");
      const url = `${origin.replace(/\/+$/, "")}/api/zernio/webhook`;
      requireYes(rest, `This registers ${url} for ${WEBHOOK_EVENTS.join(", ")}`);
      const created = await zernio("POST", "/webhooks/settings", { name: "Casevoya", url, secret, events: WEBHOOK_EVENTS });
      console.log(`Registered webhook ${created?.webhook?._id ?? ""} -> ${url}`);
      return;
    }
    default:
      console.error("Commands: sandbox, sandbox-start, sandbox-sessions, link-sandbox, templates, template-status, register-webhook");
      process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
