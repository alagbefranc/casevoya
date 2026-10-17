# Casevoya Design Specification

Version 1.1 · 14 October 2026 · Responsive web application and public website.

## 1 Reference and design ownership

User-selected reference: [Notion design system on Refero](https://styles.refero.design/style/2bf4c61f-de10-4614-ba1b-20c0453bd2a9), inspected 14 October 2026.

Reference observations: warm #f6f5f4 canvas; white surfaces; black text; #0075de action blue; #e6f3fe secondary tint; 1 px hairlines; 12 px cards; 8 px buttons; 4 px spacing unit; 24 px card padding; 80 px marketing section rhythm; approximately 200 ms transitions; sans-serif typography with occasional editorial serif accents. These measurements inform the visual starting point. Everything below specifies our own immigration-software adaptation rather than copying the reference's components, branded fonts, artwork, or wording.

This file supersedes the earlier PRD's proposed navy-and-teal visual direction. Casevoya remains a working name. The reference controls visual inspiration; RULES.md controls immigration content. Do not present Refero or Notion as a source of immigration guidance.

## 2 Design objectives

The client should recognize their next action within five seconds. The consultant should see what needs review, what is blocked, and what is due without opening every matter. The platform administrator should see operational health without being shown client narratives.

Use warm backgrounds, crisp type, simple line icons, generous spacing, and concentrated color. Marketing can be expressive; casework should be calm and information-rich. Do not use glass effects, gradient dashboard backgrounds, neon charts, oversized KPI cards, or excessive shadows. Do not place mascots beside refusals, financial disputes, urgent government requests, or other sensitive outcomes.

## 3 Design tokens

Values are implementation defaults. Tokens prefixed semantic are original adaptations, not claims about the reference. Validate final contrast in rendered states. Use CSS custom properties as the source of truth and map them into the selected styling framework without duplicating literal values throughout components.

```css
:root {
  color-scheme: light;
  --canvas: #f6f5f4;
  --surface: #ffffff;
  --surface-muted: #efeeec;
  --text: #111111;
  --text-secondary: #615d59;
  --text-muted: #69635e;
  --border: #dedbd7;
  --border-strong: #8c8781;
  --divider: rgba(0, 0, 0, 0.08);
  --action: #0075de;
  --action-hover: #0065bf;
  --action-active: #0055a1;
  --on-action: #ffffff;
  --action-tint: #e6f3fe;
  --action-tint-text: #075b9f;
  --focus: #075b9f;
  --selection: #dceeff;
  --semantic-success-bg: #e7f3ec;
  --semantic-success-text: #205c38;
  --semantic-warning-bg: #fff2d2;
  --semantic-warning-text: #704b00;
  --semantic-danger-bg: #fde9e5;
  --semantic-danger-text: #a12c20;
  --semantic-info-bg: #e6f3fe;
  --semantic-info-text: #075b9f;
  --semantic-neutral-bg: #efeeec;
  --semantic-neutral-text: #514c47;
  --marketing-amber: #ffb110;
  --marketing-coral: #f64932;
  --marketing-sky: #62aef0;
  --marketing-midnight: #02093a;
  --radius-sm: 4px;
  --radius-control: 8px;
  --radius-panel: 12px;
  --radius-pill: 9999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --font-ui: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-editorial: 'Source Serif 4', Georgia, serif;
  --font-code: ui-monospace, SFMono-Regular, Consolas, monospace;
  --motion-fast: 120ms;
  --motion-normal: 200ms;
  --ease-standard: ease;
  --overlay-shadow: 0 12px 32px rgba(17, 17, 17, 0.12);
}
```

Do not download proprietary NotionInter or Lyon Text assets. Use properly licensed font packages, self-host where appropriate, include required notices, and fall back cleanly while fonts load. Source Serif 4 is optional for marketing quotations only; never use decorative serif text for identity numbers, finance, or form controls.

The divider token is decorative separation. Interactive input borders use border-strong or another contrast-verified treatment. Never use a subtle hairline as the sole affordance for an input. If white text on action blue fails the required contrast in a particular treatment, use the darker action token; record this as an accessibility adjustment, not a theme redesign.

## 4 Typography and layout scale

| Role | Desktop size / line height | Mobile size / line height | Weight |
| --- | --- | --- | --- |
| Marketing hero | clamp 48 to 72 px / 1.08 | 36 to 44 px / 1.12 | 600 |
| Marketing section heading | 40 px / 1.2 | 28 px / 1.25 | 600 |
| App page heading | 28 px / 1.25 | 24 px / 1.3 | 600 |
| Panel heading | 18 px / 1.4 | 18 px / 1.4 | 600 |
| Body and input | 16 px / 1.5 | 16 px / 1.5 | 400 |
| Table and toolbar | 14 px / 1.45 | 14 px / 1.45 | 400 or 500 |
| Secondary metadata | 12 px / 1.5 | 12 px / 1.5 | 400 |

Use slightly tight tracking for large marketing headlines and normal tracking in body copy. Use tabular numerals for money and counts, and a monospace treatment only when an identifier benefits from it. Wrap legal names and translated text; do not truncate essential instructions, government deadlines, or fee descriptions. Restrict prose to approximately 65–75 characters per line in help and guidance views.

Marketing max width is 1200 px inside a maximum 1440 px canvas. Use 24–48 px desktop gutters and 16–20 px mobile gutters. Marketing sections use 64–80 px vertical spacing; dense application panels use 24–32 px. Application workspace may fill wider monitors with a bounded reading panel and fluid tables.

## 5 Application shells

### Firm workspace

At 1280 px and above, use a 240 px sidebar, 64 px top bar, and main content padding of 32 px. Sidebar groups: Work (Overview, Leads, Clients, Matters, Tasks, Calendar), Records (Inbox, Documents, Agreements, Finance), and Practice (Reports, Templates, Settings). Maintain a visible active-workspace label and firm switcher. Source review appears under Templates with an attention count, not as a hidden developer screen.

The top bar contains breadcrumb, permission-scoped search, quick create, notifications, and account controls. Quick create offers only actions allowed for that user. Search results mask restricted identifiers. Do not use one unrestricted global search across firms.

Between 768 and 1279 px, collapse the sidebar into a drawer or rail with accessible labels. Under 768 px, use a menu drawer and one-column layouts. Essential controls remain visible without horizontal page scrolling. Wide tables have a labelled contained scroll region or transform into summaries; the page itself must not overflow.

### Client portal

Use a simpler header showing the firm's logo and name, current matter switcher, help, and profile. Present one prominent next-action panel, then requested documents, progress, recent messages, and payments. Mobile navigation prioritizes Home, Tasks, Messages, and More. Documents, agreements, and payments remain reachable within two navigation steps.

Adult family members receive their own scoped views. A family selector must not imply that selecting a name grants access. Locked records explain that permission is required without disclosing their contents. Clients see the responsible consultant and contact route, not internal workload comments.

### Platform administration

Use the same visual system with a clearly labelled Platform administration header. Default cards contain firm count, subscription exceptions, queue health, verification workload, and incident status. Support grants show scope and expiry. Access to client content is an exceptional, explicit action and is never the default landing view.

## 6 Core component contracts

| Component | Required behavior |
| --- | --- |
| Primary button | One dominant action per local task; 44 px comfortable height; visible focus; disabled reason and loading label |
| Secondary button | Tint or neutral surface; no visual competition with primary action |
| Destructive action | Plain warning language; confirmation describes affected records; separate from ordinary save |
| Input | Persistent label, help text, error association, required state, autofill where appropriate |
| Select and combobox | Keyboard operation, searchable long lists, selected value, empty and failed-loading states |
| Panel | White surface, subtle border, 12 px radius, normally 24 px padding, no ordinary shadow |
| Status badge | Explicit noun or phrase plus color; never color-only meaning |
| Data table | Caption or heading, sortable headers, pagination, selected count, keyboard focus and clear empty state |
| Drawer | Contextual editing or inspection; close behavior and unsaved-change protection |
| Modal | Short confirmation or focused task; focus trap, escape behavior, return focus and labelled heading |
| Source details | Publisher, official link, applicable scope, source version, checked date and reviewer state |
| Alert | Specific problem, consequence and next action; permanent while action is required |
| Toast | Supplementary acknowledgement only; never the sole record of a critical failure |
| File card | Filename, document purpose, person, upload state, review state, version and allowed actions |
| Timeline event | Event type, source, actor or authority, relevant date, verification state and attachments |

Required buttons states: default, hover, focus-visible, pressed, disabled, loading, success, and retryable failure. Loading must prevent duplicate financial or signature requests but remain recoverable. Avoid icon-only primary actions. Icons use a consistent 20 px line style; tooltips supplement rather than replace accessible names.

Tables use approximately 48 px rows in comfortable mode and at least 40 px in optional dense staff mode. Client tasks remain comfortable. Multi-line rows expand. Bulk actions name the selection and require additional confirmation for access changes, deletion, or financial actions. Selecting every row on a page is distinct from selecting every matching record.

## 7 Status semantics

| Status group | Visual meaning | Examples |
| --- | --- | --- |
| Neutral | Existing or inactive information | Draft, Not started, Archived |
| Blue | Current work or information | In preparation, Submitted by firm, Awaiting review |
| Amber | Attention or unresolved dependency | Changes requested, Due soon, Source review required |
| Red | Failure, overdue task, or explicit harmful condition | Payment failed, Deadline overdue, Upload rejected |
| Green | Verified completion of the named task | Agreement signed, Payment reconciled, Document accepted by firm |

Approval requires a verified government decision, not a green card by itself. A refusal is conveyed respectfully with its confirmed status and consultant next steps; do not add dramatic red page backgrounds. Payment success does not change application status. Document acceptance must explicitly mean firm acceptance where relevant.

## 8 Screen specifications

### Public landing page

Build a navigation bar with Product, For consultants, Client portal, Security, Pricing, and Book a demo. Hero: a concise operational promise, supporting sentence, primary demo action, secondary product-tour action, and a fictional product preview. Use an original composition; do not copy Notion artwork or Refero copy.

Follow with the client journey, consultant workflow, document review, financial clarity, privacy controls, migration support, pricing, FAQs, and final call to action. Use restrained amber, coral, sky, or midnight backgrounds in selected marketing panels only. Do not claim certifications, government partnership, live integrations, customer totals, or performance gains without evidence. Pricing is labelled proposed in unapproved previews.

### Firm overview

Header includes today's date in the user's timezone and a clear action. Use four compact counts: tasks due, documents awaiting review, blocked matters, and financial exceptions. Counts link to the corresponding filtered queue. Below, prioritize an actionable task table and recent material updates. Approval rate is not a headline KPI.

### Matter overview

Header displays client name, matter reference, program, consultant, stage, next verified deadline, and source-last-checked indicator where applicable. Keep stage, government status, and financial status visually separate. Main area has next actions, blockers, key people, and recent events. Tabs reveal details without reloading the entire case context. A pinned evidence or notes drawer is optional on large screens.

### Client home and intake

Show a next action with reason, due date, estimated effort if validated, and Continue. Intake uses short topical sections with autosave feedback, clear progress through questions, a review step, and explicit unknown/not-applicable answers. Explain why sensitive information is requested when useful. A 70 percent intake completion indicator must never be labelled 70 percent approved.

### Document upload and review

Clients select a request, confirm whose document it is, upload or capture, preview, and submit. Show scan/processing separately from review acceptance. Staff use a split view: preview on the left, document details and review actions on the right. On mobile these become stacked views with persistent task context. Rejection requires a helpful reason and specific correction request.

### Source review and program template editor

Provide a source register with rule status, jurisdiction, program, effective date, reviewer, last checked, next review, and affected matters. The detail view presents the draft claim, exact source section, interpretation notes, tests, and version comparison. Actions are Capture evidence, Request review, Approve version, Publish, or Suspend according to role. No generic Verified switch.

Client-facing guidance offers a compact Official source link and Checked date. Professional review history is available to staff. If evidence is missing, show Review required and the responsible owner; do not display a fabricated recommendation as an empty-state placeholder.

### Agreements and finance

Agreement screens show parties, scope, exact version, signature progress, and downloadable executed copy. Finance has separate tabs or views for invoices, payments, advances/client funds, reconciliation, and disputes. Display professional fees, taxes, government fees, and disbursements as separate line categories. Use Paid only after verified payment, and Reconciled for the bank or ledger reconciliation state.

Client payment screens identify the consultancy receiving payment. A deposit request explains its category without exposing internal accounting jargon. Subscription billing belongs in firm settings, not a client's professional-fee view. Refunds show Requested, Processing, Completed, or Failed with clear amounts and dates.

### Government correspondence and decisions

Show the received document, recording source, received date, verified deadline if any, review status, and assigned actions. A client-uploaded letter starts as unverified. Decision view includes confirmed outcome, official evidence, consultant explanation, and next tasks. Do not imply that the portal made the decision or that a refusal automatically creates a particular legal remedy.

## 9 Interaction and motion

Use 120–200 ms opacity and small-position transitions for menus, tabs, and expandable panels. Essential information appears without animation delays. Preserve scroll and keyboard focus after updates. Use skeletons for ordinary loading, progress for large uploads, and a durable job history for exports.

Respect prefers-reduced-motion. Disable bouncing and large transforms when reduced motion is requested. Avoid confetti for immigration decisions; use a clear, respectful confirmation. No animated countdown tied to an unverified deadline. Do not use a spinning indicator indefinitely without status, timeout handling, and recovery.

## 10 Accessibility and multilingual behavior

Target WCAG 2.2 AA. Validate normal text at 4.5:1, large text at 3:1, and relevant control/focus contrast at 3:1. Use a 2 px visible focus ring with offset. Default touch targets are at least 44 by 44 px; tightly spaced exceptions require accessibility review. Every task must be achievable by keyboard and screen reader.

Use 16 px input text on mobile, structured labels, error summary links, live regions for meaningful async updates, and semantic tables. Do not rely on drag-and-drop; provide file-picker and reordering buttons. Allow zoom and browser text scaling. Charts have text summaries and tables where needed.

Support English and French without fixed text widths. Allow approximately 30 percent text expansion in layout testing. Dates use unambiguous local display and preserve the official timezone when material. Do not translate legal names or identifiers. Currency displays include CAD when ambiguity exists. Client language preference and the official source language are separate metadata.

## 11 Content and empty states

Write short, specific instructions: Upload the passport pages requested by your consultant, rather than Upload all required documents. Link each real requirement to the applicable reviewed checklist. Use Your consultant is reviewing this document instead of IRCC is reviewing when only the firm is involved.

Every data screen has loading, empty, filtered-empty, validation error, provider failure, permission denied, offline, and stale-data states. Empty states explain what belongs there and provide one authorized action. Critical errors remain on the page. Do not erase form input after a failed request. Confirm saved status only after the server confirms it.

## 12 Design deliverables and acceptance

- Components and tokens in code, with a documented visual reference and accessible examples.
- Desktop designs at 1440 px and mobile designs at 390 px, plus validation at 360, 768, 1024, and 1280 px.
- Complete firm, client, and platform navigation, including role-restricted states.
- Core journeys: invite, intake, upload, review, signature, payment, request response, decision, and export.
- Source review, stale guidance, unverified submission, failed payment, restricted family document, and expiring support grant states.
- No real client data, unlicensed imagery, government seals, or invented endorsements in previews.
- Screenshot comparisons for key states, keyboard walkthrough, contrast report, and localization checks.

Design acceptance asks whether users can complete their next task, distinguish an official requirement from an internal request, understand who verified an update, and recover from failure. Visual resemblance to the reference alone is not sufficient.
