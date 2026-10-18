# Cal.com booking internals: study for Casevoya

Prepared Sunday 18 Oct 2026, 07:55 CDT. Source studied: `https://github.com/calcom/cal.com`, shallow clone at
`/workspace/calcom-src`, commit `6bfe2df9d13c456dc9374c9e6581b36fba188728`, committed 2026-10-18 05:27 CDT. The
clone is sparse: it holds `packages/{app-store/*, features, emails, lib, prisma, trpc, types}` and parts of `apps/web`.

Citations use the form `path:line`, with paths relative to `/workspace/calcom-src`. Nothing in this report or in
BUILD-SPEC.md is copied from cal.com. The function and field names below are quoted only so the source can be found.

## 0. Read this first

1. **The licence is not what the brief assumed.** The repo at this commit is **Cal.diy**, the community edition.
   `LICENSE` is MIT ("Copyright (c) 2020-present Cal.com, Inc."), and README says Cal.diy is "strictly recommended
   for personal, non-production use". The tree has **no `ee/` directory** (`git ls-tree -r HEAD | grep /ee/` comes
   back empty). The commercial pieces are stubs:
   - `apps/web/pages/api/integrations/stripepayment/webhook.ts:9-11` returns 404 with "Payment webhooks are not
     available in community edition".
   - `apps/web/pages/api/stripe/webhook.ts:9-11` is the same for billing.
   - The Stripe Elements payment component and the Workflows (attendee reminders) module are absent.

   We still copy nothing. Casevoya's design is original, so the AGPL vs MIT question does not affect what we ship.
2. **Production cal.com is ahead of this source.** REA's runtime capture shows that production calls
   `slots/getAvailabilityRanges`, which returns a delta-encoded `starts` array plus `heldStarts` (section 3.4). This
   checkout exposes `slots/getSchedule` (`packages/trpc/server/routers/viewer/slots/util.ts:897`).
3. **Unpaid bookings do not block a slot in cal.com** (confirmed at runtime, §10.5).
   - Busy-time collection reads only `ACCEPTED` bookings (`packages/features/busyTimes/services/getBusyTimes.ts:81`).
   - `PENDING` bookings count only when `requiresConfirmationWillBlockSlot` is set
     (`packages/features/bookings/repositories/BookingRepository.ts:765-775`).
   - The only hold is a 5-minute `SelectedSlots` reservation made while the booker fills in the form
     (`packages/trpc/server/routers/viewer/slots/reserveSlot.handler.ts:29`, `packages/lib/constants.ts:137`).
   - So a paid booking awaiting payment can be double-booked once that reservation lapses. Casevoya's spec fixes this
     with an explicit payment hold.
4. **Runtime pass and video decision.** §10 has REA runtime evidence for every flow on a local Cal.diy with faked
   third parties. §11 maps every Cal Video→Daily touch point; BUILD-SPEC §7 replaces Daily with LiveKit.

## 1. Data model (Prisma, `packages/prisma/schema.prisma`)

| Concept | Model / field | Lines |
|---|---|---|
| Event type | `model EventType` | 156 |
| Slug, length, hidden | `slug`, `length` (minutes), `hidden` | 161, 168, 170 |
| Locations (video app choice) | `locations Json?` | 166 |
| Booking window | `periodType` (enum `UNLIMITED/ROLLING/ROLLING_WINDOW/RANGE` at 48-53), `periodStartDate`, `periodDays` | 196-201 |
| Confirmation | `requiresConfirmation`, `requiresConfirmationWillBlockSlot` | 205-206 |
| Notice and buffers | `minimumBookingNotice @default(120)`, `beforeEventBuffer`, `afterEventBuffer` | 219-221 |
| Cancel/reschedule rules | `disableCancelling`, `minimumRescheduleNotice` | 225, 228 |
| Availability link | `schedule`/`scheduleId` | 232-233 |
| Price | `price`, `currency`: marked **deprecated**, now in `metadata.apps.stripe.{price,currency}` | 235-238 |
| Slot step | `slotInterval` | 239 |
| Schedule | `model Schedule { name, timeZone, availability[] }` | 945-958 |
| Weekly hours and date overrides | `model Availability { days Int[], startTime @db.Time, endTime @db.Time, date @db.Date? }`. A row with `date` set is an override. | 960-976 |
| Booking | `model Booking { uid, idempotencyKey, startTime, endTime, location, status, paid, payment[], references[], metadata, iCalUID, iCalSequence … }` | 851-905 |
| Booking status | `CANCELLED, ACCEPTED, REJECTED, PENDING, AWAITING_HOST` | 843-849 |
| External artefacts | `model BookingReference { type, uid, meetingId, meetingPassword, meetingUrl, externalCalendarId, credentialId, deleted }`. One row per calendar event or video meeting. | 801-824 |
| Payment | `model Payment { uid, appId, bookingId, amount, fee, currency, success, refunded, data Json, externalId @unique, paymentOption }` | 1095-1113 |
| Payment option | `ON_BOOKING`, `HOLD` (card saved for a later charge, used for no-show fees) | 1115-1118 |

## 2. Availability and date overrides

- **Collecting rows.** `getUserAvailability._getUserAvailability`
  (`packages/features/availability/lib/getUserAvailability.ts:361`) builds `workingHours` (436) and pushes
  `dateOverrides` (456).
- **Expanding to concrete ranges.** It then calls `buildDateRanges` (511), defined at
  `packages/features/schedules/lib/date-ranges.ts:226`. Inside:
  - `processWorkingHours` (`date-ranges.ts:32`) walks each local day. It recomputes the UTC offset per day so that
    "midnight stays midnight across DST" (comments at 56-59, offset correction at 70-71). It also honours travel
    schedules through `getAdjustedTimezone` (16-29).
  - `processDateOverride` (`date-ranges.ts:175`) turns one override row into a range on that date, in the
    schedule's time zone (186-215).
  - Overrides replace that day's working hours. A zero-length override blocks the whole day (comments at 316-330).
    Out-of-office dates are handled by `processOOO` (218).
- **Set algebra.** `intersect` (`date-ranges.ts:354`) is used across hosts. `subtract` (`date-ranges.ts:423`)
  removes busy times. `mergeOverlappingRanges` is at 454.
- **Final result.** `dateRangesInWhichUserIsAvailable = subtract(dateRanges, formattedBusyTimes)`
  (`getUserAvailability.ts:648`).

## 3. Slot generation

### 3.1 Pipeline
1. `AvailableSlotsService._getAvailableSlots` (`packages/trpc/server/routers/viewer/slots/util.ts:897`) loads the
   event type and per-host availability (`calculateHostsAndAvailabilities` 678; event time zone fallback at 774).
   Results are cached through `withSlotsCache` (891).
2. The request start is clamped by `getStartTime` (672-677): `max(now + minimumBookingNotice, requested start)`,
   converted to the booker's time zone.
3. `getAggregatedAvailability` (1025) merges hosts.
4. `getSlots({ eventLength: input.duration || eventType.length, minimumBookingNotice, frequency:
   eventType.slotInterval || input.duration || eventType.length, … })` (1091-1097) cuts ranges into slots.
5. Reserved slots held by other bookers are removed (`_getReservedSlotsAndCleanupExpired` 146-170, applied at
   1166-1221). The period window (rolling/range) is enforced with `isTimeOutOfBounds` (1343-1345).

### 3.2 Slot cutter (`packages/features/schedules/lib/slots.ts`)
- `getSlots` (232) delegates to `buildSlotsWithDateRanges` (71).
- `frequency` and `eventLength` are clamped to at least 1 (93-95).
- **Minimum notice:** `startTimeWithMinNotice = dayjs.utc().add(minimumBookingNotice, "minute")` (123). A range
  start before it is moved up to it (128-130).
- **Time zones and odd offsets:** the start is converted to the target zone *before* alignment, so that +05:30 zones
  align on local minutes (comments and code at 135-148). `getCorrectedSlotStartTime` (27) snaps to the interval.
- **Fit check:** `while (!slotStartTime.add(eventLength,"minutes").subtract(1,"second").utc().isAfter(range.end))`
  (178). A slot is emitted only when the whole event fits inside the range. Successive slots step by `frequency +
  offsetStart` (181, 225).
- **Out of office:** each slot's local date is looked up in `datesOutOfOffice` (188-192).

### 3.3 Buffers and busy-time subtraction (`packages/features/busyTimes/services/getBusyTimes.ts`)
- Existing cal bookings are queried with `status: ACCEPTED` (81). The query window is widened by the largest
  defined buffer (108-112).
- Each booking blocks `[start - (its beforeEventBuffer + this event's afterEventBuffer), end + (its afterEventBuffer
  + this event's beforeEventBuffer)]` (135-136). Seated events stay bookable until full (138-150).
- External calendar busy times come from `getBusyCalendarTimes` (197) and are padded by this event's buffers
  (266-267). Video-provider busy times are merged at 274.

### 3.4 REA runtime evidence: production slot API
REA captured cal.com's public demo booking page, `https://cal.com/rick/get-rick-rolled`, in two browser time zones.
Only the page load and a "next month" click were driven. No slot was clicked, so nothing was reserved or booked.

```
$ cd /workspace/calcom-study/rea-tool
$ npx rea capture-browser-scenario ../rea-evidence/scenario-America-Toronto.json --format json \
    > ../rea-evidence/runtime-slots-America-Toronto.json         # evidence ev_cd154495f98fc469…
$ npx rea capture-browser-scenario ../rea-evidence/scenario-Asia-Kolkata.json --format json \
    > ../rea-evidence/runtime-slots-Asia-Kolkata.json            # evidence ev_13a64e3c8b523ef8…
```
Scenario: launch `/usr/bin/google-chrome`, set `environment.timezone` to `America/Toronto` or `Asia/Kolkata`, wait
15 s, click `data-testid=incrementMonth`, wait 6 s, capture network with bodies. The first run hit the default 16 MiB
event budget and dropped 49 events, so the limits were raised; the second run retained 450 events and dropped 0.

What REA recorded (fetch/XHR, step index):
```
1 GET https://cal.com/api/trpc/slots/getAvailabilityRanges?input={"json":{"isTeamEvent":false,
      "usernameList":["rick"],"eventTypeSlug":"get-rick-rolled","duration":null,"rescheduleUid":null,…,
      "startTime":"2026-09-30T00:00:00.000Z","endTime":"2026-12-02T00:00:00.000Z"}}
2 GET …/slots/getAvailabilityRanges?…"startTime":"2026-10-31T00:00:00.000Z","endTime":"2026-12-02T00:00:00.000Z"
```
Decoded response (`rea-evidence/ranges-America-Toronto-step1.json`, 7534 bytes, sha256 `95fce7a3a546884a…`):
```
{"starts":[29872250,10,10,…] (2372 entries), "heldStarts":[], "seats":[],
 "event":{"periodType":"UNLIMITED","length":10,"timeZone":"GMT","minimumBookingNotice":120,…},
 "outOfOffice":{"dates":{},"timeZone":"GMT"}}
```
What the capture shows:
- **The wire format is UTC, independent of time zone.** Both browser zones requested the same UTC window
  (2026-09-30 to 2026-12-02) and got the same first value. The Kolkata response (captured about 40 s later) had
  2371 starts, one fewer. Local rendering happens in the client.
- **The encoding is compact.** `starts[0]` is minutes since the Unix epoch (29872250 = 2026-10-18 14:50 UTC). Each
  later entry is a delta in minutes. Deltas: 10 ×2319 (slot step = length), 910 ×40 (the overnight gap), and a few
  of 20/30/40 (busy gaps).
- **Minimum notice was applied.** The capture ran at about 12:46 UTC (07:46 CDT). With 120 min notice that gives
  14:46, and the first slot is 14:50, the next 10-minute boundary.
- **The schedule is anchored to the host's zone.** The host zone is GMT, and every day runs 08:30-17:20 UTC (last
  start). Seen from Toronto, the window moves an hour across the 1 Nov 2026 DST change: 04:30 EDT on 31 Oct, then
  03:30 EST on 2 Nov (1 Nov starts at 03:50 EST because a busy gap removed earlier slots). Casevoya's slot library
  must reproduce this.
- **Held slots ship with the slot data.** Reservations travel in `heldStarts`, which matches `SelectedSlots` in
  source.

## 4. Booking create, reschedule, cancel

### 4.1 Create (`packages/features/bookings/lib/service/RegularBookingService.ts`)
- The entry point is `handler` (486). The public API is at `createBooking`/`rescheduleBooking` (2653/2663).
  `Booking.idempotencyKey` is unique (schema 855).
- `getPaymentAppData` (663) reads the price and currency from the event type's app metadata.
- `getRequiresConfirmationFlags` (668) decides confirmation. Its rule is `determineIsConfirmedByDefault =
  (!requiresConfirmation && price === 0) || userReschedulingIsOwner`
  (`handleNewBooking/getRequiresConfirmationFlags.ts:87-92`). **Any price makes the booking PENDING.**
- Availability is re-checked server-side with `ensureAvailableUsers` (902-962). Booking and duration limits are
  checked at 817.
- The row is written with `status = isConfirmedByDefault ? ACCEPTED : PENDING`
  (`handleNewBooking/createBooking.ts:192`).
- When the booking is confirmed by default, `eventManager.create(evt)` runs (2052). It creates the video meeting and
  calendar events, and the references are saved (2455). Emails are sent with `BookingActionMap.confirmed`
  (2154-2167).
- When confirmation is needed and there is no price, "requested" emails go out (2189-2201).
- When the booking needs payment (`bookingRequiresPayment` 2183-2187), the code loads the organizer's payment
  credential, calls `handlePayment` (2255-2291) and fires `BOOKING_PAYMENT_INITIATED`.

### 4.2 Reschedule
- `eventManager.reschedule(...)` is called at `RegularBookingService.ts:1909`. Rescheduled emails go out at
  2030-2046.
- In `EventManager.reschedule` (`packages/features/bookings/lib/EventManager.ts:615`):
  - If the organizer changed, old events and meetings are deleted and new ones created (700-716).
  - Otherwise, if the location changed or a Cal Video room expired (675-683), `updateLocation` recreates them.
  - Otherwise the dedicated video meeting is **updated in place**: `updateVideoEvent` (729-738, defined at 1240),
    then the calendar events (744-747).
  - Payment rows are re-pointed to the new booking id (756-770).
  - A paid original is not charged again (`!originalRescheduledBooking?.paid`, `RegularBookingService.ts:2186`).

### 4.3 Cancel (`packages/features/bookings/lib/handleCancelBooking.ts`)
- `handler` (81) respects `disableCancelling` (146) and sets `status: CANCELLED` (375/399).
- It then runs `processPaymentRefund` (411) and `processNoShowFeeOnCancellation` (419).
- `eventManager.cancelEvent(evt, references)` (472) runs `deleteEventsAndMeetings` (`EventManager.ts:792`). Every
  `_video` reference goes to `deleteVideoEventForBookingReference` (819, 537-546). Results are collected with
  `Promise.allSettled`, so cleanup errors are soft (836-850).
- `sendCancelledEmailsAndSMS` follows (509).

## 5. Confirmation emails and reminders
- `packages/emails/email-manager.ts` provides `sendScheduledEmailsAndSMS` (79/130), `sendRescheduledEmailsAndSMS`
  (283/324), `sendCancelledEmailsAndSMS` (501), `sendAwaitingPaymentEmailAndSMS` (582),
  `sendOrganizerRequestReminderEmail` (562) and `sendLocationChangeEmailsAndSMS` (631). Templates live in
  `packages/emails/templates/*` (attendee-scheduled, attendee-rescheduled, attendee-cancelled,
  attendee-awaiting-payment, no-show-fee-charged, organizer-payment-refund-failed …).
- An ICS file is generated by `packages/emails/lib/generateIcsString.ts`. Its location is the video URL when one
  exists (61).
- **Reminders in this edition are thin.**
  - `apps/web/app/api/cron/bookingReminder/route.ts` reminds *organizers* about `PENDING` bookings at 48 h, 24 h and
    3 h (23-31) and records each send in `reminderMail` (83-150). The cron is protected by `CRON_API_KEY` (19).
  - Attendee reminder workflows (ee) are absent. The workflow cron files exist only under `.github/workflows`.
- **Awaiting payment:** `PaymentService.afterPayment` schedules a `sendAwaitingPaymentEmail` task 15 minutes out
  (`packages/app-store/stripepayment/lib/PaymentService.ts:377-405`; delay from `AWAITING_PAYMENT_EMAIL_DELAY_MINUTES`).
  The task skips if the booking is already paid (`packages/features/tasker/tasks/sendAwaitingPaymentEmail.ts:38-42`).
  On success the task is cancelled (`packages/app-store/_utils/payments/handlePaymentSuccess.ts:43`).

## 6. Google and Outlook busy-time sync
- The dispatcher is `getBusyCalendarTimes` (`packages/features/calendars/lib/CalendarManager.ts:296`). Credentials
  are filtered to the user's `SelectedCalendar` rows (248-290). Adapters come from `getCalendar(credential, "slots")`
  (90).
- **Google:** `GoogleCalendarService.fetchAvailability` calls `calendar.freebusy.query({requestBody})` with
  `{timeMin, timeMax, items:[{id}]}` (`packages/app-store/googlecalendar/lib/CalendarService.ts:30, 494-504`).
  `getFreeBusyData` flattens it (520-535) and `getAvailabilityWithTimeZones` drives it (541-585).
  - Event write: `createEvent` 180 and `updateEvent` 365. Google Meet is attached through `conferenceData` (229-230,
    `conferenceDataVersion: 1` at 287) and the `hangoutLink` is returned (299-328).
- **Outlook (Microsoft Graph):** `getAvailability` calls `fetchBusyTimes(params, "showAs,start,end")`
  (`packages/app-store/office365calendar/lib/CalendarService.ts:369-370`). That reads
  `/calendars/{id}/calendarView` with paging up to 999 (390-412), batched through `/$batch` (675). Events with
  `showAs` of `free` or `workingElsewhere` are ignored (712).
  - Event write: `createEvent` 291, `updateEvent` 322, `deleteEvent` 355. Teams meetings set
    `isOnlineMeeting` (486-561).
- A webhook-driven cache exists in `packages/features/calendar-subscription/` (adapters and lib). It was not
  studied in depth.

## 7. Zoom (cal.com's Zoom app; source map, runtime request shapes in §10.4)
Zoom's own client and binaries were **not** examined (Zoom's terms forbid reverse engineering). Everything below is
cal.com's integration code.

### 7.1 OAuth app
- App metadata: slug `zoom`, type `zoom_video`, `isOAuth: true`. It registers the location type
  `integrations:zoom` (`packages/app-store/zoomvideo/_metadata.ts:3-28`, location block 19-26).
- Keys are an app-level `client_id` and `client_secret` held in the `App.keys` row
  (`packages/app-store/zoomvideo/lib/getZoomAppKeys.ts:5-13`).
- Install: `api/add.ts:23-34` builds `https://zoom.us/oauth/authorize?response_type=code&client_id&redirect_uri=
  {WEBAPP_URL_FOR_OAUTH}/api/integrations/zoomvideo/callback&state` (state from `encodeOAuthState`).
- Callback (`api/callback.ts`):
  - Exchanges the code with `POST https://zoom.us/oauth/token?grant_type=authorization_code…` using Basic auth of
    the client id and secret (17-27).
  - Converts `expires_in` to `expiry_date` (49-50).
  - **Deletes any earlier `zoom_video` credential for the user** (61-76) and stores the token JSON through
    `createOAuthAppCredential` (78; `packages/app-store/_utils/oauth/createOAuthAppCredential.ts:18-47`).
  - Redirects to a safe `returnTo` (80-82).
- Token refresh goes through the shared `OAuthManager` (`packages/app-store/_utils/oauth/OAuthManager.ts:74`).
  - It refreshes 5 s before expiry (111) using `POST https://zoom.us/oauth/token` with `grant_type=refresh_token`
    (`zoomvideo/lib/VideoApiAdapter.ts:391-409`).
  - On failure it invalidates the credential or marks the token expired (410-475).

### 7.2 Meeting created on booking
- Booking → `EventManager.create` (`EventManager.ts:287`).
  - `processLocation` (96) turns `integrations:zoom` into a dedicated integration (`isDedicatedIntegration` 43-44).
  - `createVideoEvent` (343, defined 1079-1088) picks the video credential for that location.
  - `videoClient.createMeeting` (`packages/features/conferencing/lib/videoClient.ts:29-103`) checks the app is
    enabled (68-80) and calls the adapter (82).
  - **If that fails, it emails the organizer (`sendBrokenIntegrationEmail`) and falls back to Cal Video** (86-101).
- Zoom adapter `createMeeting` (`zoomvideo/lib/VideoApiAdapter.ts:509-537`):
  - Calls `POST https://api.zoom.us/v2/users/me/meetings` with the body from `translateEvent` (251-353): `topic`,
    `type: 2` (scheduled), `start_time` in organizer zone, `duration` in minutes, `timezone`, and an agenda
    truncated to 1900 characters.
  - Uses the Zoom user's settings from `GET users/me/settings` (238-249, 313-319) to set a compliant password,
    `waiting_room`, `join_before_host` and `auto_recording`.
  - Returns `{type:"zoom_video", id, password, url: join_url}`.
- That result becomes `evt.videoCallData` (`EventManager.ts:346`) and a `BookingReference` with `meetingId`,
  `meetingPassword` and `meetingUrl` (395-409). The booking's `metadata.videoCallUrl` is set from it
  (`RegularBookingService.ts:2062`; `handleNewBooking/getVideoCallDetails.ts:24-31`).

### 7.3 Updated on reschedule
- `EventManager.reschedule` → `updateVideoEvent` (`EventManager.ts:729`, 1240-1250) → `videoClient.updateMeeting`
  (`videoClient.ts:105-145`). On failure it sends the broken-integration email and keeps going (115-121).
- Zoom adapter `updateMeeting` (`VideoApiAdapter.ts:549-575`) sends `PATCH meetings/{uid}` with a new
  `translateEvent`, then `GET meetings/{uid}` to read back `join_url` and `password`.
- If the organizer changed, the meeting is deleted and recreated instead (`EventManager.ts:700-716`).

### 7.4 Deleted on cancel
`handleCancelBooking.ts:472` → `EventManager.deleteEventsAndMeetings` (792; `_video` branch 819) →
`deleteVideoEventForBookingReference` (537-546) → `videoClient.deleteMeeting` (`videoClient.ts:147-165`) → Zoom
`DELETE meetings/{uid}` (`VideoApiAdapter.ts:539-548`). Failures are logged and not raised (`EventManager.ts:836-850`).

### 7.5 How the join link reaches confirmations
- `getVideoCallUrlFromCalEvent` (`packages/lib/CalEventParser.ts:627-646`) prefers `videoCallData.url`. It then
  falls back to the Google `hangoutLink`, then a `location` that starts with `http`. The password comes from
  `getVideoCallPassword` (648-650).
- In emails, `LocationInfo` (`packages/emails/src/components/LocationInfo.tsx:9-50`) renders the link. It is
  included in every scheduled template through `BaseScheduledEmail` (`packages/emails/src/templates/BaseScheduledEmail.tsx:126`).
  The ICS location uses the same URL (`generateIcsString.ts:61`).
- On the booking page, `bookings-single-view.tsx` reads `metadata.videoCallUrl` (157) and shows it through
  `getSuccessPageLocationMessage` (364-365, 682-702).
- For contrast, Cal Video (Daily) is cal.com's in-house video
  (`packages/app-store/dailyvideo/lib/VideoApiAdapter.ts`):
  - Each room expires 14 days after the event end (270).
  - Rooms have a pre-join UI, knocking (lobby) and screen share enabled (287-296).
  - It mints per-user meeting tokens with `exp` and `is_owner` (144-221, 250-255).
  - This is the model Casevoya follows with the Zoom Video SDK.

### 7.6 REA static evidence (Zoom and Daily apps)
```
$ npx rea analyze-javascript-application /workspace/calcom-src/packages/app-store/zoomvideo \
    --artifact-format directory --format json > ../rea-evidence/static-zoomvideo.json
  evidence ev_d452361b47d2af1ed803bcee044c79940f7000add9f813e1e64816c7dfb70c60
  statistics: relevant_files 11, parsed 10, visited_ast_nodes 3226, findings 111, parse_failures 0
  ENDPOINT "https://zoom.us/oauth/token"                                   mechanism call:fetch (VideoApiAdapter refresh)
  ENDPOINT "`https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${redirectUri}`"
                                                                           mechanism call:fetch, resolution partial (api/callback.ts)
  imports  api/add.ts -> ../../_utils/oauth/encodeOAuthState:encodeOAuthState, ../lib:getZoomAppKeys, @calcom/lib/constants:WEBAPP_URL_FOR_OAUTH
  imports  api/callback.ts -> ../../_utils/oauth/createOAuthAppCredential:default, ../../_utils/oauth/decodeOAuthState, @calcom/lib/getSafeRedirectUrl
  imports  lib/VideoApiAdapter.ts -> ../../_utils/oauth/OAuthManager:OAuthManager, ../../_utils/invalidateCredential, ../../_utils/oauth/markTokenAsExpired, ./getZoomAppKeys

$ npx rea trace-application-feature ../rea-evidence/trace-zoom-token.input.json --format json
  seed {kind:string, value:"https://zoom.us/oauth/token"}, direction both
  evidence ev_4478c70fc8b8bac399272…  summary: matched_seeds 2, traced_nodes 124, traced_edges 129,
  observed_facts 64, inferred_facts 198; coverage partial
  reached: api/index.ts:add, api/index.ts:callback, lib/getZoomAppKeys.ts, ../../_utils/oauth/createOAuthAppCredential,
           _metadata.ts:metadata, @calcom/prisma

$ npx rea analyze-javascript-application …/app-store/dailyvideo …   evidence ev_8b8d40ac3186dc59…
  ENDPOINT "`https://api.daily.co/v1${endpoint}`" call:fetch
$ npx rea trace-application-feature ../rea-evidence/trace-daily.input.json   (seed "api.daily.co")
  evidence ev_ea1f8be99d57a12a…  matched 1, traced_nodes 89, terminal_paths 2 (end_kind endpoint),
  reached lib/dailyApiFetcher.ts, lib/types.ts:dailyReturnTypeSchema, VideoApiAdapter.ts:setEnableRecordingUIAndUserIdForOrganizer
```
Literal seeds that are not graph entities return `no-match`. Tried: `zoom_video` (ev_e07f8cd4…), `_video` on the
booking core (ev_2292a9e4…) and `HOLD` on Stripe (ev_884e13e3…). REA labels this "not evidence that the feature is
absent", so those flows were confirmed by reading source (sections 4 and 7).

## 8. Paid event types (Stripe app)
- **Price on the event type:** `metadata.apps.stripe = { price, currency, paymentOption, refundPolicy,
  refundDaysCount, refundCountCalendarDays, autoChargeNoShowFee… }`
  (`packages/app-store/stripepayment/zod.ts:6-25`; `RefundPolicy = never|always|days` in
  `packages/lib/payment/types.ts:1-5`). The old columns are deprecated (schema 235-238).
- **Connection:** the firm connects its own Stripe account through Connect OAuth (`api/add.ts`, `api/callback.ts`).
  The credential stores `stripe_user_id` (`lib/PaymentService.ts:27`), and all calls carry
  `{ stripeAccount: stripe_user_id }`. These are direct charges on the connected account (108-110, 180-181, 283-284,
  351-355).
- **Payment before confirmation:**
  - A price makes the booking `PENDING` (4.1). `handlePayment` (`packages/features/bookings/lib/handlePayment.ts:55-74`)
    loads the payment service.
  - `ON_BOOKING` uses `create`. It makes a **PaymentIntent** with `automatic_payment_methods.enabled`, a customer
    found or created by email, and metadata containing bookingId and bookerEmail (`PaymentService.ts:61-107`).
    It stores `Payment{success:false, refunded:false, data:{…clientSecret, stripeAccount}}` (112-135).
  - `HOLD` uses `collectCard`: a **SetupIntent** to save the card (`handlePayment.ts:170-186`,
    `PaymentService.ts:148-210`).
  - The client pays at `/payment/[uid]` (`apps/web/app/(use-page-wrapper)/payment/[uid]/PaymentPage.tsx`, which takes
    `clientSecret` at 23). The Stripe component was removed from this edition; only PayPal, Alby, HitPay and BTCPay
    remain (30-56).
- **Confirmed by webhook:** `handlePaymentSuccess` (`packages/app-store/_utils/payments/handlePaymentSuccess.ts:29-216`):
  - Cancels the awaiting-payment email task (43).
  - Sets `paid:true, status:ACCEPTED` (54-57). Only then does it run `EventManager.create`, so the video meeting
    and calendar events appear after payment (64-80).
  - Keeps the status `PENDING` if the event also needs manual confirmation (82-91).
  - Marks `Payment.success` (92-100) and sends the scheduled emails (211).
  - In this edition the Stripe route that would call it is a 404 stub (section 0).
- **Pending booking:** it does not block the slot (section 0.3). An awaiting-payment email goes out after 15 min
  (section 5). No automatic expiry of unpaid `PENDING` bookings was found; the only `PENDING` sweep is the organizer
  reminder cron.
- **Refund on cancel:** `processPaymentRefund` (`packages/features/bookings/lib/payment/processPaymentRefund.ts:9-104`):
  - Refunds every successful, unrefunded payment (29-33).
  - Returns early if the policy is `NEVER` (42).
  - For `DAYS`, the deadline is `startTime - N` calendar or business days (73-85).
  - Then calls `PaymentService.refund`, which runs `stripe.refunds.create` on the connected account and sets
    `refunded:true` (`PaymentService.ts:336-375`).
- **No-show fees:** with `HOLD`, a staff action runs `handleNoShowFee` → `chargeCard`, an off-session PaymentIntent
  with `confirm:true` (`handleNoShowFee.ts:157`; `PaymentService.ts:227-300`). Late-cancellation auto-charge is
  controlled by `autoChargeNoShowFeeIfCancelled` plus a time value and unit
  (`payment/shouldChargeNoShowCancellationFee.ts:21-59`) and applied in `processNoShowFeeOnCancellation.ts`.
  Email: `no-show-fee-charged-email.ts`.
- REA static: `static-stripepayment.json` (evidence `ev_5fd6228b00de2294…`, 41 relevant files, 13006 AST nodes, 0
  parse failures). The graph shows:
  - `lib/server.ts -> stripe:default`
  - `lib/client/getStripe.ts -> @stripe/stripe-js/pure:loadStripe`
  - `lib/PaymentService.ts -> ./customer:retrieveOrCreateStripeCustomerByEmail, @calcom/features/tasker`
  - `zod.ts -> @calcom/lib/payment/types:RefundPolicy`

  This confirms the server/client split and the tasker dependency.

## 9. REA: what ran, what did not
| Tool | Target | Result |
|---|---|---|
| `analyze-javascript-application` | zoomvideo, stripepayment, dailyvideo, features/bookings/lib (154 files, ev_73be3d77…), features/conferencing (ev_beb44e68…), features/schedules/lib (ev_4c494da1…) | OK, 0 parse failures |
| `trace-application-feature` | Zoom token endpoint, Daily API endpoint | OK (partial coverage, as documented) |
| `capture-browser-scenario` | production cal.com public booking page, 2 time zones | OK; slot API, inputs and responses captured |
| Native engines (Hopper, Ghidra, IDA, JEB, Frida) | none installed; not needed (TypeScript source, no binaries) | not used. Zoom binaries were deliberately not analysed. |

Not exercised at runtime:
- Booking create, reschedule and cancel; Zoom meeting create, update and delete; Stripe payment.
- Doing these needs either a local Cal.diy (Postgres, `yarn install` of the monorepo, seeded Zoom and Stripe app
  keys and accounts) or real bookings on someone's public cal.com page, which would send emails and reserve their
  time.
- The CE Stripe webhook is also a stub, so the paid path cannot run end to end in this edition.
- These flows are covered by source citations only.

Evidence files: `/workspace/calcom-study/rea-evidence/` (static-*.json, trace-*.json, runtime-slots-*.json,
ranges-*.json, scenario-*.json). REA 6.7.0 from npm, run under Node 24.11.1 at `/tmp/node24/bin`.
Update 18 Oct 2026, 09:10 CDT: a local Cal.diy has since been run under REA. See §10 (runtime evidence for every
flow) and §11 (Cal Video and every Daily touch point). The "not exercised" list above is superseded by §10.8.

## 10. Runtime evidence (REA) on a local Cal.diy
Evidence root: `/workspace/calcom-study/rea-evidence/runtime/` (one folder per flow: `commands.txt` lists every REA
command; `summary.md`, `screenshots/*.png`, `api/*.body`, `db-writes.log`, `emails/*.eml`, `rea-*.json`).
Harness scripts: `/workspace/calcom-study/runtime-tools/`.

### 10.1 Harness
- Cal.diy from `/workspace/calcom-src` (`next dev --turbopack -p 3000`, `run-calcom-dev.sh`), Node 24.11.1, native
  PostgreSQL 16 (`calendso` db, `log_statement=mod` → DB writes per flow), Mailpit (SMTP 127.0.0.1:1025, API :8025).
  Seed: `yarn db-seed` (user `pro`, id 4) plus `00-seed-fake-credentials*.sql.log` (fake Stripe credential
  `acct_REA_FAKE`, paid event type 6 at 5000 CAD cents, `refundPolicy:"always"`; Zoom credential with fake tokens;
  `pro` made a member of seeded team 1 so Cal Video's team-plan branch runs).
- **Every third party is faked locally; nothing was booked anywhere real.** Node 24 `NODE_USE_ENV_PROXY=1` sends
  server `fetch` through `mitmdump` on :8080 with `fake_upstreams.py` (`connection_strategy=lazy`,
  `upstream_cert=false`, fail-closed 599 for unknown hosts). It answers Daily (stateful rooms/tokens/recordings),
  Zoom and Stripe with fakes. The Stripe SDK ignores proxies, so a `--require dns-pin-stripe.cjs` preload points
  `*.stripe.com` at 127.0.0.1 where a reverse mitm serves the same fakes. Chrome runs through `chrome-proxied.sh`.
- REA tools used per flow (`flow.sh`): `capture-browser-scenario` (Playwright, network bodies and screenshots),
  `observe-javascript-runtime` on the `next-server` V8 inspector (passive), `inspect-web-network-capture … mitmproxy`
  (decodes server egress), plus `analyze-javascript-application` and `trace-application-feature` (flow 16).
  `list-javascript-runtime-targets` output: `01-runtime-targets-*.json`.

### 10.2 Free booking (01-book-free; REA ev_57d76b21 browser, ev_151b05e7 runtime, ev_e52418a6 egress)
1. `GET /api/trpc/slots/getSchedule?input={json:{isTeamEvent,usernameList:["pro"],eventTypeSlug,startTime,endTime,timeZone,…}}` → `{slots:{"YYYY-MM-DD":[{time}]}}`.
2. Click slot → `POST /api/trpc/slots/reserveSlot {slotUtcStartDate, slotUtcEndDate, eventTypeId}` → `{uid}`. DB:
   `DELETE SelectedSlots` (expired) → `INSERT SelectedSlots` (`releaseAt` +5 min).
3. Submit → `POST /api/book/event {responses:{name,email,guests,location?}, user, start, end, eventTypeId,
   eventTypeSlug, timeZone, language, metadata, …}` → Booking JSON (`uid, status:"ACCEPTED", references, …`).
   DB: `INSERT Booking` → `INSERT Attendee` → `UPDATE users` → `UPDATE Booking` (location, `metadata.videoCallUrl`)
   → `INSERT BookingReference`. Server egress: Daily `POST /v1/rooms`, `POST /v1/meeting-tokens` (default Cal Video
   location).
4. Mail: 2 messages (booker, organizer), `.ics` `METHOD:REQUEST`, `UID:<booking uid>@Cal.diy`,
   `LOCATION:http://localhost:3000/video/<uid>`. Screenshot: `01-book-free/screenshots/07-after-submit.png`.

### 10.3 Reschedule and cancel (02, 03; ev_619aa9b0/ev_147e0764, ev_d3288aae/ev_0c6d921e)
- Reschedule creates a **new** Booking (`fromReschedule`), marks the old one `rescheduled=true,status=cancelled`,
  keeps `iCalUID` with `iCalSequence=1`. Daily: `POST /v1/rooms/<name>` (update) + new token.
  **Finding:** the reschedule `.ics` carries the new booking uid with no `@Cal.diy` suffix, not the original UID,
  so calendar clients may show two events.
- Cancel: `POST /api/cancel {uid, cancellationReason, allRemainingBookings, internalNote, csrfToken}` →
  `{success, message, onlyRemovedAttendee, bookingId, bookingUid, isPlatformManagedUserBooking}`. DB:
  `UPDATE Booking`, `UPDATE BookingReference` (soft delete), `DELETE WebhookScheduledTriggers`, `DELETE Task`.
  Daily: `DELETE /v1/rooms/<name>`. `.ics` `METHOD:CANCEL`, original `@Cal.diy` UID, `SEQUENCE:2`,
  `LOCATION:integrations:daily`. Attendee subject has the title duplicated.

### 10.4 Zoom adapter path, fake credentials (04-06; egress ev_b390cd19, ev_982d2e95, ev_fd080ef3)
- Book: `POST zoom.us/oauth/token` (refresh_token grant) **twice concurrently with the same refresh token** (race;
  two `UPDATE Credential`), `GET /v2/users/me/settings`, `POST /v2/users/me/meetings {topic, type:2, start_time
  (local), duration, timezone, password, settings{…, waiting_room}}`. `join_url` lands in `BookingReference`,
  `metadata.videoCallUrl` and `.ics LOCATION`.
- Reschedule: settings GET, `PATCH /v2/meetings/<id>`, `GET /v2/meetings/<id>`. Cancel: `DELETE /v2/meetings/<id>`.
- No Zoom binary or client was touched; the Zoom API was a local fake.

### 10.5 Paid booking, Stripe stubbed (07-book-paid-clean; ev_7f70ab57 browser, ev_e9700aed runtime, ev_da3a864e Stripe egress; 07-book-paid/RECOVERED-NOTES.md; 08; 09)
- Same getSchedule/reserveSlot, then `POST /api/book/event`. DB: `INSERT SelectedSlots` → `INSERT Booking`
  (`status=PENDING`, `paid=false`) → `INSERT Attendee` → `UPDATE users` → `INSERT Payment` (amount 5000, cad,
  `externalId pi_REA_FAKE_…`, `success=false`) → `INSERT Task` (`sendAwaitingPaymentEmail`, +15 min).
- Stripe egress (all three with `Stripe-Account: acct_REA_FAKE`, Stripe-Version 2020-08-27, **no Idempotency-Key**,
  no upstream TCP connection): `GET /v1/customers?email=…&limit=1`, `POST /v1/customers email=…`,
  `POST /v1/payment_intents amount=5000&currency=cad&customer=…&automatic_payment_methods[enabled]=true&metadata[bookingId|calAccountId|bookerName|bookerEmail|eventTitle|…]`
  (`stripe-egress-summary.txt`). No email is sent at booking time.
- Browser redirects to `/payment/<paymentUid>?date=…&name=…&email=…`. Cal.diy has no Stripe Elements component;
  in the first run the page crashed client-side (`RangeError: Invalid time value` in the payment page effect).
  Screenshot: `07-book-paid-clean/screenshots/07-after-submit.png`.
- **PENDING does not block:** the pending 08:00 slot was still offered by getSchedule (RECOVERED-NOTES).
- **Orphan + false success:** when PaymentIntent creation failed (an attempt where the Stripe SDK reached the real
  API with the fake key, `00-attempt-paid-stripe-sdk-bypassed-proxy`), the Booking stayed PENDING and the client got
  409 `payment_not_created_error`; retrying the same email and slot returned the existing unpaid booking as "This
  meeting is scheduled" (`RegularBookingService.ts:684-701`, `isPaidBooking = existingBooking.paid || !hasPayments`
  at :694).
- Webhook (08): `POST /api/integrations/stripepayment/webhook` → `404 {"message":"Payment webhooks are not available
  in community edition"}` (`08-stripe-webhook-stub/webhook-probe.http`), so a booking can never become paid here.
- Cancel unpaid (09; ev_797c1eb2, Stripe egress ev_32744037): `POST /api/cancel` → 200; DB `UPDATE Booking`,
  `UPDATE BookingReference`, `DELETE WebhookScheduledTriggers`, `DELETE Task`. **No Stripe call:** the
  PaymentIntent is left open and `Payment` stays `success=false, refunded=false`
  (`handleCancelBooking.ts:409-416` → `processPaymentRefund.ts:31-33` returns when nothing succeeded). Refunds of a
  succeeded payment could not run because nothing can mark a payment succeeded in CE.

### 10.6 Cal Video flows (10-15): see §11.2-§11.4.

### 10.7 Runtime findings that change the Casevoya spec
| Finding | Evidence | BUILD-SPEC answer |
|---|---|---|
| PENDING paid bookings don't block slots | 07 RECOVERED-NOTES | exclusion constraint incl. `pending_payment` (§1) |
| Booking row survives a failed PaymentIntent; retry reports success | 00-attempt-paid-…, RegularBookingService.ts:694 | hold + PI in one flow, cron expiry, confirm by webhook only (§8) |
| No Idempotency-Key on Stripe writes | ev_da3a864e | `Idempotency-Key: {payment.id}` (§8.2) |
| Unpaid cancel leaves the PaymentIntent open | 09 | expiry/cancel calls `payment_intents/{id}/cancel` (§8.2) |
| ICS UID changes on reschedule | 02 emails | UID `{public_ref}@casevoya`, SEQUENCE bump (§6) |
| Video provider failure still confirms the booking and sends an "[Action Required]" mail | 00-attempt-calvideo-… | room created lazily at join, never blocks confirmation (§7.1) |
| Concurrent OAuth refresh with one refresh token | 04 egress | single-flight refresh (§7.8) |
| `/video/[uid]` gives anyone with the uid a guest token plus host/attendee emails; Daily rooms are `public` | 11 | token only after portal/OTP auth, no PII (§7.3) |
| Recording-link HMAC falls back to a hard-coded secret | 15 `recording-proxy-probe.http` | R2 presigned ≤10 min, no default secrets (§7.5) |
| Email sending is awaited inline and delayed DB writes ~2 min when SMTP hung | 00-attempt-smtp-ipv6-timeout | outbox, never inline (§0.6) |

### 10.8 What could not run, and disclosures
- Not run by design: real Daily, Zoom, Stripe, Google/Outlook calendar sync (no accounts; fakes only); Stripe Elements
  payment and webhook confirmation (absent/stubbed in CE); refund of a succeeded payment (unreachable in CE);
  transcription content (fake). Calendar busy-time sync remains source-only (§6).
- **Accidental contacts with real third parties (all with fake/invalid keys; nothing created, nothing booked):**
  1. Flow 01: mitmproxy's default eager mode opened TLS handshakes to `api.daily.co` although the requests themselves
     were answered by the fake (fixed with lazy/no-upstream-cert).
  2. One paid attempt: the Stripe SDK bypassed the proxy and its request with `sk_test_REA_FAKE_NOT_A_KEY` reached
     api.stripe.com, which answered 401 "Invalid API Key" (fixed with the DNS pin and reverse mitm).
  3. After the box reset, a bug in the restored addon (missing import) let two `POST /v1/rooms` calls with
     `REA_FAKE_DAILY_KEY` reach api.daily.co, which answered 401 (addon made fail-closed).
- The box rebooted at ~08:43 CDT, losing `/tmp`, Postgres and some evidence (first clean paid run's server files).
  Everything was rebuilt and the paid run re-captured in `07-book-paid-clean`; earlier notes are in
  `07-book-paid/RECOVERED-NOTES.md`. `/tmp/node24` is now a symlink to `runtime-tools/node24`.

## 11. Cal Video, and every point where it touches Daily
Cal Video is Cal.com's built-in video location (`integrations:daily`, app slug `daily-video`, reference type
`daily_video`, `packages/lib/constants.ts:270-272`). It is a thin layer over **Daily.co**, a paid proprietary service:
it needs `DAILY_API_KEY` (stored as `App.keys.api_key` for slug `daily-video`, `getDailyAppKeys.ts`), and recording
/transcription need `DAILY_SCALE_PLAN=true` plus a team plan. Daily pricing (daily.co/pricing/video-sdk, checked
18 Oct 2026): 10,000 free participant-min/month, then $0.004/participant-min (video), cloud recording
$0.01349/recorded min + $0.003/min storage, transcription billed separately, no hard spend cap. Only Cal.com's own
code and its requests were studied; Daily's service, SDK internals and Prebuilt UI were not reverse-engineered.

### 11.1 Swap points (each must be replaced to drop Daily)
| # | Touch point | Where (file:line) | Runtime evidence |
|---|---|---|---|
| 1 | REST client: `fetch("https://api.daily.co/v1"+endpoint)` with `Authorization: Bearer api_key` | `packages/app-store/dailyvideo/lib/dailyApiFetcher.ts:5-16` | all Daily egress below |
| 2 | Keys/config: `getDailyAppKeys()` (`api_key`, `scale_plan`), `FAKE_DAILY_CREDENTIAL`, region env | `dailyvideo/lib/getDailyAppKeys.ts`; `VideoApiAdapter.ts:85, 391-392`; `features/conferencing/lib/videoClient.ts:5,168-424` (10 wrappers) | — |
| 3 | Default location = Daily when keys exist | `app-store/_utils/getDefaultLocations.ts:22-36`; `features/bookings/lib/EventManager.ts:6-7,300-328,560,1063` | 01 booked Cal Video by default |
| 4 | Room create on booking: `POST /rooms` with `translateEvent` properties (`privacy:"public"`, prejoin, knocking, screenshare, chat, pip, `exp=end+14d`, cloud recording + transcription storage on scale/team plan) | `VideoApiAdapter.ts:240-265` (createOrUpdateMeeting), `:267-325` (translateEvent, exp :270, recording :285-323), `:399` | 10 (ev_b7e13a3b): exact body captured |
| 5 | Owner meeting token minted at create, stored in `BookingReference.meetingPassword` | `VideoApiAdapter.ts:240-265` | 10: `POST /meeting-tokens {room_name, exp, is_owner:true, enable_recording_ui:false}` |
| 6 | Room update on reschedule (and re-create if expired) | `VideoApiAdapter.ts:405`; `EventManager.ts:677-721` (`isDailyVideoRoomExpired`) | 13 (ev_f637089a): `POST /rooms/rea-room-e9ce13a9` + new owner token |
| 7 | Room delete on cancel | `VideoApiAdapter.ts:401`; `handleCancelBooking.ts:1-2,431` | 14 (ev_4c0b80ff): `DELETE /rooms/rea-room-e9ce13a9` |
| 8 | Token validation/refresh on page view | `VideoApiAdapter.ts:144-182` (updateMeetingTokenIfExpired); `apps/web/lib/video/[uid]/getServerSideProps.ts:205` | 11: `GET /meeting-tokens/<ownerToken>` |
| 9 | Guest token from owner token | `VideoApiAdapter.ts:184-204`; `getServerSideProps.ts:229-240`; `apps/web/app/api/video/guest-session/route.ts:7-9,82-87` | 11 (ev_258309c0): `POST /meeting-tokens {room_name, exp, enable_recording_ui:false}` for an anonymous visitor |
| 10 | Organizer token with `is_owner`, `user_id`, written back | `VideoApiAdapter.ts:206-237`; `getServerSideProps.ts:95-119,214,243-253` | 12 (ev_de2a1b73): `{…,is_owner:true,user_id:4}` + `UPDATE BookingReference.meetingPassword` |
| 11 | `/video/[uid]` page auth and props (`meetingUrl`, `meetingPassword`, emails) | `getServerSideProps.ts:125-309` (lookup :125, no-meeting :137, team plan :146, 14-day window :174-190, props :280-309) | 11: guest token + attendee/organizer emails in SSR props for anyone with the uid |
| 12 | Client SDK and Prebuilt iframe: `DailyIframe.createFrame({url, token, theme, customTrayButtons})`, join, `DailyProvider`, `useDailyEvent` | `apps/web/modules/videos/views/videos-single-view.tsx:21-23,69-115,141,168,538`; `apps/web/package.json:50-51` (`@daily-co/daily-js` 0.83.1, `@daily-co/daily-react` 0.23.2) | 11: iframe `https://rea-fake.daily.co/<room>?t=<guestToken>&…&dailyJsVersion=0.83.1`; screenshot `11-…/screenshots/01-let-frame-load.png` |
| 13 | In-call premium controls: `startRecording/stopRecording/startTranscription/updateCustomTrayButtons`, `useRecording`, `useTranscription`, Daily events | `apps/web/modules/videos/cal-video-premium-features.tsx` (events :192-205) | REA trace ev_536d82dc (102 nodes) |
| 14 | Webhooks `recording.ready-to-download`, `batch-processor.job-finished`, `meeting.ended`; HMAC `base64(HMAC-SHA256(base64dec(DAILY_WEBHOOK_SECRET), "{x-webhook-timestamp}.{body}"))` | `apps/web/app/api/recorded-daily-video/route.ts:40-46,61-76,85-247`; `apps/web/lib/daily-webhook/schema.ts` | 15 `webhook-calls.log`: ping 200, unsigned 403, bad sig 403, each event 200 |
| 15 | Recordings: `GET /recordings?room_name`, `GET /recordings/{id}`, `GET /recordings/{id}/access-link?valid_for_secs=43200` | `VideoApiAdapter.ts:408,419,500`; tRPC `viewer/calVideo/getCalVideoRecordings`, `getDownloadLinkOfCalVideoRecordings`, `getMeetingInformation.handler.ts:19-28` | 15 part2 (ev_e5d984c1) |
| 16 | Transcripts: `POST /batch-processor {preset:"transcript",inParams:{sourceType:"recordingId",recordingId},outParams:{s3Config:{s3KeyTemplate:"transcript"}}}`, `GET /batch-processor/{id}/access-link`, `GET /transcript?mtgSessionId`, `GET /transcript/{id}/access-link` | `VideoApiAdapter.ts:107-131,430,446,464,477` | 15 part1 (ev_5036a783) |
| 17 | Recording download proxy: token `recordingId:expiresMs:hmacHex`, secret `CAL_VIDEO_RECORDING_TOKEN_SECRET` falling back to `"default-secret-change-me"`, 6-month life, non-constant-time compare | `packages/lib/videoTokens.ts:4-38`; `apps/web/app/api/video/recording/route.ts:6-29`; `route.ts:48-52` (recorded-daily-video) | 15 `recording-proxy-probe.http`: forged token with the default secret → 302 |
| 18 | No-show detection: `GET /meetings?room=` | `features/tasker/tasks/triggerNoShow/getMeetingSessionsFromRoomName.ts:1`; `common.ts:192-205` | source only |
| 19 | Instant meetings room | `VideoApiAdapter.ts:326-391` | source only |
| 20 | Maintenance script deleting recordings older than 6 months | `dailyvideo/lib/scripts/deleteRecordings.ts:37,244` | source only |
| 21 | Misc: Cal Video reference lookup, event parser, rewrite `/apps/dailyvideo`, API v2 booking-video services | `features/get-cal-video-reference.ts`; `lib/CalEventParser.ts`; `apps/web/next.config.ts:645-646`; `apps/api/v2/.../booking-video.service.ts`, `booking-location-integration.service.ts` | source only |

REA static runs for this table (`16-daily-touchpoints-static/`): `analyze-javascript-application` on
`apps/web/modules/videos` (ev_6695cbe1), `apps/web/lib/video` (ev_60ca4121), `apps/web/app/api/recorded-daily-video`
(ev_15e95587), `apps/web/lib/daily-webhook` (ev_796086b9); `trace-application-feature` module seed `@daily-co`
(ev_536d82dc: 6 seeds, 102 nodes) and token functions (ev_30de6d20). The webhook trace (ev_35ba92e6) matched 0 seeds
(App Router route handlers are not entry points to REA's tracer), so row 14 relies on source plus runtime calls.
Earlier: `rea-evidence/static-app-store_dailyvideo.json`, `trace-daily.json`.

### 11.2 Lifecycle sequence (runtime, flows 10, 13, 14)
1. Book (team plan): `POST /v1/rooms` body
   `{"privacy":"public","properties":{"enable_prejoin_ui":true,"enable_knocking":true,"enable_screenshare":true,"enable_chat":true,"enable_pip_ui":true,"exp":1794308400,"enable_recording":"cloud","enable_transcription_storage":true,"permissions":{"canAdmin":["transcription"]}}}`
   → `{name, url}`; `POST /v1/meeting-tokens {room_name, exp, is_owner:true, enable_recording_ui:false}`. DB:
   `INSERT BookingReference (type daily_video, uid=name, meetingUrl, meetingPassword=owner token)`, `UPDATE
   Booking metadata.videoCallUrl = {WEBAPP}/video/{uid}`. Mail/ICS location is the Cal page `/video/{uid}`, not the Daily URL.
2. Reschedule: `POST /v1/rooms/{name}` with the same properties and new `exp`; new owner token; the new booking gets a
   `daily_video` reference for the same room name.
3. Cancel: `DELETE /v1/rooms/{name}`; `UPDATE BookingReference deleted`.

### 11.3 Join page and auth (flows 11, 12)
- Anonymous `GET /video/{uid}?name=…`: SSR validates the owner token (`GET /meeting-tokens/{token}`), mints a guest
  token and renders props including the guest token, the room URL, and the **attendee and organizer emails**. The
  owner token is not exposed. Anyone holding the booking uid (it is in every email) gets a valid guest token for a
  `privacy:"public"` room.
- Logged-in organizer: owner token with `user_id`, written back to `BookingReference.meetingPassword`.
- Client: Prebuilt iframe from `daily-js` with Cal's theme and custom tray buttons (recording, transcription).

### 11.4 Recording and transcription hooks (flow 15, webhooks signed locally with the test secret)
- `recording.ready-to-download` → `UPDATE Booking isRecorded=true`, `POST /v1/batch-processor` (transcript job), fetch
  recording + access link, emails "Download recording" to attendee and organizer containing
  `/api/video/recording?token=…`.
- `batch-processor.job-finished` → `GET /batch-processor/{id}/access-link`, emails "Download transcript".
- `meeting.ended` → transcript lookup by `mtgSessionId`.
- `/api/video/recording?token=` → 302 to Daily's access link. With `CAL_VIDEO_RECORDING_TOKEN_SECRET` unset, a token
  forged with `default-secret-change-me` was accepted (302); a tampered one got 401.

### 11.5 Replacement
BUILD-SPEC §7 keeps this flow and page structure on self-hosted LiveKit (Apache-2.0) and gives a row-by-row
Daily→LiveKit mapping (§7.7).
