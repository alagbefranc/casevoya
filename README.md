# Casevoya app

Multi-tenant practice management for licensed Canadian immigration consultancies (working name).
Specs live in [`docs/`](docs): read `docs/spec/RULES.md` first, then MEMORY → PRD (v1.1 governs) →
ARCHITECTURE → DESIGN → TASKS. `docs/BRIEF.md` is the engineering summary.

> All immigration content (programs, forms, fees, deadlines, checklists) must come from official
> sources (IRCC / canada.ca, Justice Laws, CICC, provincial authorities) with a source link,
> checked date and licensed-reviewer approval before it is used. Until then the app uses clearly
> **fictional** placeholder content only.

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS v4 |
| Backend | Next.js Server Actions / Route Handlers for business rules |
| Database | Supabase Postgres 17, project `casevoya` (`aqjtvqmojfamtspzyeqm`), region **ca-central-1** |
| Auth | Supabase Auth via `@supabase/ssr` (cookie sessions, `getClaims()` verification) |
| Jobs | Supabase Edge Functions + cron draining the transactional outbox (planned) |
| E-signature | In-house module (planned; not built yet) |

Note: Next.js 16 renamed `middleware.ts` to `proxy.ts` (`src/proxy.ts`).

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in the publishable key from the Supabase dashboard
pnpm dev
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm verify` | migration guard + lint + typecheck + tests (what CI runs) |
| `pnpm check:migrations` | fails if a migration contains DROP / TRUNCATE / DELETE FROM / CREATE OR REPLACE, or a public table lacks ENABLE + FORCE RLS |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm db:types` | regenerate `src/types/database.types.ts` (needs `supabase login`) |

## Layout

```
src/
  app/                 minimal shell (home, /sign-in, /auth/confirm, /mfa, /invite/[token], /app, /app/invitations); real UI comes from the Designer's HTML
  lib/env.ts           public env access (URL + publishable key only)
  lib/supabase/        browser, server and proxy clients (@supabase/ssr)
  lib/tenant/          tenant context headers, request ids, role helpers
  proxy.ts             session refresh + request id + optimistic /app gate and staff aal2 redirect
  types/database.types.ts  generated from the live schema
supabase/migrations/   additive SQL migrations (applied to the remote project)
docs/                  spec set + DATABASE.md
scripts/               migration guard
tests/                 Vitest
```

## Security model (short)

* The web app always talks to Postgres **as the signed-in user** (publishable key + session), so
  RLS applies to every query. The secret/service-role key is never used by the web app and never
  goes in a `NEXT_PUBLIC_` variable. In Supabase, `service_role` and `postgres` have BYPASSRLS, so
  they are reserved for workers and migrations.
* Active workspace = `x-casevoya-org` header (or `app.organization_id` transaction setting). The
  database only honours it for an **active member**; it is a selection, not an authorization claim.
* Proxy checks are optimistic only. Every server action / route handler re-checks with
  `getClaims()` and relies on RLS.

See [`docs/DATABASE.md`](docs/DATABASE.md) for tables, policies and helpers.

## Migrations rule

Additive only. Never edit an applied migration; add a new one. No DROP / TRUNCATE / DELETE /
overwrite without explicit approval from Francis.
