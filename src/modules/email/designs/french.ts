/**
 * The French sending gate. An email goes out in French only when BOTH:
 *   (a) the recipient prefers French: person_contact_preferences.locale = 'fr-CA' (the portal
 *       Account page's "Français"; the mail worker passes it as context.locale), and
 *   (b) that template's French is approved in fr-drafts.json: status "approved" with a named
 *       reviewer and a review date, the shared shell strings (_shared) approved the same way,
 *       every string's English still equal to the current English source (not stale), and every
 *       French string carrying exactly the English string's placeholders.
 * Otherwise the English email is sent. Machine output is always "machine_draft", so nothing is
 * sent in French until a person approves it in a reviewed change to fr-drafts.json
 * (docs/i18n/README.md). There is no runtime switch.
 */
import { EN_SOURCE, FR_DRAFTS, type DraftFile, type LocalizedId } from "@/modules/email/designs/localized";
import { samePlaceholders } from "@/modules/i18n/typography";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a template's French may not be sent, or null when it may. */
export function frenchBlocker(id: string, drafted: DraftFile = FR_DRAFTS): string | null {
  const english = EN_SOURCE[id];
  const entry = drafted.templates[id];
  if (!english || !entry) return "no_french";
  if (entry.status !== "approved") return "not_approved";
  if (typeof entry.reviewer !== "string" || entry.reviewer.trim().length < 3) return "no_reviewer";
  if (typeof entry.reviewedOn !== "string" || !ISO_DATE.test(entry.reviewedOn)) return "no_review_date";
  const keys = Object.keys(english);
  if (Object.keys(entry.strings).length !== keys.length) return "stale";
  for (const key of keys) {
    const item = entry.strings[key];
    if (!item || item.en !== english[key]) return "stale";
    if (typeof item.fr !== "string" || !item.fr.trim()) return "missing";
    if (!samePlaceholders(item.en, item.fr)) return "placeholders";
  }
  return null;
}

/** True when the template's French and the shared shell strings may be sent. */
export function frenchApproved(id: string, drafted: DraftFile = FR_DRAFTS): boolean {
  return frenchBlocker(id, drafted) === null && frenchBlocker("_shared", drafted) === null;
}

export function prefersFrench(locale: unknown): boolean {
  return locale === "fr-CA" || locale === "fr";
}

/** The language to send a template in, for a recipient's stored locale. */
export function chooseEmailLanguage(id: LocalizedId, locale: unknown, drafted: DraftFile = FR_DRAFTS): "en" | "fr" {
  return prefersFrench(locale) && frenchApproved(id, drafted) ? "fr" : "en";
}
