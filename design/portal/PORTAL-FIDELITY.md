# Casevoya client portal: design vs code (origin/main @ #161, 23 Oct 2026)

How it was checked: a copy of main at /workspace/portal-check/app (original clone untouched), run with `next dev` and no Supabase or Stripe keys. Two local-only patches in the copy: (1) a `sample` access override, (2) a mock client viewer (Priya Sharma, one matter, no DB rows). Screenshots at 1440x900.

The app has **two portals**:
- **Sample/demo mode** (`components/portal/markup/*`, shown only to firm staff previewing a sample-mode firm): a near pixel-for-pixel port of the 16 designs (2–6% pixel diff, mostly font rendering). Only gap: there's no Receipt page.
- **Live client portal** (`components/portal/live.tsx` + `*-live.tsx`), which is what a real client sees. It reuses the dark sidebar shell and sheet, but its page bodies are plain lists, panels and empty states. The designed hero, tracker, cards and side panels aren't there. **This is why the coded portal doesn't look like the design.**

Live data pages (documents, agreements, appointments, payments, pay, tasks, intake, messages) need DB rows, so they show empty states in the screenshots. Their filled layouts were reviewed in the code only.

| Design page | Live route | Verdict (live) | Main differences |
|---|---|---|---|
| portal (Home) | /portal | **Different** | No blue next-step hero, no "what/by when/who/what next" strip, no "Where things stand" tracker, no Documents-you've-sent panel. Only "Hi Priya." plus one matter card |
| matters | /portal/matters | Different | Bare matter cards (title + stage), no stage tracker or detail |
| tasks | /portal/tasks | Partial | TasksLive is a simple panel list; error/empty stub when no data |
| documents | /portal/documents | Partial | DocumentsLive panels/list, no designed accepted/under-review two-column layout or status chips as designed |
| upload | /portal/upload | Partial | Shares DocumentsLive. No dedicated upload screen layout |
| messages | /portal/messages | Different (intentional) | A chat view, redesigned at owner's request on 18 Oct |
| appointments | /portal/appointments | Partial | AppointmentsLive list, no designed card/side layout |
| agreements | /portal/agreements | Partial | AgreementsLive panel list |
| payments | /portal/payments | Partial | Plain invoice table + receipt download links |
| pay | /portal/pay?invoice= | Partial | PayLive table + Stripe; demo state switcher not in live (fine) |
| receipt | none | **Missing** | No portal receipt page in demo or live; receipts are PDF downloads (/api/.../receipts) |
| intake | /portal/intake | Partial | IntakeLive form, otherwise a plain sections list |
| correction | /portal/correction | Partial | Same as intake, with a different heading |
| family | /portal/family | Different | "People on your file" bare list |
| guardian | /portal/guardian | Different | Bare list of grants |
| account | /portal/account | Partial | Simple form ("Contact choices…"), not the designed settings layout |

## Shell (all live pages)
- Sidebar: no white-on-blue Casevoya/firm logo tile; the matter is plain wrapped text, not the switcher pill; no Messages badge; no avatar; "Switch person" is replaced by "Your account / People on your file" links.
- Top bar: there's a pill and Help, so this matches.
- Icons: the Core UI sprite icons are present, so this matches.
- Fonts: Inter for text and Erode for headings, which is intentional.
- Status bar footer: the language toggle and timezone are present; the "Demo data · Fictional applicant" tag is shown only in demo, which is correct.
- The "N" bubble over the sidebar footer is the Next.js dev indicator, not an app bug.

## Images
- compare/<page>.png: DESIGN | APP live client view
- compare/sample-mode/<page>.png: DESIGN | APP demo mode
- raw: shots/ (demo), live/ (live)
