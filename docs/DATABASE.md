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
| 20261017113157 | source_governance | Official-host allowlist, source snapshots, check attempts, rule versions, evidence, professional reviews, pack versions, matter pins, impacts. Applied live. |
| 20261017113202 | platform_admin_and_pnp_domains | `platform_admins` and `app.is_platform_admin()`, plus verified provincial nominee hosts. Applied live. No user id is seeded. |

In the repository, not yet applied to the live project (do not edit the file in place once applied):

| Version | Name | Contents |
|---|---|---|
| 20261017120000 | matter_rule_bindings_fk_index | Covering index on `matter_rule_bindings (matter_id, organization_id)`. Additive only. Not applied on the live project. |
| 20261017140000 | finance_matter_billing | Billing projection and audited `issue_invoice` / `approve_earned_fee_transfer`. No ledger tables. |
| 20261017140100 | webhook_account_dedupe | Unique `(provider, connected_account_id, event_id)` with `NULLS NOT DISTINCT`. |
| 20261017140200 | owner_person_access | Assignment-based person reads. Audited 60-minute break-glass. |
| 20261017140300 | matter_stage_transitions | Stage changes only through `transition_matter_stage`, with evidence. |
| 20261017140400 | person_date_of_birth | `date_of_birth`, derived minor status, firm `age_of_majority_years` (default 19, firm-configurable 18–21; Francis confirmed). |
| 20261017140500 | staff_recovery_sessions_passkey | Hashed recovery codes, session revocation, owner MFA reset, passkey assurance. |
| 20261017140600 | fk_covering_indexes_practice | Covering indexes for foreign keys on matter stage evidence, stage transitions, break-glass, and session revocations. The break-glass actor index is not partial. |
| 20261017140700 | firm_onboarding | Firm setup, sample mode, trial settings, and manual CICC public-register licence checks. Not applied on the live project. |
| 20261017140800 | portal_invitations | Client, adult dependant, sponsor, employer contact, and guardian invites. Hashed single-use tokens, consent, section shares. Not applied on the live project. |
| 20261017200000 | agreements_current_version_fk_index | Covering index on `agreements (current_version_id, organization_id)`. |
| 20261017200100 | outbound_email | Outbox-driven deliveries, suppressions, and mail claim. Staff invites, document requests, and due reminders enqueue mail without raw tokens. |
| 20261017200200 | inbound_email | Per-firm `docs.casevoya.ca` addresses, reserved slugs, inbound messages, and the unsorted inbox. |
| 20261017200300 | reserved_firm_slugs_search_path | `app.reserved_firm_slugs` gets `search_path = ''` and schema-qualified types. No storage changes. |

`src/types/database.types.ts` includes the live schema through `20261017113202`, extended in this branch for the unapplied migrations above. Do not run `pnpm db:types` until those migrations are applied; a live regeneration would drop the extension.

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
| `persons` | Tenant-local person. Separate from `profiles`. `date_of_birth` plus `birth_date_precision` (`day`, `month`, `year`) is canonical. `birth_date` and `is_minor` are mirrors written by trigger. Grants use `app.person_is_minor`, not the mirror. | SELECT/UPDATE via `app.can_read_person` / `app.can_write_person`. A firm owner is not in that read. INSERT: operational staff in the active org at aal2. |
| `matters` | Tenant matter. Stage is independent of government outcome. Direct stage updates are rejected. | SELECT via `app.can_read_matter`. INSERT: operational staff, stage `engagement_pending` only. UPDATE of other columns: readers who are staff at aal2. Stage: `public.transition_matter_stage`. |
| `matter_participants` | A person or a staff membership on a matter, with a party role. Composite foreign keys include `organization_id`. | SELECT via `app.can_read_matter_participant`. Writes: operational staff. |
| `households` / `household_members` | Grouping only. Never consulted by person or matter authorization. | Staff who can see the household. Portal roles see nothing here. |
| `person_relationships` | Descriptive links, including `payer` and `sponsor`. Never consulted by authorization. | Same staff rule as households. |
| `access_grants` | `explicit` or `guardian`. Guardian grants require a subject `app.person_is_minor` currently treats as a minor, and a purpose. | SELECT: parties to the grant, or a firm owner at aal2. Writes: firm owner with a recent step-up. |
| `webhook_inbox` | Provider events. Unique `(provider, connected_account_id, event_id)`, nulls not distinct. Empty `provider_account_id` is stored as a null connected account. A different account is a different event. First payload wins. | SELECT: staff of the row's organization at aal2. Unscoped rows (`organization_id` null) are invisible to tenants. No direct writes. |
| `person_break_glass` | One person, one owner, 60 minutes, reason required. Read only. | SELECT: the actor, or a firm owner of that org at aal2. Inserts and closes go through functions. |
| `matter_stage_evidence` | Evidence required to enter a stage. `submission_confirmation` requires external reference, submission time, and receipt locator. | SELECT: matter readers. INSERT: owner, consultant, case manager, or assistant who can read the matter, at aal2. |
| `matter_stage_transitions` | Append-only stage history, including reverse moves and a controlled reopen. | SELECT: matter readers. Inserts only from `app.transition_matter_stage`. |
| `session_revocations`, `auth_session_cutoffs`, `mfa_recovery_codes`, `mfa_recovery_attempts`, `mfa_assurance_proofs` | Session cutoffs, hashed recovery codes, and session-bound assurance proofs. No policies. | No table privileges for `authenticated`. Functions only. |
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
is self, an explicit grant, a guardian grant while `app.person_is_minor` is true, or assignment
on a matter that includes the person. A firm owner does not have directory-wide person access.
Break-glass is a 60-minute read of one person, with a recent step-up, and it is audited.
`finance_user` does not read person rows. An assigned finance user, and a firm owner in the
active workspace, can read a billing projection (matter id, title, stage, applicant display name)
and call `issue_invoice` at aal2. `approve_earned_fee_transfer` also needs a recent step-up.
A household, payer, or sponsor link does not reveal another adult. A firm owner is not
automatically a licensed consultant. Platform admin is intentionally **not** an org role.

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
| `app.current_aal()`, `app.staff_mfa_satisfied()` | Staff assurance is `aal2`, or a passkey `amr` entry, or a recovery-code proof for this session, and the session is not revoked. Portal roles are not redirected by the proxy. |
| `app.mfa_step_up_satisfied(interval default 15 minutes)` | A fresh passkey `amr` entry, or `aal2` with a fresh `totp`, `mfa/webauthn`, or `mfa/recovery_code` entry, or an app recovery-code proof inside the window. |
| `app.guard_staff_membership_mfa()` | BEFORE INSERT/UPDATE on memberships. Staff writes need aal2. Role and status changes need a recent step-up. Accepting one's own `invited` → `active` row is the exception. |
| `app.hash_invitation_token`, `app.create_staff_invitation`, `app.accept_invitation`, `app.revoke_invitation` | Token is 32 random bytes, hex. Only the sha256 hex digest is stored. Public wrappers: `create_staff_invitation`, `accept_invitation`, `revoke_staff_invitation`. |
| `app.guard_last_firm_owner()` | BEFORE UPDATE. Refuses to change the role or leave `active` when no other active `firm_owner` remains. |
| `app.can_read_person`, `app.can_write_person`, `app.can_read_matter`, `app.can_read_matter_participant`, `app.can_read_household`, `app.can_read_relationship`, `app.can_read_grant` | Thin policies call these. Household and relationship tables are not inputs. |
| `app.can_insert_practice_row` | `firm_owner`, `licensed_consultant`, or `case_manager`, active workspace, aal2. Assistants read and update assigned people; they do not insert practice rows. `finance_user` has no person-row access and no full matter row. |
| `app.can_manage_access` | Firm owner, aal2, recent step-up, active workspace. |
| `app.ingest_webhook_event(...)` | service_role only. First payload wins. Duplicate `(provider, connected_account_id, event_id)` returns the existing id. Null and `''` are the same account. |
| `app.can_read_matter_billing`, `public.list_matter_billing`, `public.perform_billing_action` | Billing projection and the two audited billing actions. Not person access. |
| `public.open_person_break_glass`, `public.close_person_break_glass` | Owner, step-up, 60 minutes, one person, read only. |
| `public.transition_matter_stage` | Allowed edge, evidence for the destination stage, optimistic `version`. Submitted and later stages require `licensed_consultant`. |
| `app.derive_is_minor`, `app.person_is_minor` | Partial dates count as minor only when the oldest possible birthday is still under the firm's `age_of_majority_years` (default 19, range 18–21). That default is a product setting, not a legal finding. |
| `public.generate_recovery_codes`, `public.consume_recovery_code` | Ten hashed single-use codes. Regenerate needs step-up and retires unused codes. Five failures lock the user for 15 minutes. |
| `public.list_my_sessions`, `public.revoke_my_session`, `public.revoke_other_sessions` | Session inventory and revocation. A revoked session fails `app.staff_mfa_satisfied`. |
| `public.reset_staff_mfa` | Owner, step-up, not self. Retires codes, cuts off old tokens, purges Auth factors and sessions. Audit stores `reason_length` only. |
| `public.session_mfa_satisfied` | Invoker wrapper the proxy calls when the JWT is not yet `aal2`. |
| `app.official_url_host(url)` / `app.host_is_allowlisted(host)` | HTTPS host parse, then exact or suffix match against `official_source_domains`. `cic.gc.ca.evil.com` is not `cic.gc.ca`. |
| `app.is_platform_admin()` | Signed-in user is in `platform_admins` and the JWT `aal` is `aal2`. Does not read tenant tables. |

## First platform admin

No user id is stored in the migration. In the Supabase SQL editor, as the database owner (or as `service_role`), run:

```sql
insert into public.platform_admins (user_id) values ('<auth.users.id>');
```

Replace `<auth.users.id>` with the person's id from `auth.users`. A platform admin at `aal2` can create and edit global domains, official sources, rule definitions, rule versions, and rule packs. That grant does not reveal another firm's rows.

## Provincial hosts verified 2026-10-17

Pages fetched that day. Hosts already in `20261017113157` were not inserted again.

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
| `college-ic.ca` | already present | https://www.college-ic.ca/ . Suffix match includes `register.college-ic.ca`. Public register entry pages identified 2026-10-17: https://register.college-ic.ca/Public-Register-EN and https://register.college-ic.ca/Public-Register-EN/RCIC_Search.aspx . The snapshot hashes are those HTML shells, not the register database. No RISIA search URL is stored. |

Excluded: `liveinnovascotia.ca` (DNS answered, TLS handshake failed, so the page was not confirmed). `gov.nu.ca` stays from the original government seed; this fetch was stopped by a Cloudflare challenge, and IRCC says Nunavut has no nominee program, so no second Nunavut host was added. `gov.pe.ca/immigration` returned 404; the immigration pages that loaded are on `princeedwardisland.ca`.
| `app.rule_publication_blockers(version_id, content_revision)` | Not granted to `authenticated`. Blocks publish when claim, review date, tests, evidence, section, hash, retrieval time, or an approved review of that revision is missing, and when `effective_from` is only a copy of `retrieved_at`. |

Staff MFA is enforced with new functions and RESTRICTIVE policies. A later migration may `CREATE OR REPLACE FUNCTION` and `DROP CONSTRAINT`. Dropping tables, deleting rows, and replacing views stay forbidden. `public.create_organization` requires aal2 because the membership trigger fires when it inserts an active `firm_owner`. Step-up is not required there because `user_id` is the caller.

## Verified (rolled-back test transaction, 16 Oct 2026)

User A created a firm and became `firm_owner`; user B saw 0 orgs / memberships / audit rows /
outbox events, could not update A's org (0 rows), could not invite themselves (42501), could not
enqueue into A's org (42501), and setting A's org id as B's workspace resolved to null. Duplicate
idempotency key produced one outbox row. Profile display-name change was audited as redacted.
`UPDATE audit_log` as `postgres` was rejected. Security advisors: 0 findings.

## Firm onboarding (repository only, `20261017140700`)

Not applied on the live project. Do not run `pnpm db:types` or `supabase db push` for it.

`product_settings` holds `trial.duration` (14 days), `licence.recheck_interval` (1 month), and `licence.manual_check_target` (1 business day). Francis confirmed those defaults on 2026-10-17. `pending_confirmation` is false, and a platform admin can still change them. `business_days` is not converted into an interval and does not verify a licence. A trial copies `trial.duration` into `organization_subscriptions.duration_snapshot` when the firm is created. Later edits do not rewrite that snapshot. `trial_ended` does not delete rows. It blocks new real client invites.

`organizations.sample_mode` defaults to true. `authenticated` and `service_role` can insert people and matters only with `is_sample`. The sample label is `Fictional sample. Not a client record.` The flag cannot be changed. A sample person cannot be linked to a real matter. Billing and `list_exportable_matter_ids` skip sample rows.

`consultant_credentials` stores `licence_type` (`RCIC` or `RISIA`), `college_id` (uppercase storage limit, not a published CICC format), register status (`active` or `inactive`), `entitlement_to_practise`, discipline flags for suspension, revocation, and restriction, and `discipline_restriction_detail` when a restriction is recorded. `credential_checks` is append-only and stores the same detail. Staff with MFA can read both. The reviewer is a firm owner or a platform admin, with a recent step-up. The source URL must be `https` on `register.college-ic.ca`, which is allowlisted by the `college-ic.ca` suffix. `app.record_licence_check` derives the result. It does not accept a caller-supplied standing, and it does not fetch the register. `manual_public_register` is the only method. Revoked, suspended, inactive, and Entitlement to Practise = No (`not_entitled`) lock that consultant's new matters and regulated stage changes. A restriction flag and its detail do not auto-lock. Missing a credential does not lock a stage change. `attempt_matter_stage_transition` and `create_practice_matter` keep the denial audit `licence.regulated_action_blocked`. A re-check outbox event `licence.recheck_due` is due at `retrieved_at` plus `licence.recheck_interval`. `not_entitled` also enqueues `licence.adverse_status`.

Real client invitations stay locked until `verification_status` is `verified`, a manual good-standing licence is on file, the subscription is not `trial_ended`, and the six sample proofs are recorded. Staff invitations are unchanged. The eight setup steps follow the designer screen, in order: `firm_details` (Firm details), `terms_and_privacy` (Terms and privacy), `jurisdictions` (Where you practise), `licence` (Your licence), `branding` (Branding), `calendar_and_payments` (Calendar and payments), `records_and_retention` (Records and retention), `sample_case` (Sample case). The six key steps on Sample case are `intake` (Send an intake form), `agreement` (Send a service agreement), `upload` (Request and review an upload), `reminder` (Schedule a reminder), `invoice` (Issue an invoice), and `export` (Export the file). The designer HTML is a reference and is not in the repo. Calendar and payment connectors are not stored. Client email language stays `en-CA` or `fr-CA`. Jurisdiction codes stay two letters.

## Matter lifecycle, intake, and tasks (repository only, `20261017170000`–`20261017170300`)

Not applied on the live project. `public.create_engaged_matter` names a responsible consultant and may pin a published rule pack. The reference trigger fills `matters.reference`. Direct updates of stage, reference, hold, engagement, government status, outcome, predecessor, and retention are rejected. `public.transition_matter_stage` is unchanged for callers who already have evidence. `public.override_matter_stage` records the permitted role and then uses that same transition. Intake answers are append-only. Submit copies the latest answer per field into `intake_snapshots`. A later save enqueues `intake.answer_corrected` and does not rewrite the snapshot. Tasks have no update grant. Status, reassignment, and escalation go through definer functions. `public.claim_due_reminders` is `service_role` only. `20261017170300` adds `organization_id` indexes on `consent_records`, `person_section_records`, and `section_shares`.

## Documents (repository only, `20261017180000`–`20261017180100`)

Not applied on the live project. Do not run `pnpm db:types` or `supabase db push` for them. The private `documents` bucket is not public. Upload state and review state are separate. `structural_only` means the type, size, and extension matched. It is not a virus scan. A firm cannot raise the 25 MB default until `documents.large_uploads_enabled` is true. Signed retrieval links last 120 seconds. Upload authorization lasts 15 minutes. Both are pending confirmation.

## Agreements and in-house signatures (repository only, `20261017190000`–`20261017190100`)

Not applied on the live project. Do not run `pnpm db:types` or `supabase db push` for them. `20261017190000` adds `electronic_signature` to `consent_purpose` in its own migration, because Postgres cannot use a new enum label in the same transaction. `20261017190100` adds templates, agreements, locked versions, envelopes, signers, append-only signature events, and representation authority. Every envelope provider is `in_house`. There is no third-party e-sign vendor.

A sent version stores SHA-256 of its canonical text and cannot be edited. A fee change after a signature supersedes the open envelope and inserts a new version. The final PDF and completion certificate are `%PDF` bytes on the envelope and a matching object in the private `documents` bucket. `storage.objects` is not altered. Portal download streams `agreement_executed_pdf` and `agreement_certificate_pdf`. Staff create, send, revise, and void need aal2 and a recent step-up. A portal signer does not, unless that signer is a staff membership. Signing a service agreement moves a pending engagement to engaged. Representation authority is a separate write.

`agreements.envelope_days` is 14 and `agreements.esign_consent` is version `esign-consent-2026-10-17`. Both have `pending_confirmation` true.

## Email (repository only, `20261017200000`–`20261017200200`)

Not applied on the live project. Do not run `pnpm db:types` or `supabase db push` for them. Do not deploy the Worker from CI.

Outbound mail is claimed from the outbox by `POST /api/email/dispatch` (bearer `EMAIL_DISPATCH_SECRET`) and sent with the Cloudflare Email Sending REST API. `from` and `reply_to` are `{address, name}`. The visible name is the firm display name. The default From address is `notices@casevoya.ca` (`email.from_address`, confirmed, still configurable via `CLOUDFLARE_EMAIL_FROM`).

Inbound addresses are `<firm-slug>@docs.casevoya.ca`. A matter reply is `<firm-slug>+<32 hex>@` the same domain. `INBOUND_EMAIL_DOMAIN` overrides `email.inbound_domain` (default `docs.casevoya.ca`, confirmed). These slugs cannot be claimed: `support`, `billing`, `admin`, `hello`, `noreply`, `postmaster`, `abuse`, `security`, `help`, `info`, `team`. The Worker in `workers/inbound-email` buffers `message.raw` once, parses with postal-mime, and POSTs to `/api/email/inbound` with `x-casevoya-timestamp` and `x-casevoya-signature` (HMAC-SHA256 of `timestamp.body`, five-minute skew).

Known senders on a matter go through `create_upload_intent` and `complete_document_upload` into the private `documents` bucket. Other attachments land in `inbound_inbox_items` for staff at aal2 with a recent step-up to assign. Unknown firms are rejected. The hourly cap defaults to 30 (`email.inbound_hourly_limit`, pending confirmation) and a duplicate message id does not consume it. Bodies go to `public.messages` when that table has `organization_id`, `matter_id`, and `body`; otherwise they stay on `inbound_emails`.

Deploy steps and the routing env vars are in `docs/DEPLOY.md`. The Worker does not publish a `workers.dev` hostname (`workers_dev = false`). Each claimed slug gets an exact rule `<slug>@docs.casevoya.ca` named `casevoya-firm:<slug>` on zone `303990065795d627a9fd337b01258024`, action Send to Worker `casevoya-inbound-email`. A failed rule does not roll back the slug. `POST /api/email/routing/reconcile` adds missing firm rules and deletes stale ones with that name prefix. The `casevoya-test@` rule and the catch-all stay. Plus-tags use subaddressing and do not get their own rules. `app.reserved_firm_slugs` is pinned with `search_path = ''` in `20261017200300`. That migration does not alter `storage` tables.

## Known gaps (next tasks)

* T006 recovery codes, session revocation, owner-assisted MFA reset, and passkey assurance are in the repository and not applied live. Login rate limits and idle timeout are still open. Client and guardian invitations remain T021; this slice invites staff only.
* T007 negative tests cover SQL RLS. Storage URLs, search, exports, and jobs do not exist yet. `finance_user` still has no person-row access. Billing is a projection plus two audited actions; invoices and the ledger are T030.
* T010 dedupes on `(provider, connected_account_id, event_id)`. Signature verification, retry, and the business effect of a webhook are still the worker's job.
* T011 source governance is applied on the live project (`20261017113157`, `20261017113202`). There is no fetcher (T012), so a stored hash is attested by the caller and not checked against bytes. There is no review workbench (T013) and no client projection of rule claims (T017). The first `platform_admins` row is not seeded. `database.types.ts` includes that live schema and the unapplied migrations in this branch. The `matter_rule_bindings` foreign-key index (`20261017120000`) is in the repository and is not applied on the live project.
* T023 and T026 are in the repository as `20261017170000`–`20261017170300` and are not applied on the live project. Do not run `pnpm db:types` or `supabase db push` for them. The agreement document itself remains T022. `engagement_status` includes `ended`, and no function sets it yet.
* T024 and T025 are in the repository as `20261017180000` and `20261017180100` and are not applied on the live project. There is no malware scanner, preview, OCR, or camera assembly. `complete_document_upload` trusts the caller-supplied checksum and header when the stored size matches. The supported path is the server action, which hashes the downloaded object. Package invalidation is not implemented. A superseded clean file can still be downloaded so an older package stays reproducible.
* T022 is in the repository as `20261017190000` and `20261017190100` and is not applied on the live project. The sealed PDF is a text rendering of the locked agreement, not a visual replica of a government form, and the PDF says it is not a government-form signature. There is no mailer for “ready to sign”. Envelope expiry is enforced on the next sign attempt. `agreements.envelope_days` and `agreements.esign_consent` are still pending confirmation.
* A firm owner can still read household membership ids. That is not person-row access.
* External tamper-evident audit sink (DB owner can still disable triggers).
* Majority review still enqueues `person.majority_review_due`. T026 also opens one internal task titled `Majority review` when `is_minor` changes from true to false and a date of birth is on file. The birth date is not copied onto the task. Francis confirmed `age_of_majority_years` defaults to 19 and is firm-configurable from 18 to 21.
* T018 firm onboarding, sample mode, and manual licence checks are in `20261017140600` and `20261017140700` and are not applied on the live project. There is no register scraper. Client invitation rows remain T021. An approved professional review is still not a verified licence until a manual register check is recorded.
