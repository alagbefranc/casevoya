/** Code entry when a factor is already verified. Setup otherwise. Explicit recovery and step-up steps stay available. */
export function mfaActiveStep(hasVerifiedFactor: boolean, requested: number | null): number {
  if (!hasVerifiedFactor) return 2;
  if (requested === 1 || requested === 5 || requested === 6) return requested;
  return 0;
}
