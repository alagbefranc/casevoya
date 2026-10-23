# Brief: public consultation agreement + booking confirmation

For Francis’s external designer (not the in-app Designer bot). Visual redesign only — not eng wiring.

## Surfaces
1. Private signing link: `/consultation/<ref>/agreement`
2. Booking confirmation (public) that should lead into “Sign the agreement”
3. Signed success state

## What’s wrong (see `shots/`)
- Signed success feels sparse / broken; stub toast (“This form isn’t connected yet / Nothing was saved”) has shown on success
- Unsigned signing page and booking confirmation feel unfinished / off-brand vs Casevoya
- Consent error should stay inline (eng), but layout/brand still need a pass

## Brand binding
- Font: Erode only
- Canvas `#F6F5F4` · action `#0075DE` · ink `#111`
- See repo `docs/spec/DESIGN.md` if present

## Eng note
PR #161 (separate) fixes list refresh after Book/Send/Void and kills the stub toast on the signing form. This brief is layout + branding, not that bugfix.

## Out of scope
- Staff Consultations CRUD
- Prior Concept C pack (Francis rejected)

## Ask
Propose a fresh redesign of these public surfaces matching Casevoya branding. Deliver stills / HTML the way you usually do; Francis will pick before eng implements.
