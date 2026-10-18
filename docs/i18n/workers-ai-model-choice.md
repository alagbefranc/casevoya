# Workers AI model for French drafts

**Choice: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`**, with the fr-CA system prompt in
`src/modules/i18n/fr-ca.json` and the deterministic OQLF typography pass in
`src/modules/i18n/typography.ts`. It produces **drafts only**: every email draft is
`machine_draft` until a named reviewer approves it (`docs/i18n/README.md`), and every staff
"Draft in French" must be checked by the staff member before it is saved.

Decided by Francis on Claude's recommendation, 2026-10-18 (`docs/DECISIONS.md`). The scores
below are Claude's reading of the outputs, not a certified translator's assessment.

## Method

- **Catalog.** `GET /accounts/{account}/ai/models/search` on 2026-10-18 (account `c8010438…818a`).
  Translation models: `@cf/meta/m2m100-1.2b` (the only en↔fr one; `@cf/ai4bharat/indictrans2-en-indic-1B`
  is English↔Indic). Instruction models tried: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
  `@cf/mistralai/mistral-small-3.1-24b-instruct`, `@cf/google/gemma-4-26b-a4b-it`, `@cf/openai/gpt-oss-120b`.
  Also listed but not tried: `@cf/utter-project/eurollm-9b-it`, `@cf/meta/llama-4-scout-17b-16e-instruct`,
  `@cf/qwen/qwen3-30b-a3b-fp8`, `@cf/deepseek-ai/deepseek-v4-flash-0731`, `@cf/zai-org/glm-5.3`, and others.
- **Strings.** 17 real Casevoya strings (`scripts/i18n/compare-models.mjs`, `SAMPLES`): document
  request with a deadline, reminder subject, invoice balance due, advance-payment receipt,
  client-account trust wording, a receipt line with an amount (`CAD 1,000.00`), a client-account
  transfer with `{amount}`, the sign-in code, booking and cancellation with date/time and zone,
  document accepted, payment failed, refund timing, client invite, agreement ready, the CICC
  s. 32(g) withdrawal line, and a button label.
- **Calls.** Workers AI REST `POST /accounts/{account}/ai/run/{model}`. m2m100 with
  `{text, source_lang: "en", target_lang: "fr"}`. Instruction models with the system prompt and
  `temperature: 0` (gpt-oss through `instructions`/`input`, `reasoning.effort: low`).
- **Rounds.** Round 1, 2026-10-18T17:58Z, prompt `fr-ca-2026-10-18.1`, all five models. Round 2,
  2026-10-18T18:05Z, prompt `fr-ca-2026-10-18.2` (adds a glossary: convention, examiner, dossier,
  communiquer avec, prendre rendez-vous, en fidéicommis), the two leading models only.
  Re-run: `CLOUDFLARE_API_TOKEN=… node scripts/i18n/compare-models.mjs out.json [model …]`.

## Results

Scores 1 (poor) to 5 (good). "Placeholders" is mechanical: same `{…}` set as the English.

| Model (exact id) | Placeholders intact (round 1) | Fidelity | Register (vous, plain) | Quebec terms (OQLF) | Typography | Notes |
|---|---|---|---|---|---|---|
| `@cf/meta/m2m100-1.2b` | 13 / 17 | 1 | 3 | 1 | 1 | Drops whole sentences and placeholders (EM02, EM08, EM16c, EX06). "télécharger" for upload, "fichier" for file, "e-mail", "en confiance" for in trust, "Réception" for receipt, "CAD 1000.00". No prompt possible, so no glossary or placeholder rule. |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **17 / 17** (round 2: 17 / 17) | 4 | 5 | 5 | 3 | téléverser, courriel, compte client, **en fidéicommis**, **communiquez avec**, `1 000,00 $ CA`. Round 1 errors fixed by the glossary in round 2 ("accord de service" → convention de services, "Révisez-le" → Examinez-la). Remaining: "Voir réservation" (no article), "acompte" for advance. Apostrophes inconsistent (fixed by the typography pass). Fast; no reasoning tokens. |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 15 / 17 | 3 | 4 | 4 | 3 | Dropped `{firm_name}` (EX08). For the button "View booking" it invented a full sentence with new placeholders `{date}`, `{time}`, `{email}`, `{phone_number}`. "elle ne détient" (wrong pronoun for Casevoya). |
| `@cf/google/gemma-4-26b-a4b-it` | 12 / 17 (counting 6 empty answers) | n/a | 4 | 4 | 3 | 6 of 17 answers empty and one cut off (`La facture {invoice_number`), likely reasoning output using the token budget. Not retuned; unusable as configured. |
| `@cf/openai/gpt-oss-120b` | **17 / 17** (round 2: 17 / 17) | 3 | 4 | 3 | 4 | Best raw typography (U+202F before `;` `:`), but also scatters U+202F into "de 5", "30 jours", "art. 32" and uses non-breaking hyphens (U+2011) in "rendez‑vous", "Examinez‑la", which hurt search and copy-paste. Round 1: "fichier" for file, "Aucun frais n’a été appliqué" (meaning shift), "créneau", "contactez". Round 2 left "« Accepted »" in English inside the French. Slower (reasoning). |

## Why Llama 3.3 70B

- Every placeholder intact in both rounds, and no hallucinated content on short strings once
  the prompt says what kind of text it is (rule 8, prompt `fr-ca-2026-10-18.3`, added after
  the first full email draft turned "Update billing" into an invented paragraph).
- The most Quebec-appropriate vocabulary (fidéicommis, communiquez avec, courriel) and
  consistent vouvoiement.
- Plain output (no stray Unicode) that the deterministic typography pass makes OQLF-correct,
  so typography does not depend on the model.
- Fast and non-reasoning, which matters for the interactive staff "Draft in French".

gpt-oss-120b is the fallback candidate if Llama 3.3 70B leaves the catalog. Changing the model
means re-running the comparison, changing `MODEL` in `scripts/i18n/draft-email-fr.mjs` and
`TRANSLATE_MODEL` in `src/modules/i18n/translate.ts`, re-drafting, and re-reviewing.

## Draft run

`node scripts/i18n/draft-email-fr.mjs`, 2026-10-18, prompt `fr-ca-2026-10-18.3`: 36 templates
(35 catalog emails + the generic notice) and the shared shell strings, 233 strings in all
(19 hand drafts, the rest machine drafts). One machine draft (EM05 body) added `{firm_name}`;
it is flagged in the file and the review package, and the sending gate refuses a template
whose placeholders differ even if it is marked approved.
