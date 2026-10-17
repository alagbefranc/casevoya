# Decision log

| Date | Decision | By |
|---|---|---|
| 2026-10-16 | Host on Supabase, region ca-central-1 (Canada Central), project `casevoya` | Francis |
| 2026-10-16 | Auth: Supabase Auth (not Clerk) | Francis |
| 2026-10-16 | Backend = Next.js server actions / route handlers + Supabase; jobs as Edge Functions / cron | Francis |
| 2026-10-16 | E-signature: build an in-house module (identity checks, e-sign consent, document hash, tamper-evident trail, sealed PDF + completion certificate). Not built yet | Francis |
| 2026-10-16 | All immigration info grounded only in official sources (IRCC/canada.ca, Justice Laws, CICC, provincial authorities), with source link + checked date + licensed review; fictional placeholders until then | Francis |
| 2026-10-16 | UI is designed in HTML by the Designer and converted to Next.js later; this repo ships a minimal shell only | Francis |
| 2026-10-16 | Migrations are additive only; anything destructive needs Francis's explicit approval | Francis |
| 2026-10-17 | Staff invitations expire after 7 days, are single-use, and persist only `sha256(token)`. Bound to organization, normalized email, and a staff role. Accepting moves membership `invited` → `active` and is audited. The raw token is returned once to the firm owner; there is no mailer yet. | Engineering, pending Francis |
| 2026-10-17 | Step-up window for sensitive staff actions is 15 minutes from the TOTP `amr` timestamp (`app.mfa_step_up_satisfied` and `STEP_UP_WINDOW_SECONDS`). SEC-01 actions in this slice: staff invites, invitation revoke, and access-grant writes. Exports, payment configuration, and sensitive downloads do not exist yet. | Engineering, pending Francis |
| 2026-10-17 | All staff roles need Supabase Auth TOTP at `aal2` in RLS and on `/app`. Portal roles are not redirected and are not blocked by the staff MFA trigger. Creating a firm now requires `aal2` because the new membership trigger runs inside `create_organization`. | Engineering, pending Francis |
| 2026-10-17 | The last active `firm_owner` cannot be demoted or moved off `active`, including by the table owner. A second active owner must exist first. | Engineering, pending Francis |
| 2026-10-17 | DEC-006 in this schema: a household, payer, or sponsor relationship never grants person visibility. Guardian access is an `access_grants` row of kind `guardian` and only while `persons.is_minor` is true. A firm owner at `aal2` can read every person in the active workspace. Other staff, except `finance_user`, see people through matter assignment. `licensed_consultant` and `case_manager` also see rows they created. `is_minor` is staff-recorded; age of majority is not calculated. | Engineering, pending Francis |
| 2026-10-17 | Webhook inbox uniqueness is `(provider, event_id)`, as specified for this change. `provider_account_id` is stored, and a replay that names a different account is rejected instead of inserting a second row. FIN-08's triple key (provider, connected account, event id) is not what was implemented. | Engineering, pending Francis |
| 2026-10-17 | Official sources use a lookup allowlist plus a trigger, not a hardcoded check of every host. `canada.ca` as a suffix covers `www.canada.ca` and `ircc.canada.ca`. `cic.gc.ca` as a suffix covers `cic.gc.ca` and subdomains such as `www.cic.gc.ca`. A lookalike such as `cic.gc.ca.evil.com` is rejected. `organization_id` null is the platform catalog. A firm may record its own allowlisted URL; that row is private to the firm. Publishing a rule requires an approved `licensed_consultant` review of the current content revision. Null authority dates stay null and are never copied from `retrieved_at`. No real immigration program, fee, form, or deadline is seeded. | Engineering, pending Francis |
| 2026-10-17 | Platform admins are rows in `platform_admins`, keyed by `auth.users.id`, not an organization role. `app.is_platform_admin()` requires that row and JWT `aal2`. A platform admin may create and edit global domains, official sources, rule definitions, rule versions, and rule packs. The same policies do not grant select or write on another firm's rows. No user id is seeded. The first row is `insert into public.platform_admins (user_id) values ('<auth.users.id>');` run by the database owner or `service_role`. | Francis |
| 2026-10-17 | Provincial nominee hosts confirmed by fetching the government page on 2026-10-17 are allowlisted: `welcomebc.ca`, `immigratemanitoba.com`, `welcomenb.ca`, `novascotiaimmigration.com`, `liveinnovascotia.com`, `princeedwardisland.ca`, and `immigratenwt.ca`, in addition to the government domains already seeded (`ontario.ca`, `alberta.ca`, `saskatchewan.ca`, `quebec.ca`, `gnb.ca`, `novascotia.ca`, `gov.nl.ca`, `yukon.ca`, `gov.nt.ca`, `gov.nu.ca`, `college-ic.ca`, and the others in that migration). `liveinnovascotia.ca` was not added because the TLS handshake failed. Verification URLs are in `docs/DATABASE.md` and in the notes on the new rows. | Francis |

## Open

* Erode-only typography vs DESIGN.md's tabular / non-decorative rule for money, IDs and form fields.
* Residency review for Supabase Auth email delivery and other subprocessors before claiming "Canada-only".
* First provinces / programs and the licensed reviewer (T001).
* Payment provider (Stripe Connect?) for earned fees.
* Firms may record their own allowlisted source rows. Hashes are stored, not fetched, until T012.
* An approved review requires a `licensed_consultant` membership. That membership is not a verified licence (T018). The credential snapshot stays null.
* `next_review_at` is required to publish and is not calculated from a daily, weekly, or monthly monitoring interval.
* Global drafts stay hidden from tenants. Clients do not see rule claims yet (T017). O01–O15 are not seeded.
* `service_role` can insert a professional review without being that user, because `auth.uid()` is null. That path is trusted infrastructure. T013 must not expose it as a user API.
