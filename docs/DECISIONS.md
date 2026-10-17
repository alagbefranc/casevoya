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

## Open

* Erode-only typography vs DESIGN.md's tabular / non-decorative rule for money, IDs and form fields.
* Residency review for Supabase Auth email delivery and other subprocessors before claiming "Canada-only".
* First provinces / programs and the licensed reviewer (T001).
* Payment provider (Stripe Connect?) for earned fees.
