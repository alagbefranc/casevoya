/**
 * MIG decision 7 (gap #187): a documents import can't be undone. Casevoya never deletes a stored
 * document, so rolling back an import removes none of its files (staff unlink a document from its
 * matter instead). The firm owner reads this plainly before each step that stores files: running
 * the pilot, signing the pilot off, and running the full import. Pure.
 */

export type IrreversibleStep = "pilot" | "signoff" | "full";

export type IrreversibleNotice = { tone: "bad"; title: string; copy: string };

export const DOCUMENTS_IRREVERSIBLE_TITLE = "Documents can’t be removed by rolling back this import";

const COPY: Record<IrreversibleStep, string> = {
  pilot:
    "The pilot stores its files on each person’s record, and nothing removes them afterwards: a document can only be unlinked from its matter, one at a time. Keep the pilot small and check its files.",
  signoff: "Check the pilot’s files before you sign off. The full import then stores every other file in the ZIP, and those can’t be removed by a rollback either.",
  full: "The full import stores every other file in the ZIP, and they can’t be removed by a rollback. Check the pilot’s files before you continue.",
};

/** The Sign off tab's warning for a documents import at this step. */
export function documentsIrreversibleNotice(step: IrreversibleStep): IrreversibleNotice {
  return { tone: "bad", title: DOCUMENTS_IRREVERSIBLE_TITLE, copy: COPY[step] };
}

/** The sentence every confirm dialog of a documents import carries, before the owner confirms. */
export function documentsIrreversibleConfirm(step: IrreversibleStep): string {
  return step === "signoff"
    ? "Documents can’t be removed by rolling back this import. Check the pilot’s files before you sign off."
    : step === "pilot"
      ? "Documents can’t be removed by rolling back this import, the pilot’s included. Check the pilot’s files before you sign off."
      : "Documents can’t be removed by rolling back this import. Every remaining file in the ZIP is stored.";
}
