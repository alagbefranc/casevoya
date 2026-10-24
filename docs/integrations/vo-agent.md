# Vo agent service (Claude Agent SDK)

Vo, Casevoya's drafting assistant, runs on the Claude Agent SDK in its own container. This note is
for whoever deploys it and for the privacy reviewer. Status: **built and tested with the SDK
mocked; not deployed.**

## Sources consulted (retrieved 2026-10-18)

- Claude Agent SDK, TypeScript reference: https://code.claude.com/docs/en/agent-sdk/typescript
  (`query()`, `Options`: `model`, `tools`, `allowedTools`, `disallowedTools`, `permissionMode`,
  `canUseTool`, `hooks`, `maxTurns`, `maxBudgetUsd`, `systemPrompt`, `mcpServers`,
  `settingSources`, `cwd`, `env`; `PreToolUseHookInput`, `SyncHookJSONOutput`
  `permissionDecision`; `SDKResultMessage` `result`, `usage`, `total_cost_usd`).
- Claude Agent SDK, custom tools: https://code.claude.com/docs/en/agent-sdk/custom-tools
  (`tool()`, `createSdkMcpServer()`, `mcp__{server}__{tool}` names, `tools: []` removes every
  built-in, bare `disallowedTools` names remove a tool from context, `alwaysLoad`).
- Cloudflare Containers: https://developers.cloudflare.com/containers/get-started/,
  https://developers.cloudflare.com/containers/configuration/wrangler/,
  https://developers.cloudflare.com/containers/api/container-class/ (`Container`, `envVars`,
  `defaultPort`, `sleepAfter`, `getRandom`), https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/.

## Shape

```
browser ── server action (app Worker, casevoya-app)
             1. begin_vo_run (DB: staff + MFA + can read the matter, Vo on, capability,
                sample mode, rate limits) → run id
             2. POST /v1/run over service binding VO_AGENT, HMAC-signed (VO_AGENT_SECRET),
                body: run id, firm, membership, task, matter/thread, the user's own
                short-lived Supabase access token, expiry
          ── casevoya-vo-agent Worker → VoAgentContainer (Node 22, services/vo-agent)
             3. verify signature + freshness, build a Supabase client from the USER's token
                (publishable key, RLS applies; no service-role key exists here)
             4. Agent SDK query(): model claude-opus-5-5, only our in-process MCP tools
             5. finish_vo_run as the user (draft saved as vo_drafts status=draft, or abstained /
                answered / failed), with tool names, tokens and cost
          ←  outcome to the app; the draft fills the composer; a PERSON presses Send
```

## Tools (in-process MCP server `casevoya`)

| Tool | Tasks | Reads / writes |
| --- | --- | --- |
| `read_matter_summary` | reply, document request, ask | matter, open tasks, deadlines (verified or tentative), open document requests (explanations as data) |
| `read_person` | all | display names and roles on the matter only |
| `read_documents_index` | ask | document purposes, filtered by the owner's per-kind switches; no contents |
| `read_messages_thread` | reply, document request | the run's own conversation (12 latest), only if "Client messages" is on |
| `search_approved_sources` | reply, ask | titles, publishers, links of verified, current `official_sources`; no content |
| `find_free_slots` | reply | the firm's next free consultation times (`staff_booking_availability` + the app's slot engine) and the published booking page link |
| `save_draft` | reply, document request | the only write: keeps the guarded draft for `finish_vo_run` (status draft) |

There is no send, email, submit or update tool.

## Document reading (`document_review`, 2026-10-18)

One task does not use the Agent SDK's tool loop: reading one uploaded document version.
`src/vo-doc-read.ts` makes ONE Messages API call (`@anthropic-ai/sdk`, `client.beta.messages.create`)
with model `claude-opus-5-5`, adaptive thinking, effort `high`, `max_tokens` 16000, structured
outputs (`output_config.format` json_schema built from the firm's switches), server-side refusal
fallback (`server-side-fallback-2026-07-01`, `fallbacks: "default"`) and **no tools**. The file goes
in as a base64 `document` block (PDF, up to 20 MB) or `image` block (JPEG/PNG/WebP/GIF, up to 5 MB);
HEIC and DOCX are refused as `unsupported_file`. Order of checks: the firm's switches and the
document's category (before any download) → `authorize_document_download` + Storage download with
the staff member's own token (`src/vo-doc-data.ts`; audited `document.download`) → magic bytes →
model → `normalizeReading` (capabilities, identity-number redaction, links/emails removed, flags
never fraud findings, deadlines only on dates read from the page, `[needs a sourced rule]` for
anything rule-based) → `finish_vo_document_review` as the staff member (checked again in SQL).
The run log records the served model, `read_document_version` as the tool, tokens and an
estimated cost, and the version id as the source. Client-, staff- and third-party-written text comes
back inside per-run nonce delimiters; identity-number-like strings are removed first.

## Lead follow-ups and call summaries (`lead_follow_up`, `call_summary`, 2026-10-24)

Two more tasks without the tool loop (`src/vo-crm.ts`, `src/vo-crm-data.ts`; the pure rules are
`src/modules/vo/crm.ts` in the app). The request is signed like every other; its body names the lead,
or the consultation plus the notes the staff member pasted (never stored). Order: the firm's
switches → consent to contact (lead) or the sensitive-category screen on the notes (medical,
criminal history) → the lead's record, latest notes and linked consultations, or the consultation,
read with the staff member's own token → ONE Messages API call (same model constant, adaptive
thinking, refusal fallback, `max_tokens` 2000, no tools, no structured output) → the shared output
guard (`guardVoOutput`) → `finish_vo_crm_run` as the staff member (sources and consent checked again
in SQL). Run log: `read_lead` or `read_consultation` as the tool, tokens, estimated cost, how many
notes were left out. **The container must be rebuilt and redeployed for these tasks to exist.**

## Locks

`tools: []`; every built-in name in `disallowedTools`; `allowedTools` = this task's tools only;
`permissionMode: "dontAsk"`; `canUseTool` denies off-list; a PreToolUse hook denies off-list and
logs every attempt; `settingSources: []`; empty scratch `cwd`; subprocess env = PATH, HOME,
ANTHROPIC_API_KEY only; `maxTurns` 8; `maxBudgetUsd` 0.75. The output guard (src/modules/vo/guard.ts)
removes non-app links, emails, phone numbers and markup and replaces money amounts and durations
with `[needs a sourced rule]`, which `send_vo_draft` refuses to send.

## To go live (not done)

1. `cd services/vo-agent && npm install && npm run bundle` (writes `dist/server.mjs`).
2. Secrets on `casevoya-vo-agent`: `wrangler secret put VO_AGENT_SECRET` (32+ random chars) and
   `wrangler secret put ANTHROPIC_API_KEY`. Then `wrangler deploy` from `services/vo-agent`.
3. On `casevoya-app`: the same `VO_AGENT_SECRET` as a secret, and a service binding in
   `wrangler.jsonc`: `"services": [..., { "binding": "VO_AGENT", "service": "casevoya-vo-agent" }]`.
   Not added in this branch: a binding to a Worker that doesn't exist yet would fail the app deploy.
4. Apply migrations `20261019207000` and `20261019207100` (and, for document reading,
   `20261019218000` then `20261019218100`; the enum migration must commit first).
5. Privacy review: client messages and matter details go to Anthropic (US) through the container.
   The owner must turn Vo on per firm (off by default for real firms).

Without steps 2–3 the app reports Vo as unavailable and every workflow works by hand.
