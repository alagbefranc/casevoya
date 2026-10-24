/** Code entry when a factor is already verified. Setup otherwise. Explicit recovery and step-up steps stay available. */
export function mfaActiveStep(hasVerifiedFactor: boolean, requested: number | null): number {
  if (!hasVerifiedFactor) return 2;
  if (requested === 1 || requested === 5 || requested === 6) return requested;
  return 0;
}

/** The Designer's step-up line, written for exporting a client file. */
export const EXPORT_STEP_UP_LEAD = "Exporting a whole client file needs a fresh check, even when you’re already signed in.";

/** What the step-up page names: the line under the title and the action card below it. */
export type StepUpAction = { icon: string; title: string; detail: string };

/** The Designer's action card, written for exporting a client file. */
export const EXPORT_STEP_UP_ACTION: StepUpAction = { icon: "download", title: "Export a client file", detail: "All documents, forms and the audit trail" };

type StepUpKind = "export" | "reconciliation" | "other";

/** Where the person goes back to (`next`) after the check. */
function stepUpKind(next: string | null | undefined): StepUpKind {
  let url: URL | null = null;
  try {
    url = next ? new URL(next, "https://app.invalid") : null;
  } catch {
    url = null;
  }
  if (url?.pathname.startsWith("/sheet/exports")) return "export";
  if (url?.pathname === "/sheet/finance" && (url.searchParams.get("tab") === "reconciliation" || url.searchParams.get("dlg") === "recon")) {
    return "reconciliation";
  }
  return "other";
}

/** The step-up page's lead line for where the person goes back to (`next`), so it names what they were doing. */
export function stepUpLead(next: string | null | undefined): string {
  const kind = stepUpKind(next);
  if (kind === "export") return EXPORT_STEP_UP_LEAD;
  if (kind === "reconciliation") return "Signing a reconciliation needs a fresh check, even when you’re already signed in.";
  return "This needs a fresh check, even when you’re already signed in.";
}

/** The step-up page's action card for where the person goes back to (`next`). */
export function stepUpAction(next: string | null | undefined): StepUpAction {
  const kind = stepUpKind(next);
  if (kind === "export") return EXPORT_STEP_UP_ACTION;
  if (kind === "reconciliation") return { icon: "bank", title: "Sign a reconciliation", detail: "The month’s bank balance, control ledger and client ledgers" };
  return { icon: "arrow-right", title: "Finish what you were doing", detail: "You go back to the same page after the check" };
}
