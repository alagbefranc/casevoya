/**
 * Which version of staff-written client text a viewer sees: the French a staff member reviewed and
 * saved, when the viewer prefers French and it exists; otherwise the English. Pure.
 */
export type ShownText = { text: string; lang: "en" | "fr" };

export function textForViewer(english: string, french: string | null | undefined, locale: unknown): ShownText {
  if ((locale === "fr-CA" || locale === "fr") && typeof french === "string" && french.trim()) {
    return { text: french, lang: "fr" };
  }
  return { text: english, lang: "en" };
}
