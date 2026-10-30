# Client portal fidelity

Spec only. Implementation follows in a later change. Francis confirms merges.

Checked against `origin/main` at #161 (23 Oct 2026). The design pack is `design/portal/`. The check notes are `design/portal/PORTAL-FIDELITY.md`.

## Problem

Demo or sample mode (the staff preview) already matches all 16 designs. The live client portal keeps the dark sidebar, light sheet and Core UI icons, and its page bodies are bare lists and empty boxes.

## Approach

Rebuild the live portal pages from the existing demo-mode components, fed by real data, rather than writing them from scratch. Keep Inter for interface text and Erode for headings. Keep the Core UI icons and the #0075DE / #F6F5F4 / #111 palette.

Sample mode renders `DemoPortal` (`src/components/portal/demo.tsx`) from `src/components/portal/markup/*` when portal access is `sample`. A real client renders `LivePortal` (`src/components/portal/live.tsx` and the `*-live.tsx` bodies) from `src/app/portal/[[...slug]]/page.tsx`. The live shell (dark sidebar, light sheet, Core UI sprite at `/assets/icons-coreui/sprite.svg`, top pill and Help) stays. Replace the bare page bodies with the designed layouts, filled from the loaders the live route already calls.

The HTML in `design/portal/pages/` is the design source. It links kit CSS and scripts that are not in this pack, so open the PNGs beside each page for the rendered design. The markup components are the working port of those designs.

Live copy comes from the signed-in firm and person. `tests/demo-surface.test.tsx` rejects prototype names on live renders (`northline`, `olena`, `rafael`, and the related demo strings). Keep that.

`design/portal/pages/portal-olena.html` and `portal-rafael.html` are sample-mode persona screens. The live route already returns not found for those slugs. Leave them sample-only.

## Work

### 1. Home

`/portal`, from `design/portal/pages/portal.html`.

Add the blue next-step hero (step, due date, Continue button), the summary strip (what to do / by when / who's working on it / what happens next), the "Where things stand" 8-step tracker with its disclaimer line, and the "Documents you've sent" panel split into accepted and uploaded-not-yet-accepted.

### 2. Sidebar

On every live page, add the firm logo tile, the matter switcher pill, count badges (Tasks, Messages), the person's avatar and role at the bottom, and the "Powered by Casevoya" footer.

### 3. Card pages

Matters, Tasks, Documents, Upload, Appointments, Agreements, Payments, Pay, Intake, Correction, Account, Family, Guardian: use the designed cards and side panels instead of plain lists. Design each empty state to match too.

| Page | Route | Design |
|---|---|---|
| Matters | `/portal/matters` | `design/portal/pages/portal-matters.html` |
| Tasks | `/portal/tasks` | `design/portal/pages/portal-tasks.html` |
| Documents | `/portal/documents` | `design/portal/pages/portal-documents.html` |
| Upload | `/portal/upload` | `design/portal/pages/portal-upload.html` |
| Appointments | `/portal/appointments` | `design/portal/pages/portal-appointments.html` |
| Agreements | `/portal/agreements` | `design/portal/pages/portal-agreements.html` |
| Payments | `/portal/payments` | `design/portal/pages/portal-payments.html` |
| Pay | `/portal/pay` | `design/portal/pages/portal-pay.html` |
| Intake | `/portal/intake` | `design/portal/pages/portal-intake.html` |
| Correction | `/portal/correction` | `design/portal/pages/portal-correction.html` |
| Account | `/portal/account` | `design/portal/pages/portal-account.html` |
| Family | `/portal/family` | `design/portal/pages/portal-family.html` |
| Guardian | `/portal/guardian` | `design/portal/pages/portal-guardian.html` |

### 4. Receipt

Add the missing in-portal receipt page from `design/portal/pages/portal-receipt.html`, keeping the PDF download.

There is no receipt route in sample mode or on the live portal today. Receipts download as PDFs through `paymentReceiptHref` in `src/modules/finance/receipt-links.ts` (`/api/invoices/receipts/:id`). The new page is the on-screen receipt. The PDF link stays.

### 5. Messages

Keep the chat view from 18 Oct (`ChatView` in `src/components/messages/chat`, mounted from `LivePortal` for `/portal/messages`). Only align its styling. Leave `design/portal/pages/portal-messages.html` as the earlier thread layout. Sample mode may keep that thread; the live page stays the chat.

### 6. Acceptance

Screenshot every live page at 1440 and 390 px, with both seeded data and empty states, next to the design. Add tests. Make no claim of a live link to IRCC.

Place the new shots beside the designs the way `design/portal/compare/` does (design | live). `design/portal/compare/sample-mode/` is design | demo, and already shows sample mode matching. The tracker disclaimer stays a disclaimer: the product has no live link to IRCC, and the page must not say that it does.

Tests render each live page with seeded data and with an empty file, and assert the designed regions (hero, tracker, cards, empty states, receipt, sidebar chrome). Extend the live portal coverage in `tests/demo-surface.test.tsx` rather than pasting prototype copy into a live render.

## Pictures in this pack

- `design/portal/<page>.png` — the design.
- `design/portal/compare/<page>.png` — design next to the live portal.
- `design/portal/compare/sample-mode/<page>.png` — design next to demo mode.
- `design/portal/PORTAL-FIDELITY.md` — per-page gap notes from the 23 Oct check.
