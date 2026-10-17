# Database foundations

Project `casevoya` (`aqjtvqmojfamtspzyeqm`), Postgres 17, ca-central-1.

Applied on the live project (versions recorded by `apply_migration`; do not edit these files in place):

| Version | Name | Contents |
|---|---|---|
| 20261017040614 | foundation_core | `app` schema, enums, organizations, profiles, memberships, tenant helpers, RLS |
| 20261017040620 | audit_log | append-only `audit_log`, row-change triggers, `app.record_audit_event` |
| 20261017040625 | outbox | `outbox_events`, enqueue + worker claim/ack/fail/replay functions |
| 20261017052625 | staff_mfa | `app.current_aal`, `app.staff_mfa_satisfied`, `app.mfa_step_up_satisfied`, restrictive policies, staff membership trigger |
| 20261017052630 | invitations | hashed single-use staff invites, accept/revoke, last `firm_owner` guard |
| 20261017052636 | persons_matters_grants | persons, matters, participants, households, relationships, access grants, RLS |
| 20261017052643 | webhook_inbox | provider event inbox, unique `(provider, event_id)`, `app.ingest_webhook_event` |
| 20261017083908 | fk_covering_indexes | covering indexes for foreign keys flagged by the performance advisor. Additive only. |

In the repository, not yet applied to the live project (do not edit the file in place once applied):

| Version | Name | Contents |
|---|---|---|
| 20261017110000 | source_governance | Official-host allowlist, source snapshots, check attempts, rule versions, evidence, professional reviews, pack versions, matter pins, impacts. `src/types/database.types.ts` stays stale until this migration is applied and `pnpm db:types` is run against the live project. |
| 20261017130000 | platform_admin_and_pnp_domains | `platform_admins` and `app.is_platform_admin()`, plus verified provincial nominee hosts. No user id is seeded. |

All tables have `ENABLE` + `FORCE ROW LEVEL SECURITY`. `anon` has no table privileges. There are
no DELETE policies: deletion is a retention workflow (SEC-07), not a client action.

## Tables

| Table | Purpose | Policies (role `authenticated`) |
|---|---|---|
| `organizations` | Tenant boundary (`id` = `organization_id`). `verification_status` starts `unverified` (sandbox). | SELECT: active member. UPDATE: `firm_owner` and aal2. |
| `profiles` | 1:1 with `auth.users`, auto-created by trigger on sign-up. Global, not a client Person. | SELECT: self, or staff who share an org and have aal2. UPDATE: self. |
| `memberships` | user ↔ org, one row per role (`unique(org,user,role)`), status invited/active/suspended/revoked. | SELECT: own rows, or staff of that org at aal2. INSERT: `firm_owner`, only as `status='invited'`, plus aal2 and a recent step-up. UPDATE: `firm_owner` and a recent step-up. A BEFORE trigger blocks removing or demoting the last active `firm_owner`, including for the table owner. |
| `audit_log` | Append-only trail: actor, actor_type, db_role, tenant, action, object, result, request_id, redacted diff, context. | SELECT: `firm_owner` of that org at aal2. No writes; UPDATE/DELETE/TRUNCATE rejected by triggers for every role. `token_hash` is redacted. |
| `outbox_events` | Transactional outbox (event envelope: id, organization_id, aggregate, version, type, schema_version, minimal payload ≤ 8 KB). Idempotency key unique per org. | SELECT: staff of that org at aal2. No writes; workers use functions. |
| `invitations` | Expiring single-use staff invite. Stores `sha256(token)` only, bound to normalized email, role, and organization. TTL 7 days. | SELECT: `firm_owner` at aal2, and not the `token_hash` column. No direct writes. |
| `persons` | Tenant-local person. Separate from `profiles`. `is_minor` is a staff-recorded flag. | SELECT/UPDATE via `app.can_read_person` / `app.can_write_person`. INSERT: operational staff in the active org at aal2. |
| `matters` | Tenant matter. Stage is independent of government outcome. | SELECT via `app.can_read_matter`. INSERT: operational staff. UPDATE: readers who are staff at aal2. |
| `matter_participants` | A person or a staff membership on a matter, with a party role. Composite foreign keys include `organization_id`. | SELECT via `app.can_read_matter_participant`. Writes: operational staff. |
| `households` / `household_members` | Grouping only. Never consulted by person or matter authorization. | Staff who can see the household. Portal roles see nothing here. |
| `person_relationships` | Descriptive links, including `payer` and `sponsor`. Never consulted by authorization. | Same staff rule as households. |
| `access_grants` | `explicit` or `guardian`. Guardian grants require a minor subject and a purpose. | SELECT: parties to the grant, or a firm owner at aal2. Writes: firm owner with a recent step-up. |
| `webhook_inbox` | Provider events. Unique `(provider, event_id)`. `provider_account_id` is stored; a replay with a different account is rejected. | SELECT: staff of the row's organization at aal2. Unscoped rows (`organization_id` null) are invisible to tenants. No direct writes. |
| `official_source_domains` | Official-host allowlist. Suffix match: exact host or a host that ends in `.` plus the registered host. Seed includes `canada.ca` (so `www.canada.ca` and `ircc.canada.ca`), `cic.gc.ca` (so `www.cic.gc.ca`), `college-ic.ca`, and the provincial hosts in the verification table below. `cic.gc.ca.evil.com` does not match. A match is an entry gate, not approval of a page. | SELECT: any active member with a workspace, or a platform admin at aal2. INSERT/UPDATE: `service_role`, or a platform admin at aal2. |
| `platform_admins` | Platform operators, keyed by `auth.users.id`. Not an organization role. The first row is not seeded. | SELECT: own row, or a platform admin at aal2. INSERT/UPDATE: `service_role` (and the database owner). |
| `official_sources` | Page identity. `organization_id` null is the platform catalog. A firm row is that firm's record of an allowlisted URL. Freshness columns move only from snapshot and check triggers. | SELECT: global rows for any active member; firm rows for that firm's staff at aal2. INSERT/UPDATE: practice writers of that firm. Global writes are `service_role`. |
| `source_snapshots` | Immutable capture: final URL, publisher, `retrieved_at`, nullable authority dates, sha256 `content_hash`. `snapshot_number` is assigned by the database. A hash change sets `change_detected` and does not rewrite older rows. | Same visibility as the parent source. Practice writers insert firm snapshots. |
| `source_dependencies` | Linked URL recorded against a parent snapshot. The parent cannot be rewritten. | Same visibility as the parent snapshot. |
| `source_check_attempts` | Append-only monitoring attempt. `failed` and `blocked` do not move `last_checked_at` and do not clear `change_detected`. | Staff of the active firm at aal2, including global attempts. Insert only. |
| `rule_definitions` / `rule_versions` | Stable key plus a version. Published content is frozen. `content_revision` bumps when the claim, dates, or tests change. Global drafts stay hidden; tenants see a global version only at `published`, `review_due`, `suspended`, or `superseded`. | Staff of the active firm at aal2. Firm rows are private. Practice writers insert and update firm rows. |
| `rule_evidence` | Claim-to-snapshot link. A blank or homepage section (`/`, `home`, `homepage`, `index`) cannot satisfy publication. Excerpt and interpretation notes are redacted in the audit diff. | Same staff visibility as the rule version. |
| `professional_reviews` | Decision on the current `content_revision`. `approved` requires an active `licensed_consultant` membership of the signed-in user. Credential snapshot stays null. | Staff of that review's organization at aal2. |
| `rule_pack_versions` / `rule_pack_items` | Versioned set a matter can pin. Publishing requires `next_review_at`, at least one item, and included rules already published, review-due, or suspended. | Staff visibility. Items are insert-only and freeze with the pack. |
| `matter_rule_bindings` | The pack version a matter used. The pin does not move when a newer pack is published. `recheck_required` is set when a cited source hash changes and a tenant cannot clear it. | Staff of that organization at aal2. |
| `rule_impacts` | Open work item when a cited hash changes (`source_content_hash_changed`). | Staff of that organization at aal2. |

Common columns: `created_at`, `updated_at`, `created_by`, `version` (bumped by `app.touch_row()` on
every UPDATE for optimistic locking: update `... where id = $1 and version = $expected`; 0 rows ⇒ 409).
Tenant and identity keys are immutable (`app.guard_immutable_keys()`).

## Roles (`public.org_role`)

Staff: `firm_owner`, `licensed_consultant`, `case_manager`, `assistant`, `finance_user`
(`app.staff_roles()`). Portal: `client`, `adult_dependant`, `sponsor`, `employer_contact`,
`guardian`, `external_collaborator`. Portal memberships give org access only. Person visibility
is self, an explicit grant, a guardian grant while the subject is a minor, firm-owner directory
access in the active workspace, or assignment on a matter that includes the person. A household,
payer, or sponsor link does not reveal another adult. A firm owner is not automatically a
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
| `app.current_aal()`, `app.staff_mfa_satisfied()` | `aal2` from the JWT. Staff roles need it; portal roles return true from the staff check so clients are not forced. |
| `app.mfa_step_up_satisfied(interval default 15 minutes)` | A `totp` entry in `amr` whose timestamp is inside the window. |
| `app.guard_staff_membership_mfa()` | BEFORE INSERT/UPDATE on memberships. Staff writes need aal2. Role and status changes need a recent step-up. Accepting one's own `invited` → `active` row is the exception. |
| `app.hash_invitation_token`, `app.create_staff_invitation`, `app.accept_invitation`, `app.revoke_invitation` | Token is 32 random bytes, hex. Only the sha256 hex digest is stored. Public wrappers: `create_staff_invitation`, `accept_invitation`, `revoke_staff_invitation`. |
| `app.guard_last_firm_owner()` | BEFORE UPDATE. Refuses to change the role or leave `active` when no other active `firm_owner` remains. |
| `app.can_read_person`, `app.can_write_person`, `app.can_read_matter`, `app.can_read_matter_participant`, `app.can_read_household`, `app.can_read_relationship`, `app.can_read_grant` | Thin policies call these. Household and relationship tables are not inputs. |
| `app.can_insert_practice_row` | `firm_owner`, `licensed_consultant`, or `case_manager`, active workspace, aal2. Assistants read and update assigned people; they do not insert practice rows. `finance_user` has no person or matter visibility. |
| `app.can_manage_access` | Firm owner, aal2, recent step-up, active workspace. |
| `app.ingest_webhook_event(...)` | service_role only. First payload wins. Duplicate `(provider, event_id)` returns the existing id; a different account raises an error. |
| `app.official_url_host(url)` / `app.host_is_allowlisted(host)` | HTTPS host parse, then exact or suffix match against `official_source_domains`. `cic.gc.ca.evil.com` is not `cic.gc.ca`. |
| `app.is_platform_admin()` | Signed-in user is in `platform_admins` and the JWT `aal` is `aal2`. Does not read tenant tables. |

## First platform admin

No user id is stored in the migration. In the Supabase SQL editor, as the database owner (or as `service_role`), run:

```sql
insert into public.platform_admins (user_id) values ('<auth.users.id>');
```

Replace `<auth.users.id>` with the person's id from `auth.users`. A platform admin at `aal2` can create and edit global domains, official sources, rule definitions, rule versions, and rule packs. That grant does not reveal another firm's rows.

## Provincial hosts verified 2026-10-17

Pages fetched that day. Hosts already in `20261017110000` were not inserted again.

| Host | Added now | Verification URL |
|---|---|---|
| `ontario.ca` | already present | https://www.ontario.ca/page/ontario-immigrant-nominee-program-oinp |
| `welcomebc.ca` | yes | https://www.welcomebc.ca/immigrate-to-b-c/about-the-bc-provincial-nominee-program |
| `alberta.ca` | already present | https://www.alberta.ca/aaip-application-streams |
| `saskatchewan.ca` | already present | https://www.saskatchewan.ca/residents/moving-to-saskatchewan/live-in-saskatchewan/by-immigrating/saskatchewan-immigrant-nominee-program |
| `immigratemanitoba.com` | yes | https://immigratemanitoba.com/ and https://www.gov.mb.ca/contact/faq.html |
| `quebec.ca` | already present | https://www.quebec.ca/en/immigration |
| `gnb.ca` | already present | https://www.gnb.ca/en/topic/family-home-community/immigration/provincial-nominee-program.html |
| `welcomenb.ca` | yes | https://www.welcomenb.ca/ redirects to https://www.gnb.ca/bil/immigration.html |
| `novascotia.ca` | already present | https://lampss.novascotia.ca/Forms/IMM/Home |
| `novascotiaimmigration.com` | yes | 301 to https://liveinnovascotia.com/nova-scotia-nominee-program |
| `liveinnovascotia.com` | yes | https://liveinnovascotia.com/nova-scotia-nominee-program |
| `princeedwardisland.ca` | yes | https://www.princeedwardisland.ca/en/topic/immigration |
| `gov.nl.ca` | already present | https://www.gov.nl.ca/immigration/immigrating-to-newfoundland-and-labrador/provincial-nominee-program/overview/ |
| `yukon.ca` | already present | https://yukon.ca/en/yukon-nominee-program |
| `gov.nt.ca` | already present | https://www.ece.gov.nt.ca/en/services/immigration-and-nominee-program |
| `immigratenwt.ca` | yes | https://www.immigratenwt.ca/ |
| `college-ic.ca` | already present | https://www.college-ic.ca/ |

Excluded: `liveinnovascotia.ca` (DNS answered, TLS handshake failed, so the page was not confirmed). `gov.nu.ca` stays from the original government seed; this fetch was stopped by a Cloudflare challenge, and IRCC says Nunavut has no nominee program, so no second Nunavut host was added. `gov.pe.ca/immigration` returned 404; the immigration pages that loaded are on `princeedwardisland.ca`.
| `app.rule_publication_blockers(version_id, content_revision)` | Not granted to `authenticated`. Blocks publish when claim, review date, tests, evidence, section, hash, retrieval time, or an approved review of that revision is missing, and when `effective_from` is only a copy of `retrieved_at`. |

Staff MFA is enforced with new functions and RESTRICTIVE policies. Existing helpers are not replaced (`CREATE OR REPLACE` is forbidden). `public.create_organization` now requires aal2 because the membership trigger fires when it inserts an active `firm_owner`. Step-up is not required there because `user_id` is the caller.

## Verified (rolled-back test transaction, 16 Oct 2026)

User A created a firm and became `firm_owner`; user B saw 0 orgs / memberships / audit rows /
outbox events, could not update A's org (0 rows), could not invite themselves (42501), could not
enqueue into A's org (42501), and setting A's org id as B's workspace resolved to null. Duplicate
idempotency key produced one outbox row. Profile display-name change was audited as redacted.
`UPDATE audit_log` as `postgres` was rejected. Security advisors: 0 findings.

## Known gaps (next tasks)

* T006 is not done: session inventory, revocation, recovery, and login rate limits are still open. Client and guardian invitations remain T021; this slice invites staff only.
* T007 is not done: negative tests cover SQL RLS (cross-tenant, household, payer, unassigned staff, guardian-without-grant, adult-to-adult). Storage URLs, search, exports, and jobs do not exist yet, so they are not tested. Sensitive document categories are not split. `finance_user` sees no person or matter rows in this slice.
* T010 is not done: the inbox deduplicates. Signature verification, retry, and the business effect of a webhook are still the worker's job.
* T011 is in the repository and not applied to the live project. There is no fetcher (T012), so a stored hash is attested by the caller and not checked against bytes. There is no review workbench (T013) and no client projection of rule claims (T017). The first `platform_admins` row is not seeded. `database.types.ts` does not include these tables until the migration is applied and types are regenerated.
* External tamper-evident audit sink (DB owner can still disable triggers).
* Age of majority is not calculated. `is_minor` is recorded by staff. An authority-review task when a child reaches majority is future work.
