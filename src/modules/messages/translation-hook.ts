/**
 * HOOK POINT: "Draft in French" (PRD OPS-04 "translation drafts").
 *
 * Another branch adds the translation helper at `src/modules/i18n/translate.ts`. This module is
 * the only place the messaging UI asks for it, so wiring it in is one change here:
 *
 *   import { translateDraft } from "@/modules/i18n/translate";
 *   export const draftTranslation: DraftTranslation | null = (text, locale) => translateDraft(...);
 *
 * Until then it is null and the composer shows no translate control. Whatever the helper returns
 * is a DRAFT the sender reviews and edits in the composer; only the text they send is stored.
 * Nothing is translated on the server and no message text is sent anywhere else.
 */
export type DraftTranslation = (text: string, locale: "fr-CA" | "en-CA") => Promise<{ text: string } | { error: string }>;

export const draftTranslation: DraftTranslation | null = null;
