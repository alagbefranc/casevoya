/** Pure helpers for Settings > Retention's Save: plain messages and the step-up round trip. */

/** public.set_firm_retention_policy's own refusals, in plain words; null for access refusals. */
export function retentionSaveError(message: string): string | null {
  if (/version conflict/i.test(message)) return "The retention period changed since you opened this page. Reload to see it.";
  if (/already the firm retention period/i.test(message)) return "That’s already the firm’s retention period.";
  if (/1 to 100/i.test(message)) return "Choose 1 to 100 years.";
  return null;
}

/** Where the step-up screen sends the owner back: this tab, with what they chose kept in this browser tab. */
export function retentionStepUpLocation(): string {
  return `/mfa?step=6&next=${encodeURIComponent("/sheet/settings?tab=retention")}`;
}

/** sessionStorage key for the period chosen before a step-up. */
export const RETENTION_DRAFT = "cv-retention-years";
