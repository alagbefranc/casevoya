# Database foundations

Project `casevoya` (`aqjtvqmojfamtspzyeqm`), Postgres 17, ca-central-1. Applied migrations:

| Version | Name | Contents |
|---|---|---|
| 20261017040614 | foundation_core | `app` schema, enums, organizations, profiles, memberships, tenant helpers, RLS |
| 20261017040620 | audit_log | append-only `audit_log`, row-change triggers, `app.record_audit_event` |
| 20261017040625 | outbox | `outbox_events`, enqueue + worker claim/ack/fail/replay functions |

All tables have `ENABLE` + `FORCE ROW LEVEL SECURITY`. `anon` has no table privileges. There are
no DELETE policies: deletion is a retention workflow (SEC-07), not a client action.

## Tables

| Table | Purpose | Policies (role `authenticated`) |
|---|---|---|
| `organizations` | Tenant boundary (`id` = `organization_id`). `verification_status` starts `unverified` (sandbox). | SELECT: active member. UPDATE: `firm_owner`. |
| `profiles` | 1:1 with `auth.users`, auto-created by trigger on sign-up. Global, not a client Person. | SELECT: self, or staff who share an org. UPDATE: self. |
| `memberships` | user ↔ org, one row per role (`unique(org,user,role)`), status invited/active/suspended/revoked. | SELECT: own rows, or staff of that org. INSERT: `firm_owner`, only as `status='invited'` with `invited_by = created_by = auth.uid()`. UPDATE: `firm_owner`. |
| `audit_log` | Append-only trail: actor, actor_type, db_role, tenant, action, object, result, request_id, redacted diff, context. | SELECT: `firm_owner` of that org. No writes; UPDATE/DELETE/TRUNCATE rejected by triggers for every role. |
| `outbox_events` | Transactional outbox (event envelope: id, organization_id, aggregate, version, type, schema_version, minimal payload ≤ 8 KB). Idempotency key unique per org. | SELECT: staff of that org. No writes; workers use functions. |

Common columns: `created_at`, `updated_at`, `created_by`, `version` (bumped by `app.touch_row()` on
every UPDATE for optimistic locking: update `... where id = $1 and version = $expected`; 0 rows ⇒ 409).
Tenant and identity keys are immutable (`app.guard_immutable_keys()`).

## Roles (`public.org_role`)

Staff: `firm_owner`, `licensed_consultant`, `case_manager`, `assistant`, `finance_user`
(`app.staff_roles()`). Portal: `client`, `adult_dependant`, `sponsor`, `employer_contact`,
`guardian`, `external_collaborator`. Portal memberships give org access only; what they can see
will be decided by person/matter/audience grants (T007). A firm owner is not automatically a
licensed consultant. Platform admin is intentionally **not** an org role.

## Helpers (schema `app`, not exposed by the Data API, `search_path = ''`)

| Function | Notes |
|---|---|
| `app.has_org_role(org, roles[])`, `app.is_org_member(org)`, `app.is_org_staff(org)` | SECURITY DEFINER membership checks for policies (avoids policy recursion). |
| `app.current_organization_id()` | Active workspace from `app.organization_id` (transaction-local) or the `x-casevoya-org` header; returns it only if the caller is an active member, else null. |
| `app.in_active_org(org)` | Use in future tenant-table policies: `using (app.in_active_org(organization_id))`. |
| `app.create_organization(...)` / `public.create_organization(...)` | Atomic org + `firm_owner` membership. Public wrapper is SECURITY INVOKER. |
| `app.audit_row_change(redacted_cols...)` | AFTER trigger; UPDATE stores only changed columns as `{old,new}`; listed columns are `[redacted]`. |
| `app.record_audit_event(org, action, table, id, result, context)` | Explicit events (sensitive reads, downloads, denials). Actor is always the caller. |
| `app.enqueue_event(...)` | Write in the same transaction as the domain change. Same idempotency key + same event ⇒ same id; different event ⇒ error. |
| `app.claim_outbox_events(worker, limit, lease)` | service_role only. `FOR UPDATE SKIP LOCKED`, reclaims expired leases. |
| `app.mark_outbox_published` / `app.mark_outbox_failed` / `app.replay_outbox_event` | service_role only. Exponential backoff to 60 min, dead-letter after 8 attempts, audited replay. |

## Verified (rolled-back test transaction, 16 Oct 2026)

User A created a firm and became `firm_owner`; user B saw 0 orgs / memberships / audit rows /
outbox events, could not update A's org (0 rows), could not invite themselves (42501), could not
enqueue into A's org (42501), and setting A's org id as B's workspace resolved to null. Duplicate
idempotency key produced one outbox row. Profile display-name change was audited as redacted.
`UPDATE audit_log` as `postgres` was rejected. Security advisors: 0 findings.

## Known gaps (next tasks)

* Invite acceptance flow (expiring, single-use tokens) and last-owner protection.
* Staff MFA enforcement (AAL2 checks in policies / server), session inventory, step-up.
* Composite `(id, organization_id)` foreign keys on future tenant tables.
* Transactional inbox for provider webhooks (dedupe on provider + account + event id).
* External tamper-evident audit sink (DB owner can still disable triggers).
* Person / matter / household grants (T007) and the negative authz test suite.
