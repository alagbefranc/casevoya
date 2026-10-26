# Support access: the admin portal contract

Decided by Francis 2026-10-19: **support requests come from the separate platform admin portal,
which writes to this database with the service role. Casevoya shows the firm owner the request,
lets them approve, decline, end or extend it, logs every use, and revokes on expiry. There is no
"log in as this firm" anywhere.** Status: built and tested in PGlite (branch
`support-access-grants`, migrations `20261020170000`–`20261020170200`); not applied live. PRD
SEC-04, SEC-09, ADM-04; TASKS T043.

## What the portal may call

Every call below is a Postgres function the portal invokes with the **service role** key
(`supabase.rpc(...)` or `select public.<function>(...)`). Nothing else: the portal never reads
or writes `support_access_requests`, `matters`, `documents` or any other firm table directly, and
no RLS policy opens a firm's rows to a platform admin.

### Ask for access

```sql
select public.create_support_access_request(
  p_organization_id      => '<firm uuid>',
  p_requester_name       => 'Jordan Reid',          -- 1 to 120 characters, shown to the firm
  p_requester_email      => 'jordan@casevoya.ca',   -- optional, lowercased
  p_ticket_ref           => 'CS-2291',              -- optional, up to 60 characters
  p_scope                => 'matter_documents',     -- see scopes
  p_matter_id            => '<matter uuid>',        -- required for the matter_* scopes, null for firm_settings
  p_not_included         => 'Document contents, messages, finance',  -- optional, up to 500 characters
  p_reason               => 'Uploads time out over 20 MB',           -- 8 to 1000 characters, shown to the firm
  p_minutes              => 60,                     -- 15 to 240, default 60
  p_requested_by_user_id => '<auth.users id of the admin, or null>'  -- must be a platform_admins row
);
-- returns the request id (uuid)
```

Rules: one **pending** request per firm (cancel the old one first; error `a support request is
already waiting for this firm`); the matter must belong to the firm; `firm_settings` names no
matter. The call audits `support_access.requested` and queues EX11 "Support access requested" to
every active firm owner. The firm sees the request on Access grants > Support access, Settings >
Security and Sheet > Notifications.

Scopes and what they open once approved:

| Scope | `support_read_matter` | `support_read_firm_settings` |
|---|---|---|
| `firm_settings` | no | yes |
| `matter_documents` | that matter: state and document records (states, types, sizes; never contents or file names) | no |
| `matter_records` | that matter: state, parties, tasks, deadlines | no |
| `matter_all` | that matter: both of the above | no |
| `records_set` | nothing through these functions today; the request describes the set, and the firm decides | no |

### Withdraw, or give it back early

```sql
select public.cancel_support_access_request('<request id>', 'Resolved another way');
```

A pending request becomes `cancelled`; an open (approved, unexpired) grant becomes `ended` with
audit context `by: support`. Anything else errors `that request is already closed`.

### Read, once the firm approved

```sql
select public.support_read_matter('<request id>', '<matter id>');
select public.support_read_firm_settings('<request id>');
```

Both refuse unless the request is approved and unexpired (`support access is not open`), the
caller is the service role or the platform admin the request names (at aal2), and the scope
covers what is asked (`the grant does not cover ...`). **Each successful call is one row in
`support_access_uses` and one audit event `support_access.used`**; the firm sees the count in its
history ("2 records, both listed in Audit"). Call them as often as the work needs; every call is
logged.

`support_read_matter` returns:

```json
{
  "request_id": "…", "scope": "matter_documents", "ends_at": "2026-10-22T15:40:00+00:00",
  "matter": { "id": "…", "reference": "CA-2026-0001", "title": "…", "stage": "in_progress", "on_hold": false,
              "engagement_status": "engaged", "government_status": "not_recorded", "is_sample": false,
              "created_at": "…", "updated_at": "…" },
  "documents": [ { "id": "…", "purpose": "Passport", "sensitivity": "ordinary", "audience": "subject", "versions": 2,
                   "current": { "version_number": 2, "upload_state": "clean", "review_state": "accepted",
                                "declared_media_type": "application/pdf", "detected_media_type": "application/pdf",
                                "declared_byte_size": 123456, "byte_size": 123456, "scan_result": null,
                                "quarantine_reason": null, "completed_at": "…", "created_at": "…" },
                   "failed_uploads": 0 } ],
  "participants": [ { "role": "applicant", "kind": "person", "name": "…" }, { "role": "consultant", "kind": "staff", "name": "…" } ],
  "tasks": [ { "id": "…", "title": "…", "status": "open", "audience": "client", "due_on": "2026-11-01" } ],
  "deadlines": [ { "id": "…", "label": "…", "kind": "legal", "due_on": "2026-11-01", "due_at": null, "verification": "confirmed" } ]
}
```

`documents` is present for `matter_documents` and `matter_all`; `participants`, `tasks` and
`deadlines` for `matter_records` and `matter_all`.

`support_read_firm_settings` returns:

```json
{
  "request_id": "…", "scope": "firm_settings", "ends_at": "…",
  "firm": { "id": "…", "display_name": "…", "legal_name": "…", "slug": "…", "default_locale": "en-CA",
            "timezone": "America/Toronto", "jurisdiction_codes": ["CA"], "verification_status": "unverified", "created_at": "…" },
  "seats": { "firm_owner": 1, "licensed_consultant": 2 }
}
```

### Reading the request's state

A platform admin signed in at aal2 whose `auth.users.id` the request names (`p_requested_by_user_id`)
can `select` their own rows from `public.support_access_requests` and `public.support_access_uses`
through RLS. The service role can read any row. `status` is one of `pending`, `approved`,
`declined`, `expired`, `ended`, `cancelled`; an approved row whose `ends_at` has passed is treated
as expired everywhere, and `app.expire_support_access()` (pg_cron, every five minutes) marks and
audits it.

## What the firm does

- **Approve** (firm owner, recent step-up): `approve_support_access_request(id)`; the grant starts
  at once and ends after the requested minutes. EM17 "Support access granted" goes to the owners.
- **Decline** (firm owner at aal2, with a reason): `decline_support_access_request(id, reason)`.
- **End now** (firm owner at aal2): `end_support_access(id)`.
- **Extend 30 min** (firm owner, recent step-up): `extend_support_access(id, 30)`; 240 minutes in all.

Audit actions: `support_access.requested`, `.approved`, `.declined`, `.ended`, `.extended`,
`.expired`, `.cancelled`, `.used`. The words of a reason stay on the row; the audit stream keeps
their length.

## Service-level report (ADM-04)

Branch `feat/adm-service-levels`, migration `20261025360000_service_levels.sql` (not applied
live). Platform admins act through RPC or `scripts/ops/service-levels.mjs` (service role); there is
no platform admin web UI.

**Support response times** come from `public.support_response_records`: one row per support
request a firm sent Casevoya, keyed by firm and the support desk's ticket reference, with when it
reached support and when support first replied (null while waiting). Metadata only: no subject,
message or anything the firm wrote. Casevoya's support desk is outside this repository, so a
platform admin records each request:

```sql
select public.record_support_response(
  p_organization_id   => '<firm uuid>',
  p_ticket_ref        => 'CS-2291',                    -- 1 to 60 characters; same ref again corrects it
  p_received_at       => '2026-10-25T14:05:00-04:00',  -- when it reached support; not in the future
  p_first_response_at => '2026-10-25T15:20:00-04:00',  -- null while it waits; not before received
  p_recorded_by       => '<platform admin user id>'    -- service role only; a signed-in admin records as themself
);
```

```
node scripts/ops/service-levels.mjs record <firm-id> --ticket CS-2291 \
  --received 2026-10-25T14:05:00-04:00 --responded 2026-10-25T15:20:00-04:00 \
  --recorded-by <platform-admin-user-id>
node scripts/ops/service-levels.mjs report <firm-id> --months 6
```

Callers: a platform admin signed in at aal2, or the service role naming a `platform_admins` user.
Firm staff never. Audited `service_level.support_response_recorded` / `.support_response_updated`
(ticket reference and times only).

**The report** `public.service_level_report(firm, months)` (1 to 24, default 6) gives, per month in
the firm's timezone (newest first), how many requests reached support, how many got a first reply,
how many wait, and the median and longest time to that reply in seconds. Read by the firm's owner
(aal2; shown on Settings > Security as "Support response time"), a platform admin at aal2 or the
service role; a Casevoya read is audited on the firm as `service_level.report_read`.

**Uptime** is `{"measured": false}`: Casevoya records no uptime monitoring (no health check,
status page or monitor writes to the database), so Settings > Security says "Not measured yet" and
no figure is ever computed. Hook: when a real source exists (for example service windows recorded
when an incident or maintenance notice is resolved), fill `uptime` in `public.service_level_report`
from it and give `serviceLevelRows` (`src/modules/sheet/service-levels-present.ts`) a measured form.

## Not built

- The admin portal itself (a separate codebase) and its sign-in.
- An emergency procedure that opens access without the firm's approval (SEC-09 allows one; every
  grant here needs the owner's approval).
- Reads for the `records_set` scope: the request describes the set in words; no function opens
  records for it yet.
- Incident notices (ADM-04) and uptime monitoring (see Service-level report above).
