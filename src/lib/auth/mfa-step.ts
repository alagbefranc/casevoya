/** Code entry when a factor is already verified. Setup otherwise. Explicit recovery and step-up steps stay available. */
export function mfaActiveStep(hasVerifiedFactor: boolean, requested: number | null): number {
  if (!hasVerifiedFactor) return 2;
  if (requested === 1 || requested === 5 || requested === 6) return requested;
  return 0;
}

/** The Designer's step-up line, written for exporting a client file. */
export const EXPORT_STEP_UP_LEAD = "Exporting a whole client file needs a fresh check, even when you’re already signed in.";

/** The step-up page's lead line for where the person goes back to (`next`), so it names what they were doing. */
export function stepUpLead(next: string | null | undefined): string {
  let url: URL | null = null;
  try {
    url = next ? new URL(next, "https://app.invalid") : null;
  } catch {
    url = null;
  }
  if (url?.pathname.startsWith("/sheet/exports")) return EXPORT_STEP_UP_LEAD;
  if (url?.pathname === "/sheet/finance" && (url.searchParams.get("tab") === "reconciliation" || url.searchParams.get("dlg") === "recon")) {
    return "Signing a reconciliation needs a fresh check, even when you’re already signed in.";
  }
  return "This needs a fresh check, even when you’re already signed in.";
}
