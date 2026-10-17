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

## Open

* Erode-only typography vs DESIGN.md's tabular / non-decorative rule for money, IDs and form fields.
* Residency review for Supabase Auth email delivery and other subprocessors before claiming "Canada-only".
* First provinces / programs and the licensed reviewer (T001).
* Payment provider (Stripe Connect?) for earned fees.
