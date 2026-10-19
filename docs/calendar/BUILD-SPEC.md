# Casevoya Scheduling: build spec (calendar, booking, paid consultations, in-app video on LiveKit)

Written 18 Oct 2026 (CDT). This is an original design for `alagbefranc/casevoya`: Next.js 16 on Cloudflare
Workers, Supabase project `aqjtvqmojfamtspzyeqm`, forced RLS per organization, and the existing outbox mailer.
The cal.com study in `REPORT.md` informed the *behaviour* only. No cal.com code, schema, names or copy are to be
reused.

Base: `main`, plus the finance work in **PR #19** (`cursor/finance-t030-t033-049d` @ `6bdab08`, still open). The
paid-consultation parts of this module **depend on PR #19 being merged first**.

## 0. Ground rules
1. **Tenancy.**
   - Every new table has `organization_id uuid not null`, `alter table … enable/force row level security`, and
     policies through `app.current_organization_id()`.
   - Every foreign key is indexed (repo convention: `*_fk_covering_indexes` migrations).
   - Anonymous users never read tables directly. Public reads go through narrow `security definer` RPCs that return
     no PII.
2. **Money** is `bigint` cents. Currency is `'cad'` at launch, checked in SQL. Stripe runs in **test mode only**:
   `STRIPE_MODE=test` with `STRIPE_TEST_SECRET_KEY`, through the PR #19 helpers `stripeSecretKey` and `stripeForm`,
   which already refuse live keys and `/v1/checkout/`.
3. **No hosted pages.** No Stripe Checkout, no hosted invoices, and no third-party meeting pages or iframes (no Daily
   Prebuilt, no Zoom). Everything renders inside Casevoya; video media goes through our LiveKit server (§7).
4. **No demo data outside sample mode.** Seed rows, fake slots and fake meetings exist only when
   `sample-mode` is on (existing `components/sheet/markup/sample-mode.tsx` path). Live screens render real
   snapshots or empty states.
5. **Mail content.** The current templates never put a usable secret in an email
   (`modules/email/templates.ts`: "no token, no file body"). Join and manage links in booking mail are
   **non-secret references** (see 6.2). Joining or cancelling still requires a portal session or a one-time email
   code.
6. **Audit.** Every state change writes `audit_log`. Every outbound side effect (mail, LiveKit RoomService/Egress call, Stripe call)
   goes through the outbox or inbox, with idempotency keys.
7. **Nothing copied from cal.com.**

## 1. Database (new migrations, in order)

`2026102xxxxxx_scheduling_enums.sql`
- `booking_status`: `pending_payment`, `confirmed`, `cancelled`, `expired`, `no_show`, `completed`
- `booking_actor`: `client`, `staff`, `system`
- `refund_policy`: `none`, `full_before_cutoff`, `full_always`
- `video_session_status`: `scheduled`, `live`, `ended`, `cancelled`
- `recording_status`: `requested`, `recording`, `processing`, `stored`, `failed`, `deleted`
- `busy_source`: `google`, `microsoft`, `ics`, `manual`

`2026102xxxxxx_scheduling_core.sql` (requires `create extension if not exists btree_gist`)

| Table | Key columns | Notes |
|---|---|---|
| `booking_event_types` | `id, organization_id, slug, title, description, duration_min (5..480), slot_step_min (5..240, null = duration), buffer_before_min, buffer_after_min (0..240), min_notice_min (default 1440), max_advance_days (1..365), host_staff_ids uuid[] or join table, schedule_id, location_kind ('video'\|'phone'\|'in_person'), price_cents bigint default 0 check (>=0), currency text default 'cad' check (currency='cad'), refund_policy, refund_cutoff_hours int default 48, recording_allowed bool default false, requires_portal_account bool default false, intake_form_id null, is_published bool, version int` | unique `(organization_id, slug)`. Publishing a paid type requires the firm's `processor_accounts.status='enabled'` (PR #19). |
| `booking_event_type_hosts` | `event_type_id, staff_id, organization_id` | Round-robin later; v1 assigns the first free host. |
| `availability_schedules` | `id, organization_id, owner_staff_id, name, time_zone (IANA, checked against a list), is_default` | One default per staff member. |
| `availability_rules` | `schedule_id, organization_id, weekday smallint 1..7 (ISO), start_local time, end_local time` | check `end_local > start_local`. Overnight ranges are two rows. |
| `availability_overrides` | `schedule_id, organization_id, on_date date, start_local time null, end_local time null` | Both times null means the day is unavailable. Several rows per date are allowed, and they *replace* the weekly rules for that date. |
| `bookings` | `id uuid, public_ref text unique (base32 of 16 random bytes), organization_id, event_type_id, host_staff_id, starts_at timestamptz, ends_at, blocked_from, blocked_until (computed with buffers), attendee_time_zone, status, hold_expires_at, price_cents, currency (snapshot), refund_policy_snapshot jsonb, matter_id null, person_id null, cancelled_at, cancelled_by booking_actor, cancel_reason, rescheduled_from_id null, idempotency_key unique, version int` | **Exclusion constraint:** `exclude using gist (host_staff_id with =, tstzrange(blocked_from, blocked_until,'[)') with &&) where (status in ('pending_payment','confirmed'))`. This makes double-booking impossible, including during a payment hold, which fixes the gap noted in REPORT §0.3. |
| `booking_attendees` | `booking_id, organization_id, person_id null, name, email citext, phone null, role ('primary'\|'guest'), locale` | Email check like `email_deliveries.recipient_email`. |
| `booking_events` | `booking_id, organization_id, kind, actor, payload jsonb, created_at` | Append-only history (created, held, paid, confirmed, rescheduled, cancelled, refund_requested…). |
| `video_sessions` | `id uuid, booking_id unique, organization_id, room_name text unique ('cv-'+uuid without dashes), join_opens_at, join_closes_at, status, livekit_room_sid null (from webhook), started_at, ended_at, recording_requested bool` | One row per booking. Created with the booking; the LiveKit room is created lazily (§7.1). |
| `video_participants` | `video_session_id, organization_id, staff_id null, attendee_id null, identity text ('staff:…'\|'att:…'), role ('host'\|'client'), admitted_at, joined_at, left_at` | Tokens are **never stored** (Cal Video stores its owner token in `BookingReference.meetingPassword`); they are minted per join. |
| `video_recording_consents` | `video_session_id, organization_id, participant_id, consented bool, consent_text_version, decided_at, ip_hash` | One row per participant per session. |
| `video_recordings` | `video_session_id, organization_id, egress_id text unique, status, storage_path (R2 key), byte_size, sha256, duration_s, retained_until, deleted_at` | Written by LiveKit Egress straight to the private R2 bucket. |
| `external_busy_blocks` | `organization_id, staff_id, source busy_source, external_ref, starts_at, ends_at, synced_at` | Filled by the stub interface (§5); empty in v1. Indexed `(staff_id, starts_at)`. |
| `booking_payments` *(or reuse the PR #19 `payments` table with `flow='booking_fee'`, preferred)* | `booking_id` foreign key plus the PR #19 columns | Pick one in the PR #19 follow-up. The spec assumes PR #19 `payments` gains a nullable `booking_id` and `flow`. |

RLS:
- Staff `select` on all tables where `organization_id = app.current_organization_id()`. Only roles holding a
  `scheduling.manage` capability can write config tables (extend `lib/tenant/roles.ts`).
- Portal clients may `select` their own `bookings`, `booking_attendees` and `video_sessions` through the person
  link (pattern of `owner_person_access`).
- Writes to `bookings` happen only through RPCs:
  - `app.create_booking_hold`
  - `app.confirm_booking`
  - `app.cancel_booking`
  - `app.reschedule_booking`
  - `app.expire_booking_holds(p_as_of)`
  - `app.mark_video_session(...)`

  Each RPC checks the org and writes `booking_events`, `audit_log` and outbox rows in one transaction.
- Public RPCs (`security definer`, `search_path` pinned, anon `execute` only):
  - `public.booking_public_event(p_firm_slug, p_event_slug)` returns the published type, duration, price, currency,
    firm display name and time zone.
  - `public.booking_public_busy(p_event_type_id, p_from, p_to)` returns
    `{rules, overrides, schedule_tz, busy: [{start,end}]}` with **no** titles, names or ids. Busy covers
    `pending_payment` and `confirmed` bookings and `external_busy_blocks`.

Tests (PGlite, as the repo does):
- RLS isolation across two orgs.
- The exclusion constraint rejects an overlapping hold.
- An expired hold frees the range.
- anon cannot read tables.
- The public RPC leaks no PII.

## 2. Pure TypeScript slot library: `src/modules/scheduling/slots/`
No I/O, no Date.now (time is passed in) and no runtime dependency, so it runs on Workers and in the browser. Time
zone math uses `Intl.DateTimeFormat(..., {timeZone}).formatToParts` to find the offset at an instant, plus a
two-pass local-to-UTC resolver (`zone.ts`).

Files:
- `zone.ts`
  - `offsetMinutes(instant, tz)`
  - `localToUtc(dateISO, timeHHMM, tz, {gap:'forward', overlap:'earlier'})`
  - `utcToLocal(instant, tz)`
- `windows.ts`
  - `expandSchedule({rules, overrides, tz, fromUtc, toUtc}) → Interval[]` (UTC, half-open, merged)
- `intervals.ts`
  - `merge`, `subtract(base, cuts)`, `intersect(a,b)`, `pad(interval, beforeMin, afterMin)`
- `slots.ts`
  - `generateSlots({windows, busy, durationMin, stepMin, bufferBeforeMin, bufferAfterMin, minNoticeMin,
    maxAdvanceDays, nowUtc, alignTz}) → SlotStart[]`
  - A slot `[s, s+duration)` is offered only when `[s - bufferBefore, s + duration + bufferAfter)` misses every
    busy interval and `[s, s+duration)` sits inside a window.
  - Starts are aligned to `stepMin` on the *schedule's local clock* (so +05:30 and +05:45 zones align locally), and
    the earliest start is `ceil(now + minNotice)`.
- `encode.ts`
  - `encodeStarts(starts) / decodeStarts(...)`: a compact wire form of epoch minutes followed by deltas. This is our
    own format; production cal.com uses a similar idea (REPORT §3.4).
- `index.ts` holds the public API and types.

Vitest list (`tests/scheduling-slots.test.ts`, plus `zone`, `intervals` and `encode` suites):
1. Weekly rule Mon 09:00-17:00 Toronto → correct UTC on an EDT date and an EST date.
2. DST spring-forward (8 Mar 2026, Toronto): a 02:00-03:00 rule is resolved forward, and no slot exists in the gap.
3. DST fall-back (1 Nov 2026, Toronto): an 01:00-02:00 rule takes the earlier occurrence once, with no duplicate
   slot.
4. Host in Toronto, booker in Vancouver: the same UTC starts are returned (rendering is the client's job).
5. Asia/Kolkata (+05:30) and Asia/Kathmandu (+05:45) schedules align to local :00/:30.
6. An override with times replaces that weekday's rules.
7. An override with null times blocks the whole day.
8. Several override ranges on one date.
9. An override on a date with no weekly rule adds availability.
10. Overnight availability expressed as two rows across midnight.
11. Duration 60, step 30 → overlapping starts. Step null → step equals duration.
12. A slot that would overrun the window end is excluded, including the last minute.
13. Minimum notice 24 h relative to `nowUtc` mid-day → first slot is the next aligned start.
14. Minimum notice crossing a DST boundary uses elapsed minutes, not wall time.
15. Max advance days cuts off at the end of the local day.
16. Busy interval subtraction: exact-edge touching is allowed (half-open), overlap by 1 minute is not.
17. Buffer before/after blocks adjacent slots; the buffer can extend outside the window.
18. Existing booking buffers are applied symmetrically (their blocked range already includes their buffers).
19. Several busy sources merged (booking, hold, external).
20. An empty schedule gives no slots. A zero-length rule is ignored.
21. Leap day (29 Feb 2028) and month-end ranges.
22. Range query spanning 62 days stays under 50 ms for one host with 400 busy blocks (perf guard).
23. `encodeStarts`/`decodeStarts` round-trip, including an empty list and large gaps.
24. Input validation: unknown IANA zone, `end<=start`, negative buffers → typed errors.
25. Determinism: the same input gives byte-identical output (no hidden clock).
26. Property test (fast-check, dev dependency only): every generated slot fits a window and misses all padded
    busy intervals.

## 3. API routes (Next.js route handlers, Workers runtime)
Public (rate-limited per IP and per firm; Cloudflare Turnstile on hold creation):
- `GET /api/book/[firm]/[event]` returns the public event (`booking_public_event`).
- `GET /api/book/[firm]/[event]/slots?from&to&tz` calls `booking_public_busy` and then `generateSlots`. It returns
  `{starts: encoded, tz}`. Cache 30 s per (event, range).
- `POST /api/book/[firm]/[event]/hold` takes `{start, attendee:{name,email,phone?}, tz, answers, idempotencyKey}`.
  - It re-validates the slot server-side and calls `app.create_booking_hold`, which takes the exclusion-constrained
    insert.
  - Free type: the booking is confirmed immediately (`confirm_booking`), returning `{publicRef, status:'confirmed'}`.
  - Paid type: status `pending_payment` with `hold_expires_at = now()+15 min` (setting
    `booking.payment_hold_minutes`). It creates the PaymentIntent (§8) and returns
    `{publicRef, clientSecret, publishableKey, connectAccountId, expiresAt}`.
- `GET /api/book/manage/[ref]` returns booking summary only after OTP or portal session.
- `POST /api/book/manage/[ref]/otp` and `/otp/verify` email a 6-digit one-time code (outbox template
  `booking_code`). On success they set a short-lived httpOnly cookie scoped to that ref.
- `POST /api/book/manage/[ref]/cancel` and `/reschedule` `{start}` require the OTP cookie or a portal session.

Staff (session + MFA as in the existing shell; step-up for refunds):
- `GET/POST/PATCH /api/scheduling/event-types[/id]`, `/api/scheduling/schedules[/id]`,
  `/api/scheduling/overrides`
- `GET /api/scheduling/bookings?from&to&staff`
- `POST /api/scheduling/bookings/[id]/cancel`
- `POST /api/scheduling/bookings/[id]/reschedule`
- `POST /api/scheduling/bookings/[id]/no-show`
- `POST /api/scheduling/bookings/[id]/refund` (PR #19 approval rules)

Video:
- `POST /api/video/[ref]/token` mints the LiveKit access token (§7.3). It needs a staff session (host role) or a
  client portal session / OTP cookie (client role, lobby grant).
- `POST /api/video/[ref]/admit` `{identity, decision:'admit'|'deny'}` is host only (§7.4).
- `POST /api/video/[ref]/consent` takes `{consented}`.
- `POST /api/video/[ref]/recording` `{action:'start'|'stop'}` is for the host only and requires all consents.
- `GET /api/video/recordings/[id]` returns a ≤10-min R2 presigned URL to authorised staff (§7.5).
- `POST /api/video/livekit/webhook` handles LiveKit events (§7.6).

Payments:
- Extend the PR #19 `POST /api/stripe/webhook` (§8.3). There is no new webhook endpoint.

Cron (Worker scheduled trigger, every minute):
- `app.expire_booking_holds(now())`, then cancel the PaymentIntent for each expired hold.
- `claim_due_reminders` gains booking reminders (§6).

## 4. UI
Staff pages, inside the existing sheet shell (`SheetScreen`, `SheetBody`, live slots mounted the way PR #19 mounts
`#cv-payment`). Designer markup already exists for `book`, `calendar` and `consultations`; keep its classes and add
live mount points:
- **Calendar** (`/sheet/calendar`): week and day grid of bookings and holds (hatched), filtered by staff. Clicking
  opens a booking drawer with join, reschedule, cancel, refund and no-show.
- **Consultations** (`/sheet/consultations`): list with status chips (pending payment, confirmed, completed,
  cancelled), payment and receipt links, recording status.
- **Settings → Booking types**: CRUD form with duration, step, buffers, notice, advance, hosts, price (CAD),
  refund policy and cutoff, recording allowed, publish toggle. The publish toggle is disabled with a reason if paid
  and Connect is not enabled.
- **Settings → Availability**: weekly editor plus a date-override calendar. The time zone picker defaults to the
  firm's zone.
- **Video call** (`/call/[ref]`): the branded call UI (§7.4).

Public pages:
- `/book/[firm]/[event]`
  - Step 1: month calendar and slot list in the booker's detected zone, with a zone switcher. It uses the encoded
    starts and shows the price if paid.
  - Step 2: details form (name, email, phone, intake answers).
  - Step 3: free → confirmation view. Paid → in-page **Stripe Payment Element** mounted from the returned
    `clientSecret` on the firm's account (`Stripe(pk, {stripeAccount})`). It shows a hold countdown and calls
    `confirmPayment({redirect:'if_required', confirmParams:{return_url:/book/[firm]/[event]/done?ref=…}})`.
  - The page shows "Confirming…" until the server reports `confirmed`, polling
    `/api/book/manage/[ref]/status` (public, status only). It never trusts the client result.
- `/book/[firm]` lists the published types.
- `/book/manage/[ref]`: OTP gate, then view, reschedule (same slot picker), cancel (shows the refund outcome before
  confirming) and join.
- `/book/[firm]/[event]/done?ref=` handles the return after 3-D Secure.
- The existing `/book` page stays the designer/demo entry. The live route is the dynamic one.

## 5. External busy-time stub
```ts
// src/modules/scheduling/busy/provider.ts
export type BusyInterval = { startsAt: string; endsAt: string };          // UTC ISO, half-open
export interface ExternalBusyProvider {
  readonly source: "google" | "microsoft" | "ics";
  listBusy(input: { organizationId: string; staffId: string; fromUtc: string; toUtc: string }): Promise<BusyInterval[]>;
}
export const noExternalBusy: ExternalBusyProvider = { source: "ics", async listBusy() { return []; } };
```
- `booking_public_busy` reads `external_busy_blocks`. A future sync worker (Google free/busy, Graph calendarView;
  see REPORT §6) fills that table, so slot reads never call providers inline.
- v1 ships with the stub registered and the table empty.
- Tests assert that blocks in the table subtract from slots.

## 6. Mailer hooks (outbox `email_deliveries`, `modules/email/templates.ts`)
New templates. Copy is generic and holds no secrets. Links are to `https://{app}/book/manage/{ref}` or
`/call/{ref}`, which require OTP or a session:

| Template | Trigger (in the RPC transaction) | Content |
|---|---|---|
| `booking_confirmed` | `confirm_booking` | Firm, type, local date and time in the attendee zone (plus firm zone), "Join video call" link `/call/{ref}` (opens 15 min before), manage link, `.ics` attachment |
| `booking_payment_pending` | Hold created for a paid type, sent only if still unpaid after 10 min | Resume link to `/book/manage/{ref}` (the resume page re-fetches the client secret after OTP) |
| `booking_rescheduled` | `reschedule_booking` | New time; the same join link (it does not change) |
| `booking_cancelled` | `cancel_booking` | Refund outcome (full, none, or pending staff review) |
| `booking_reminder` | `claim_due_reminders`, 24 h and 1 h before | Join link and manage link |
| `booking_receipt` | Payment confirmed | Receipt number `R-{year}-{seq}`; PDF link `/api/receipts/[id]/pdf` (PR #19), portal-gated |
| `booking_staff_notice` | Any of the above, to the host | Same facts plus a staff link |
| `booking_code` | OTP request | 6-digit code, 10 min expiry |

ICS: build `text/calendar` with a UID of `{public_ref}@casevoya`, a SEQUENCE bumped on reschedule, `METHOD:CANCEL`
on cancel, and LOCATION and URL set to `/call/{ref}`. This needs attachment support in `modules/email/dispatch.ts`
(add it if missing).

## 7. Video: Cal Video's flow and pages, on self-hosted LiveKit (replaces Daily; replaces the Zoom Video SDK plan)
**Decision (Francis, 18 Oct 2026):** keep the *shape* of Cal Video (a room per booking, a stable join page,
server-minted per-person tokens, guest vs host roles, recording and transcript hooks, lifecycle tied to the
booking) but run it on **LiveKit** (server, Egress and client SDKs are Apache-2.0) instead of Daily.co, which is a
paid third-party engine. No Daily account, no Daily key, no Zoom. Nothing of Daily's proprietary service is
reverse-engineered: REPORT §11 maps only Cal.com's own code and its calls to Daily, observed against a local fake.

Why not Daily: Daily bills per participant-minute after 10,000 free minutes a month ($0.004/participant-min list),
cloud recording $0.01349/recorded min plus $0.003/min storage, transcription extra, and has no hard spend cap
(daily.co/pricing/video-sdk, checked 18 Oct 2026). Cal Video requires `DAILY_API_KEY` (and `DAILY_SCALE_PLAN=true`
for recording); see REPORT §11.1.

### 7.0 Hosting option (pick one; the code is identical, only `LIVEKIT_URL` and keys change)
| | **A. Self-host on a VPS (recommended for cost control)** | **B. LiveKit Cloud, free Build plan (fastest start)** |
|---|---|---|
| What | `livekit-server` (single Go binary / Docker) + `livekit-egress` + Redis on one VPS (e.g. 4 vCPU / 8 GB, Canadian region for residency) | Managed SFU; we only hold an API key/secret |
| Cost | VPS only (~CA$30-60/mo); egress CPU-heavy, so size for 1-2 concurrent recordings | $0. Hard caps per month: 5,000 WebRTC participant-min, 50 GB downstream, 60 transcode min shared ingress/egress, 2 concurrent egress, 100 concurrent participants; requests fail when exceeded (no overage). Ship plan starts at $50/mo |
| Ops | Domain + TLS (Caddy/Let's Encrypt), open UDP 50000-60000 and TCP 7881, TURN/TLS on 443 for strict firewalls (built-in TURN), `livekit.yaml` with `keys`, `webhook.urls`, Redis for egress. Update/monitor ourselves | None |
| Residency | Ours (choose the VPS region) | LiveKit's global edge; confirm region pinning before using for privileged calls |
| Recording | Egress on our box writes to R2 | Cloud Egress writes to R2 (counts against the 60 transcode min on Build) |

Recommendation: start on **B** for development and the first pilot firm (free, zero ops), switch `LIVEKIT_URL` to
**A** before general availability or as soon as monthly minutes or recording approach the Build caps. The free plan's
60 transcode minutes make recording effectively a paid/self-hosted feature.

**Prerequisites (Francis):**
- B: create a LiveKit Cloud project → copy **API Key**, **API Secret**, **WebSocket URL** (`wss://<project>.livekit.cloud`); add the webhook URL `https://{app}/api/video/livekit/webhook` in project settings.
- A: generate a key pair (`livekit-server generate-keys`), put it in `livekit.yaml`, set `webhook.api_key` and `urls`.
- R2: a private bucket `casevoya-recordings` + an R2 API token (S3 access key id/secret) scoped to that bucket.

Env (Workers secrets; never sent to the client): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`R2_RECORDINGS_BUCKET`, `R2_S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`. Server SDK: `livekit-server-sdk` (Twirp over `fetch`, JWT via `jose`; verify it bundles on
the Workers runtime in slice 7, otherwise call the Twirp endpoints with `fetch` and sign tokens with Web Crypto).

### 7.1 Room per booking (Cal Video parity: "room created on booking")
- `confirm_booking` inserts `video_sessions` with `room_name = 'cv-' || replace(id::text,'-','')` (opaque, no PII),
  `join_opens_at = starts_at - 15 min`, `join_closes_at = ends_at + 30 min`, `status='scheduled'`.
- The outbox job calls `RoomService.CreateRoom {name, emptyTimeout: 600, departureTimeout: 60, maxParticipants:
  8, metadata: {"session_id": …}}` **lazily**: at first token mint inside the join window (LiveKit also auto-creates
  rooms on first join; explicit create lets us set limits). Unlike Cal Video's Daily room (`privacy:"public"`, any
  holder of the URL can knock), a LiveKit room is unreachable without a token we minted.
- No room expiry bookkeeping is needed (Cal Video sets Daily `exp = end + 14 days` and must re-create expired
  rooms on reschedule, REPORT §11.2); we simply stop minting tokens after `join_closes_at` and the room closes
  `emptyTimeout` seconds after the last participant leaves.

### 7.2 Lifecycle tied to the booking (Cal Video parity: update on reschedule, delete on cancel)
- **Reschedule:** update the same `video_sessions` row window; keep `room_name` and the `/call/{ref}` link (Cal Video
  keeps the Daily room and re-posts its properties, REPORT §11.2). If `status='live'` refuse; host ends first.
- **Cancel:** `status='cancelled'` → the token route refuses; outbox job `RoomService.DeleteRoom {room}` (disconnects
  anyone inside) if it exists. Mirrors Cal Video's `DELETE /v1/rooms/{name}`.
- **No-show:** `participant_joined` webhooks set `video_participants.joined_at`; a job at `ends_at + 15 min` with no
  client join lets staff mark `no_show` (Cal Video uses Daily `/meetings?room=` for this, REPORT §11.1 #14).

### 7.3 Server-minted access tokens (`POST /api/video/[ref]/token`; Cal Video parity: owner vs guest meeting tokens)
`AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {identity, name, ttl, metadata})` with a `VideoGrant`:
| Role | Grant |
|---|---|
| Host (staff of the org with access to the booking) | `roomJoin, room, canPublish, canSubscribe, canPublishData, canPublishSources:[camera,microphone,screen_share,screen_share_audio], roomAdmin:true, roomRecord:false` |
| Client (attendee via portal session or OTP cookie) | lobby token first (7.4): `roomJoin, room, canSubscribe:false, canPublish:false, canPublishData:false, hidden:false`; after admission the host's admit call updates permissions server-side |
- `identity = 'staff:'+staff_id` or `'att:'+attendee_id`; `name` is the display name; `ttl = min(join_closes_at - now, 2h)`; `metadata={"role":"host"|"client"}`.
- Mint only inside the join window, for the right org/attendee, rate-limit 10/min/identity, never log or store the
  token. Unlike Cal Video's `/video/[uid]`, which hands any anonymous visitor a guest token plus host and attendee
  emails in SSR props (REPORT §11.3), our page renders nothing until the session/OTP check passes, and returns no
  emails.

### 7.4 Branded call UI and lobby (`/call/[ref]`, client component; Cal Video parity: Daily Prebuilt iframe)
Packages: `livekit-client`, `@livekit/components-react`, `@livekit/components-styles` (all Apache-2.0); themed with
Casevoya tokens, no third-party iframe.
- **Pre-join:** `<PreJoin>` (camera/mic preview, device pickers) inside our frame: firm logo/name, title, local time,
  countdown before the window, recording-consent checkbox (versioned text).
- **Lobby / admission (replaces Daily `enable_knocking`):** the client connects with the lobby grant (can neither
  publish nor subscribe, so sees and sends nothing), and the host's "Waiting" panel lists participants whose
  `metadata.role='client'` and `admitted_at is null`. **Admit** → `POST /api/video/[ref]/admit {identity}` → server
  `RoomService.UpdateParticipant {room, identity, permission:{canPublish, canSubscribe, canPublishData,
  canPublishSources:[camera,microphone,screen_share]}}` and writes `admitted_at`. **Deny** →
  `RemoveParticipant`. Unadmitted clients see "Waiting for {host}".
- **In call:** `<LiveKitRoom serverUrl token connect>` + custom layout from `GridLayout`/`FocusLayout`,
  `ParticipantTile`, `ControlBar` (mic, camera, **screen share** via `TrackSource.ScreenShare`, leave), `useTracks`,
  connection-quality indicator, end-for-all (host → `DeleteRoom`), recording banner driven by room metadata.
- **Chat:** `useChat` (data channel), ephemeral, not persisted by default (privileged); "Save chat to matter" only
  with both parties' consent.
- No COOP/COEP requirement (that was a Zoom SDK need); keep default headers.

### 7.5 Recording via LiveKit Egress to R2, with consent (Cal Video parity: Daily cloud recording + `/api/video/recording` proxy)
- Allowed only if `booking_event_types.recording_allowed`, the host requests it, and every current participant has
  `video_recording_consents.consented=true` (asked in pre-join; withdrawal stops it).
- `POST /api/video/[ref]/recording {action:'start'}` (host, re-checks consent) → `EgressClient.startRoomCompositeEgress(room_name,
  {file: EncodedFileOutput{fileType: MP4, filepath: 'recordings/{organization_id}/{session_id}/{time}.mp4',
  output: S3Upload{accessKey, secret, bucket: R2_RECORDINGS_BUCKET, endpoint: R2_S3_ENDPOINT, region: 'auto',
  forcePathStyle: true}}}, {layout: 'grid'})` → store `egress_id`, status `recording`; set room metadata
  `{"recording":true}` so every client shows the banner. `stop` → `stopEgress(egress_id)`.
- `egress_ended` webhook → `status='stored'`, `storage_path`, `byte_size`, `duration_s` from `fileResults`; compute
  sha256 in a follow-up job reading from R2. Retention sweep deletes from R2 after `video.recording_retention_days`
  (default 90; Cal Video ships a manual 6-month Daily deletion script instead).
- Access: staff `GET /api/video/recordings/[id]` → re-check RLS + audit → **short-lived R2 presigned GET (≤10 min)**.
  Do not copy Cal Video's 6-month HMAC token whose secret falls back to a hard-coded string when unset
  (REPORT §11.4).
- Transcription is out of scope for v1 (Cal Video uses Daily's paid batch-processor). Later option: run an
  open-source Whisper job on the stored file, never on a third-party service without firm opt-in.

### 7.6 LiveKit webhooks (`POST /api/video/livekit/webhook`)
- Verify with `WebhookReceiver(API_KEY, API_SECRET).receive(rawBody, Authorization)` (JWT signed with our secret,
  carrying the body sha256); reject on failure (401), ingest via the existing webhook inbox, dedupe on `event.id`.
- Events: `room_started`, `room_finished`, `participant_joined`, `participant_left`, `egress_started`,
  `egress_updated`, `egress_ended`. Effects: `status live/ended`, participant join/leave times, recording state;
  mark the booking `completed` on `room_finished` after at least one client join.

### 7.7 Mapping: every Cal Video → Daily call and its LiveKit equivalent
(Daily side observed at runtime by REA against a local fake; see REPORT §11.1 for file:line of each swap point.)
| # | Cal Video (Daily) | When | LiveKit equivalent in Casevoya |
|---|---|---|---|
| 1 | `POST /v1/rooms {privacy:"public", properties:{enable_prejoin_ui, enable_knocking, enable_screenshare, enable_chat, enable_pip_ui, exp:end+14d, enable_recording:"cloud"?, enable_transcription_storage, permissions.canAdmin:["transcription"]}}` | booking confirmed | `RoomService.CreateRoom {name, emptyTimeout, departureTimeout, maxParticipants, metadata}` (lazy, at first token); pre-join = `<PreJoin>`, knocking = lobby grant + admit (7.4), screenshare = `canPublishSources`, chat = data channel |
| 2 | `POST /v1/meeting-tokens {room_name, exp, is_owner:true, enable_recording_ui:false}` (stored in `BookingReference.meetingPassword`) | right after room create | nothing stored; host `AccessToken` minted per join (7.3) |
| 3 | `POST /v1/rooms/{name}` (re-post properties, new `exp`) + new owner token | reschedule | update `video_sessions` window only; no LiveKit call |
| 4 | `DELETE /v1/rooms/{name}` | cancel | `RoomService.DeleteRoom {room}` |
| 5 | `GET /v1/meeting-tokens/{token}` (validate/expiry) then `POST /v1/meeting-tokens` | every `/video/[uid]` view | none (JWT is self-contained; we check our DB window) |
| 6 | `POST /v1/meeting-tokens {room_name, exp}` guest token (anonymous allowed) | guest opens `/video/[uid]` or `/api/video/guest-session` | client `AccessToken` with lobby grant, only after portal/OTP auth |
| 7 | `POST /v1/meeting-tokens {…, is_owner:true, user_id}` and write back to DB | organizer opens `/video/[uid]` | host `AccessToken` with `roomAdmin` |
| 8 | `@daily-co/daily-js` `DailyIframe.createFrame({url, token, theme, customTrayButtons})` → iframe `https://{domain}.daily.co/{room}?t={token}` | call page | `livekit-client` + `@livekit/components-react` `<LiveKitRoom>` rendered in our DOM |
| 9 | `@daily-co/daily-react` `DailyProvider`, `useDailyEvent('left-meeting'…)`, `useRecording`, `useTranscription`, `daily.startRecording/stopRecording/startTranscription/updateCustomTrayButtons` | in call | `RoomContext`, `useRoomContext`, `RoomEvent.Disconnected`, server-side Egress start/stop (7.5), our own `ControlBar` buttons |
| 10 | Daily webhook `recording.ready-to-download` (HMAC-SHA256 `x-webhook-signature` over `{ts}.{body}`, base64 secret `DAILY_WEBHOOK_SECRET`) | after recording | LiveKit `egress_ended` webhook (JWT `Authorization`) |
| 11 | `GET /v1/recordings/{id}`, `GET /v1/recordings/{id}/access-link?valid_for_secs=43200`, `GET /v1/recordings?room_name=` | recording emails, tRPC `getCalVideoRecordings`, `/api/video/recording?token=` redirect | R2 object list by prefix + presigned GET (7.5) |
| 12 | `POST /v1/batch-processor {preset:"transcript", inParams:{sourceType:"recordingId", recordingId}}`, `GET /v1/batch-processor/{id}/access-link`, webhook `batch-processor.job-finished` | after recording | none in v1 (optional self-hosted Whisper job later) |
| 13 | `GET /v1/transcript?mtgSessionId=`, `GET /v1/transcript/{id}/access-link`, webhook `meeting.ended` | after meeting | none in v1 |
| 14 | `GET /v1/meetings?room={name}` (participants, for no-show tasks) | tasker `triggerNoShow` | our `video_participants` rows from `participant_joined/left` webhooks |
| 15 | `POST /v1/rooms` instant room (`exp = end + 1h`, `start_video_off`) | instant meetings | out of scope |
| 16 | `getDailyAppKeys()` (`App.keys` of slug `daily-video`: `api_key`, `scale_plan`) gating Cal Video as default location | everywhere | env secrets 7.0; location kind `video` always available |

### 7.8 Later add-ons, not in v1
- Per-firm Zoom Meetings connector (direct Zoom OAuth, create/PATCH/DELETE like REPORT §7). Runtime note: Cal.com
  refreshed the Zoom token twice in parallel with the same refresh token (REPORT §10.4); ours must single-flight
  refreshes.
- Transcripts (self-hosted Whisper), dial-in via LiveKit SIP.

## 8. Paid consultations (Stripe, in-app only; reuses PR #19)
### 8.1 Configuration
- `booking_event_types.price_cents` (CAD cents), `currency='cad'`, `refund_policy` and `refund_cutoff_hours`.
- The price and policy are **snapshotted onto the booking** at hold time.

### 8.2 Hold, then pay
1. `POST …/hold` (paid type) inserts the booking as `pending_payment` with `hold_expires_at`. The exclusion
   constraint now blocks the slot.
2. It inserts a PR #19 `payments` row: `flow='booking_fee'`, `booking_id`, `amount_cents=price`,
   `currency='cad'`, `status='processing'`.
3. It creates the PaymentIntent with `stripeForm` on the **firm's Connect account**:
   - `POST /v1/payment_intents`
   - headers `Stripe-Account: {processor_accounts.stripe_account_id}`, `Idempotency-Key: {payment.id}`
   - body: `amount`, `currency=cad`, `automatic_payment_methods[enabled]=true`,
     `metadata[flow]=booking_fee`, `metadata[organization_id]`, `metadata[booking_id]`, `metadata[payment_id]`,
     `receipt_email` omitted (Casevoya sends its own receipt), `application_fee_amount` omitted (0, per PR #19
     default 5)
4. It returns the `client_secret` to the page. The **Payment Element** is mounted in-page. There is no Checkout
   and no redirect, except the 3DS `return_url`.
5. Hold timeout: the cron runs `app.expire_booking_holds`, which sets status `expired` and releases the range, then
   calls `POST /v1/payment_intents/{id}/cancel` (same Stripe-Account). The hold is also extended once by 5 min if the
   intent is `processing` or `requires_action` when the cron fires.

### 8.3 Confirmed by webhook only
Extend `src/modules/finance/webhook.ts` with a `flow === "booking_fee"` branch **before** the generic
`payment_intent.succeeded` branch (currently at line 106, which would otherwise label it `client_fee`). It
normalises to `booking_fee.succeeded` / `booking_fee.failed`. `record_stripe_event` then calls
`app.confirm_paid_booking(payment_id)`, which:
- checks amount and currency against the booking snapshot. A mismatch means do not confirm, open a review task and
  audit it.
- if the booking is `pending_payment`, sets it `confirmed`, `payments.status='succeeded'`, creates `video_sessions`,
  issues the **receipt** (PR #19 receipts, `R-{year}-{seq}`, PDF at `/api/receipts/[id]/pdf`) and enqueues
  `booking_confirmed` + `booking_receipt` + staff notice.
- **Late payment after expiry:** if the range is still free, it re-takes it and confirms. Otherwise it auto-refunds
  in full, sends `booking_cancelled` with "slot taken, refunded", and audits it.
- Duplicate events return 200 with no effect (the existing inbox dedupe). A client redirect never confirms anything.

`payment_intent.payment_failed` keeps the hold until expiry, so the client can retry within the Payment Element.

### 8.4 Refund policy on cancel
- **Client cancel:**
  - `full_always` → full refund.
  - `full_before_cutoff` → full refund if `now <= starts_at - cutoff_hours`, otherwise none.
  - `none` → no refund.

  The outcome is shown before the client confirms.
- **Firm or staff cancel** → always a full refund.
- Refunds use `POST /v1/refunds {payment_intent}` with `Stripe-Account` and `Idempotency-Key: refund:{booking_id}`.
  The PR #19 rules apply: the refund approval limit (`refund_self_approval_limit_cents`), the second approver when
  two billing staff exist, and a credit note when a receipt was issued.
- `refund.succeeded` (already normalised in PR #19) updates `payments`. If a receipt was issued, it issues a credit
  note and sends `booking_cancelled` with the refund line.
- **Reschedule** keeps the same payment, with no new charge or refund. A client reschedule inside the cutoff can be
  disallowed by setting `allow_late_reschedule=false`.
- No-show fees and saved cards (SetupIntent) are deferred. Note for later: REPORT §8 describes the pattern.

### 8.5 Guards
- `stripeSecretKey()` must return a test key. Tests assert `STRIPE_LIVE_SECRET_KEY` is never read.
- Paid types cannot be published unless Connect is `enabled`. Only `connect.updated` sets that.
- The amount is always computed server-side from the snapshot. The client never sends a price.
- Runtime lessons from Cal.diy (REPORT §10.7) that tests must cover: a failed PaymentIntent create rolls back the
  hold in the same request (no orphan `pending_payment` row); a retry with the same idempotency key returns the
  *existing hold and its client secret*, never "confirmed"; cancelling an unpaid hold cancels its PaymentIntent; every
  Stripe write carries an `Idempotency-Key`.

## 9. Sample mode
- Sample mode renders a fixed fictional firm calendar, slots and a fake call screen. It makes no Stripe or LiveKit
  calls; the token endpoint returns 404 and the Payment Element is replaced by a static mock.
- Live mode never shows sample rows. Empty states read "No booking types yet" and similar.
- **Practice pages** (docs/DECISIONS.md, 2026-10-18; `20261019190000_booking_practice_pages.sql`): a firm in
  sample mode may publish a booking type as a sample row. Its public page and APIs answer only the firm's own
  signed-in staff (with MFA); everyone else gets the unpublished page's 404. Bookings made there are sample
  bookings, with every usual check, and their mail is sent like other sample records' mail.

## 10. Delivery plan (suggested PR slices)
1. Migrations, enums, RPCs, RLS, PGlite tests.
2. Slot library and the full Vitest list.
3. Public slots and hold API, the free booking path, the `/book/[firm]/[event]` UI, `booking_confirmed` mail and
   ICS.
4. Staff settings (types, availability, overrides), calendar, consultations.
5. Manage flow: OTP, reschedule, cancel, reminder templates and cron. **Status 2026-10-19 (branch
   `portal-appointment-actions`):** the portal part is built: a signed-in client moves or cancels their own
   upcoming consultation from Appointments (`portal_reschedule_booking`, `portal_cancel_booking`,
   `portal_booking_availability`; minimum notice and booking window enforced for clients, late cancellations
   recorded), EM16b/EM16c to the client (EM16c says who cancelled), in-app notices to the host and owner, and
   "Join video call" as the firm's stored meeting link from 10 minutes before the call. Not built: the OTP
   "Manage your booking" link for bookers without a portal, reminder templates and cron.
6. Paid consultations: PR #19 webhook branch, hold expiry cron, Payment Element, receipt, refunds.
7. LiveKit video: token + admit routes, room lifecycle hooks, `/call/[ref]` UI (PreJoin, lobby, grid, screen share,
   chat), webhook route. Start on LiveKit Cloud Build; self-host switch is config only.
8. Recording with consent via Egress → R2, presigned access, retention sweep.
9. The external-busy stub wired with tests. Google and Microsoft sync stay in the backlog.

Acceptance:
- `pnpm` lint, typecheck, test and build pass, and the migration check passes.
- The exclusion constraint test proves no double booking.
- A test-mode Stripe card books, confirms by webhook, issues a receipt, then cancels with a refund.
- Two browsers join one call, with lobby admit, screen share and chat.
- Cancelling the booking blocks new tokens.

## 11. Open decisions for Francis
1. The join link in email is a non-secret `/call/{ref}` behind a portal session or OTP (recommended, consistent
   with current mail rules). The alternative is a signed one-tap link.
2. Hold length: 15 min (default) vs 10.
3. Default refund cutoff: 48 h.
4. Recording retention: 90 days. Can a client ever download recordings?
5. Whether to persist chat (default: no).
6. LiveKit hosting: Cloud Build plan for the pilot, then a Canadian VPS (recommended) before GA? Recording on the
   free plan is capped at 60 transcode min/month.
7. Transcripts: skip in v1 (Daily's are a paid add-on) or plan a self-hosted Whisper job?
