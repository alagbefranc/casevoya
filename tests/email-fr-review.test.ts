/**
 * The French review package, kept as file snapshots of the drafts (like tests/email-previews.test.ts):
 *
 *   docs/i18n/email-fr-review.md        every template: English | French draft | notes for the reviewer
 *   docs/email/previews/fr/*.html       each template's French draft rendered with synthetic data
 *
 * Refresh with `pnpm email:previews`. This fails when fr-drafts.json or a builder changes and the
 * package was not regenerated, so the reviewer always sees what would be sent.
 */
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, type TemplateId } from "@/modules/email/designs/catalog";
import { escapeHtml, renderCopy } from "@/modules/email/designs/layout";
import { frenchBlocker } from "@/modules/email/designs/french";
import { EN_SOURCE, FR_DRAFTS, LOCALIZED_IDS, buildLocalized, type LocalizedId } from "@/modules/email/designs/localized";
import { placeholders, samePlaceholders } from "@/modules/i18n/typography";

const ORIGIN = "https://app.casevoya.ca";
const FIRM = "Maple Example Immigration";

/** What each placeholder holds at send time, with a French example. */
const PLACEHOLDER_HELP: Record<string, string> = {
  "{firm_name}": "the firm's display name, never translated (Maple Example Immigration)",
  "{inviter_name}": "a person's name, never translated",
  "{consultant_name}": "a person's name, never translated",
  "{approver_name}": "a person's name, never translated (or the default_approver phrase)",
  "{handler_name}": "a person's name, never translated",
  "{role_phrase}": "one of the _shared role_* phrases, article-free (gestionnaire de dossiers)",
  "{due_date}": "a date, written by the code: 6 novembre 2026 (1er mai 2026)",
  "{short_date}": "a short date, written by the code: 30 oct.",
  "{day_date}": "a date with the weekday, written by the code: vendredi 30 octobre 2026",
  "{date_time}": "date and 24-hour time in the attendee's or firm's zone: jeudi 22 octobre 2026 à 10 h 30 (on the hour: à 10 h)",
  "{time_zone_label}": "the zone, from _shared.zone_label: heure de Toronto, heure d’Edmonton",
  "{city}": "the last part of the IANA zone name (Toronto, Vancouver), not translated",
  "{invoice_number}": "an identifier such as INV-0001, never translated",
  "{receipt_number}": "an identifier such as PR-0001 or RC-0001, never translated",
  "{matter_reference}": "the firm's matter reference, never translated",
  "{address}": "the meeting address as the firm typed it, not translated",
  "{device}": "the browser and system as detected (Chrome on Windows); stays as detected",
  "{minutes}": "a whole number",
  "{hours}": "a whole number greater than 1 (1 has its own string)",
  "{days}": "a whole number",
};

/** Points the drafter noticed; the reviewer decides. Keyed by template id. */
const REVIEW_POINTS: Record<string, string[]> = {
  _shared: [
    "These strings appear in every French email (header tagline, footers, zone label, role phrases). Approve them first: no French email is sent while _shared is not approved.",
    "Role phrases are article-free hand drafts so they fit « à titre de / en tant que {role_phrase} ». « consultante ou consultant autorisé » is the app's role name, not the regulated CICC title; choose the wording.",
    "footer_platform: « consultants en immigration » vs « conseillers »: pick the firm's preferred term and use it everywhere.",
  ],
  EM01: ["lead: « Vous avez été invité » is masculine; consider an epicene wording (for example « Une invitation vous est faite… »)."],
  EM02: ["subject, preheader and cta are the earlier EM14a hand drafts. « au cabinet {firm_name} » reads oddly when the firm name already says Immigration; « de {firm_name} » may be better."],
  EM05: ["body: the machine draft ADDED {firm_name}, which the English does not have. Remove it (« de votre cabinet ») before approval; the gate refuses this template until the placeholders match."],
  EM06: ["subject, preheader, body and cta are the earlier EM14b hand drafts; subject is in the present tense where the English is past."],
  EM07: [
    "preheader, heading, body and cta are the earlier EM14c hand drafts.",
    "subject_due / heading_due / body_due: « est prévue {short_date} » lacks « le » (« est prévue le 30 oct. »); check each.",
  ],
  EM08: ["preheader: « Examinez-le » should agree with « convention » (« Examinez-la et signez-la »).", "body_consent / body_quote: « signez » vs « signez-le »: make consistent."],
  "EM08-staff": ["« Ouvrir Conventions dans Casevoya »: the Sheet's screen is labelled « Agreements » in English. Decide whether to name the English screen or describe it."],
  EM09: ["preheader says « certificat de complétion », body « certificat d’achèvement »: use one term."],
  EM12: ["« affaire » is used for matter; elsewhere the drafts use « dossier ». Choose one (Quebec immigration practice usually says « dossier »)."],
  EM15: ["preheader and body translate « For your privacy » three different ways; choose one."],
  EM16a: ["subject « est prise » vs heading « est réservée »: make consistent.", "when: the machine draft dropped the final period; the English has one.", "cta « Voir la réservation » vs EM16b/EM16c wording « rendez-vous »: choose one."],
  EM16b: ["subject: « Votre rendez-vous avec {firm_name} reporté » lacks a verb (« a été déplacé »).", "preheader « l’heure nouvelle » → « la nouvelle heure »."],
  EM17: ["« support » is an anglicism here; OQLF prefers « assistance » or « soutien technique ». default_approver « un propriétaire » is masculine."],
  EM18b: ["body: « versions de soumission » / « publications » for submission releases: confirm the term."],
  EX11: ["« support Casevoya »: see EM17.", "« Rien ne s’ouvre à moins que vous n’approuviez » is awkward; consider « Aucun accès n’est ouvert sans votre approbation »."],
  EX12: ["« licence »: CICC's French materials say « permis » (titulaire de permis). cta already says « permis »; align subject and body.", "« engagements » for new engagements (mandats?): confirm."],
  EX13: ["« demande de confidentialité » for a privacy (access) request: consider « demande d’accès à vos renseignements personnels »."],
};

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ").replaceAll("\u00a0", "&nbsp;").replaceAll("\u202f", "&#8239;");
}

function stringNotes(en: string, fr: string, origin: string, note: string | undefined): string {
  const notes: string[] = [];
  notes.push(origin === "hand" ? "Hand draft" : origin === "reviewer" ? "Reviewer's text" : "Machine draft");
  if (note) notes.push(note);
  const keep = [...new Set(placeholders(en))];
  if (keep.length) notes.push(`Keep ${keep.join(", ")}`);
  if (!samePlaceholders(en, fr)) notes.push("**Placeholders differ from the English: fix before approval.**");
  const end = (text: string) => text.trim().slice(-1);
  if (/[.!?]/.test(end(en)) !== /[.!?]/.test(end(fr))) notes.push("**Final punctuation differs from the English.**");
  return notes.join(". ").replaceAll("..", ".");
}

function previewPath(id: string): string {
  return `../email/previews/fr/${id}.html`;
}

/** The sample context of a template (generic: just the firm). */
function sample(id: LocalizedId): unknown {
  return id === "generic" ? { firmName: FIRM } : EMAIL_TEMPLATES[id as TemplateId].sample;
}

function reviewMarkdown(): string {
  const lines: string[] = [];
  lines.push("# French email copy: review package");
  lines.push("");
  lines.push("Generated from `src/modules/email/designs/fr-drafts.json` by `tests/email-fr-review.test.ts` (`pnpm email:previews`). Do not edit by hand.");
  lines.push("");
  lines.push("**For the certified translator (OTTIAQ member).** Every French string below is a DRAFT: a machine draft by Workers AI");
  lines.push(`(\`${FR_DRAFTS.templates.EM01.model}\`, prompt \`${FR_DRAFTS.templates.EM01.promptVersion}\`) or a hand draft. Nothing here is sent to anyone until a`);
  lines.push("named reviewer approves the template in the repository (see `docs/i18n/README.md`). Until then every client gets the English email.");
  lines.push("");
  lines.push("Conventions to apply: Canadian French (fr-CA), vouvoiement, OQLF typography (no-break space before `:`, narrow no-break space before `; ! ?`, « » with no-break spaces), 24-hour times written `14 h 30`, dates `mardi 20 octobre 2026`, amounts `1 250,00 $ CA`. Do not translate names of people or firms, identifiers (INV-0001, CN-0001, PR-0001, RC-0001), or {placeholders}. These emails name no immigration program or form; if one is ever added, keep the English name unless an official French name can be cited from the official source.");
  lines.push("");
  lines.push("Subjects and preheaders must not reveal a program, document name, amount or decision (they appear on lock screens). Copy has no em dashes.");
  lines.push("");
  lines.push("## Placeholders");
  lines.push("");
  lines.push("| Placeholder | What it holds at send time |");
  lines.push("|---|---|");
  for (const [name, help] of Object.entries(PLACEHOLDER_HELP)) lines.push(`| \`${name}\` | ${cell(help)} |`);
  lines.push("");
  lines.push("## Status");
  lines.push("");
  lines.push("| Template | Name | Status | Reviewer | Reviewed on | Would send French today? |");
  lines.push("|---|---|---|---|---|---|");
  for (const id of ["_shared", ...LOCALIZED_IDS]) {
    const entry = FR_DRAFTS.templates[id];
    const nameText = id === "_shared" ? "Shared shell strings" : id === "generic" ? "Generic update (unknown template)" : EMAIL_TEMPLATES[id as TemplateId].name;
    const blocker = frenchBlocker(id);
    lines.push(`| ${id} | ${cell(nameText)} | ${entry.status} | ${entry.reviewer ?? "—"} | ${entry.reviewedOn ?? "—"} | ${blocker ? `No (${blocker})` : "Yes"} |`);
  }
  for (const id of ["_shared", ...LOCALIZED_IDS]) {
    const entry = FR_DRAFTS.templates[id];
    lines.push("");
    if (id === "_shared") {
      lines.push("## _shared: header, footers and phrases used in every email");
    } else {
      const def = id === "generic" ? null : EMAIL_TEMPLATES[id as TemplateId];
      lines.push(`## ${id}: ${def ? def.name : "Generic update"}`);
      lines.push("");
      lines.push(def ? `${cell(def.trigger)}. Audience: ${def.audience}. [French preview](${previewPath(id)})` : `Sent for a database template the renderer does not know. [French preview](${previewPath(id)})`);
    }
    lines.push("");
    lines.push(`Status \`${entry.status}\` · drafted ${entry.draftedOn} · English hash \`${entry.sourceHash.slice(0, 19)}…\``);
    for (const point of REVIEW_POINTS[id] ?? []) {
      lines.push("");
      lines.push(`- ${point}`);
    }
    lines.push("");
    lines.push("| Key | English | French draft | Notes for the reviewer |");
    lines.push("|---|---|---|---|");
    for (const key of Object.keys(EN_SOURCE[id])) {
      const item = entry.strings[key];
      lines.push(`| \`${key}\` | ${cell(item.en)} | ${cell(item.fr)} | ${cell(stringNotes(item.en, item.fr, item.origin, item.note))} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function frenchPreview(id: LocalizedId): string {
  const email = renderCopy(buildLocalized(id, "fr", sample(id) as never, ORIGIN), ORIGIN);
  const status = FR_DRAFTS.templates[id].status;
  const inner = `${id} · FRENCH DRAFT (${status}) · not sent until approved · synthetic data · Subject: ${email.subject} · Preheader: ${email.preheader}`.replaceAll("--", "- -");
  return email.html.replace("<body", `<!-- ${inner} -->\n<body`);
}

describe("French review package", () => {
  it("docs/i18n/email-fr-review.md is current", async () => {
    await expect(reviewMarkdown()).toMatchFileSnapshot("../docs/i18n/email-fr-review.md");
  });

  it.each(LOCALIZED_IDS)("%s French preview is current", async (id) => {
    await expect(frenchPreview(id)).toMatchFileSnapshot(`../docs/email/previews/fr/${id}.html`);
  });

  it("indexes the French previews", async () => {
    const rows = LOCALIZED_IDS.map((id) => {
      const email = renderCopy(buildLocalized(id, "fr", sample(id) as never, ORIGIN), ORIGIN);
      return `  <tr><td><a href="${id}.html">${id}</a></td><td>${escapeHtml(FR_DRAFTS.templates[id].status)}</td><td>${escapeHtml(email.subject)}</td><td>${escapeHtml(email.preheader)}</td></tr>`;
    });
    const html =
      `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>Casevoya: aperçus des courriels en français (ébauches)</title>` +
      `<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}</style></head><body>\n` +
      `<h1>French email drafts (synthetic data)</h1>\n<p>Drafts only. Nothing is sent in French until a named reviewer approves the template (docs/i18n/README.md). Review table: docs/i18n/email-fr-review.md.</p>\n` +
      `<table><thead><tr><th>ID</th><th>Status</th><th>Subject</th><th>Preheader</th></tr></thead><tbody>\n` +
      `${rows.join("\n")}\n</tbody></table>\n</body></html>\n`;
    await expect(html).toMatchFileSnapshot("../docs/email/previews/fr/index.html");
  });
});
