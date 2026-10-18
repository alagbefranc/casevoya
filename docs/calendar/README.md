# Calendar, bookings, and video

Instructions for Claude, the next engineer on this module.

1. Build the calendar, bookings, paid consultations, and video module exactly per [BUILD-SPEC.md](./BUILD-SPEC.md). [REPORT.md](./REPORT.md) is the evidence: an REA analysis of cal.com (MIT-licensed Cal.diy, commit `6bfe2df9d13c456dc9374c9e6581b36fba188728`). MIT code may be reused if the copyright notice is kept in `THIRD_PARTY_NOTICES`.
2. Video is Cal Video's flow on LiveKit, not Daily or Zoom.
3. Payments use the custom Stripe from [PR #19](https://github.com/alagbefranc/casevoya/pull/19), test key only. The `booking_fee` webhook branch goes ahead of the generic one.
4. Fix the cal.com flaws listed in REPORT.md §10.7.
5. Open decisions in BUILD-SPEC §11 use the stated defaults unless Francis says otherwise.
6. Merge PR #19 first.
