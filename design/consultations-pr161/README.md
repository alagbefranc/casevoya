# Consultations + signing — design reference for PR #161

Static, openable copies of the Casevoya design pages that PR #161 should match. They are the design reference for the fix list in
https://github.com/alagbefranc/casevoya/pull/161#issuecomment-6372771689

**Design reference only.** Nothing here is imported by the app, and no app code was changed.

## How to open

No server or build needed. Open any page straight from this folder in a browser (double-click, or `file://…`):

| Page | File |
|---|---|
| Consultations (The Sheet) | `app-v2/sheet/consultations.html` |
| Consultation-agreement signing page (public) | `app-v2/esign/index.html` |
| Public booking page | `app-v2/public/book.html` |
| Agreements (The Sheet) | `app-v2/sheet/agreements.html` |

The folder keeps the original relative layout (`app-v2/`, `assets/`, `fonts/`) so every path resolves locally. Links to Sheet pages that aren't part of this reference (Clients, Inbox, etc.) and to marketing pages lead nowhere; that's expected.

## Pages, states and URL params

### `app-v2/sheet/consultations.html`
- `?tab=upcoming` (default): Upcoming list with Agreement and Booking fee columns, plus **Book for a client**, Reschedule and Cancel dialogs.
- `?tab=availability`: availability, buffer, capacity and timezone.
- `?tab=booking`: hosted booking page settings.
- `?tab=record`: Consultation record. The agreement card has three states, picked with `&ag=`:
  - `&ag=signed` (default): signed, with fee and proposal rows.
  - `&ag=sent`: **sent, not signed**. Shows the status chip, Sent and Opened rows, a note that the link is private, and **Copy signing link**, **Remind** and **Void**.
  - `&ag=voided`: **voided**. The agreement stays on record, struck through, with a Voided row and **Send again**.
  - Clicking **Void** opens the **Void this agreement?** dialog: the explanation, a **Reason (staff only)** box, and Keep it / Void agreement. Confirming switches to the voided state.
- The demo state switcher above the card (Signed / Sent, not signed / Voided) is only there to preview the states. It isn't product UI.

### `app-v2/esign/index.html`: signing flow, `?state=`
`landing` (email link) → `verify` (check it's you, email code) → `verify-error` (wrong code) → `review` → `sign` (draw / type / upload signature) → `confirm` → `done`.
Other end states: `declined`, `expired` (expired link), `signed` (already signed), `error`, `loading`.
That's 11 states plus `loading`. The switcher bar at the bottom is a demo aid only.

### `app-v2/public/book.html`
The public booking page a client uses to book a consultation with the firm.

### `app-v2/sheet/agreements.html`, `?tab=`
`list` (default), `quote`, `editor`, `envelope`, `authority`.

## Screenshots

`shots-real-icons/` is the newer set, at 1440×900, and it shows the app’s real icons. Use it for icon shape. `shots/` is the earlier set, including the 390 px-wide record shots and the wrong-code signing shot (`index-state-verify-error.png`), which the newer set does not include.

Rendered from these pages at 1440 px wide (files ending `-390` are phone width):
- `consultations-tab-*.png`, `consultations-tab-record-ag-{signed,sent,voided}.png`, `consultations-record-{signed,sent,voided}-390.png`
- `dialog-book-for-client.png`, `dialog-void-agreement.png`, `dialog-reschedule.png`, `dialog-cancel.png`
- `index-state-*.png`: every signing state
- `book.png`, `agreements-tab-*.png`

## Icons
The private design files use a licensed commercial icon kit, which **is not included here** and must not be added to the repo.
In this copy, `app-v2/kit/icons-open.js` injects an inline sprite built from **Lucide** (ISC licence, https://lucide.dev/license), and `ui.js` points at it (`#i-<name>`). Agreements, the booking page, and the signing page still load that script. `app-v2/sheet/consultations.html` does not: it was replaced from `consultations.html.src`, which drops the Lucide sprite so the page matches `shots-real-icons/`. Opening that one file from disk will not draw icons. The real-icon screenshots are the reference for it. In the app, use the icon set it already ships. Match the size, placement and meaning, not the Lucide glyph.

## Fonts
Only **Erode** (`fonts/Erode-*.woff2`) is included, so this folder sets Erode on body text as well as headings. It comes from the Indian Type Foundry's Fontshare and is free for personal and commercial use under the ITF Free Font Licence (https://www.fontshare.com/licenses/itf-ffl). The app does not follow that: it keeps Inter for interface text and Erode for headings. See `docs/specs/consultation-agreement-states.md`.

## Notes
- All names, emails, firms ("Northline Immigration") and amounts are fictional demo data for a firm's own client fees. None of them are Casevoya prices.
- No third-party signing provider is named anywhere in the UI, and the app shouldn't name one either.
- The Void dialog includes **Reason (staff only)** above the buttons. The hint is “Shown on the record with who voided it and when.” The placeholder is “e.g. Wrong template sent.” The prototype caps the box at 300 characters; the app’s existing void function already allows 3 to 500, and that rule stays.
