#!/usr/bin/env node
// Drafts fr-CA copy for every email in src/modules/email/designs/i18n-source.json with Workers AI
// and writes src/modules/email/designs/fr-drafts.json. Machine output is a DRAFT: every template
// it touches gets status "machine_draft" and no reviewer. Approval is a reviewed edit of that file
// (docs/i18n/README.md), never this script.
//
//   node scripts/i18n/draft-email-fr.mjs            draft what is missing or stale (needs credentials)
//   node scripts/i18n/draft-email-fr.mjs --check    no network: list stale drafts, exit 1 if any
//
// Needs CLOUDFLARE_API_TOKEN (Workers AI access) and CLOUDFLARE_ACCOUNT_ID (defaults to the account
// in wrangler.jsonc). Prints neither. Strings whose English and French are unchanged are kept, so a
// re-run only drafts what changed; a template keeps its approval only when nothing in it changed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { credentials, translate, PROMPT } from "./workers-ai.mjs";
import { sourceHash, staleDrafts } from "./source-hash.mjs";
import { frTypography, samePlaceholders } from "../../src/modules/i18n/typography.ts";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = path.join(root, "src/modules/email/designs/i18n-source.json");
const DRAFTS = path.join(root, "src/modules/email/designs/fr-drafts.json");

/**
 * Hand drafts. EM14a–c are the earlier hand-written French drafts (docs/EMAIL-TEMPLATES.md),
 * folded in where their English matches; the rest are article-free role phrases and the zone
 * label, which a sentence template cannot get right from a per-string machine translation.
 * Hand drafts are drafts too: they still need the reviewer's approval.
 */
const HAND = {
  "_shared.footer_firm": ["Envoyé par {firm_name} au moyen de Casevoya", "Existing hand draft (layout.ts footer)."],
  "_shared.zone_label": ["heure de {city}", "The code writes « heure d’ » before a vowel (heure d’Edmonton)."],
  "_shared.role_firm_owner": ["propriétaire du cabinet", "Article-free so it fits « à titre de {role_phrase} » in EM01."],
  "_shared.role_licensed_consultant": ["consultante ou consultant autorisé", "Article-free. App role name, not the regulated CICC title; check the wording."],
  "_shared.role_case_manager": ["gestionnaire de dossiers", "Article-free (EM01)."],
  "_shared.role_assistant": ["adjointe ou adjoint", "Article-free (EM01)."],
  "_shared.role_finance_user": ["responsable des finances", "Article-free (EM01)."],
  "_shared.role_other": ["membre de l’équipe", "Article-free (EM01)."],
  "EM02.subject": ["Votre dossier avec {firm_name} est prêt", "EM14a hand draft."],
  "EM02.preheader": ["Ouvrez votre lien privé pour créer votre accès au portail.", "EM14a hand draft."],
  "EM02.cta": ["Ouvrir votre portail", "EM14a hand draft."],
  "EM06.subject": ["{firm_name} vous demande un document", "EM14b hand draft (present tense; the English is past tense)."],
  "EM06.preheader": ["Téléversez-le en toute sécurité dans votre portail.", "EM14b hand draft."],
  "EM06.body": ["Veuillez téléverser un document à votre dossier. Les détails se trouvent dans votre portail.", "EM14b hand draft."],
  "EM06.cta": ["Ouvrir votre portail", "EM14b hand draft."],
  "EM07.preheader": ["Votre portail indique quoi faire.", "EM14c hand draft (drops « next »)."],
  "EM07.heading": ["Une étape arrive à échéance", "EM14c hand draft."],
  "EM07.body": ["Une étape de votre dossier arrive à échéance. Votre portail indique quoi faire.", "EM14c hand draft."],
  "EM07.cta": ["Ouvrir votre portail", "EM14c hand draft."],
};

function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** What a string is, from its key, sent to the model as context (prompt rule 8). */
export function kindOf(key) {
  if (key === "cta") return "button label";
  if (key.startsWith("subject")) return "email subject line";
  if (key.startsWith("preheader")) return "email preview text";
  if (key.startsWith("heading")) return "email heading";
  if (key === "tagline") return "email header tagline";
  if (key.startsWith("role_") || key === "your_firm" || key === "default_approver") return "short phrase inserted in a sentence";
  return "email paragraph";
}

async function machine(key, en, creds) {
  const kind = kindOf(key);
  let fr = frTypography(await translate(MODEL, en, creds, kind));
  if (!samePlaceholders(en, fr)) fr = frTypography(await translate(MODEL, en, creds, kind));
  const note = samePlaceholders(en, fr) ? undefined : "PLACEHOLDERS DIFFER FROM THE ENGLISH: fix before approval.";
  return { fr, note };
}

async function draft() {
  const source = readJson(SOURCE, {});
  const drafts = readJson(DRAFTS, { templates: {} });
  const creds = credentials();
  // Translation memory: the same English gets the same French across templates.
  const memory = new Map();
  for (const entry of Object.values(drafts.templates ?? {})) {
    for (const item of Object.values(entry.strings ?? {})) if (item.fr && item.origin === "machine") memory.set(item.en, item.fr);
  }
  for (const [key, [fr]] of Object.entries(HAND)) {
    const [id, name] = key.split(/\.(.+)/);
    const en = source[id]?.[name];
    if (en) memory.set(en, fr);
  }

  const out = {
    _readme:
      "French (fr-CA) email copy. Machine and hand drafts are drafts: a template is sent in French only when its status is approved with reviewer and reviewedOn set, _shared is approved too, and the English hash still matches. See docs/i18n/README.md.",
    templates: {},
  };
  for (const [id, strings] of Object.entries(source)) {
    const previous = drafts.templates?.[id];
    const hash = sourceHash(strings);
    const entry = {
      status: "machine_draft",
      reviewer: null,
      reviewedOn: null,
      model: MODEL,
      promptVersion: PROMPT.promptVersion,
      draftedOn: previous?.draftedOn ?? today(),
      sourceHash: hash,
      strings: {},
    };
    let changed = !previous || previous.sourceHash !== hash;
    for (const [key, en] of Object.entries(strings)) {
      const kept = previous?.strings?.[key];
      const hand = HAND[`${id}.${key}`];
      if (kept && kept.en === en && kept.fr) {
        entry.strings[key] = kept;
        continue;
      }
      changed = true;
      if (hand) {
        entry.strings[key] = { en, fr: hand[0], origin: "hand", note: hand[1] };
      } else if (memory.has(en)) {
        entry.strings[key] = { en, fr: memory.get(en), origin: "machine", note: "Same English as another template; same French reused." };
      } else {
        const { fr, note } = await machine(key, en, creds);
        memory.set(en, fr);
        entry.strings[key] = { en, fr, origin: "machine", ...(note ? { note } : {}) };
      }
      console.error(`drafted ${id}.${key}`);
    }
    if (!changed && previous) {
      // Nothing in this template changed: keep its status and reviewer as they were.
      Object.assign(entry, {
        status: previous.status,
        reviewer: previous.reviewer,
        reviewedOn: previous.reviewedOn,
        model: previous.model,
        promptVersion: previous.promptVersion,
        draftedOn: previous.draftedOn,
      });
    } else {
      entry.draftedOn = today();
    }
    out.templates[id] = entry;
  }
  writeFileSync(DRAFTS, `${JSON.stringify(out, null, 2)}\n`);
  console.error(`wrote ${path.relative(root, DRAFTS)}`);
}

function check() {
  const stale = staleDrafts(readJson(SOURCE, {}), readJson(DRAFTS, { templates: {} }));
  if (stale.length) {
    console.error(`Stale or missing French drafts (English changed): ${stale.join(", ")}`);
    console.error("Run node scripts/i18n/draft-email-fr.mjs, then have the French reviewed again.");
    process.exit(1);
  }
  console.error("Every French draft matches its English source.");
}

if (process.argv.includes("--check")) check();
else await draft();
