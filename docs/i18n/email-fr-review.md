# French email copy: review package

Generated from `src/modules/email/designs/fr-drafts.json` by `tests/email-fr-review.test.ts` (`pnpm email:previews`). Do not edit by hand.

**For the certified translator (OTTIAQ member).** Every French string below is a DRAFT: a machine draft by Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, prompt `fr-ca-2026-10-18.3`) or a hand draft. Nothing here is sent to anyone until a
named reviewer approves the template in the repository (see `docs/i18n/README.md`). Until then every client gets the English email.

Conventions to apply: Canadian French (fr-CA), vouvoiement, OQLF typography (no-break space before `:`, narrow no-break space before `; ! ?`, « » with no-break spaces), 24-hour times written `14 h 30`, dates `mardi 20 octobre 2026`, amounts `1 250,00 $ CA`. Do not translate names of people or firms, identifiers (INV-0001, CN-0001, PR-0001, RC-0001), or {placeholders}. These emails name no immigration program or form; if one is ever added, keep the English name unless an official French name can be cited from the official source.

Subjects and preheaders must not reveal a program, document name, amount or decision (they appear on lock screens). Copy has no em dashes.

## Placeholders

| Placeholder | What it holds at send time |
|---|---|
| `{firm_name}` | the firm's display name, never translated (Maple Example Immigration) |
| `{inviter_name}` | a person's name, never translated |
| `{consultant_name}` | a person's name, never translated |
| `{approver_name}` | a person's name, never translated (or the default_approver phrase) |
| `{handler_name}` | a person's name, never translated |
| `{role_phrase}` | one of the _shared role_* phrases, article-free (gestionnaire de dossiers) |
| `{due_date}` | a date, written by the code: 6 novembre 2026 (1er mai 2026) |
| `{short_date}` | a short date, written by the code: 30 oct. |
| `{day_date}` | a date with the weekday, written by the code: vendredi 30 octobre 2026 |
| `{date_time}` | date and 24-hour time in the attendee's or firm's zone: jeudi 22 octobre 2026 à 10 h 30 (on the hour: à 10 h) |
| `{time_zone_label}` | the zone, from _shared.zone_label: heure de Toronto, heure d’Edmonton |
| `{city}` | the last part of the IANA zone name (Toronto, Vancouver), not translated |
| `{invoice_number}` | an identifier such as INV-0001, never translated |
| `{receipt_number}` | an identifier such as PR-0001 or RC-0001, never translated |
| `{matter_reference}` | the firm's matter reference, never translated |
| `{address}` | the meeting address as the firm typed it, not translated |
| `{device}` | the browser and system as detected (Chrome on Windows); stays as detected |
| `{minutes}` | a whole number |
| `{hours}` | a whole number greater than 1 (1 has its own string) |
| `{days}` | a whole number |

## Status

| Template | Name | Status | Reviewer | Reviewed on | Would send French today? |
|---|---|---|---|---|---|
| _shared | Shared shell strings | machine_draft | — | — | No (not_approved) |
| EM01 | Staff invite | machine_draft | — | — | No (not_approved) |
| EM02 | Client invite | machine_draft | — | — | No (not_approved) |
| EM05 | Sessions signed out | machine_draft | — | — | No (not_approved) |
| EM06 | Document requested | machine_draft | — | — | No (not_approved) |
| EM07 | Deadline reminder | machine_draft | — | — | No (not_approved) |
| EM08 | Agreement ready to sign | machine_draft | — | — | No (not_approved) |
| EM08-staff | Agreement: your turn to countersign (staff variant of EM08) | machine_draft | — | — | No (not_approved) |
| EM09 | Agreement executed | machine_draft | — | — | No (not_approved) |
| EM09-staff | Agreement executed (staff variant of EM09) | machine_draft | — | — | No (not_approved) |
| EM10 | Invoice issued | machine_draft | — | — | No (not_approved) |
| EM11 | Payment receipt | machine_draft | — | — | No (not_approved) |
| EM12 | Bounced notice staff follow up | machine_draft | — | — | No (not_approved) |
| EM15 | Decision recorded | machine_draft | — | — | No (not_approved) |
| EM16a | Consultation booked | machine_draft | — | — | No (not_approved) |
| EM16b | Consultation rescheduled | machine_draft | — | — | No (not_approved) |
| EM16c | Consultation cancelled | machine_draft | — | — | No (not_approved) |
| EM17 | Support access granted | machine_draft | — | — | No (not_approved) |
| EM18a | Subscription past due | machine_draft | — | — | No (not_approved) |
| EM18b | Workspace restricted | machine_draft | — | — | No (not_approved) |
| EM19a | Data export ready | machine_draft | — | — | No (not_approved) |
| EM19b | Data export expiring | machine_draft | — | — | No (not_approved) |
| EX02 | New sign in alert | machine_draft | — | — | No (not_approved) |
| EX03 | Invitation expired | machine_draft | — | — | No (not_approved) |
| EX04 | Dependant invite | machine_draft | — | — | No (not_approved) |
| EX05 | Document needs another look | machine_draft | — | — | No (not_approved) |
| EX06 | Document accepted | machine_draft | — | — | No (not_approved) |
| EX06-received | Document received | machine_draft | — | — | No (not_approved) |
| EX07 | New message | machine_draft | — | — | No (not_approved) |
| EX08 | Payment failed | machine_draft | — | — | No (not_approved) |
| EX09 | Refund started | machine_draft | — | — | No (not_approved) |
| EX10 | Refund complete | machine_draft | — | — | No (not_approved) |
| EX20 | Refund didn’t go through | machine_draft | — | — | No (not_approved) |
| EX19 | New notice (announcement) | machine_draft | — | — | No (not_approved) |
| EX18 | New enquiry (staff) | machine_draft | — | — | No (not_approved) |
| EX17 | Consultant changed | machine_draft | — | — | No (not_approved) |
| EX16 | Signing code | machine_draft | — | — | No (not_approved) |
| EX11 | Support access requested | machine_draft | — | — | No (not_approved) |
| EX12 | Licence check attention | machine_draft | — | — | No (not_approved) |
| EX13 | Privacy request received | machine_draft | — | — | No (not_approved) |
| EX14 | Complaint received | machine_draft | — | — | No (not_approved) |
| generic | Generic update (unknown template) | machine_draft | — | — | No (not_approved) |

## _shared: header, footers and phrases used in every email

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:2392d7d1cd0a…`

- These strings appear in every French email (header tagline, footers, zone label, role phrases). Approve them first: no French email is sent while _shared is not approved.

- Role phrases are article-free hand drafts so they fit « à titre de / en tant que {role_phrase} ». « consultante ou consultant autorisé » is the app's role name, not the regulated CICC title; choose the wording.

- footer_platform: « consultants en immigration » vs « conseillers »: pick the firm's preferred term and use it everywhere.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `your_firm` | Your firm | votre cabinet | Machine draft |
| `tagline` | Your immigration file | Votre dossier d’immigration | Machine draft |
| `footer_firm` | Sent by {firm_name} via Casevoya | Envoyé par {firm_name} au moyen de Casevoya | Hand draft. Existing hand draft (layout.ts footer). Keep {firm_name} |
| `footer_platform` | Case management for immigration consultants · casevoya.ca | Gestion de dossiers pour les consultants en immigration · casevoya.ca | Machine draft |
| `zone_label` | {city} time | heure de {city} | Hand draft. The code writes « heure d’ » before a vowel (heure d’Edmonton). Keep {city} |
| `invite_expiry` | Your private link works once and expires in 7 days. | Votre lien privé fonctionne une seule fois et expire dans 7 jours. | Machine draft |
| `invite_without_link` | The private link is not in this email. Use the link the firm gives you. | Le lien privé ne se trouve pas dans ce courriel. Utilisez le lien que le cabinet vous fournit. | Machine draft |
| `contact_to_change` | To change or cancel, contact {firm_name}. | Pour apporter des modifications ou annuler, communiquez avec {firm_name}. | Machine draft. Keep {firm_name} |
| `role_firm_owner` | a Firm owner | propriétaire du cabinet | Hand draft. Article-free so it fits « à titre de {role_phrase} » in EM01. |
| `role_licensed_consultant` | a Licensed consultant | consultante ou consultant autorisé | Hand draft. Article-free. App role name, not the regulated CICC title; check the wording. |
| `role_case_manager` | a Case manager | gestionnaire de dossiers | Hand draft. Article-free (EM01). |
| `role_assistant` | an Assistant | adjointe ou adjoint | Hand draft. Article-free (EM01). |
| `role_finance_user` | a Finance user | responsable des finances | Hand draft. Article-free (EM01). |
| `role_other` | a member of the team | membre de l’équipe | Hand draft. Article-free (EM01). |
| `manage_line` | To change the time or cancel, use Manage your booking. | Pour changer l’heure ou annuler, utilisez Gérer votre réservation. | Hand draft. CRM-03 hand draft (#176). |
| `manage_cta` | Manage your booking | Gérer votre réservation | Hand draft. CRM-03 hand draft (#176). |

## EM01: Staff invite

Firm owner invites a staff member (outbox staff_invitation.email_requested, template invite, kind staff). Audience: staff. [French preview](../email/previews/fr/EM01.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:20a555b693e7…`

- lead: « Vous avez été invité » is masculine; consider an epicene wording (for example « Une invitation vous est faite… »).

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject_inviter` | {inviter_name} invited you to {firm_name} | {inviter_name} vous invite à {firm_name} | Machine draft. Keep {firm_name}, {inviter_name} |
| `subject` | You’re invited to join {firm_name} | Vous êtes invité à rejoindre {firm_name} | Machine draft. Keep {firm_name} |
| `preheader` | Accept your invitation to join {firm_name} on Casevoya. | Acceptez l’invitation pour rejoindre {firm_name} sur Casevoya. | Machine draft. Keep {firm_name} |
| `lead` | You’ve been invited as {role_phrase}. Set a password and two-step sign-in to join. | Vous avez été invité en tant que {role_phrase}. Définissez un mot de passe et une authentification à deux étapes pour rejoindre. | Machine draft. Keep {role_phrase} |
| `cta` | Accept invitation | Accepter l’invitation | Machine draft |

## EM02: Client invite

Staff invite a client, sponsor, employer contact or guardian to the portal (outbox portal_invitation.email_requested). Audience: client. [French preview](../email/previews/fr/EM02.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:80ec40f27e9b…`

- subject, preheader and cta are the earlier EM14a hand drafts. « au cabinet {firm_name} » reads oddly when the firm name already says Immigration; « de {firm_name} » may be better.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your file with {firm_name} is ready | Votre dossier avec {firm_name} est prêt | Hand draft. EM14a hand draft. Keep {firm_name} |
| `preheader` | Open your private link to set up your portal login. | Ouvrez votre lien privé pour créer votre accès au portail. | Hand draft. EM14a hand draft. |
| `invited_inviter` | {inviter_name} at {firm_name} invited you to your client portal. | {inviter_name} au cabinet {firm_name} vous a invité à accéder à votre portail de compte client. | Machine draft. Keep {firm_name}, {inviter_name} |
| `invited` | {firm_name} invited you to your client portal. | {firm_name} vous invite à accéder à votre portail client. | Machine draft. Keep {firm_name} |
| `first_step` | Open your portal to see your first step. | Ouvrez votre portail pour voir votre première étape. | Machine draft |
| `cta` | Open your portal | Ouvrir votre portail | Hand draft. EM14a hand draft. |

## EM05: Sessions signed out

Password changed with “sign out everywhere” (revoke_other_sessions). No outbox event yet. Audience: staff. [French preview](../email/previews/fr/EM05.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:451190d76424…`

- body: the machine draft ADDED {firm_name}, which the English does not have. Remove it (« de votre cabinet ») before approval; the gate refuses this template until the placeholders match.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your other sessions were signed out | Vos autres sessions ont été déconnectées | Machine draft |
| `preheader` | This follows your password change. | Ceci fait suite à votre changement de mot de passe. | Machine draft |
| `body` | After your password change, every other session was signed out. This is recorded in your firm’s audit trail. | Après votre changement de mot de passe, toutes les autres sessions ont été déconnectées. Ceci est consigné dans la traçabilité de votre cabinet {firm_name}. | Machine draft. PLACEHOLDERS DIFFER FROM THE ENGLISH: fix before approval. **Placeholders differ from the English: fix before approval.** |

## EM06: Document requested

Staff create a document request (outbox document.request_created, template document_request). Audience: client. [French preview](../email/previews/fr/EM06.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:acc375e4f817…`

- subject, preheader, body and cta are the earlier EM14b hand drafts; subject is in the present tense where the English is past.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} asked for a document | {firm_name} vous demande un document | Hand draft. EM14b hand draft (present tense; the English is past tense). Keep {firm_name} |
| `preheader` | Upload it securely in your portal. | Téléversez-le en toute sécurité dans votre portail. | Hand draft. EM14b hand draft. |
| `body_due` | Please upload a document to your file by {due_date}. Details are in your portal. | Téléversez un document à votre dossier avant {due_date}. Les détails se trouvent dans votre portail. | Machine draft. Keep {due_date} |
| `body` | Please upload a document to your file. Details are in your portal. | Veuillez téléverser un document à votre dossier. Les détails se trouvent dans votre portail. | Hand draft. EM14b hand draft. |
| `cta` | Open your portal | Ouvrir votre portail | Hand draft. EM14b hand draft. |

## EM07: Deadline reminder

A reminder schedule comes due (outbox reminder.due, template reminder). Honours deadline_reminders and email_notices. Audience: client. [French preview](../email/previews/fr/EM07.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:e7d957422caf…`

- preheader, heading, body and cta are the earlier EM14c hand drafts.

- subject_due / heading_due / body_due: « est prévue {short_date} » lacks « le » (« est prévue le 30 oct. »); check each.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject_due` | A step on your file is due {short_date} | Une étape de votre dossier est prévue {short_date} | Machine draft. Keep {short_date} |
| `subject` | A reminder from {firm_name} | Un rappel de {firm_name} | Machine draft. Keep {firm_name} |
| `preheader` | Your portal shows what to do next. | Votre portail indique quoi faire. | Hand draft. EM14c hand draft (drops « next »). |
| `heading_due` | A step is due on {short_date} | Une étape est prévue pour {short_date} | Machine draft. Keep {short_date} |
| `heading` | A step on your file is coming up | Une étape arrive à échéance | Hand draft. EM14c hand draft. |
| `body_due` | A step on your file is due {day_date}. Your portal shows what to do. | Une étape de votre dossier est prévue {day_date}. Votre portail indique les démarches à suivre. | Machine draft. Keep {day_date} |
| `body` | A step on your file is coming up. Your portal shows what to do. | Une étape de votre dossier arrive à échéance. Votre portail indique quoi faire. | Hand draft. EM14c hand draft. |
| `cta` | Open your portal | Ouvrir votre portail | Hand draft. EM14c hand draft. |

## EM08: Agreement ready to sign

Staff send an agreement for signature (outbox agreement.sent, template agreement), to client signers; or a consultation agreement on a booking (outbox booking_agreement.sent), to the booking’s attendee, with its private signing link. Audience: client. [French preview](../email/previews/fr/EM08.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:10dfed57d368…`

- preheader: « Examinez-le » should agree with « convention » (« Examinez-la et signez-la »).

- body_consent / body_quote: « signez » vs « signez-le »: make consistent.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | An agreement from {firm_name} is ready to sign | Une convention de {firm_name} est prête à être signée | Machine draft. Keep {firm_name} |
| `preheader` | Review it and sign in your portal. | Examinez-le et signez dans votre portail. | Machine draft |
| `heading` | An agreement is ready to sign | Une convention est prête à être signée | Machine draft |
| `body_service` | Your service agreement from {firm_name} is ready. Review it and sign in your portal. | Votre convention de services de {firm_name} est prête. Examinez-la et signez-la dans votre portail. | Machine draft. Keep {firm_name} |
| `body_consultation` | Your consultation agreement from {firm_name} is ready. Review it and sign in your portal. | Votre convention de consultation de {firm_name} est prête. Examinez-la et signez-la dans votre portail. | Machine draft. Keep {firm_name} |
| `body_amendment` | Your agreement amendment from {firm_name} is ready. Review it and sign in your portal. | Votre modification de convention de {firm_name} est prête. Examinez-la et signez-la dans votre portail. | Machine draft. Keep {firm_name} |
| `body_consent` | Your consent form from {firm_name} is ready. Review it and sign in your portal. | Votre formulaire de consentement de {firm_name} est prêt. Examinez-le et signez dans votre portail. | Machine draft. Keep {firm_name} |
| `body_quote` | Your quote from {firm_name} is ready. Review it and sign in your portal. | Votre devis de {firm_name} est prêt. Examinez-le et signez dans votre portail. | Machine draft. Keep {firm_name} |
| `body` | Your agreement from {firm_name} is ready. Review it and sign in your portal. | Votre convention avec {firm_name} est prête. Examinez-la et signez-la dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Review and sign | Examiner et signer | Machine draft |
| `preheader_booking` | Review it and sign it before your consultation. | Examinez-la et signez-la avant votre consultation. | Hand draft. Booking consultation agreement (signed from its private link, no portal). Hand draft. |
| `body_booking` | Your consultation agreement from {firm_name} is ready. Review it and sign it before your consultation. | Votre convention de consultation de {firm_name} est prête. Examinez-la et signez-la avant votre consultation. | Hand draft. Booking consultation agreement. Hand draft, same wording as body_consultation. Keep {firm_name} |

## EM08-staff: Agreement: your turn to countersign (staff variant of EM08)

A staff signer’s turn comes (outbox agreement.signer_turn, template agreement, audience staff). Audience: staff. [French preview](../email/previews/fr/EM08-staff.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:30b9f71a7d8e…`

- « Ouvrir Conventions dans Casevoya »: the Sheet's screen is labelled « Agreements » in English. Decide whether to name the English screen or describe it.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your countersignature is needed at {firm_name} | Votre contre-signature est requise à {firm_name} | Machine draft. Keep {firm_name} |
| `preheader` | Open Agreements in Casevoya to sign. | Ouvrir les conventions dans Casevoya pour signer. | Machine draft |
| `heading` | It’s your turn to countersign | C’est à votre tour de contre-signer | Machine draft |
| `body` | Everyone before you has signed an agreement. It is your turn to countersign it for {firm_name}. Open Agreements in Casevoya to sign. | Tout le monde avant vous a signé une convention. C’est à votre tour de la contresigner pour {firm_name}. Ouvrir Conventions dans Casevoya pour signer. | Machine draft. Keep {firm_name} |
| `cta` | Open agreements | Ouvrir les conventions | Machine draft |

## EM09: Agreement executed

The last signer signs (outbox agreement.executed, template signature), to client signers. Audience: client. [French preview](../email/previews/fr/EM09.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:90cef63ed89a…`

- preheader says « certificat de complétion », body « certificat d’achèvement »: use one term.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your agreement with {firm_name} is signed | Votre convention avec {firm_name} est signée | Machine draft. Keep {firm_name} |
| `preheader` | Your copy and the completion certificate are in your portal. | Votre copie et le certificat de complétion sont dans votre portail. | Machine draft |
| `heading` | Everyone has signed | Tout le monde a signé | Machine draft |
| `body` | Your agreement with {firm_name} is signed by everyone. Your copy and the completion certificate are in your portal. | Votre convention avec {firm_name} est signée par tous. Votre copie et le certificat d’achèvement se trouvent dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Download your copy | Télécharger votre copie | Machine draft |

## EM09-staff: Agreement executed (staff variant of EM09)

The last signer signs (outbox agreement.executed, template signature, audience staff), to staff signers. Audience: staff. [French preview](../email/previews/fr/EM09-staff.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:ced88bf04115…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | An agreement at {firm_name} is signed | Une convention chez {firm_name} est signée | Machine draft. Keep {firm_name} |
| `preheader` | The firm’s copy is on the matter in Casevoya. | La copie du cabinet est sur le dossier dans Casevoya. | Machine draft |
| `heading` | Everyone has signed | Tout le monde a signé | Machine draft. Same English as another template; same French reused. |
| `body` | An agreement you signed is now signed by everyone. The firm’s copy and the completion certificate are on the matter in Casevoya. | Une convention que vous avez signée est maintenant signée par tous. La copie du cabinet et le certificat d’achèvement sont disponibles sur le dossier dans Casevoya. | Machine draft |
| `cta` | Open agreements | Ouvrir les conventions | Machine draft. Same English as another template; same French reused. |

## EM10: Invoice issued

Billing staff issue an invoice (outbox invoice.issued, template invoice), to the matter’s applicants. Honours email_notices. Audience: client. [French preview](../email/previews/fr/EM10.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:3408fccaeca8…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | New invoice from {firm_name} | Nouvelle facture de {firm_name} | Machine draft. Keep {firm_name} |
| `preheader` | The amount and payment options are in your portal. | Le montant et les options de paiement se trouvent dans votre portail. | Machine draft |
| `body_number_due` | Invoice {invoice_number} has a balance due on {due_date}. The amount and payment options are in your portal. | La facture {invoice_number} a un solde dû le {due_date}. Le montant et les options de paiement se trouvent dans votre portail. | Machine draft. Keep {due_date}, {invoice_number} |
| `body_due` | Your invoice has a balance due on {due_date}. The amount and payment options are in your portal. | Votre facture a un solde dû le {due_date}. Le montant et les options de paiement se trouvent dans votre portail. | Machine draft. Keep {due_date} |
| `body_number` | Invoice {invoice_number} is ready. The amount and payment options are in your portal. | La facture {invoice_number} est prête. Le montant et les options de paiement se trouvent dans votre portail. | Machine draft. Keep {invoice_number} |
| `body` | Your invoice is ready. The amount and payment options are in your portal. | Votre facture est prête. Le montant et les options de paiement se trouvent dans votre portail. | Machine draft |
| `cta` | View invoice | Afficher la facture | Machine draft |

## EM11: Payment receipt

An invoice payment receipt (PR-) or client-funds advance receipt (RC-) is issued. Hook: template payment_receipt; needs its enum value and an outbox event from app.issue_invoice_payment_receipt. Audience: client. [French preview](../email/previews/fr/EM11.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:d3d1b27e4df6…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} received your payment | {firm_name} a reçu votre paiement | Machine draft. Keep {firm_name} |
| `preheader` | Your receipt is in your portal. | Votre reçu se trouve dans votre portail. | Machine draft |
| `heading` | Payment received | Paiement reçu | Machine draft |
| `body_number` | {firm_name} received your payment. Receipt {receipt_number} is in your portal. | {firm_name} a reçu votre paiement. Le reçu {receipt_number} se trouve dans votre portail. | Machine draft. Keep {firm_name}, {receipt_number} |
| `body_advance_number` | {firm_name} received your advance payment. Receipt {receipt_number} is in your portal. | {firm_name} a reçu votre paiement anticipé. Le reçu {receipt_number} se trouve dans votre portail. | Machine draft. Keep {firm_name}, {receipt_number} |
| `body` | {firm_name} received your payment. Your receipt is in your portal. | {firm_name} a reçu votre paiement. Votre reçu se trouve dans votre portail. | Machine draft. Keep {firm_name} |
| `body_advance` | {firm_name} received your advance payment. Your receipt is in your portal. | {firm_name} a reçu votre paiement anticipé. Votre reçu se trouve dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | View receipt | Afficher le reçu | Machine draft |

## EM12: Bounced notice staff follow up

A critical client email bounces (finish_email_delivery opens the “Email was not delivered” task). No email yet. Audience: staff. [French preview](../email/previews/fr/EM12.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:af0e3d9bfef9…`

- « affaire » is used for matter; elsewhere the drafts use « dossier ». Choose one (Quebec immigration practice usually says « dossier »).

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | A client notice was not delivered | Un avis au client n’a pas été livré | Machine draft |
| `preheader` | A follow-up task is open in Casevoya. | Une tâche de suivi est ouverte dans Casevoya. | Machine draft |
| `heading` | Critical notice not delivered | Avis critique non livré | Machine draft |
| `body_reference` | A notice on matter {matter_reference} bounced and was not delivered. A follow-up task was created. | Un avis concernant l’affaire {matter_reference} a rebondi et n’a pas été livré. Une tâche de suivi a été créée. | Machine draft. Keep {matter_reference} |
| `body` | A client notice bounced and was not delivered. A follow-up task was created. | Un avis destiné à un client a rebondi et n’a pas été livré. Une tâche de suivi a été créée. | Machine draft |
| `cta` | Open task | Ouvrir la tâche | Machine draft |

## EM15: Decision recorded

Staff record a government decision on the matter. No outbox mail event yet. Audience: client. [French preview](../email/previews/fr/EM15.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:b03c14d2760f…`

- preheader and body translate « For your privacy » three different ways; choose one.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | There’s news on your file | Il y a des nouvelles sur votre dossier | Machine draft |
| `preheader` | For your privacy, the details are in your portal. | Pour votre confidentialité, les détails se trouvent dans votre portail. | Machine draft |
| `body_consultant` | {firm_name} recorded a decision on your file. For your privacy, the details are in your portal. {consultant_name} will contact you about next steps. | {firm_name} a enregistré une décision concernant votre dossier. Pour protéger votre vie privée, les détails se trouvent dans votre portail. {consultant_name} communiquera avec vous au sujet des prochaines étapes. | Machine draft. Keep {consultant_name}, {firm_name} |
| `body` | {firm_name} recorded a decision on your file. For your privacy, the details are in your portal. {firm_name} will contact you about next steps. | {firm_name} a enregistré une décision concernant votre dossier. Pour des raisons de confidentialité, les détails se trouvent dans votre portail. {firm_name} communiquera avec vous au sujet des prochaines étapes. | Machine draft. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Machine draft. Same English as another template; same French reused. |

## EM16a: Consultation booked

A consultation is booked on the public booking page (or a practice page in sample mode) or by staff (outbox booking.confirmed, template consultation_booked), to the attendee. Honours email_notices when linked to a person. The portal button only for an attendee whose person has a portal login. Audience: client. [French preview](../email/previews/fr/EM16a.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:118205fd2d0d…`

- subject « est prise » vs heading « est réservée »: make consistent.

- when: the machine draft dropped the final period; the English has one.

- cta « Voir la réservation » vs EM16b/EM16c wording « rendez-vous »: choose one.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your consultation with {firm_name} is booked | Votre consultation avec {firm_name} est prise | Machine draft. Keep {firm_name} |
| `preheader` | Here’s when, and how you’ll meet. | Voici quand et comment vous vous rencontrerez. | Machine draft |
| `heading` | Your consultation is booked | Votre consultation est réservée | Machine draft |
| `when_consultant` | {date_time} ({time_zone_label}) with {consultant_name}. | {date_time} ({time_zone_label}) avec {consultant_name}. | Machine draft. Keep {consultant_name}, {date_time}, {time_zone_label} |
| `when` | {date_time} ({time_zone_label}). | {date_time} ({time_zone_label}) | Machine draft. Keep {date_time}, {time_zone_label}. **Final punctuation differs from the English.** |
| `consultant` | Your consultation with {consultant_name}. | Votre consultation avec {consultant_name}. | Machine draft. Keep {consultant_name} |
| `plain` | Your consultation. | Votre consultation. | Machine draft |
| `meet_phone` | {firm_name} will call you at the number you gave. | {firm_name} vous appellera au numéro que vous avez fourni. | Machine draft. Keep {firm_name} |
| `meet_link` | {firm_name} will send you the meeting link. | {firm_name} vous enverra le lien de la réunion. | Machine draft. Keep {firm_name} |
| `meet_address` | At {address}. | À {address}. | Machine draft. Keep {address} |
| `meet_confirm_address` | {firm_name} will confirm the address. | {firm_name} confirmera l’adresse. | Machine draft. Keep {firm_name} |
| `cta` | View booking | Voir la réservation | Machine draft |

## EM16b: Consultation rescheduled

Staff move a confirmed consultation (outbox booking.rescheduled, template consultation_rescheduled), to the attendee. The portal button only for an attendee whose person has a portal login. Audience: client. [French preview](../email/previews/fr/EM16b.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:655f41dc335a…`

- subject: « Votre rendez-vous avec {firm_name} reporté » lacks a verb (« a été déplacé »).

- preheader « l’heure nouvelle » → « la nouvelle heure ».

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your appointment with {firm_name} moved | Votre rendez-vous avec {firm_name} reporté | Machine draft. Keep {firm_name} |
| `preheader_portal` | The new time is in your portal. | Le nouvel horaire est dans votre portail. | Machine draft |
| `preheader` | Here’s the new time. | Voici l’heure nouvelle. | Machine draft |
| `heading` | Your appointment moved | Votre rendez-vous a été déplacé | Machine draft |
| `moved_when` | Your consultation is now {date_time} ({time_zone_label}). | Votre consultation est maintenant {date_time} ({time_zone_label}). | Machine draft. Keep {date_time}, {time_zone_label} |
| `moved` | Your consultation has a new time. | Votre consultation a un nouvel horaire. | Machine draft |
| `reminders_moved` | Your reminders moved too. | Vos rappels ont également été déplacés. | Machine draft |
| `portal_no_time` | Your consultation has a new time. It’s in your portal, and your reminders moved too. | Votre consultation a une nouvelle heure. Elle se trouve dans votre portail, et vos rappels ont également été déplacés. | Machine draft |
| `cta` | View booking | Voir la réservation | Machine draft. Same English as another template; same French reused. |

## EM16c: Consultation cancelled

Staff cancel an upcoming confirmed consultation, or the attendee cancels it from their portal (outbox booking.cancelled, template consultation_cancelled; cancelled_by says which), to the attendee. Portal attendees get the portal button; others get the firm's booking page when it has a published one they can use, otherwise no button. Audience: client. [French preview](../email/previews/fr/EM16c.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:2742831211cb…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} cancelled your consultation | {firm_name} a annulé votre consultation | Machine draft. Keep {firm_name} |
| `preheader_portal` | You can book another time in your portal. | Vous pouvez prendre un autre rendez-vous dans votre portail. | Machine draft |
| `preheader_page` | You can book another time online. | Vous pouvez prendre un autre rendez-vous en ligne. | Machine draft |
| `preheader` | To book another time, contact the firm. | Pour prendre un autre rendez-vous, communiquez avec le cabinet. | Machine draft |
| `heading` | Your consultation was cancelled | Votre consultation a été annulée | Machine draft |
| `body_when` | Your consultation on {date_time} ({time_zone_label}) was cancelled by {firm_name}. | Votre consultation du {date_time} ({time_zone_label}) a été annulée par {firm_name}. | Machine draft. Keep {date_time}, {firm_name}, {time_zone_label} |
| `body` | Your consultation was cancelled by {firm_name}. | Votre consultation a été annulée par {firm_name}. | Machine draft. Keep {firm_name} |
| `subject_self` | Your consultation with {firm_name} is cancelled | Votre consultation avec {firm_name} est annulée | Hand draft. Portal appointments (2026-10-19): the attendee cancelled from their portal. Hand draft, not reviewed. Keep {firm_name} |
| `body_when_self` | You cancelled your consultation on {date_time} ({time_zone_label}) with {firm_name}. | Vous avez annulé votre consultation du {date_time} ({time_zone_label}) avec {firm_name}. | Hand draft. Portal appointments (2026-10-19): the attendee cancelled from their portal. Hand draft, not reviewed. Keep {date_time}, {firm_name}, {time_zone_label} |
| `body_self` | You cancelled your consultation with {firm_name}. | Vous avez annulé votre consultation avec {firm_name}. | Hand draft. Portal appointments (2026-10-19): the attendee cancelled from their portal. Hand draft, not reviewed. Keep {firm_name} |
| `contact_to_book` | To book another time, contact {firm_name}. | Pour prendre un autre rendez-vous, communiquez avec {firm_name}. | Machine draft. Keep {firm_name} |
| `cta` | Book another time | Prendre un autre rendez-vous | Machine draft |

## EM17: Support access granted

A firm owner approves a Casevoya support access request (approve_support_access_request; outbox support_access.approved, template support_granted), to every active firm owner at their sign-in address. The approver's name, the minutes, the end time in the firm's zone; never the matter or the reason. Audience: firm owner. [French preview](../email/previews/fr/EM17.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:d1e82f0bd39e…`

- « support » is an anglicism here; OQLF prefers « assistance » or « soutien technique ». default_approver « un propriétaire » is masculine.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | You gave Casevoya support access | Vous avez accordé l’accès au support Casevoya | Machine draft |
| `preheader` | Every action is in your audit trail. You can end it now. | Chaque action est consignée dans votre journal d’audit. Vous pouvez y mettre fin maintenant. | Machine draft |
| `default_approver` | A firm owner | un propriétaire de cabinet | Machine draft |
| `approved_minutes` | {approver_name} approved {minutes} minutes of support access on one matter. | {approver_name} a approuvé {minutes} minutes d’accès au soutien pour une affaire. | Machine draft. Keep {approver_name}, {minutes} |
| `approved` | {approver_name} approved support access on one matter. | {approver_name} a approuvé l’accès au soutien pour une affaire. | Machine draft. Keep {approver_name} |
| `ends` | It ends {date_time}. | Cela se termine {date_time}. | Machine draft. Keep {date_time} |
| `audit` | Every action is in your audit trail, and you can end it now. | Chaque action est consignée dans votre journal d’audit, et vous pouvez la terminer maintenant. | Machine draft |
| `cta` | Review or end access | Examiner ou mettre fin à l’accès | Machine draft |

## EM18a: Subscription past due

The Casevoya subscription payment fails. Subscription billing is not built yet. Audience: firm owner. [French preview](../email/previews/fr/EM18a.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:9c55851a3641…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your Casevoya subscription is past due | Votre abonnement Casevoya est en retard | Machine draft |
| `preheader` | Nothing is deleted. Update billing to keep working. | Rien n’est supprimé. Mettez à jour la facturation pour continuer à travailler. | Machine draft |
| `body` | We couldn’t collect {firm_name}’s subscription payment. Nothing is deleted; new work pauses after notice if it stays unpaid. | Nous n’avons pas pu collecter le paiement de l’abonnement de {firm_name}. Rien n’est supprimé&#8239;; les nouveaux travaux sont mis en pause après un avis si celui-ci reste impayé. | Machine draft. Keep {firm_name} |
| `cta` | Update billing | Mettre à jour la facturation | Machine draft |

## EM18b: Workspace restricted

The subscription stays past due. Subscription billing is not built yet. Audience: firm owner. [French preview](../email/previews/fr/EM18b.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:18a010908d7f…`

- body: « versions de soumission » / « publications » for submission releases: confirm the term.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name}’s workspace is restricted | L’espace de travail de {firm_name} est restreint | Machine draft. Keep {firm_name} |
| `preheader` | Clients can still sign in, upload and pay. Nothing is deleted. | Les clients peuvent toujours se connecter, téléverser et payer. Rien n’est supprimé. | Machine draft |
| `body_days` | Your subscription has been past due for {days} days, so new matters, invitations and submission releases are paused. Clients can still sign in, upload and pay, and nothing is deleted. | Votre abonnement est en retard depuis {days} jours, donc les nouvelles affaires, les invitations et les versions de soumission sont suspendues. Les clients peuvent toujours se connecter, téléverser et payer, et rien n’est supprimé. | Machine draft. Keep {days} |
| `body` | Your subscription has been past due, so new matters, invitations and submission releases are paused. Clients can still sign in, upload and pay, and nothing is deleted. | Votre abonnement est en retard, vos nouveaux dossiers, invitations et publications sont donc en pause. Les clients peuvent toujours se connecter, téléverser et payer, et rien n’est supprimé. | Machine draft |
| `cta` | Update billing | Mettre à jour la facturation | Machine draft. Same English as another template; same French reused. |

## EM19a: Data export ready

A client-file export finishes. Exports are not built yet. Audience: staff. [French preview](../email/previews/fr/EM19a.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:e5011f630d01…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your export is ready | Votre exportation est prête | Machine draft |
| `preheader` | Sign in to download it. | Connectez-vous pour le télécharger. | Machine draft |
| `body_hours` | The client-file export you started is ready. The link works for {hours} hours and needs you to sign in. | L’exportation de votre dossier client que vous avez lancée est prête. Le lien est valide pendant {hours} heures et nécessite que vous vous connectiez. | Machine draft. Keep {hours} |
| `body` | The client-file export you started is ready. The link needs you to sign in. | L’exportation de votre dossier client que vous avez lancée est prête. Le lien nécessite que vous vous connectiez. | Machine draft |
| `cta` | Download export | Télécharger l’exportation | Machine draft |

## EM19b: Data export expiring

An unopened export nears expiry. Exports are not built yet. Audience: staff. [French preview](../email/previews/fr/EM19b.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:9ee735bb2815…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your client-file export expires soon | L’exportation de votre dossier client expire bientôt | Machine draft |
| `preheader` | Download it before the link expires. | Téléchargez-le avant que le lien n’expire. | Machine draft |
| `expires_started_hour` | The export you started on {short_date} expires in 1 hour. | L’exportation que vous avez lancée le {short_date} expire dans 1 heure. | Machine draft. Keep {short_date} |
| `expires_started_hours` | The export you started on {short_date} expires in {hours} hours. | L’exportation que vous avez lancée le {short_date} expire dans {hours} heures. | Machine draft. Keep {hours}, {short_date} |
| `expires_started` | The export you started on {short_date} expires soon. | L’exportation que vous avez lancée le {short_date} expire bientôt. | Machine draft. Keep {short_date} |
| `expires_hour` | The export you started expires in 1 hour. | L’exportation que vous avez lancée expire dans 1 heure. | Machine draft |
| `expires_hours` | The export you started expires in {hours} hours. | L’exportation que vous avez lancée expire dans {hours} heures. | Machine draft. Keep {hours} |
| `expires` | The export you started expires soon. | L’exportation que vous avez lancée expire bientôt. | Machine draft |
| `after` | After that you can start a new one; nothing in the file changes. | Après cela, vous pouvez en commencer un nouveau&#8239;; rien dans le dossier ne change. | Machine draft |
| `cta` | Download export | Télécharger l’exportation | Machine draft. Same English as another template; same French reused. |

## EX02: New sign in alert

A staff sign-in from a new device. No device tracking event yet. Audience: staff. [French preview](../email/previews/fr/EX02.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:14ac3e8d48e2…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | New sign-in to your Casevoya account | Nouvelle connexion à votre compte Casevoya | Machine draft |
| `preheader` | If it wasn’t you, sign out everywhere now. | Si ce n’était pas vous, déconnectez-vous partout maintenant. | Machine draft |
| `heading` | New sign-in to your account | Nouvelle connexion à votre compte | Machine draft |
| `body_device` | Someone signed in to {firm_name} on a new device ({device}). If it wasn’t you, sign out everywhere now. | Quelqu’un s’est connecté à {firm_name} sur un nouvel appareil ({device}). Si ce n’était pas vous, déconnectez-vous partout maintenant. | Machine draft. Keep {device}, {firm_name} |
| `body` | Someone signed in to {firm_name} on a new device. If it wasn’t you, sign out everywhere now. | Quelqu’un s’est connecté à {firm_name} sur un nouvel appareil. Si ce n’était pas vous, déconnectez-vous partout immédiatement. | Machine draft. Keep {firm_name} |
| `cta` | Review sign-ins | Examiner les connexions | Machine draft |

## EX03: Invitation expired

A staff invitation passes its 7 days unused. No expiry event yet. Audience: staff. [French preview](../email/previews/fr/EX03.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:190715eb775f…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your invitation to {firm_name} expired | Votre invitation à {firm_name} a expiré | Machine draft. Keep {firm_name} |
| `preheader` | Ask the firm to send a new one. | Demandez au cabinet d’en envoyer un nouveau. | Machine draft |
| `heading` | Your invitation expired | Votre invitation a expiré | Machine draft |
| `body_inviter` | Your invitation to {firm_name} expired after 7 days. Ask {inviter_name} to send a new one. | Votre invitation à {firm_name} a expiré après 7 jours. Demandez à {inviter_name} d’en envoyer une nouvelle. | Machine draft. Keep {firm_name}, {inviter_name} |
| `body` | Your invitation to {firm_name} expired after 7 days. Ask the firm owner to send a new one. | Votre invitation à {firm_name} a expiré après 7 jours. Demandez au propriétaire du cabinet de vous en envoyer une nouvelle. | Machine draft. Keep {firm_name} |

## EX04: Dependant invite

Staff invite an adult dependant to their own login (portal_invitation.email_requested, role adult_dependant). Audience: adult dependant. [French preview](../email/previews/fr/EX04.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:00c11335811c…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} opened your own login | {firm_name} a ouvert votre propre connexion | Machine draft. Keep {firm_name} |
| `preheader` | Set up your login. You choose what you share. | Configurez votre connexion. Vous choisissez ce que vous partagez. | Machine draft |
| `heading` | You’re invited to share your file | Vous êtes invité à partager votre dossier | Machine draft |
| `lead` | {firm_name} has opened your own login for the family file. You choose what you share. | {firm_name} a ouvert votre propre connexion pour le dossier familial. Vous choisissez ce que vous partagez. | Machine draft. Keep {firm_name} |
| `cta` | Set up your login | Configurer votre connexion | Machine draft |

## EX05: Document needs another look

Staff reject a document version (outbox document.reviewed, decision not accepted). Currently skipped by prepare_email_delivery. Audience: client. [French preview](../email/previews/fr/EX05.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:8f53997f42da…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | A document needs another look | Un document nécessite un nouvel examen | Machine draft |
| `preheader` | The reason is in your portal. | La raison se trouve dans votre portail. | Machine draft |
| `body` | {firm_name} asked for a clearer copy of one of your documents. The reason is in your portal. | {firm_name} a demandé une copie plus claire d’un de vos documents. La raison se trouve dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Machine draft. Same English as another template; same French reused. |

## EX06: Document accepted

Staff accept a document version (outbox document.reviewed, decision accepted, template document_receipt). Audience: client. [French preview](../email/previews/fr/EX06.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:b555b1679190…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your document was accepted | Votre document a été accepté | Machine draft |
| `preheader` | Accepted by {firm_name}, not by the government. | Accepté par {firm_name}, mais pas par le gouvernement. | Machine draft. Keep {firm_name} |
| `body` | {firm_name} accepted one of your documents for your file. Accepted means accepted by {firm_name}, not by the government. | {firm_name} a accepté l’un de vos documents pour votre dossier. Accepté signifie accepté par {firm_name}, et non par le gouvernement. | Machine draft. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Machine draft. Same English as another template; same French reused. |

## EX06-received: Document received

A document upload passes the file check (outbox document.uploaded, template document_receipt). Audience: client. [French preview](../email/previews/fr/EX06-received.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:11f9b183bd92…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} received your document | {firm_name} a reçu votre document | Machine draft. Keep {firm_name} |
| `preheader` | It’s in your portal. | Ceci se trouve dans votre portail. | Machine draft |
| `heading` | Your document was received | Votre document a été reçu | Machine draft |
| `body` | {firm_name} received a document on your file. It’s in your portal. | {firm_name} a reçu un document relatif à votre dossier. Il se trouve dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Machine draft. Same English as another template; same French reused. |

## EX07: New message

Staff send a matter message (outbox message.sent, template message), to each person the thread is addressed to. Honours email_notices. Firm name only: never the message text. Audience: client. [French preview](../email/previews/fr/EX07.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:76558f9887c7…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | New message from {firm_name} | Nouveau message de {firm_name} | Machine draft. Keep {firm_name} |
| `preheader` | For your privacy, read it in your portal. | Pour votre confidentialité, lisez-le dans votre portail. | Machine draft |
| `heading` | You have a new message | Vous avez un nouveau message | Machine draft |
| `body` | {firm_name} sent you a message. For your privacy, read it in your portal. | {firm_name} vous a envoyé un message. Pour votre confidentialité, lisez-le dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Read message | Lire le message | Machine draft |

## EX08: Payment failed

A card payment fails (Stripe payment_intent.payment_failed moves invoice_payments to failed; outbox invoice.payment_failed, template payment_failed). Honours email_notices. Audience: client. [French preview](../email/previews/fr/EX08.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:a6d535eefc14…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your payment to {firm_name} didn’t go through | Votre paiement à {firm_name} n’a pas été traité | Machine draft. Keep {firm_name} |
| `preheader` | You haven’t been charged. You can try again in your portal. | Vous n’avez pas été facturé. Vous pouvez essayer à nouveau dans votre portail. | Machine draft |
| `heading` | We couldn’t take your payment | Nous n’avons pas pu prendre votre paiement | Machine draft |
| `body_number` | Your card payment to {firm_name} for invoice {invoice_number} didn’t go through. You haven’t been charged. You can try again in your portal. | Le paiement par carte pour la facture {invoice_number} de {firm_name} n’a pas été effectué. Vous n’avez pas été débité. Vous pouvez essayer à nouveau dans votre portail. | Machine draft. Keep {firm_name}, {invoice_number} |
| `body` | Your card payment to {firm_name} didn’t go through. You haven’t been charged. You can try again in your portal. | Votre paiement par carte à {firm_name} n’a pas été effectué. Vous n’avez pas été débité. Vous pouvez essayer à nouveau dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Open payments | Ouvrir les paiements | Machine draft |

## EX09: Refund started

Billing staff refund a card payment (invoice_refunds row recorded; outbox invoice.refund_started, template refund_started). Honours email_notices. Audience: client. [French preview](../email/previews/fr/EX09.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:fbb471777eab…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} started a refund | {firm_name} a initié un remboursement | Machine draft. Keep {firm_name} |
| `preheader` | Refunds usually take 5 to 10 business days to appear. | Les remboursements mettent habituellement 5 à 10 jours ouvrables pour apparaître. | Machine draft |
| `heading` | Your refund is on its way | Votre remboursement est en route | Machine draft |
| `body` | {firm_name} started a refund to your card. Refunds usually take 5 to 10 business days to appear. | {firm_name} a initié un remboursement sur votre carte. Les remboursements mettent généralement 5 à 10 jours ouvrables pour apparaître. | Machine draft. Keep {firm_name} |
| `cta` | View payments | Afficher les paiements | Machine draft |

## EX10: Refund complete

Not sent since 20261025530100: a card refund Stripe reports succeeded can still fail for up to 30 days and Stripe gives no final signal (docs.stripe.com/refunds#failed-refunds), so “complete” could be untrue. The client keeps EX09 (“on its way”) and gets EX20 if the refund fails. The renderer still maps template refund_complete here for mail queued before. Audience: client. [French preview](../email/previews/fr/EX10.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:5609f6110cbf…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your refund from {firm_name} is complete | Votre remboursement de {firm_name} est complet | Machine draft. Keep {firm_name} |
| `preheader` | The details are in your portal. | Les détails se trouvent dans votre portail. | Machine draft |
| `heading` | Your refund is complete | Votre remboursement est complet | Machine draft |
| `body` | {firm_name}’s refund has been sent. The details are in your portal. | Le remboursement de {firm_name} a été envoyé. Les détails se trouvent dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | View payments | Afficher les paiements | Machine draft. Same English as another template; same French reused. |

## EX20: Refund didn’t go through

Stripe reports a refund failed or canceled after the client was told it was on its way (refund.failed / refund.updated; invoice_refunds moves from pending, requires_action or succeeded to failed or canceled; outbox invoice.refund_failed, template refund_failed), to the same people as EX09. Once per refund, also when Stripe replays the event. Sent even when the client turned Email notices off (a money correction; Francis 2026-10-25); suppressed (bounced or complained) addresses are not. A plain-words reason only for a closed, expired, lost or stolen card; never Stripe's code (bug #215 check 6; copy approved by Francis 2026-10-25). Audience: client. [French preview](../email/previews/fr/EX20.html)

Status `machine_draft` · drafted 2026-10-25 · English hash `sha256:34b3867edc59…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your refund from {firm_name} didn’t go through | Votre remboursement de {firm_name} n’a pas abouti | Hand draft. EX20 hand draft (bug #215 refund correction). Not reviewed. Keep {firm_name} |
| `preheader` | The money hasn’t reached you. The firm will contact you. | L’argent ne vous est pas parvenu. Le cabinet communiquera avec vous. | Hand draft. EX20 hand draft (bug #215 refund correction). Not reviewed. |
| `heading` | Your refund didn’t go through | Votre remboursement n’a pas abouti | Hand draft. EX20 hand draft (bug #215 refund correction). Not reviewed. |
| `body` | The refund from {firm_name} didn’t go through, so the money hasn’t reached you. Please disregard our earlier email about this refund. {firm_name} will contact you to arrange it another way. | Le remboursement de {firm_name} n’a pas abouti; l’argent ne vous est donc pas parvenu. Veuillez ne pas tenir compte de notre courriel précédent au sujet de ce remboursement. {firm_name} communiquera avec vous pour le faire autrement. | Hand draft. EX20 hand draft (bug #215 refund correction). Not reviewed. Keep {firm_name} |
| `body_card` | The refund from {firm_name} didn’t go through because the card it was sent to is no longer active, so the money hasn’t reached you. Please disregard our earlier email about this refund. {firm_name} will contact you to arrange it another way. | Le remboursement de {firm_name} n’a pas abouti parce que la carte visée n’est plus active; l’argent ne vous est donc pas parvenu. Veuillez ne pas tenir compte de notre courriel précédent au sujet de ce remboursement. {firm_name} communiquera avec vous pour le faire autrement. | Hand draft. EX20 hand draft (bug #215 refund correction). Not reviewed. Keep {firm_name} |
| `cta` | View payments | Afficher les paiements | Hand draft. EX20 hand draft (bug #215 refund correction). Not reviewed. |

## EX19: New notice (announcement)

Staff with permission send an announcement from an approved firm template (send_announcement; outbox announcement.sent, template announcement), to each chosen client with a portal account. Honours email_notices. Never for a sample-mode firm. Firm name only: the announcement itself is in the portal (OPS-04). Audience: client. [French preview](../email/previews/fr/EX19.html)

Status `machine_draft` · drafted 2026-10-24 · English hash `sha256:1a45496c2bab…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | A new notice from {firm_name} | Un nouvel avis de {firm_name} | Hand draft. EX19 hand draft (OPS-04, #179). Not reviewed. Keep {firm_name} |
| `preheader` | Read it in your portal. | Lisez-le dans votre portail. | Hand draft. EX19 hand draft (OPS-04, #179). Not reviewed. |
| `heading` | You have a new notice from {firm_name} | Vous avez un nouvel avis de {firm_name} | Hand draft. EX19 hand draft (OPS-04, #179). Not reviewed. Keep {firm_name} |
| `body` | {firm_name} posted a notice for its clients. For your privacy, it is in your portal. | {firm_name} a publié un avis pour ses clients. Pour protéger votre vie privée, il se trouve dans votre portail. | Hand draft. EX19 hand draft (OPS-04, #179). Not reviewed. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Hand draft. EX19 hand draft (OPS-04, #179). Not reviewed. |

## EX18: New enquiry (staff)

Someone sends an enquiry from the firm's hosted page or website form (trigger leads_enquiry_notice; outbox lead.enquiry_received, template enquiry_received), to the firm's active owners and the lead's owner when set. Not for sample (practice) enquiries. Firm name only: never the enquirer's name or what they wrote (CRM-01). Audience: staff. [French preview](../email/previews/fr/EX18.html)

Status `machine_draft` · drafted 2026-10-24 · English hash `sha256:05b5307ba082…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | New enquiry for {firm_name} | Nouvelle demande pour {firm_name} | Hand draft. EX18 hand draft (CRM-01, #176). Keep {firm_name} |
| `preheader` | Open the Pipeline in Casevoya to read it. | Ouvrez le pipeline dans Casevoya pour la lire. | Hand draft. EX18 hand draft (CRM-01, #176). |
| `heading` | You have a new enquiry | Vous avez une nouvelle demande | Hand draft. EX18 hand draft (CRM-01, #176). |
| `body` | Someone sent {firm_name} an enquiry from your enquiry page or website form. For their privacy, the details are in the Pipeline. | Quelqu’un a envoyé une demande à {firm_name} depuis votre page de demande ou le formulaire de votre site. Pour protéger sa vie privée, les détails sont dans le pipeline. | Hand draft. EX18 hand draft (CRM-01, #176). Keep {firm_name} |
| `cta` | Open the Pipeline | Ouvrir le pipeline | Hand draft. EX18 hand draft (CRM-01, #176). |

## EX17: Consultant changed

Staff change a matter's responsible consultant from the matter's People tab (change_responsible_consultant; outbox matter.consultant_changed, template consultant_changed), to each person on the matter with a portal account. Honours email_notices. Firm name only: the new consultant's name is in the portal, not the email (ORG-06). Audience: client. [French preview](../email/previews/fr/EX17.html)

Status `machine_draft` · drafted 2026-10-24 · English hash `sha256:aec282098709…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | An update on your file from {firm_name} | Une mise à jour de votre dossier de {firm_name} | Hand draft. EX17 hand draft (ORG-06, #175). Keep {firm_name} |
| `preheader` | Your consultant has changed. See who in your portal. | Votre consultant a changé. Voyez qui dans votre portail. | Hand draft. EX17 hand draft (ORG-06, #175). |
| `heading` | Your consultant has changed | Votre consultant a changé | Hand draft. EX17 hand draft (ORG-06, #175). |
| `body` | A different consultant at {firm_name} is now responsible for your file, and your file stays with {firm_name}. For your privacy, their name is in your portal, along with anything you may need to sign. If you have questions or don't agree with this change, contact {firm_name}. | Un autre consultant de {firm_name} est maintenant responsable de votre dossier, qui reste chez {firm_name}. Pour protéger votre vie privée, son nom figure dans votre portail, avec tout document que vous pourriez avoir à signer. Si vous avez des questions ou n'êtes pas d'accord avec ce changement, communiquez avec {firm_name}. | Hand draft. EX17 hand draft (ORG-06, #175). Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Hand draft. EX17 hand draft (ORG-06, #175). |

## EX16: Signing code

The booker asks for a code on a consultation agreement's private signing page (issue_booking_agreement_code; outbox booking_agreement.code, template signing_code), to the booking's primary attendee. The code is sealed by the app and opened by the mail worker; it works for 10 minutes. Honours email_notices. Copy pending Francis (#166). Audience: client. [French preview](../email/previews/fr/EX16.html)

Status `machine_draft` · drafted 2026-10-23 · English hash `sha256:cf8ca1398997…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Your signing code from {firm_name} | Votre code de signature de {firm_name} | Hand draft. EX16 hand draft (#166). Keep {firm_name} |
| `preheader` | It works for 10 minutes. | Il est valide pendant 10 minutes. | Hand draft. EX16 hand draft (#166). |
| `heading` | Your signing code | Votre code de signature | Hand draft. EX16 hand draft (#166). |
| `body` | Enter this code to confirm it’s you and sign your consultation agreement from {firm_name}. It works for 10 minutes. If you didn’t ask for it, you can ignore this email. | Entrez ce code pour confirmer votre identité et signer votre convention de consultation de {firm_name}. Il est valide pendant 10 minutes. Si vous ne l’avez pas demandé, vous pouvez ignorer ce courriel. | Hand draft. EX16 hand draft (#166). Keep {firm_name} |
| `body_missing` | Your code from {firm_name} couldn’t be added to this email. Go back to the signing page and ask for a new code. | Votre code de {firm_name} n’a pas pu être ajouté à ce courriel. Retournez à la page de signature et demandez un nouveau code. | Hand draft. EX16 hand draft (#166). Keep {firm_name} |

## EX11: Support access requested

Casevoya support asks a firm for access from the admin portal (create_support_access_request; outbox support_access.requested, template support_requested), to every active firm owner at their sign-in address. The minutes asked for only; never the matter or the reason. Audience: firm owner. [French preview](../email/previews/fr/EX11.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:d2d35292fe75…`

- « support Casevoya »: see EM17.

- « Rien ne s’ouvre à moins que vous n’approuviez » is awkward; consider « Aucun accès n’est ouvert sans votre approbation ».

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | Casevoya support asked for access | Le support Casevoya a demandé l’accès | Machine draft |
| `preheader` | Nothing opens unless you approve. | Rien ne s’ouvre à moins que vous n’approuviez. | Machine draft |
| `heading` | Support access requested | Accès au support demandé | Machine draft |
| `body_minutes` | Casevoya support asked for {minutes} minutes of access to one matter at {firm_name}. Nothing opens unless you approve. | Le support Casevoya a demandé {minutes} minutes d’accès à une affaire au cabinet {firm_name}. Rien ne s’ouvrira sans votre approbation. | Machine draft. Keep {firm_name}, {minutes} |
| `body` | Casevoya support asked for access to one matter at {firm_name}. Nothing opens unless you approve. | Le support Casevoya a demandé l’accès à une affaire chez {firm_name}. Rien ne s’ouvre à moins que vous n’approuviez. | Machine draft. Keep {firm_name} |
| `cta` | Review request | Examiner la demande | Machine draft |

## EX12: Licence check attention

The register re-check cannot confirm a consultant’s licence. Re-check reminders are not wired to email yet. Audience: firm owner. [French preview](../email/previews/fr/EX12.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:9ac41e7b7dde…`

- « licence »: CICC's French materials say « permis » (titulaire de permis). cta already says « permis »; align subject and body.

- « engagements » for new engagements (mandats?): confirm.

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | A licence check needs attention | Vérification de licence nécessitant une attention | Machine draft |
| `preheader` | Open Licences in Casevoya to review it. | Ouvrir les licences dans Casevoya pour l’examiner. | Machine draft |
| `body_consultant` | The register check couldn’t confirm {consultant_name}’s licence. New engagements and submission releases are paused. | La vérification du registre n’a pas pu confirmer la licence de {consultant_name}. Les nouveaux engagements et les soumissions sont suspendus. | Machine draft. Keep {consultant_name} |
| `body` | The register check couldn’t confirm a consultant’s licence. New engagements and submission releases are paused. | La vérification du registre n’a pas pu confirmer la licence du consultant. Les nouveaux engagements et les publications sont suspendus. | Machine draft |
| `cta` | Open licences | Ouvrir les permis | Machine draft |

## EX13: Privacy request received

A client makes a privacy request. Privacy requests are not built yet. Audience: client. [French preview](../email/previews/fr/EX13.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:db111c7bf8a7…`

- « demande de confidentialité » for a privacy (access) request: consider « demande d’accès à vos renseignements personnels ».

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} received your privacy request | {firm_name} a reçu votre demande de confidentialité | Machine draft. Keep {firm_name} |
| `preheader` | You can follow it in your portal. | Vous pouvez le suivre dans votre portail. | Machine draft |
| `heading` | We received your privacy request | Nous avons reçu votre demande de confidentialité | Machine draft |
| `body_by` | {firm_name} received your request to see your records. They’ll reply by {due_date}. | {firm_name} a reçu votre demande pour consulter vos dossiers. Ils vous répondront au plus tard {due_date}. | Machine draft. Keep {due_date}, {firm_name} |
| `body` | {firm_name} received your request to see your records. | {firm_name} a reçu votre demande pour consulter vos dossiers. | Machine draft. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Machine draft. Same English as another template; same French reused. |

## EX14: Complaint received

A client files a complaint. Complaints are not built yet. Audience: client. [French preview](../email/previews/fr/EX14.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:9253833dcd54…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | {firm_name} received your complaint | {firm_name} a reçu votre plainte | Machine draft. Keep {firm_name} |
| `preheader` | We’ll respond in writing. | Nous allons répondre par écrit. | Machine draft |
| `heading` | We received your complaint | Nous avons reçu votre plainte | Machine draft |
| `body_by_handler` | {firm_name} received your complaint and will respond by {due_date}. It’s handled by {handler_name}. | {firm_name} a reçu votre plainte et y répondra au plus tard {due_date}. Elle est traitée par {handler_name}. | Machine draft. Keep {due_date}, {firm_name}, {handler_name} |
| `body_by` | {firm_name} received your complaint and will respond by {due_date}. | {firm_name} a reçu votre plainte et y répondra au plus tard {due_date}. | Machine draft. Keep {due_date}, {firm_name} |
| `body_handler` | {firm_name} received your complaint and will respond in writing. It’s handled by {handler_name}. | {firm_name} a reçu votre plainte et y répondra par écrit. Elle est traitée par {handler_name}. | Machine draft. Keep {firm_name}, {handler_name} |
| `body` | {firm_name} received your complaint and will respond in writing. | {firm_name} a reçu votre plainte et y répondra par écrit. | Machine draft. Keep {firm_name} |

## generic: Generic update

Sent for a database template the renderer does not know. [French preview](../email/previews/fr/generic.html)

Status `machine_draft` · drafted 2026-10-18 · English hash `sha256:7123e1ebd8ed…`

| Key | English | French draft | Notes for the reviewer |
|---|---|---|---|
| `subject` | An update from {firm_name} | Mise à jour de {firm_name} | Machine draft. Keep {firm_name} |
| `preheader` | The details are in your portal. | Les détails se trouvent dans votre portail. | Machine draft. Same English as another template; same French reused. |
| `heading` | There’s an update on your file | Mise à jour de votre dossier | Machine draft |
| `body` | {firm_name} has an update for you. For your privacy, the details are in your portal. | {firm_name} a une mise à jour pour vous. Pour votre confidentialité, les détails se trouvent dans votre portail. | Machine draft. Keep {firm_name} |
| `cta` | Open your portal | Ouvrir votre portail | Machine draft. Same English as another template; same French reused. |
